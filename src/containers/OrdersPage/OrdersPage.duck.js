import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import { fetchOrderGroups } from '../../util/api';

// ================ Thunks ================ //

// One checkout is many Sharetribe transactions; /api/order-groups regroups them
// so the customer sees one order. The endpoint needs the browser session
// cookie, so the page loads it client-side on mount rather than in SSR
// loadData — same as FollowedVendorsPage and the active-order-group lookup.
const loadOrderGroupsPayloadCreator = async (_arg, { rejectWithValue }) => {
  try {
    const res = await fetchOrderGroups();
    return { orderGroups: res?.orderGroups || [] };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const loadOrderGroups = createAsyncThunk(
  'OrdersPage/loadOrderGroups',
  loadOrderGroupsPayloadCreator
);

const loadOrderGroupPayloadCreator = async ({ id }, { rejectWithValue }) => {
  try {
    const res = await fetchOrderGroups({ id });
    return { orderGroup: res?.orderGroup || null };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const loadOrderGroup = createAsyncThunk(
  'OrdersPage/loadOrderGroup',
  loadOrderGroupPayloadCreator
);

// ================ Slice ================ //

const initialState = {
  orderGroups: [],
  orderGroup: null,
  fetchInProgress: false,
  fetchError: null,
};

const ordersPageSlice = createSlice({
  name: 'OrdersPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(loadOrderGroups.pending, state => {
        state.fetchInProgress = true;
        state.fetchError = null;
      })
      .addCase(loadOrderGroups.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        state.orderGroups = action.payload.orderGroups;
      })
      .addCase(loadOrderGroups.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload || action.error;
      })
      .addCase(loadOrderGroup.pending, state => {
        state.fetchInProgress = true;
        state.fetchError = null;
        state.orderGroup = null;
      })
      .addCase(loadOrderGroup.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        state.orderGroup = action.payload.orderGroup;
      })
      .addCase(loadOrderGroup.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload || action.error;
      });
  },
});

export default ordersPageSlice.reducer;
