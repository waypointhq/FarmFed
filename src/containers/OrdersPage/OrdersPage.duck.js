import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { types as sdkTypes } from '../../util/sdkLoader';
import { storableError } from '../../util/errors';
import * as log from '../../util/log';
import {
  fetchOrderGroups,
  estimateCartDelivery,
  initiatePrivileged,
  convertOrderToDelivery,
} from '../../util/api';

const { UUID } = sdkTypes;

const DELIVERY_LISTING_ID = process.env.REACT_APP_DELIVERY_LISTING_ID;
const DELIVERY_PROCESS_ALIAS = 'default-delivery/release-1';

// ================ Thunks ================ //

// One checkout is many Sharetribe transactions; /api/order-groups regroups them
// so the customer sees one order. The endpoint needs the browser session
// cookie, so the page loads it client-side on mount rather than in SSR
// loadData — same as FollowedVendorsPage and the active-order-group lookup.
const loadOrderGroupsPayloadCreator = async (_arg, { rejectWithValue }) => {
  try {
    const res = await fetchOrderGroups();
    return {
      orderGroups: res?.orderGroups || [],
      lastShippingAddress: res?.lastShippingAddress || null,
    };
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

/**
 * Estimate what delivery would cost for an order that was placed as pickup.
 */
const estimateUpgradePayloadCreator = async ({ orderGroup, shippingAddress }, { rejectWithValue }) => {
  try {
    const listingIds = orderGroup.suborders.flatMap(s => s.items.map(i => i.listingId));
    const estimate = await estimateCartDelivery({ listingIds, shippingAddress });
    return { feeCents: estimate?.totalFeeCents || 0, distanceMiles: estimate?.totalDistanceMiles };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const estimateUpgrade = createAsyncThunk(
  'OrdersPage/estimateUpgrade',
  estimateUpgradePayloadCreator
);

/**
 * Upgrade a pickup order to delivery.
 *
 * Deliberately mirrors what checkout does for a delivery order rather than
 * inventing a second payment path: the fee lives on its own standalone
 * delivery transaction against the operator's delivery listing, sharing the
 * order group id. That means the existing reconciliation already covers the
 * refund case — if every item is later declined, the delivery fee is refunded
 * with them, which is what happens for an order that chose delivery up front.
 *
 * Order matters. The fee is charged first and the items are flipped second: a
 * failure after payment leaves a charge to reverse, but a failure after the
 * flip would leave an order marked for delivery that nobody paid to deliver.
 */
const upgradeToDeliveryPayloadCreator = async (
  { orderGroup, shippingAddress, paymentMethodId, stripe },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  if (!DELIVERY_LISTING_ID) {
    return rejectWithValue(storableError(new Error('Delivery listing is not configured')));
  }
  if (!paymentMethodId) {
    return rejectWithValue(storableError(new Error('no-saved-card')));
  }

  try {
    const listingIds = orderGroup.suborders.flatMap(s => s.items.map(i => i.listingId));
    const estimate = await estimateCartDelivery({ listingIds, shippingAddress });
    const feeCents = Math.round(estimate?.totalFeeCents || 0);
    if (feeCents <= 0) {
      return rejectWithValue(storableError(new Error('no-delivery-fee')));
    }

    const orderData = {
      isDeliveryOrder: true,
      deliveryFeeCents: feeCents,
      deliveryMethod: 'shipping',
      orderGroupId: orderGroup.id,
      currency: orderGroup.totals.currency || 'USD',
      shippingAddress,
    };

    const response = await initiatePrivileged({
      isSpeculative: false,
      orderData,
      bodyParams: {
        processAlias: DELIVERY_PROCESS_ALIAS,
        transition: 'transition/request-payment',
        params: {
          listingId: { _sdkType: 'UUID', uuid: DELIVERY_LISTING_ID },
          cardToken: 'OrdersPage_upgrade_token',
        },
      },
      queryParams: { expand: true },
    });

    const deliveryTx = response.data.data;
    const paymentIntents = deliveryTx.attributes.protectedData?.stripePaymentIntents;
    if (!paymentIntents) {
      throw new Error('Missing stripePaymentIntents on the delivery transaction');
    }

    const stripeResult = await stripe.confirmCardPayment(
      paymentIntents.default.stripePaymentIntentClientSecret,
      { payment_method: paymentMethodId }
    );
    if (stripeResult.error) {
      throw new Error(stripeResult.error.message || 'Delivery payment failed');
    }

    await sdk.transactions.transition(
      { id: deliveryTx.id, transition: 'transition/confirm-payment', params: {} },
      { expand: true }
    );

    // Paid. Now flip the items and tell the vendors.
    const result = await convertOrderToDelivery({
      orderGroupId: orderGroup.id,
      deliveryTransactionId: deliveryTx.id.uuid,
      shippingAddress,
    });

    await dispatch(loadOrderGroup({ id: orderGroup.id }));

    return { feeCents, deliveryTransactionId: deliveryTx.id.uuid, ...result };
  } catch (e) {
    log.error(e, 'order-upgrade-to-delivery-failed', { orderGroupId: orderGroup?.id });
    return rejectWithValue(storableError(e));
  }
};

export const upgradeToDelivery = createAsyncThunk(
  'OrdersPage/upgradeToDelivery',
  upgradeToDeliveryPayloadCreator
);

// ================ Slice ================ //

const initialState = {
  orderGroups: [],
  orderGroup: null,
  lastShippingAddress: null,
  fetchInProgress: false,
  fetchError: null,
  upgradeEstimate: null,
  upgradeEstimateInProgress: false,
  upgradeInProgress: false,
  upgradeError: null,
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
        state.lastShippingAddress = action.payload.lastShippingAddress;
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
      })
      .addCase(estimateUpgrade.pending, state => {
        state.upgradeEstimateInProgress = true;
        state.upgradeError = null;
      })
      .addCase(estimateUpgrade.fulfilled, (state, action) => {
        state.upgradeEstimateInProgress = false;
        state.upgradeEstimate = action.payload;
      })
      .addCase(estimateUpgrade.rejected, (state, action) => {
        state.upgradeEstimateInProgress = false;
        state.upgradeError = action.payload || action.error;
      })
      .addCase(upgradeToDelivery.pending, state => {
        state.upgradeInProgress = true;
        state.upgradeError = null;
      })
      .addCase(upgradeToDelivery.fulfilled, state => {
        state.upgradeInProgress = false;
        state.upgradeEstimate = null;
      })
      .addCase(upgradeToDelivery.rejected, (state, action) => {
        state.upgradeInProgress = false;
        state.upgradeError = action.payload || action.error;
      });
  },
});

export default ordersPageSlice.reducer;
