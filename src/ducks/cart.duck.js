import { createSlice } from '@reduxjs/toolkit';
import { denormalisedResponseEntities } from '../util/data';
import * as log from '../util/log';

const CART_STORAGE_KEY = 'farmfed_cart';

// Cart items carry `maxQuantity`: the listing's available stock when we last
// looked, or undefined when unknown (not fetched yet, or the listing doesn't
// track stock). A known cap is enforced on every quantity change, so the cart
// can't ask for more than the vendor has — Sharetribe refuses those orders at
// payment, which buyers read as a card problem.
const capQuantity = (quantity, maxQuantity) =>
  typeof maxQuantity === 'number' ? Math.max(1, Math.min(quantity, maxQuantity)) : quantity;

// Helper to read cart from localStorage
const readCartFromStorage = () => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(CART_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
};

// Helper to write cart to localStorage
const writeCartToStorage = items => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    // Storage full or unavailable
  }
};

// ================ Slice ================ //

const initialState = {
  items: [],
  isCartOpen: false,
  initialized: false,
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    initializeCart: state => {
      state.items = readCartFromStorage();
      state.initialized = true;
    },
    addItem: (state, action) => {
      const { listingId, listing, quantity, deliveryMethod, maxQuantity } = action.payload;
      const existing = state.items.find(item => item.listingId === listingId);
      if (existing) {
        if (typeof maxQuantity === 'number') existing.maxQuantity = maxQuantity;
        existing.quantity = capQuantity(
          (existing.quantity || 1) + (quantity || 1),
          existing.maxQuantity
        );
      } else {
        state.items.push({
          listingId,
          listing,
          quantity: capQuantity(quantity || 1, maxQuantity),
          ...(typeof maxQuantity === 'number' ? { maxQuantity } : {}),
          deliveryMethod: deliveryMethod || null,
          addedAt: new Date().toISOString(),
        });
      }
      writeCartToStorage(state.items);
    },
    removeItem: (state, action) => {
      const { listingId } = action.payload;
      state.items = state.items.filter(item => item.listingId !== listingId);
      writeCartToStorage(state.items);
    },
    updateQuantity: (state, action) => {
      const { listingId, quantity } = action.payload;
      const item = state.items.find(i => i.listingId === listingId);
      if (item && quantity > 0) {
        item.quantity = capQuantity(quantity, item.maxQuantity);
        writeCartToStorage(state.items);
      }
    },
    // Payload: { [listingId]: stock }, where stock is a number, or null for a
    // listing that doesn't track stock. 0 means sold out or no longer listed.
    applyStock: (state, action) => {
      const stockByListingId = action.payload || {};
      state.items.forEach(item => {
        if (!(item.listingId in stockByListingId)) return;
        const stock = stockByListingId[item.listingId];
        if (typeof stock === 'number') {
          item.maxQuantity = stock;
          item.quantity = capQuantity(item.quantity || 1, stock);
        } else {
          delete item.maxQuantity;
        }
      });
      writeCartToStorage(state.items);
    },
    clearCart: state => {
      state.items = [];
      writeCartToStorage(state.items);
    },
    removeItems: (state, action) => {
      const listingIds = action.payload;
      state.items = state.items.filter(item => !listingIds.includes(item.listingId));
      writeCartToStorage(state.items);
    },
    openCartPanel: state => {
      state.isCartOpen = true;
    },
    closeCartPanel: state => {
      state.isCartOpen = false;
    },
    toggleCartPanel: state => {
      state.isCartOpen = !state.isCartOpen;
    },
  },
});

// ================ Exports ================ //

export const {
  initializeCart,
  addItem,
  removeItem,
  updateQuantity,
  clearCart,
  removeItems,
  applyStock,
  openCartPanel,
  closeCartPanel,
  toggleCartPanel,
} = cartSlice.actions;

export default cartSlice.reducer;

// ================ Stock ================ //

/**
 * Current stock for the given listings, as { [listingId]: stock } (see
 * applyStock), or null if it couldn't be fetched. A listing missing from the
 * result is closed or deleted, so it counts as 0.
 */
export const fetchCartStock = async (sdk, listingIds) => {
  if (!listingIds || listingIds.length === 0) return {};
  try {
    const response = await sdk.listings.query({
      ids: listingIds,
      include: ['currentStock'],
      'fields.listing': ['title'],
      perPage: 100,
    });
    const found = denormalisedResponseEntities(response).reduce((acc, listing) => {
      const quantity = listing.currentStock?.attributes?.quantity;
      acc[listing.id.uuid] = typeof quantity === 'number' ? quantity : null;
      return acc;
    }, {});
    return listingIds.reduce((acc, id) => {
      acc[id] = id in found ? found[id] : 0;
      return acc;
    }, {});
  } catch (e) {
    log.error(e, 'cart-stock-fetch-failed', { listingIds });
    return null;
  }
};

// Re-checks stock for everything in the cart. The cart lives in localStorage
// for days, so what was available when an item was added can be long gone.
export const refreshCartStock = () => async (dispatch, getState, sdk) => {
  const listingIds = getState().cart.items.map(item => item.listingId);
  const stock = await fetchCartStock(sdk, listingIds);
  if (stock) dispatch(applyStock(stock));
  return stock;
};

// ================ Selectors ================ //

export const getCartItems = state => state.cart.items;
export const getCartItemCount = state =>
  state.cart.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
export const getIsCartOpen = state => state.cart.isCartOpen;

// Sold out (or no longer listed) items block checkout until removed.
export const isCartItemSoldOut = item => item.maxQuantity === 0;
export const hasSoldOutCartItems = items => items.some(isCartItemSoldOut);
