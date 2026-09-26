import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  initiatePrivileged,
  estimateCartDelivery,
  createOnfleetTask,
  notifyTransition,
  linkDeliveryItems,
  reportCheckoutFailure,
} from '../../util/api';
import { storableError } from '../../util/errors';
import * as log from '../../util/log';
import { clearCart, removeItems } from '../../ducks/cart.duck';
import { setCurrentUserHasOrders } from '../../ducks/user.duck';

// The operator/hub-owned "Delivery" listing that standalone delivery
// transactions are created against (default-delivery process). Configured via
// env so the marketplace can point at its delivery listing. When unset, the
// flow gracefully falls back to the legacy per-item shipping fee.
const DELIVERY_LISTING_ID = process.env.REACT_APP_DELIVERY_LISTING_ID;
const DELIVERY_PROCESS_ALIAS = 'default-delivery/release-1';

// Local API failures come back wrapped as { message: 'Local API request
// failed', statusText, data } — the real Sharetribe cause is in statusText (and
// data.errors), while `message` is a generic wrapper. Surface the real reason
// so failed orders are diagnosable instead of all reading "Local API request
// failed".
const realErrorMessage = e => {
  const apiErrorTitle = e?.data?.errors?.[0]?.title;
  const isGenericWrapper = e?.message === 'Local API request failed';
  return (
    apiErrorTitle ||
    (isGenericWrapper ? e?.statusText : e?.message) ||
    e?.statusText ||
    e?.message ||
    null
  );
};

