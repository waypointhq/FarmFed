import React, { useState, useEffect, useRef, useCallback } from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { types as sdkTypes } from '../../util/sdkLoader';
import { calculateCartFee, estimateCartDelivery, fetchPickupSettings, fetchActiveOrderGroup } from '../../util/api';
import appSettings from '../../config/settings';
import { requestAppReviewAfterOrder } from '../../util/appReview';

import { NamedLink, PrimaryButton } from '../../components';

import css from './CartCheckoutPage.module.css';

const { Money } = sdkTypes;

const stripeElementsOptions = {
  fonts: [{ cssSrc: 'https://fonts.googleapis.com/css?family=Inter' }],
};

const cardStyles = {
  base: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", Helvetica, Arial, sans-serif',
    fontSize: '16px',
    fontSmoothing: 'antialiased',
    lineHeight: '24px',
    letterSpacing: '-0.1px',
    color: '#4A4A4A',
    '::placeholder': { color: '#B2B2B2' },
  },
};

// The server returns the next delivery date as a date-only string
// (YYYY-MM-DD) in the marketplace timezone. Parse it as calendar parts —
// `new Date('YYYY-MM-DD')` would interpret it as UTC midnight and shift the
// displayed weekday back a day for viewers west of UTC.
const formatPickupDate = dateStr => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
};

const CartItemRow = ({ item, intl }) => {
  const { listing, quantity } = item;
  const title = listing?.attributes?.title || '';
  const price = listing?.attributes?.price;
  const formattedPrice = price ? formatMoney(intl, new Money(price.amount, price.currency)) : '';
  const lineTotal = price
    ? formatMoney(intl, new Money(price.amount * quantity, price.currency))
    : '';

  return (
    <div className={css.cartItemRow}>
      <div className={css.cartItemInfo}>
        <span className={css.cartItemTitle}>{title}</span>
        <span className={css.cartItemDetails}>
          {formattedPrice} x {quantity}
        </span>
      </div>
      <span className={css.cartItemTotal}>{lineTotal}</span>
    </div>
  );
};

