// The delivery listing id is read when the duck loads.
process.env.REACT_APP_DELIVERY_LISTING_ID = 'delivery-listing';

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

const cartItem = {
  listingId: 'l1',
  deliveryMethod: 'shipping',
  quantity: 1,
  listing: {
    attributes: { title: 'Eggs', price: { amount: 1000, currency: 'USD' }, publicData: {} },
  },
};

const shippingDetails = {
  protectedData: {
    shippingAddress: {
      addressLine1: '1 Main St',
      city: 'Lebanon',
      state: 'TN',
      postalCode: '37087',
      country: 'US',
    },
  },
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

const runCheckout = args => {
  const sdk = { transactions: { transition: jest.fn(() => Promise.resolve({})) } };
  const stripe = { confirmCardPayment: jest.fn(() => Promise.resolve({})) };
  const dispatch = jest.fn(action => action);
  return processCartCheckout({
    cartItems: [cartItem],
    stripe,
    shippingDetails,
    processAlias: 'default-purchase/release-1',
    savedPaymentMethodId: 'pm_1',
    ...args,
  })(dispatch, () => ({}), sdk);
};

beforeEach(() => {
  jest.clearAllMocks();
  api.estimateCartDelivery.mockResolvedValue({ totalFeeCents: 899 });
  api.initiatePrivileged.mockImplementation(({ orderData }) =>
    Promise.resolve(txResponse(orderData.isDeliveryOrder ? 'delivery-tx' : 'item-tx'))
  );
  api.createOnfleetTask.mockResolvedValue({});
  api.linkDeliveryItems.mockResolvedValue({});
  api.confirmPromo.mockResolvedValue({ ok: true });
});

describe('cart checkout with a free-delivery promo', () => {
  it('charges delivery as usual without a promo', async () => {
    const action = await runCheckout({});
    expect(action.type).toBe(processCartCheckout.fulfilled.type);
    const deliveryCall = api.initiatePrivileged.mock.calls.find(
      ([p]) => p.orderData.isDeliveryOrder
    );
    expect(deliveryCall[0].orderData.deliveryFeeCents).toBe(899);
  });

  it('skips the delivery charge and confirms the use', async () => {
    api.redeemPromo.mockResolvedValue({
      ok: true,
      redemptionId: 'rdm_1',
      coveredCents: 899,
      code: 'FREESAT',
    });

    const action = await runCheckout({ promoCode: 'FREESAT' });

    expect(action.type).toBe(processCartCheckout.fulfilled.type);
    expect(api.redeemPromo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FREESAT', shippingAddress: expect.any(Object) })
    );
    // Only the item was initiated, with no shipping fee on it.
    expect(api.initiatePrivileged).toHaveBeenCalledTimes(1);
    expect(api.initiatePrivileged.mock.calls[0][0].orderData.customShippingFeeCents).toBe(0);
    expect(api.confirmPromo).toHaveBeenCalledWith({
      redemptionId: 'rdm_1',
      transactionId: 'item-tx',
    });
    expect(action.payload.results).toContainEqual(
      expect.objectContaining({ isPromo: true, code: 'FREESAT', coveredCents: 899 })
    );
  });

  it('stops before charging anything when the promo no longer works', async () => {
    api.redeemPromo.mockResolvedValue({ ok: false, reason: 'limit' });

    const action = await runCheckout({ promoCode: 'FREESAT' });

    expect(action.type).toBe(processCartCheckout.rejected.type);
    expect(action.payload.promoError).toEqual({ code: 'FREESAT', reason: 'limit', date: null });
    expect(api.initiatePrivileged).not.toHaveBeenCalled();

    // The buyer stays on the form to confirm the new total.
    const state = reducer(undefined, action);
    expect(state.promoError.reason).toBe('limit');
    expect(state.completedResults).toBeNull();
    expect(state.checkoutError).toBeNull();
  });

  it("stops rather than charge delivery when the fee can't be worked out", async () => {
    api.estimateCartDelivery.mockRejectedValue(new Error('geocoder down'));

    const action = await runCheckout({ promoCode: 'FREESAT' });

    expect(action.type).toBe(processCartCheckout.rejected.type);
    expect(action.payload.promoError.reason).toBe('unavailable');
    expect(api.initiatePrivileged).not.toHaveBeenCalled();
  });

  it('gives the use back when payment fails', async () => {
    api.redeemPromo.mockResolvedValue({ ok: true, redemptionId: 'rdm_1', coveredCents: 899 });
    api.reportCheckoutFailure.mockResolvedValue({ refunded: [] });
    api.initiatePrivileged.mockRejectedValue(new Error('Card declined'));

    const action = await runCheckout({ promoCode: 'FREESAT' });

    expect(action.type).toBe(processCartCheckout.rejected.type);
    expect(api.reportCheckoutFailure).toHaveBeenCalledWith(
      expect.objectContaining({ promoRedemptionId: 'rdm_1' })
    );
    expect(api.confirmPromo).not.toHaveBeenCalled();
  });

  it('does not spend a promo on a pickup order', async () => {
    const action = await runCheckout({
      promoCode: 'FREESAT',
      cartItems: [{ ...cartItem, deliveryMethod: 'pickup' }],
      shippingDetails: undefined,
    });
    expect(action.type).toBe(processCartCheckout.fulfilled.type);
    expect(api.redeemPromo).not.toHaveBeenCalled();
  });
});
