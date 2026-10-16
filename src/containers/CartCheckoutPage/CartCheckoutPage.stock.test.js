jest.mock('../../util/api', () => ({
  initiatePrivileged: jest.fn(),
  estimateCartDelivery: jest.fn(),
  createOnfleetTask: jest.fn(),
  notifyTransition: jest.fn(),
  linkDeliveryItems: jest.fn(),
  reportCheckoutFailure: jest.fn(),
  redeemPromo: jest.fn(),
  confirmPromo: jest.fn(),
}));

const api = require('../../util/api');
const { processCartCheckout, default: reducer } = require('./CartCheckoutPage.duck');
const { applyStock } = require('../../ducks/cart.duck');

const makeItem = (listingId, quantity) => ({
  listingId,
  deliveryMethod: 'pickup',
  quantity,
  listing: {
    attributes: { title: `Item ${listingId}`, price: { amount: 1000, currency: 'USD' }, publicData: {} },
  },
});

// Sharetribe's listings.query response for the given { listingId: stock }.
const stockResponse = stockByListingId => {
  const ids = Object.keys(stockByListingId);
  return {
    data: {
      data: ids.map(id => ({
        id: { uuid: id },
        type: 'listing',
        attributes: {},
        relationships: { currentStock: { data: { id: { uuid: `s-${id}` }, type: 'stock' } } },
      })),
      included: ids.map(id => ({
        id: { uuid: `s-${id}` },
        type: 'stock',
        attributes: { quantity: stockByListingId[id] },
      })),
    },
  };
};

const txResponse = id => ({
  data: {
    data: {
      id: { uuid: id },
      attributes: {
        protectedData: {
          stripePaymentIntents: { default: { stripePaymentIntentClientSecret: 's' } },
        },
      },
    },
  },
});

// What the local API throws when Sharetribe refuses an order for lack of stock.
const insufficientStockError = () =>
  Object.assign(new Error(), {
    message: 'Local API request failed',
    status: 409,
    statusText: 'Conflict',
    data: { errors: [{ status: 409, code: 'transaction-listing-insufficient-stock' }] },
  });

const runCheckout = ({ cartItems, stock, listingsQuery }) => {
  const sdk = {
    transactions: { transition: jest.fn(() => Promise.resolve({})) },
    listings: { query: listingsQuery || jest.fn(() => Promise.resolve(stockResponse(stock))) },
  };
  const stripe = { confirmCardPayment: jest.fn(() => Promise.resolve({})) };
  const dispatch = jest.fn(action => action);
  const getState = () => ({ cart: { items: cartItems } });
  return processCartCheckout({
    cartItems,
    stripe,
    processAlias: 'default-purchase/release-1',
    savedPaymentMethodId: 'pm_1',
  })(dispatch, getState, sdk).then(action => ({ action, dispatch }));
};

beforeEach(() => {
  jest.clearAllMocks();
  let n = 0;
  api.initiatePrivileged.mockImplementation(() => Promise.resolve(txResponse(`tx-${++n}`)));
  api.reportCheckoutFailure.mockResolvedValue({ refunded: [] });
});

describe('cart checkout stock check', () => {
  it('stops before charging anything when the cart asks for more than is in stock', async () => {
    const { action, dispatch } = await runCheckout({
      cartItems: [makeItem('l1', 1), makeItem('l2', 5)],
      stock: { l1: 10, l2: 2 },
    });

    expect(action.type).toBe(processCartCheckout.rejected.type);
    expect(action.payload.stockError).toEqual({ refunded: false });
    expect(api.initiatePrivileged).not.toHaveBeenCalled();
    // The cart is brought down to what's available.
    expect(dispatch).toHaveBeenCalledWith(applyStock({ l1: 10, l2: 2 }));

    // The buyer stays on the form, with no "Payment failed" message.
    const state = reducer(undefined, action);
    expect(state.stockError).toEqual({ refunded: false });
    expect(state.checkoutError).toBeNull();
    expect(state.completedResults).toBeNull();
  });

  it('stops when an item is sold out or no longer listed', async () => {
    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 1), makeItem('closed', 1)],
      stock: { l1: 3 },
    });

    expect(action.payload.stockError).toEqual({ refunded: false });
    expect(api.initiatePrivileged).not.toHaveBeenCalled();
  });

  it('goes ahead when everything is in stock', async () => {
    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 2), makeItem('l2', 2)],
      stock: { l1: 2, l2: 5 },
    });

    expect(action.type).toBe(processCartCheckout.fulfilled.type);
    expect(api.initiatePrivileged).toHaveBeenCalledTimes(2);
  });

  it('goes ahead when stock cannot be checked', async () => {
    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 2)],
      listingsQuery: jest.fn(() => Promise.reject(new Error('offline'))),
    });

    expect(action.type).toBe(processCartCheckout.fulfilled.type);
  });

  it('explains a sell-out during checkout instead of blaming the card', async () => {
    api.initiatePrivileged.mockRejectedValueOnce(insufficientStockError());

    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 2)],
      stock: { l1: 2 },
    });

    expect(action.payload.stockError).toEqual({ refunded: false });
    const state = reducer(undefined, action);
    expect(state.checkoutError).toBeNull();
  });

  it('refunds what was charged when a later item sells out during checkout', async () => {
    api.initiatePrivileged
      .mockResolvedValueOnce(txResponse('tx-1'))
      .mockRejectedValueOnce(insufficientStockError());
    api.reportCheckoutFailure.mockResolvedValue({ refunded: ['tx-1'] });

    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 1), makeItem('l2', 1)],
      stock: { l1: 1, l2: 1 },
    });

    expect(api.reportCheckoutFailure).toHaveBeenCalledWith(
      expect.objectContaining({ chargedOrderIds: ['tx-1'] })
    );
    expect(action.payload.stockError).toEqual({ refunded: true });
  });

  it('shows the results view if a refund did not go through', async () => {
    api.initiatePrivileged
      .mockResolvedValueOnce(txResponse('tx-1'))
      .mockRejectedValueOnce(insufficientStockError());
    api.reportCheckoutFailure.mockResolvedValue({ refunded: [] });

    const { action } = await runCheckout({
      cartItems: [makeItem('l1', 1), makeItem('l2', 1)],
      stock: { l1: 1, l2: 1 },
    });

    expect(action.payload.stockError).toBeUndefined();
    expect(action.payload.results).toContainEqual(
      expect.objectContaining({ listingId: 'l2', error: 'Not enough left in stock' })
    );
  });
});