const CartCheckoutPageContent = props => {
  const { cartItems, checkoutState, onProcessCheckout, currentUser, stripeCustomer, config, intl } = props;

  const profile = currentUser?.attributes?.profile;
  const savedAddress = currentUser?.attributes?.profile?.protectedData?.address;

  const [shippingAddress, setShippingAddress] = useState({
    name: profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() : '',
    phone: '',
    addressLine1: savedAddress?.street || '',
    addressLine2: '',
    city: savedAddress?.city || '',
    state: savedAddress?.state || '',
    postalCode: savedAddress?.zip || '',
    country: savedAddress?.country || '',
  });
  const addressInitializedRef = useRef(false);

  // Pre-fill address from user profile when it becomes available
  useEffect(() => {
    if (addressInitializedRef.current) return;
    if (profile && savedAddress) {
      addressInitializedRef.current = true;
      setShippingAddress(prev => ({
        ...prev,
        name: prev.name || `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
        addressLine1: prev.addressLine1 || savedAddress.street || '',
        city: prev.city || savedAddress.city || '',
        state: prev.state || savedAddress.state || '',
        postalCode: prev.postalCode || savedAddress.zip || '',
        country: prev.country || savedAddress.country || '',
      }));
    }
  }, [profile, savedAddress]);

  // Saved payment method
  const defaultPaymentMethod = stripeCustomer?.defaultPaymentMethod || null;
  const savedCard = defaultPaymentMethod?.attributes?.card || null;
  const [paymentChoice, setPaymentChoice] = useState(savedCard ? 'saved' : 'new');
  const [cardReady, setCardReady] = useState(false);
  const [cardError, setCardError] = useState(null);

  // Update payment choice when saved card becomes available
  useEffect(() => {
    if (savedCard && paymentChoice === 'new' && !cardReady) {
      setPaymentChoice('saved');
    }
  }, [savedCard, paymentChoice, cardReady]);
  const [estimatedDelivery, setEstimatedDelivery] = useState(null);
  const [estimatedFee, setEstimatedFee] = useState(null);
  // Per-charge card processing fee (cents), from the server so it stays in
  // sync with the line item added in server/api-util/lineItems.js.
  const [processingFeeCents, setProcessingFeeCents] = useState(0);
  const [estimatingBreakdown, setEstimatingBreakdown] = useState(false);
  const [selectedDeliveryMethod, setSelectedDeliveryMethod] = useState(null);
  const [deliveryRateCents, setDeliveryRateCents] = useState(null);
  const [deliveryDistanceMiles, setDeliveryDistanceMiles] = useState(null);
  const [deliveryEstimateError, setDeliveryEstimateError] = useState(null);

  // Feature 1: Next pickup date
  const [nextPickupDate, setNextPickupDate] = useState(null);
  const [pickupCutoffPassed, setPickupCutoffPassed] = useState(false);
  useEffect(() => {
    if (!appSettings.featureFlags.pickupSchedule) return;
    fetchPickupSettings()
      .then(data => {
        if (data.nextPickupDate) {
          setNextPickupDate(data.nextPickupDate);
        }
        if (data.cutoffPassed) {
          setPickupCutoffPassed(true);
        }
      })
      .catch(() => {});
  }, []);

  // Feature 6: Add to existing order group
  const [activeOrderGroup, setActiveOrderGroup] = useState(null);
  const [activeDeliveryTxId, setActiveDeliveryTxId] = useState(null);
  const [activeDeliveryMethod, setActiveDeliveryMethod] = useState(null);
  const [addToExistingOrder, setAddToExistingOrder] = useState(false);
  useEffect(() => {
    if (!appSettings.featureFlags.addToExistingOrder) return;
    fetchActiveOrderGroup()
      .then(data => {
        if (data.canAddToOrder && data.orderGroupId) {
          setActiveOrderGroup(data.orderGroupId);
          setActiveDeliveryTxId(data.deliveryTransactionId || null);
          setActiveDeliveryMethod(data.deliveryMethod || null);
        }
      })
      .catch(() => {});
  }, []);

  // When the buyer opts to add to their existing order, inherit that order's
  // delivery choice (pickup vs. shipping) so they don't have to pick again.
  useEffect(() => {
    if (addToExistingOrder && activeDeliveryMethod) {
      setSelectedDeliveryMethod(activeDeliveryMethod);
    }
  }, [addToExistingOrder, activeDeliveryMethod]);

  const stripeRef = useRef(null);
  const cardRef = useRef(null);
  const cardContainerRef = useRef(null);
  const deliveryTimerRef = useRef(null);

  const { checkoutInProgress, currentItemIndex, completedResults, checkoutError } = checkoutState;

  // Scroll to top when checkout completes so user sees the results
  useEffect(() => {
    if (completedResults) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [completedResults]);

  // Ask for an app store review after a successful order. Native app only, and
  // throttled inside the helper — see util/appReview. Delayed so the dialog
  // lands on the success screen rather than on top of the spinner.
  useEffect(() => {
    const anySucceeded = completedResults?.results?.some(r => r.success);
    if (!anySucceeded) return undefined;
    const timer = setTimeout(() => requestAppReviewAfterOrder(), 1500);
    return () => clearTimeout(timer);
  }, [completedResults]);

  // Check if any cart items support delivery/shipping (from listing publicData)
  const shippingAvailable = cartItems.some(
    item => item.listing?.attributes?.publicData?.shippingEnabled
  );
  // Self pickup is always offered: buyers can collect directly from the vendor
  // (coordinated via in-app messaging) regardless of listing settings.
  const pickupAvailable = true;

  // The buyer must consciously choose a delivery method at checkout — we do not
  // auto-select one, so no one forgets to pick delivery vs. self pickup.

  const hasShippingItems = selectedDeliveryMethod === 'shipping' && shippingAvailable;

  // Initialize Stripe instance on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !window.Stripe) return;
    const publishableKey = config?.stripe?.publishableKey;
    if (!publishableKey) return;
    stripeRef.current = window.Stripe(publishableKey);
  }, [config?.stripe?.publishableKey]);

  // Mount/unmount card element based on payment choice
  useEffect(() => {
    if (!stripeRef.current || paymentChoice !== 'new') {
      if (cardRef.current) {
        cardRef.current.unmount();
        cardRef.current = null;
        setCardReady(false);
      }
      return;
    }

    if (!cardContainerRef.current) return;

    const elements = stripeRef.current.elements(stripeElementsOptions);
    cardRef.current = elements.create('card', { style: cardStyles });
    cardRef.current.mount(cardContainerRef.current);
    cardRef.current.addEventListener('change', event => {
      setCardError(event.error ? event.error.message : null);
      setCardReady(event.complete);
    });

    return () => {
      if (cardRef.current) {
        cardRef.current.unmount();
        cardRef.current = null;
        setCardReady(false);
      }
    };
  }, [paymentChoice, config?.stripe?.publishableKey]);

  // Fetch marketplace fee: a single platform fee for the entire cart subtotal
  // (5% OR $3.99 minimum — whichever is greater), charged once per order.
  const cartSubtotalCents = cartItems.reduce((sum, item) => {
    const amount = item.listing?.attributes?.price?.amount || 0;
    return sum + amount * (item.quantity || 1);
  }, 0);

  useEffect(() => {
    if (!cartSubtotalCents) {
      setEstimatedFee(null);
      return;
    }

    let cancelled = false;
    calculateCartFee({ subtotalCents: cartSubtotalCents })
      .then(res => {
        if (cancelled) return;
        const feeCents = res?.data?.feeCents;
        setEstimatedFee(feeCents > 0 ? feeCents : null);
        setProcessingFeeCents(Number(res?.data?.processingFeeCents) || 0);
      })
      .catch(() => {
        if (!cancelled) setEstimatedFee(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cartSubtotalCents]);

  // Fetch route-based delivery estimate (supplier → supplier → buyer)
  useEffect(() => {
    if (selectedDeliveryMethod !== 'shipping' || !cartItems.length) {
      setEstimatedDelivery(null);
      setDeliveryDistanceMiles(null);
      return;
    }

    const { addressLine1, city, postalCode, country } = shippingAddress;
    const hasAddress = !!(addressLine1 && city && postalCode && country);
    if (!hasAddress) {
      setEstimatedDelivery(null);
      setDeliveryDistanceMiles(null);
      return;
    }

    if (deliveryTimerRef.current) {
      clearTimeout(deliveryTimerRef.current);
    }

    setEstimatingBreakdown(true);
    setDeliveryEstimateError(null);

    deliveryTimerRef.current = setTimeout(() => {
      const listingIds = cartItems.map(item => item.listingId);
      const address = {
        line1: addressLine1,
        city,
        state: shippingAddress.state,
        postalCode,
        country,
      };

      estimateCartDelivery({ listingIds, shippingAddress: address })
        .then(result => {
          const { totalFeeCents, totalDistanceMiles, rateCentsPerMile } = result;
          setEstimatedDelivery(totalFeeCents > 0 ? totalFeeCents : null);
          setDeliveryDistanceMiles(totalDistanceMiles > 0 ? totalDistanceMiles : null);
          if (rateCentsPerMile > 0) setDeliveryRateCents(rateCentsPerMile);
          setEstimatingBreakdown(false);
          setDeliveryEstimateError(null);
        })
        .catch(() => {
          setEstimatedDelivery(null);
          setDeliveryDistanceMiles(null);
          setEstimatingBreakdown(false);
          setDeliveryEstimateError(true);
        });
    }, 500);

    return () => {
      if (deliveryTimerRef.current) {
        clearTimeout(deliveryTimerRef.current);
      }
    };
  }, [
    shippingAddress.addressLine1,
    shippingAddress.city,
    shippingAddress.postalCode,
    shippingAddress.country,
    shippingAddress.state,
    selectedDeliveryMethod,
    cartItems,
  ]);

  const handleShippingChange = e => {
    const { name, value } = e.target;
    setShippingAddress(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = useCallback(
    e => {
      e.preventDefault();
      if (!stripeRef.current) return;
      if (paymentChoice === 'new' && !cardRef.current) return;

      const billingDetails = {
        name: shippingAddress.name || undefined,
      };

      const shippingDetailsMaybe = hasShippingItems
        ? {
            protectedData: {
              shippingAddress: { ...shippingAddress },
            },
          }
        : undefined;

      // Apply the customer's selected delivery method to every cart item.
      // Self pickup is offered for every order, so it always propagates — the
      // buyer coordinates collection with each vendor via in-app messaging.
      // Delivery (shipping) propagates only to listings that support it so the
      // backend generates the shipping-fee line item and charges for delivery
      // (the common case after the May bulk-enable: shippingEnabled=true).
      const itemsWithDelivery = cartItems.map(item => {
        if (!selectedDeliveryMethod) return item;
        if (selectedDeliveryMethod === 'pickup') {
          return { ...item, deliveryMethod: 'pickup' };
        }
        const shippingEnabled = item.listing?.attributes?.publicData?.shippingEnabled;
        return shippingEnabled ? { ...item, deliveryMethod: 'shipping' } : item;
      });

      const savedPaymentMethodId = paymentChoice === 'saved' && defaultPaymentMethod?.attributes?.stripePaymentMethodId
        ? defaultPaymentMethod.attributes.stripePaymentMethodId
        : null;

      // Feature 6: If adding to existing order, include orderGroupId (and the
      // existing delivery transaction id so new items attach to the SAME
      // standalone delivery instead of re-charging it) and zero out delivery.
      const orderGroupMaybe = addToExistingOrder && activeOrderGroup
        ? {
            orderGroupId: activeOrderGroup,
            customShippingFeeCents: 0,
            ...(activeDeliveryTxId ? { deliveryTransactionId: activeDeliveryTxId } : {}),
          }
        : {};

      onProcessCheckout({
        cartItems: itemsWithDelivery,
        stripe: stripeRef.current,
        card: paymentChoice === 'new' ? cardRef.current : null,
        billingDetails,
        shippingDetails: shippingDetailsMaybe,
        processAlias: cartItems[0]?.listing?.attributes?.publicData?.transactionProcessAlias || 'default-purchase/release-1',
        savedPaymentMethodId,
        stripeCustomer,
        cartFeeCents: estimatedFee || 0,
        ...orderGroupMaybe,
      });
    },
    [cartItems, shippingAddress, hasShippingItems, selectedDeliveryMethod, onProcessCheckout, paymentChoice, defaultPaymentMethod, stripeCustomer, estimatedFee, addToExistingOrder, activeOrderGroup, activeDeliveryTxId]
  );

  // Success/Results view
  if (completedResults) {
    const { results, allSucceeded } = completedResults;
    const successResults = results?.filter(r => r.success) || [];
    const failedResults = results?.filter(r => !r.success) || [];

    return (
      <div className={css.root}>
        <div className={css.resultsContainer}>
          <h2 className={css.resultsTitle}>
            {allSucceeded ? (
              <FormattedMessage id="CartCheckoutPage.successTitle" />
            ) : (
              <FormattedMessage id="CartCheckoutPage.partialSuccessTitle" />
            )}
          </h2>

          {successResults.length > 0 ? (
            <div className={css.resultsList}>
              <h3 className={css.resultsSubtitle}>
                <FormattedMessage id="CartCheckoutPage.completedOrders" />
              </h3>
              {successResults.map(result =>
                result.isDelivery ? (
                  // Delivery is an operator-managed order with no buyer-facing
                  // transaction page; show the charged fee instead of a link.
                  <div key={result.orderId} className={css.resultItem}>
                    <span className={css.resultTitle}>
                      <FormattedMessage id="CartCheckoutPage.deliveryOrderLabel" />
                    </span>
                    {typeof result.feeCents === 'number' ? (
                      <span className={css.resultTitle}>
                        {formatMoney(intl, new Money(result.feeCents, result.currency || 'USD'))}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div key={result.orderId} className={css.resultItem}>
                    <span className={css.resultTitle}>{result.title}</span>
                    <NamedLink
                      name="OrderDetailsPage"
                      params={{ id: result.orderId }}
                      className={css.orderLink}
                    >
                      <FormattedMessage id="CartCheckoutPage.viewOrder" />
                    </NamedLink>
                  </div>
                )
              )}
            </div>
          ) : null}

          {failedResults.length > 0 ? (
            <div className={css.resultsList}>
              <h3 className={css.resultsSubtitleError}>
                <FormattedMessage id="CartCheckoutPage.failedOrders" />
              </h3>
              {failedResults.map((result, i) => (
                <div key={result.listingId || (result.isDelivery ? 'delivery' : `failed-${i}`)} className={css.resultItemError}>
                  <span className={css.resultTitle}>
                    {result.isDelivery ? (
                      <FormattedMessage id="CartCheckoutPage.deliveryOrderLabel" />
                    ) : (
                      result.title
                    )}
                  </span>
                  <span className={css.resultError}>{result.error}</span>
                </div>
              ))}
            </div>
          ) : null}

          <NamedLink name="InboxPage" params={{ tab: 'orders' }} className={css.inboxLink}>
            <FormattedMessage id="CartCheckoutPage.goToInbox" />
          </NamedLink>
        </div>
      </div>
    );
  }

  // Empty cart state
  if (!cartItems || cartItems.length === 0) {
    return (
      <div className={css.root}>
        <div className={css.emptyState}>
          <h2 className={css.emptyTitle}>
            <FormattedMessage id="CartCheckoutPage.emptyCart" />
          </h2>
          <NamedLink name="SearchPage" className={css.browseLink}>
            <FormattedMessage id="CartCheckoutPage.browseListings" />
          </NamedLink>
        </div>
      </div>
    );
  }

  // Calculate subtotal (items only)
  const subtotal = cartItems.reduce((sum, item) => {
    const price = item.listing?.attributes?.price;
    return price ? sum + price.amount * (item.quantity || 1) : sum;
  }, 0);
  const currency = cartItems[0]?.listing?.attributes?.price?.currency || 'USD';
  const formattedSubtotal = subtotal > 0 ? formatMoney(intl, new Money(subtotal, currency)) : '';

  // When the buyer is adding to an existing order, the marketplace fee and
  // delivery were already paid on the original order — the new items piggyback
  // with no additional fee or delivery charge (the server zeroes both). Reflect
  // that here so the displayed total matches what's actually charged, instead
  // of re-showing the full fees.
  const addingToExistingOrder = addToExistingOrder && !!activeOrderGroup;

  const deliveryAmount = addingToExistingOrder ? 0 : estimatedDelivery || 0;
  const feeAmount = addingToExistingOrder ? 0 : estimatedFee || 0;
  // Hide the fee row entirely when there is no buyer-side fee. Under a
  // provider-side commission the platform's cut comes out of the vendor's
  // price, so the buyer has nothing to show and a "$0.00" row just raises
  // questions.
  const showFeeRow = !addingToExistingOrder && estimatedFee > 0;
  const showDeliveryRow =
    !addingToExistingOrder && hasShippingItems && (estimatingBreakdown || estimatedDelivery != null);
  const showBreakdown =
    estimatingBreakdown || showFeeRow || showDeliveryRow || addingToExistingOrder;

  // Card processing fee: one per Stripe charge. Each cart item is its own
  // transaction/charge, plus one more when this checkout creates a standalone
  // delivery transaction (mirrors canStandaloneDelivery in the duck — joining
  // an existing order group reuses its delivery transaction).
  const willCreateDeliveryTx =
    !!process.env.REACT_APP_DELIVERY_LISTING_ID &&
    hasShippingItems &&
    deliveryAmount > 0 &&
    !addingToExistingOrder;
  const chargeCount = cartItems.length + (willCreateDeliveryTx ? 1 : 0);
  const processingAmount = processingFeeCents > 0 ? processingFeeCents * chargeCount : 0;

  const grandTotal = subtotal + deliveryAmount + feeAmount + processingAmount;
  const formattedTotal = grandTotal > 0 ? formatMoney(intl, new Money(grandTotal, currency)) : '';
  const formattedDelivery = estimatedDelivery != null
    ? formatMoney(intl, new Money(estimatedDelivery, currency))
    : '';
  const deliveryMath = estimatedDelivery != null && deliveryRateCents > 0 && deliveryDistanceMiles != null
    ? (() => {
        const rateFormatted = (deliveryRateCents / 100).toFixed(2);
        return `(${deliveryDistanceMiles.toFixed(1)} mi × $${rateFormatted}/mi)`;
      })()
    : null;
  const formattedFee = estimatedFee != null
    ? formatMoney(intl, new Money(estimatedFee, currency))
    : '';

  return (
    <div className={css.root}>
      <h1 className={css.pageTitle}>
        <FormattedMessage id="CartCheckoutPage.title" />
      </h1>

      <form onSubmit={handleSubmit} className={css.checkoutLayout}>
        <div className={css.formColumn}>
        {appSettings.featureFlags.addToExistingOrder && activeOrderGroup ? (
          <div className={css.addToOrderSection}>
            <label className={css.addToOrderLabel}>
              <input
                type="checkbox"
                checked={addToExistingOrder}
                onChange={e => setAddToExistingOrder(e.target.checked)}
                className={css.addToOrderCheckbox}
              />
              <span>
                <FormattedMessage id="CartCheckoutPage.addToExistingOrder" />
              </span>
            </label>
            {addToExistingOrder ? (
              <p className={css.addToOrderNote}>
                <FormattedMessage id="CartCheckoutPage.addToExistingOrderNote" />
                {activeDeliveryMethod ? (
                  <>
                    {' '}
                    <FormattedMessage
                      id={
                        activeDeliveryMethod === 'pickup'
                          ? 'CartCheckoutPage.inheritedPickup'
                          : 'CartCheckoutPage.inheritedShipping'
                      }
                    />
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {(shippingAvailable || pickupAvailable) && !(addingToExistingOrder && activeDeliveryMethod) ? (
          <div className={css.deliveryMethodSection}>
            <h3 className={css.sectionTitle}>
              <FormattedMessage id="CartCheckoutPage.deliveryMethodTitle" />
            </h3>
            <div className={css.deliveryOptions}>
              {pickupAvailable ? (
                <label className={css.deliveryOption}>
                  <input
                    type="radio"
                    name="deliveryMethod"
                    value="pickup"
                    checked={selectedDeliveryMethod === 'pickup'}
                    onChange={() => {
                      setSelectedDeliveryMethod('pickup');
                      setEstimatedDelivery(null);
                    }}
                    className={css.radioInput}
                  />
                  <span className={css.radioLabel}>
                    <FormattedMessage id="CartCheckoutPage.pickupOption" />
                  </span>
                </label>
              ) : null}
              {shippingAvailable ? (
                <label className={css.deliveryOption}>
                  <input
                    type="radio"
                    name="deliveryMethod"
                    value="shipping"
                    checked={selectedDeliveryMethod === 'shipping'}
                    onChange={() => setSelectedDeliveryMethod('shipping')}
                    className={css.radioInput}
                  />
                  <span className={css.radioLabel}>
                    <FormattedMessage id="CartCheckoutPage.shippingOption" />
                  </span>
                </label>
              ) : null}
            </div>
            {selectedDeliveryMethod === 'shipping' && estimatedDelivery == null && !estimatingBreakdown ? (
              <p className={css.deliveryHint}>
                <FormattedMessage id="CartCheckoutPage.deliveryFeeHint" />
              </p>
            ) : null}
            {selectedDeliveryMethod === 'pickup' ? (
              <p className={css.pickupNote}>
                <FormattedMessage id="CartCheckoutPage.selfPickupNote" />
              </p>
            ) : null}
          </div>
        ) : null}

        {appSettings.featureFlags.pickupSchedule && nextPickupDate && selectedDeliveryMethod === 'shipping' ? (
          <div className={css.pickupDateInfo}>
            <FormattedMessage
              id="CartCheckoutPage.nextDeliveryDate"
              values={{ date: formatPickupDate(nextPickupDate) }}
            />
            {pickupCutoffPassed ? (
              <p className={css.cutoffWarning}>
                <FormattedMessage id="CartCheckoutPage.deliveryCutoffPassed" />
              </p>
            ) : null}
          </div>
        ) : null}

        {hasShippingItems ? (
          <div className={css.shippingSection}>
            <h3 className={css.sectionTitle}>
              <FormattedMessage id="CartCheckoutPage.shippingAddress" />
            </h3>
            <div className={css.formFields}>
              <div className={css.fieldGroup}>
                <label className={css.fieldLabel} htmlFor="shipping-name">
                  <FormattedMessage id="CartCheckoutPage.nameLabel" />
                </label>
                <input
                  id="shipping-name"
                  className={css.input}
                  name="name"
                  autoComplete="name"
                  value={shippingAddress.name}
                  onChange={handleShippingChange}
                  required
                />
              </div>
              <div className={css.fieldGroup}>
                <label className={css.fieldLabel} htmlFor="shipping-phone">
                  <FormattedMessage id="CartCheckoutPage.phoneLabel" />
                </label>
                <input
                  id="shipping-phone"
                  className={css.input}
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={shippingAddress.phone}
                  onChange={handleShippingChange}
                  required
                />
              </div>
              <div className={css.fieldGroup}>
                <label className={css.fieldLabel} htmlFor="shipping-address1">
                  <FormattedMessage id="CartCheckoutPage.addressLine1Label" />
                </label>
                <input
                  id="shipping-address1"
                  className={css.input}
                  name="addressLine1"
                  autoComplete="address-line1"
                  value={shippingAddress.addressLine1}
                  onChange={handleShippingChange}
                  required
                />
              </div>
              <div className={css.fieldGroup}>
                <label className={css.fieldLabel} htmlFor="shipping-address2">
                  <FormattedMessage id="CartCheckoutPage.addressLine2Label" />
                </label>
                <input
                  id="shipping-address2"
                  className={css.input}
                  name="addressLine2"
                  autoComplete="address-line2"
                  value={shippingAddress.addressLine2}
                  onChange={handleShippingChange}
                />
              </div>
              <div className={css.formRow}>
                <div className={css.fieldGroup}>
                  <label className={css.fieldLabel} htmlFor="shipping-city">
                    <FormattedMessage id="CartCheckoutPage.cityLabel" />
                  </label>
                  <input
                    id="shipping-city"
                    className={css.input}
                    name="city"
                    autoComplete="address-level2"
                    value={shippingAddress.city}
                    onChange={handleShippingChange}
                    required
                  />
                </div>
                <div className={css.fieldGroup}>
                  <label className={css.fieldLabel} htmlFor="shipping-state">
                    <FormattedMessage id="CartCheckoutPage.stateLabel" />
                  </label>
                  <input
                    id="shipping-state"
                    className={css.input}
                    name="state"
                    autoComplete="address-level1"
                    value={shippingAddress.state}
                    onChange={handleShippingChange}
                  />
                </div>
              </div>
              <div className={css.formRow}>
                <div className={css.fieldGroup}>
                  <label className={css.fieldLabel} htmlFor="shipping-postal">
                    <FormattedMessage id="CartCheckoutPage.postalCodeLabel" />
                  </label>
                  <input
                    id="shipping-postal"
                    className={css.input}
                    name="postalCode"
                    autoComplete="postal-code"
                    value={shippingAddress.postalCode}
                    onChange={handleShippingChange}
                    required
                  />
                </div>
                <div className={css.fieldGroup}>
                  <label className={css.fieldLabel} htmlFor="shipping-country">
                    <FormattedMessage id="CartCheckoutPage.countryLabel" />
                  </label>
                  <input
                    id="shipping-country"
                    className={css.input}
                    name="country"
                    autoComplete="country"
                    value={shippingAddress.country}
                    onChange={handleShippingChange}
                    required
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className={css.paymentSection}>
          <h3 className={css.sectionTitle}>
            <FormattedMessage id="CartCheckoutPage.paymentDetails" />
          </h3>
          {savedCard ? (
            <div className={css.paymentOptions}>
              <label className={css.paymentOption}>
                <input
                  type="radio"
                  name="paymentChoice"
                  value="saved"
                  checked={paymentChoice === 'saved'}
                  onChange={() => setPaymentChoice('saved')}
                  className={css.radioInput}
                />
                <span className={css.savedCardInfo}>
                  <span className={css.cardBrand}>{savedCard.brand}</span>
                  <span className={css.cardLast4}>
                    <FormattedMessage
                      id="CartCheckoutPage.savedCardEnding"
                      values={{ last4: savedCard.last4Digits }}
                    />
                  </span>
                </span>
              </label>
              <label className={css.paymentOption}>
                <input
                  type="radio"
                  name="paymentChoice"
                  value="new"
                  checked={paymentChoice === 'new'}
                  onChange={() => setPaymentChoice('new')}
                  className={css.radioInput}
                />
                <span className={css.radioLabel}>
                  <FormattedMessage id="CartCheckoutPage.newCard" />
                </span>
              </label>
            </div>
          ) : null}
          {paymentChoice === 'new' ? (
            <>
              <div className={css.cardElement} ref={cardContainerRef} />
              {cardError ? <p className={css.cardError}>{cardError}</p> : null}
            </>
          ) : null}
        </div>

        {checkoutError ? (
          <div className={css.errorMessage}>
            <FormattedMessage id="CartCheckoutPage.errorPayment" />
            <p className={css.errorDetail}>{checkoutError}</p>
          </div>
        ) : null}

        <PrimaryButton
          type="submit"
          className={css.submitButton}
          disabled={
            (paymentChoice === 'new' && !cardReady) ||
            checkoutInProgress ||
            ((shippingAvailable || pickupAvailable) && !selectedDeliveryMethod)
          }
        >
          {checkoutInProgress ? (
            <FormattedMessage
              id="CartCheckoutPage.processingItem"
              values={{ current: currentItemIndex + 1, total: cartItems.length }}
            />
          ) : (
            <FormattedMessage id="CartCheckoutPage.submitButton" />
          )}
        </PrimaryButton>
        </div>

        <div className={css.summaryColumn}>
          <div className={css.orderSummary}>
            <h3 className={css.sectionTitle}>
              <FormattedMessage id="CartCheckoutPage.orderSummary" />
            </h3>
            {cartItems.map(item => (
              <CartItemRow key={item.listingId} item={item} intl={intl} />
            ))}
            {showBreakdown ? (
              <>
                <div className={css.subtotalRow}>
                  <span className={css.subtotalLabel}>
                    <FormattedMessage id="CartCheckoutPage.subtotal" />
                  </span>
                  <span className={css.subtotalAmount}>{formattedSubtotal}</span>
                </div>
                {showDeliveryRow ? (
                  <div className={css.deliveryRow}>
                    <span className={css.subtotalLabel}>
                      <FormattedMessage id="CartCheckoutPage.delivery" />
                      {deliveryMath ? (
                        <span className={css.deliveryMath}> {deliveryMath}</span>
                      ) : null}
                    </span>
                    <span className={css.subtotalAmount}>
                      {estimatingBreakdown ? (
                        <span className={css.estimatingText}>
                          <FormattedMessage id="CartCheckoutPage.estimatingDelivery" />
                        </span>
                      ) : (
                        formattedDelivery
                      )}
                    </span>
                  </div>
                ) : null}
                {deliveryEstimateError ? (
                  <p className={css.deliveryEstimateError}>
                    <FormattedMessage id="CartCheckoutPage.deliveryEstimateFailed" />
                  </p>
                ) : null}
                {showFeeRow ? (
                  <div className={css.deliveryRow}>
                    <span className={css.subtotalLabel}>
                      <FormattedMessage id="CartCheckoutPage.marketplaceFee" />
                    </span>
                    <span className={css.subtotalAmount}>{formattedFee}</span>
                  </div>
                ) : null}
                {processingAmount > 0 ? (
                  <div className={css.deliveryRow}>
                    <span className={css.subtotalLabel}>
                      <FormattedMessage
                        id="CartCheckoutPage.processingFee"
                        values={{
                          count: chargeCount,
                          fee: formatMoney(intl, new Money(processingFeeCents, currency)),
                        }}
                      />
                    </span>
                    <span className={css.subtotalAmount}>
                      {formatMoney(intl, new Money(processingAmount, currency))}
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className={css.totalRow}>
              <span className={css.totalLabel}>
                <FormattedMessage id="CartCheckoutPage.total" />
              </span>
              <span className={css.totalAmount}>
                {estimatingBreakdown ? (
                  <span className={css.estimatingText}>
                    <FormattedMessage id="CartCheckoutPage.estimatingDelivery" />
                  </span>
                ) : (
                  formattedTotal
                )}
              </span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CartCheckoutPageContent;
