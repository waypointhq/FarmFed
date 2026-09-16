import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { types as sdkTypes } from '../../util/sdkLoader';
import { storableError } from '../../util/errors';
import { fetchVendorSuborders, notifyTransition } from '../../util/api';
import * as log from '../../util/log';

const { UUID } = sdkTypes;

export const ACCEPT_TRANSITION = 'transition/accept-order';
export const DECLINE_TRANSITION = 'transition/decline-order';

// ================ Thunks ================ //

// /api/vendor-suborders regroups the vendor's per-line-item sales into one
// suborder per customer order. Browser-only (session cookie), so it loads on
// mount rather than in SSR loadData.
const loadSubordersPayloadCreator = async ({ date } = {}, { rejectWithValue }) => {
  try {
    const res = await fetchVendorSuborders({ date });
    return {
      suborders: res?.suborders || [],
      rollUp: res?.rollUp || [],
      deliveryDates: res?.deliveryDates || [],
      activeDate: res?.activeDate || null,
    };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const loadSuborders = createAsyncThunk(
  'VendorOrdersPage/loadSuborders',
  loadSubordersPayloadCreator
);

/**
 * Accept or mark unavailable, one item or a whole suborder.
 *
 * A suborder is still N Sharetribe transactions underneath, so "accept the
 * whole thing" is N transitions. They run in sequence rather than in parallel:
 * a partial failure has to leave the remaining items untouched and visible,
 * not half-transitioned behind a rejected promise.
 *
 * Items already resolved are skipped, so the call is safe to retry.
 */
const transitionItemsPayloadCreator = async (
  { transactionIds, transitionName, date },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  const succeeded = [];
  const failed = [];

  for (const id of transactionIds) {
    try {
      await sdk.transactions.transition(
        { id: new UUID(id), transition: transitionName, params: {} },
        { expand: true }
      );
      succeeded.push(id);
      // Push to the customer, best-effort — never block the vendor's flow.
      notifyTransition({ transactionId: id, transition: transitionName });
    } catch (e) {
      log.error(e, 'vendor-suborder-transition-failed', { transactionId: id, transitionName });
      failed.push(id);
    }
  }

  // Re-read rather than patching state locally: the server derives suborder
  // status and the money breakdown from the transactions, and it is the only
  // thing that should decide what those now are.
  await dispatch(loadSuborders({ date }));

  if (succeeded.length === 0) {
    return rejectWithValue(storableError(new Error('All transitions failed')));
  }
  return { succeeded, failed };
};

export const transitionItems = createAsyncThunk(
  'VendorOrdersPage/transitionItems',
  transitionItemsPayloadCreator
);

// ================ Slice ================ //

const initialState = {
  suborders: [],
  rollUp: [],
  deliveryDates: [],
  activeDate: null,
  fetchInProgress: false,
  fetchError: null,
  // Transaction ids currently being transitioned, so each row can show its own
  // spinner instead of the whole page going blank.
  transitionInProgressIds: [],
  transitionError: null,
};

const vendorOrdersSlice = createSlice({
  name: 'VendorOrdersPage',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(loadSuborders.pending, state => {
        state.fetchInProgress = true;
        state.fetchError = null;
      })
      .addCase(loadSuborders.fulfilled, (state, action) => {
        state.fetchInProgress = false;
        state.suborders = action.payload.suborders;
        state.rollUp = action.payload.rollUp;
        state.deliveryDates = action.payload.deliveryDates;
        state.activeDate = action.payload.activeDate;
      })
      .addCase(loadSuborders.rejected, (state, action) => {
        state.fetchInProgress = false;
        state.fetchError = action.payload || action.error;
      })
      .addCase(transitionItems.pending, (state, action) => {
        state.transitionError = null;
        state.transitionInProgressIds = action.meta.arg.transactionIds;
      })
      .addCase(transitionItems.fulfilled, state => {
        state.transitionInProgressIds = [];
      })
      .addCase(transitionItems.rejected, (state, action) => {
        state.transitionInProgressIds = [];
        state.transitionError = action.payload || action.error;
      });
  },
});

export default vendorOrdersSlice.reducer;
