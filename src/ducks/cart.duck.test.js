import reducer, {
  initializeCart,
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  removeItems,
  applyStock,
  fetchCartStock,
  openCartPanel,
  closeCartPanel,
  toggleCartPanel,
  getCartItems,
  getCartItemCount,
  getIsCartOpen,
} from './cart.duck';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: key => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: key => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const makeListing = (id, amount = 1000) => ({
  attributes: {
    title: `Listing ${id}`,
    price: { amount, currency: 'USD' },
  },
});

describe('cart duck', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('reducer', () => {
    it('should return initial state', () => {
      const state = reducer(undefined, { type: '@@INIT' });
      expect(state.items).toEqual([]);
      expect(state.isCartOpen).toBe(false);
      expect(state.initialized).toBe(false);
    });

    it('should initialize cart from localStorage', () => {
      const savedItems = [{ listingId: 'l1', quantity: 2 }];
      localStorageMock.setItem('farmfed_cart', JSON.stringify(savedItems));

      const state = reducer(undefined, initializeCart());
      expect(state.initialized).toBe(true);
      expect(state.items).toEqual(savedItems);
    });

    it('should initialize to empty array when localStorage is empty', () => {
      const state = reducer(undefined, initializeCart());
      expect(state.items).toEqual([]);
      expect(state.initialized).toBe(true);
    });

    it('should add a new item', () => {
      const state = reducer(undefined, { type: '@@INIT' });
      const listing = makeListing('l1');
      const next = reducer(state, addItem({ listingId: 'l1', listing, quantity: 1 }));

      expect(next.items).toHaveLength(1);
      expect(next.items[0].listingId).toBe('l1');
      expect(next.items[0].quantity).toBe(1);
      expect(next.items[0].listing).toBe(listing);
      expect(next.items[0].addedAt).toBeDefined();
    });

    it('should increment quantity for existing item', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      const listing = makeListing('l1');
      state = reducer(state, addItem({ listingId: 'l1', listing, quantity: 1 }));
      state = reducer(state, addItem({ listingId: 'l1', listing, quantity: 3 }));

      expect(state.items).toHaveLength(1);
      expect(state.items[0].quantity).toBe(4);
    });

    it('should remove an item', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, addItem({ listingId: 'l2', listing: makeListing('l2'), quantity: 1 }));
      state = reducer(state, removeItem({ listingId: 'l1' }));

      expect(state.items).toHaveLength(1);
      expect(state.items[0].listingId).toBe('l2');
    });

    it('should update quantity', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, updateQuantity({ listingId: 'l1', quantity: 5 }));

      expect(state.items[0].quantity).toBe(5);
    });

    it('should not update quantity to zero or negative', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 3 }));
      state = reducer(state, updateQuantity({ listingId: 'l1', quantity: 0 }));

      expect(state.items[0].quantity).toBe(3);
    });

    it('should clear cart', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, addItem({ listingId: 'l2', listing: makeListing('l2'), quantity: 2 }));
      state = reducer(state, clearCart());

      expect(state.items).toEqual([]);
    });

    it('should remove multiple items by IDs', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, addItem({ listingId: 'l2', listing: makeListing('l2'), quantity: 1 }));
      state = reducer(state, addItem({ listingId: 'l3', listing: makeListing('l3'), quantity: 1 }));
      state = reducer(state, removeItems(['l1', 'l3']));

      expect(state.items).toHaveLength(1);
      expect(state.items[0].listingId).toBe('l2');
    });

    it('should open/close/toggle cart panel', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      expect(state.isCartOpen).toBe(false);

      state = reducer(state, openCartPanel());
      expect(state.isCartOpen).toBe(true);

      state = reducer(state, closeCartPanel());
      expect(state.isCartOpen).toBe(false);

      state = reducer(state, toggleCartPanel());
      expect(state.isCartOpen).toBe(true);

      state = reducer(state, toggleCartPanel());
      expect(state.isCartOpen).toBe(false);
    });
  });

  describe('selectors', () => {
    it('getCartItems returns items', () => {
      const state = { cart: { items: [{ listingId: 'l1', quantity: 1 }], isCartOpen: false } };
      expect(getCartItems(state)).toEqual([{ listingId: 'l1', quantity: 1 }]);
    });

    it('getCartItemCount sums quantities', () => {
      const state = {
        cart: {
          items: [
            { listingId: 'l1', quantity: 2 },
            { listingId: 'l2', quantity: 3 },
          ],
          isCartOpen: false,
        },
      };
      expect(getCartItemCount(state)).toBe(5);
    });

    it('getCartItemCount defaults quantity to 1', () => {
      const state = {
        cart: {
          items: [{ listingId: 'l1' }, { listingId: 'l2', quantity: 2 }],
          isCartOpen: false,
        },
      };
      expect(getCartItemCount(state)).toBe(3);
    });

    it('getIsCartOpen returns open state', () => {
      expect(getIsCartOpen({ cart: { items: [], isCartOpen: true } })).toBe(true);
      expect(getIsCartOpen({ cart: { items: [], isCartOpen: false } })).toBe(false);
    });
  });

  describe('localStorage sync', () => {
    it('persists items to localStorage on add', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));

      const stored = JSON.parse(localStorageMock.getItem('farmfed_cart'));
      expect(stored).toHaveLength(1);
      expect(stored[0].listingId).toBe('l1');
    });

    it('persists items to localStorage on remove', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, removeItem({ listingId: 'l1' }));

      const stored = JSON.parse(localStorageMock.getItem('farmfed_cart'));
      expect(stored).toEqual([]);
    });

    it('persists items to localStorage on clear', () => {
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1 }));
      state = reducer(state, clearCart());

      const stored = JSON.parse(localStorageMock.getItem('farmfed_cart'));
      expect(stored).toEqual([]);
    });
  });

  describe('stock limits', () => {
    const init = () => reducer(undefined, { type: '@@INIT' });

    it('caps a new item at the known stock', () => {
      const state = reducer(
        init(),
        addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 5, maxQuantity: 2 })
      );
      expect(state.items[0].quantity).toBe(2);
      expect(state.items[0].maxQuantity).toBe(2);
    });

    it('caps an existing item when more is added', () => {
      let state = reducer(
        init(),
        addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 3, maxQuantity: 4 })
      );
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 3 }));
      expect(state.items[0].quantity).toBe(4);
    });

    it('caps quantity changes in the cart at the known stock', () => {
      let state = reducer(
        init(),
        addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1, maxQuantity: 3 })
      );
      state = reducer(state, updateQuantity({ listingId: 'l1', quantity: 10 }));
      expect(state.items[0].quantity).toBe(3);
    });

    it('lowers quantities to fresh stock and leaves other items alone', () => {
      let state = init();
      state = reducer(state, addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 6 }));
      state = reducer(state, addItem({ listingId: 'l2', listing: makeListing('l2'), quantity: 2 }));
      state = reducer(state, applyStock({ l1: 4 }));

      expect(state.items[0]).toEqual(expect.objectContaining({ quantity: 4, maxQuantity: 4 }));
      expect(state.items[1].quantity).toBe(2);
      expect(state.items[1].maxQuantity).toBeUndefined();
      expect(JSON.parse(localStorageMock.getItem('farmfed_cart'))[0].quantity).toBe(4);
    });

    it('marks a sold-out item without dropping its quantity below 1', () => {
      let state = reducer(init(), addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 2 }));
      state = reducer(state, applyStock({ l1: 0 }));
      expect(state.items[0]).toEqual(expect.objectContaining({ quantity: 1, maxQuantity: 0 }));
    });

    it('removes the cap from a listing that no longer tracks stock', () => {
      let state = reducer(
        init(),
        addItem({ listingId: 'l1', listing: makeListing('l1'), quantity: 1, maxQuantity: 2 })
      );
      state = reducer(state, applyStock({ l1: null }));
      state = reducer(state, updateQuantity({ listingId: 'l1', quantity: 9 }));
      expect(state.items[0].quantity).toBe(9);
    });
  });

  describe('fetchCartStock', () => {
    const listingWithStock = (id, quantity) => ({
      id: { uuid: id },
      type: 'listing',
      attributes: { title: id },
      relationships:
        quantity === undefined
          ? {}
          : { currentStock: { data: { id: { uuid: `stock-${id}` }, type: 'stock' } } },
    });
    const stockEntity = (id, quantity) => ({
      id: { uuid: `stock-${id}` },
      type: 'stock',
      attributes: { quantity },
    });

    it('returns stock per listing, 0 for unlisted and null for untracked', async () => {
      const sdk = {
        listings: {
          query: jest.fn(() =>
            Promise.resolve({
              data: {
                data: [listingWithStock('l1', 3), listingWithStock('l2')],
                included: [stockEntity('l1', 3)],
              },
            })
          ),
        },
      };

      const stock = await fetchCartStock(sdk, ['l1', 'l2', 'gone']);

      expect(stock).toEqual({ l1: 3, l2: null, gone: 0 });
      expect(sdk.listings.query).toHaveBeenCalledWith(
        expect.objectContaining({ ids: ['l1', 'l2', 'gone'], include: ['currentStock'] })
      );
    });

    it('returns null when stock cannot be fetched', async () => {
      const sdk = { listings: { query: jest.fn(() => Promise.reject(new Error('offline'))) } };
      expect(await fetchCartStock(sdk, ['l1'])).toBeNull();
    });

    it('skips the request for an empty cart', async () => {
      const sdk = { listings: { query: jest.fn() } };
      expect(await fetchCartStock(sdk, [])).toEqual({});
      expect(sdk.listings.query).not.toHaveBeenCalled();
    });
  });
});