// Generate a unique order-group id so all transactions in one cart checkout
// (the items plus the standalone delivery) can be reconciled together.
const generateOrderGroupId = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `group-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

// ================ Async thunks ================ //

/**
 * Process cart checkout: creates one transaction per cart item sequentially.
 * For new cards, sets up a reusable PaymentMethod via SetupIntent before processing.
 */
const processCartCheckoutPayloadCreator = async (
  { cartItems, stripe, card, billingDetails, shippingDetails, processAlias, savedPaymentMethodId, stripeCustomer, orderGroupId, deliveryTransactionId, customShippingFeeCents, cartFeeCents },
  { dispatch, extra: sdk, rejectWithValue }
) => {
  const results = [];
  let paymentMethodId = savedPaymentMethodId || null;

  // If using a new card, create a SetupIntent to save it as a reusable PaymentMethod.
  // This is the proper Stripe Connect flow: the PM is created on the platform account
  // and can be reused across multiple PaymentIntents on connected accounts.
  if (!paymentMethodId && card) {
    try {
      // Step A: Create a SetupIntent via Sharetribe SDK
      const setupIntentResponse = await sdk.stripeSetupIntents.create();
      const setupIntent = setupIntentResponse.data.data;
      const setupIntentClientSecret =
        setupIntent.attributes.clientSecret || setupIntent.attributes.client_secret;

      // Step B: Confirm the SetupIntent with the card element
      const setupResult = await stripe.confirmCardSetup(setupIntentClientSecret, {
        payment_method: {
          card,
          billing_details: billingDetails,
        },
      });

      if (setupResult.error) {
        return rejectWithValue({
          results: [],
          error: setupResult.error.message || 'Card setup failed',
        });
      }

      // Step C: Save the PM to the user's Stripe Customer (call SDK directly)
      const newPaymentMethodId = setupResult.setupIntent.payment_method;
      if (stripeCustomer?.id) {
        // User already has a Stripe Customer — add or replace payment method
        await sdk.stripeCustomer.addPaymentMethod(
          { stripePaymentMethodId: newPaymentMethodId },
          { expand: true }
        );
      } else {
        // Create a new Stripe Customer with this payment method
        await sdk.stripeCustomer.create(
          { stripePaymentMethodId: newPaymentMethodId },
          { expand: true, include: ['defaultPaymentMethod'] }
        );
      }
      paymentMethodId = newPaymentMethodId;
    } catch (e) {
      log.error(e, 'cart-checkout-card-setup-failed');
      return rejectWithValue({
        results: [],
        error: 'Failed to set up payment method. Please try again.',
      });
    }
  }

  // Pre-compute route-based delivery fee for shipping items
  let routeShippingFeeCents = null;
  const shippingAddr = shippingDetails?.protectedData?.shippingAddress;
  const hasShippingItems = cartItems.some(item => item.deliveryMethod === 'shipping');

  if (hasShippingItems && shippingAddr) {
    try {
      const shippingListingIds = cartItems
        .filter(item => item.deliveryMethod === 'shipping')
        .map(item => item.listingId);
      const routeEstimate = await estimateCartDelivery({
        listingIds: shippingListingIds,
        shippingAddress: {
          line1: shippingAddr.addressLine1,
          city: shippingAddr.city,
          state: shippingAddr.state,
          postalCode: shippingAddr.postalCode,
          country: shippingAddr.country,
        },
      });
      routeShippingFeeCents = routeEstimate.totalFeeCents || 0;
    } catch (e) {
      log.error(e, 'cart-checkout-route-estimate-failed');
      // Continue without custom fee — server will calculate per-item
    }
  }

  // Decide whether to create a STANDALONE delivery transaction for this order.
  // When enabled, the whole route fee lives on its own delivery transaction
  // (created after the items, below) and every item carries $0 shipping. A
  // single declined item then never claws back delivery. If the delivery
  // listing isn't configured, or we're adding to an existing order, or there's
  // no shipping, we fall back to the legacy first-item shipping behavior.
  const canStandaloneDelivery =
    !!DELIVERY_LISTING_ID && hasShippingItems && routeShippingFeeCents > 0 && !orderGroupId;
  // All transactions from this checkout share one order-group id so they can be
  // reconciled (and added to) together.
  // Every checkout gets a group id, not just the ones with a standalone
  // delivery transaction. The consolidated order views key off this, and a
  // pickup-only or single-item cart has to render through the same structure
  // as everything else — one code path, not two.
  const effectiveGroupId = orderGroupId || generateOrderGroupId();

  let shippingFeeAssigned = false;
  // Charge the platform fee once per cart, but split it proportionally across
  // every transaction so that one vendor declining doesn't refund the whole
  // fee. Each transaction's share is round(cartFee × itemSubtotal / cartSubtotal),
  // with any rounding remainder added to the last transaction so the parts
  // sum exactly to cartFeeCents. If adding to an existing order group, skip
  // the fee entirely (the original order already paid it).
  const shouldApplyCartFee =
    typeof cartFeeCents === 'number' && cartFeeCents > 0 && !orderGroupId;
  const itemSubtotalsCents = cartItems.map(item =>
    (item.listing?.attributes?.price?.amount || 0) * (item.quantity || 1)
  );
  const cartSubtotalCents = itemSubtotalsCents.reduce((s, x) => s + x, 0);
  const cartFeeAllocations = (() => {
    if (!shouldApplyCartFee) return cartItems.map(() => 0);
    const shares = new Array(cartItems.length).fill(0);
    let allocated = 0;
    for (let i = 0; i < cartItems.length - 1; i++) {
      const share = cartSubtotalCents > 0
        ? Math.round((cartFeeCents * itemSubtotalsCents[i]) / cartSubtotalCents)
        : Math.floor(cartFeeCents / cartItems.length);
      shares[i] = share;
      allocated += share;
    }
    shares[cartItems.length - 1] = cartFeeCents - allocated;
    return shares;
  })();

  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    dispatch(setCurrentItemIndex(i));

    try {
      // Step 1: Initiate the transaction via privileged API
      const { deliveryMethod, quantity } = item;
      const quantityMaybe = quantity ? { stockReservationQuantity: quantity } : {};
      const shippingAddressMaybe =
        deliveryMethod === 'shipping' && shippingAddr
          ? {
              shippingAddress: {
                line1: shippingAddr.addressLine1,
                city: shippingAddr.city,
                state: shippingAddr.state,
                postalCode: shippingAddr.postalCode,
                country: shippingAddr.country,
              },
            }
          : {};

      // Shipping fee assignment:
      // - Standalone delivery enabled, or adding to an existing order:
      //   items carry $0 shipping (delivery is its own transaction).
      // - Legacy fallback: full route fee on the first shipping item, $0 rest.
      const customShippingMaybe =
        canStandaloneDelivery || orderGroupId
          ? { customShippingFeeCents: 0 }
          : deliveryMethod === 'shipping' && routeShippingFeeCents != null
            ? { customShippingFeeCents: shippingFeeAssigned ? 0 : routeShippingFeeCents }
            : {};

      if (
        !canStandaloneDelivery &&
        !orderGroupId &&
        deliveryMethod === 'shipping' &&
        routeShippingFeeCents != null &&
        !shippingFeeAssigned
      ) {
        shippingFeeAssigned = true;
      }

      const orderGroupMaybe = effectiveGroupId ? { orderGroupId: effectiveGroupId } : {};

      // Assign this item's share of the platform fee (pre-computed above).
      const customCartFeeMaybe = orderGroupId
        ? { customCustomerCommissionCents: 0 }
        : { customCustomerCommissionCents: cartFeeAllocations[i] };

      const orderData = {
        ...(deliveryMethod ? { deliveryMethod } : {}),
        ...shippingAddressMaybe,
        ...customShippingMaybe,
        ...customCartFeeMaybe,
        ...orderGroupMaybe,
      };

      const listingProcessAlias =
        item.listing?.attributes?.publicData?.transactionProcessAlias || processAlias;

      const bodyParams = {
        processAlias: listingProcessAlias,
        transition: 'transition/request-payment',
        params: {
          listingId: { _sdkType: 'UUID', uuid: item.listingId },
          ...quantityMaybe,
          ...(shippingDetails || {}),
          cardToken: 'CartCheckoutPage_card_token',
        },
      };
      const queryParams = {
        include: ['booking', 'provider'],
        expand: true,
      };

      const orderResponse = await initiatePrivileged({
        isSpeculative: false,
        orderData,
        bodyParams,
        queryParams,
      });

      const order = orderResponse.data.data;
      const orderId = order.id;

      // Step 2: Confirm card payment with Stripe
      const stripePaymentIntents = order.attributes.protectedData?.stripePaymentIntents;
      if (!stripePaymentIntents) {
        throw new Error('Missing stripePaymentIntents in transaction protectedData');
      }

      const { stripePaymentIntentClientSecret } = stripePaymentIntents.default;

      // paymentMethodId is always set: either from saved card or SetupIntent flow above
      const stripeResult = await stripe.confirmCardPayment(stripePaymentIntentClientSecret, {
        payment_method: paymentMethodId,
      });

      if (stripeResult.error) {
        throw new Error(stripeResult.error.message || 'Payment failed');
      }

      // Step 3: Confirm payment transition on Marketplace API
      await sdk.transactions.transition(
        {
          id: orderId,
          transition: 'transition/confirm-payment',
          params: {},
        },
        { expand: true }
      );

      // Fire push to vendor (best-effort, non-blocking)
      notifyTransition({ transactionId: orderId.uuid, transition: 'transition/confirm-payment' });

      dispatch(setCurrentUserHasOrders());

      // Create OnFleet delivery task for shipping items (non-blocking)
      let trackingURL = null;
      if (item.deliveryMethod === 'shipping') {
        try {
          const onfleetResult = await createOnfleetTask({ transactionId: orderId.uuid });
          if (onfleetResult.trackingURL) {
            trackingURL = onfleetResult.trackingURL;
          }
        } catch (onfleetError) {
          log.error(onfleetError, 'cart-checkout-onfleet-task-failed', {
            listingId: item.listingId,
            orderId: orderId.uuid,
          });
          // Do not fail checkout if OnFleet is unavailable
        }
      }

      results.push({
        listingId: item.listingId,
        orderId: orderId.uuid,
        title: item.listing?.attributes?.title,
        success: true,
        ...(trackingURL ? { trackingURL } : {}),
      });
    } catch (e) {
      log.error(e, 'cart-checkout-item-failed', {
        listingId: item.listingId,
        reason: realErrorMessage(e),
      });
      results.push({
        listingId: item.listingId,
        title: item.listing?.attributes?.title,
        success: false,
        error: realErrorMessage(e) || 'Transaction failed',
      });

      // Stop the whole checkout on any payment failure, and unwind what was
      // already charged in it.
      //
      // This used to abort only when the FIRST item failed. A card that failed
      // on item 3 of 8 left items 1 and 2 charged, items 3-8 never created,
      // and the buyer holding a partial order they never agreed to. The card
      // is the same for every item, so a failure partway is a failure for the
      // whole cart — there is no sensible way to deliver half of it.
      const chargedOrderIds = results.filter(r => r.success && r.orderId).map(r => r.orderId);

      let refundedIds = [];
      try {
        const unwind = await reportCheckoutFailure({
          orderGroupId: effectiveGroupId,
          reason: realErrorMessage(e) || 'Payment failed',
          itemCount: cartItems.length,
          chargedOrderIds,
        });
        refundedIds = unwind?.refunded || [];
      } catch (reportError) {
        // The buyer still needs to be told their checkout failed, so a failure
        // to unwind must not swallow the original error. It is logged loudly
        // because it is the case where someone is left out of pocket.
        log.error(reportError, 'cart-checkout-unwind-failed', {
          orderGroupId: effectiveGroupId,
          chargedOrderIds,
        });
      }

      // Anything refunded is no longer a completed order, so the results view
      // must not show it as one.
      const refunded = new Set(refundedIds);
      const finalResults = results.map(r =>
        r.success && refunded.has(r.orderId)
          ? { ...r, success: false, refunded: true, error: 'Refunded — checkout could not be completed' }
          : r
      );

      return rejectWithValue({
        results: finalResults,
        error:
          chargedOrderIds.length > 0
            ? 'Your payment failed partway through checkout. Anything already charged has been refunded — please check your card and try again.'
            : 'Payment declined. Please check your card details.',
      });
    }
  }

  // Standalone delivery: now that the item transactions exist, charge the
  // whole route delivery fee ONCE on a dedicated delivery transaction and link
  // the successful items to it. Reconciliation (server-side) refunds this
  // delivery transaction only if every linked item is later denied; a single
  // declined item leaves delivery intact.
  //
  // Only SHIPPING items matter for delivery: link (and gate creation on) the
  // successful shipping items. Pickup items don't need delivery, so a pickup
  // item being accepted must not capture (or keep) a delivery charge, and an
  // order with no surviving shipping item must not create a delivery at all.
  const shippingListingIds = new Set(
    cartItems.filter(it => it.deliveryMethod === 'shipping').map(it => it.listingId)
  );
  const successfulShippingItemIds = results
    .filter(r => r.success && r.listingId && shippingListingIds.has(r.listingId))
    .map(r => r.orderId);
  if (canStandaloneDelivery && successfulShippingItemIds.length > 0) {
    try {
      const deliveryShippingAddressMaybe = shippingAddr
        ? {
            shippingAddress: {
              line1: shippingAddr.addressLine1,
              city: shippingAddr.city,
              state: shippingAddr.state,
              postalCode: shippingAddr.postalCode,
              country: shippingAddr.country,
            },
          }
        : {};

      const deliveryCurrency =
        cartItems.find(it => it.listing?.attributes?.price?.currency)?.listing?.attributes?.price
          ?.currency;

      const deliveryOrderData = {
        isDeliveryOrder: true,
        // Cents must be a positive integer (server rejects otherwise).
        deliveryFeeCents: Math.round(routeShippingFeeCents),
        deliveryMethod: 'shipping',
        orderGroupId: effectiveGroupId,
        ...(deliveryCurrency ? { currency: deliveryCurrency } : {}),
        ...deliveryShippingAddressMaybe,
      };

      const deliveryBody = {
        processAlias: DELIVERY_PROCESS_ALIAS,
        transition: 'transition/request-payment',
        params: {
          listingId: { _sdkType: 'UUID', uuid: DELIVERY_LISTING_ID },
          ...(shippingDetails || {}),
          cardToken: 'CartCheckoutPage_card_token',
        },
      };

      const deliveryResponse = await initiatePrivileged({
        isSpeculative: false,
        orderData: deliveryOrderData,
        bodyParams: deliveryBody,
        queryParams: { expand: true },
      });

      const deliveryTx = deliveryResponse.data.data;
      const deliveryTxId = deliveryTx.id;
      const deliveryPaymentIntents = deliveryTx.attributes.protectedData?.stripePaymentIntents;
      if (!deliveryPaymentIntents) {
        throw new Error('Missing stripePaymentIntents in delivery transaction');
      }

      const deliveryStripeResult = await stripe.confirmCardPayment(
        deliveryPaymentIntents.default.stripePaymentIntentClientSecret,
        { payment_method: paymentMethodId }
      );
      if (deliveryStripeResult.error) {
        throw new Error(deliveryStripeResult.error.message || 'Delivery payment failed');
      }

      await sdk.transactions.transition(
        { id: deliveryTxId, transition: 'transition/confirm-payment', params: {} },
        { expand: true }
      );

      // Link the successful shipping item transactions so reconciliation can
      // find them and decide refund-vs-capture for the whole order.
      await linkDeliveryItems({
        deliveryTransactionId: deliveryTxId.uuid,
        itemTransactionIds: successfulShippingItemIds,
      });

      results.push({
        orderId: deliveryTxId.uuid,
        isDelivery: true,
        success: true,
        feeCents: Math.round(routeShippingFeeCents),
        currency: deliveryCurrency || 'USD',
        orderGroupId: effectiveGroupId,
      });
    } catch (e) {
      log.error(e, 'cart-checkout-delivery-failed', {
        orderGroupId: effectiveGroupId,
        reason: realErrorMessage(e),
      });
      // Items already succeeded — surface a non-fatal delivery error rather
      // than failing the whole checkout.
      results.push({
        isDelivery: true,
        success: false,
        error: realErrorMessage(e) || 'Delivery charge failed',
      });
    }
  } else if (orderGroupId && deliveryTransactionId && successfulShippingItemIds.length > 0) {
    // Add-to-existing-order: attach the newly ordered shipping items to the
    // existing standalone delivery transaction so reconciliation treats the
    // whole group as one order. No new delivery fee is charged (items carry
    // $0 shipping). The items are already paid for — a linking failure must not
    // reject the whole checkout, so it's logged and surfaced, not thrown.
    try {
      await linkDeliveryItems({
        deliveryTransactionId,
        itemTransactionIds: successfulShippingItemIds,
      });
    } catch (e) {
      log.error(e, 'cart-checkout-delivery-link-failed', {
        deliveryTransactionId,
        reason: realErrorMessage(e),
      });
      results.push({
        isDelivery: true,
        success: false,
        error: realErrorMessage(e) || 'Failed to link items to delivery',
      });
    }
  }

  // Clear successful items from cart
  const successfulIds = results.filter(r => r.success && !r.isDelivery).map(r => r.listingId);
  if (successfulIds.length > 0) {
    dispatch(removeItems(successfulIds));
  }

  const allSucceeded = results.every(r => r.success);
  if (allSucceeded) {
    dispatch(clearCart());
  }

  return { results, allSucceeded };
};

export const processCartCheckout = createAsyncThunk(
  'CartCheckoutPage/processCartCheckout',
  processCartCheckoutPayloadCreator
);

/**
 * Speculate line items for a single cart item (for price breakdown display)
 */
const speculateCartItemPayloadCreator = async (
  { item, processAlias },
  { rejectWithValue }
) => {
  try {
    const { deliveryMethod, quantity, listingId } = item;
    const listingProcessAlias =
      item.listing?.attributes?.publicData?.transactionProcessAlias || processAlias;
    const quantityMaybe = quantity ? { stockReservationQuantity: quantity } : {};
    const orderData = deliveryMethod ? { deliveryMethod } : {};

    const bodyParams = {
      processAlias: listingProcessAlias,
      transition: 'transition/request-payment',
      params: {
        listingId: { _sdkType: 'UUID', uuid: listingId },
        ...quantityMaybe,
        cardToken: 'CartCheckoutPage_speculative_card_token',
      },
    };
    const queryParams = {
      include: ['booking', 'provider', 'listing'],
      expand: true,
    };

    const response = await initiatePrivileged({
      isSpeculative: true,
      orderData,
      bodyParams,
      queryParams,
    });

    return { listingId, transaction: response.data.data };
  } catch (e) {
    return rejectWithValue({ listingId: item.listingId, error: storableError(e) });
  }
};

export const speculateCartItem = createAsyncThunk(
  'CartCheckoutPage/speculateCartItem',
  speculateCartItemPayloadCreator
);

// ================ Slice ================ //

const initialState = {
  speculatedTransactions: {},
  speculateInProgress: false,
  speculateError: null,
  checkoutInProgress: false,
  currentItemIndex: 0,
  completedResults: null,
  checkoutError: null,
};

const cartCheckoutSlice = createSlice({
  name: 'CartCheckoutPage',
  initialState,
  reducers: {
    setCurrentItemIndex: (state, action) => {
      state.currentItemIndex = action.payload;
    },
    resetCheckout: () => initialState,
  },
  extraReducers: builder => {
    builder
      .addCase(processCartCheckout.pending, state => {
        state.checkoutInProgress = true;
        state.currentItemIndex = 0;
        state.completedResults = null;
        state.checkoutError = null;
      })
      .addCase(processCartCheckout.fulfilled, (state, action) => {
        state.checkoutInProgress = false;
        state.completedResults = action.payload;
      })
      .addCase(processCartCheckout.rejected, (state, action) => {
        state.checkoutInProgress = false;
        state.checkoutError = action.payload?.error || 'Checkout failed';
        state.completedResults = action.payload;
      })
      .addCase(speculateCartItem.pending, state => {
        state.speculateInProgress = true;
      })
      .addCase(speculateCartItem.fulfilled, (state, action) => {
        state.speculateInProgress = false;
        const { listingId, transaction } = action.payload;
        state.speculatedTransactions[listingId] = transaction;
      })
      .addCase(speculateCartItem.rejected, (state, action) => {
        state.speculateInProgress = false;
        state.speculateError = action.payload?.error || null;
      });
  },
});

export const { setCurrentItemIndex, resetCheckout } = cartCheckoutSlice.actions;
export default cartCheckoutSlice.reducer;

// ================ Selectors ================ //

export const getCheckoutState = state => state.CartCheckoutPage;
