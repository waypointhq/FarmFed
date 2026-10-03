import React, { useCallback, useEffect, useState } from 'react';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { fetchMyPromos, checkPromoCode } from '../../util/api';
import {
  formatPromoDate,
  promoReasonMessageId,
  getAppliedPromoCode,
  setAppliedPromoCode,
  clearAppliedPromoCode,
} from '../../util/promos';

import css from './CartCheckoutPage.module.css';

// The promo is valid but this order can't use it yet; it stays on the order
// and kicks in if the buyer switches to delivery or the fee comes back.
const INACTIVE_REASONS = ['pickup', 'already-free'];

/**
 * The customer's message for a reason a promo won't work here.
 */
export const PromoReasonMessage = ({ reason, date }) => (
  <FormattedMessage id={promoReasonMessageId(reason)} values={{ date: formatPromoDate(date) }} />
);

/**
 * State for the free-delivery promo at checkout: the customer's saved
 * promos (for the one-tap banner), the applied promo, and the typed-code
 * field. Nothing here counts a use — that happens at Place Order.
 *
 * @param {Object} params
 * @param {boolean} params.isLoggedIn
 * @param {string|null} params.deliveryMethod 'shipping' | 'pickup' | null
 * @param {number|null} params.deliveryFeeCents the fee, once estimated
 *   (0 when delivery is already free); null while unknown
 */
export const useCheckoutPromo = ({ isLoggedIn, deliveryMethod, deliveryFeeCents }) => {
  const [myPromos, setMyPromos] = useState([]);
  const [applied, setApplied] = useState(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [fieldError, setFieldError] = useState(null);

  const loadMyPromos = useCallback(() => {
    if (!isLoggedIn) return;
    fetchMyPromos()
      .then(res => setMyPromos(res?.active || []))
      .catch(() => setMyPromos([]));
  }, [isLoggedIn]);

  useEffect(loadMyPromos, [loadMyPromos]);

  const apply = useCallback(
    code => {
      if (!code) return Promise.resolve();
      setChecking(true);
      setFieldError(null);
      return checkPromoCode({
        code,
        deliveryMethod: deliveryMethod || undefined,
        deliveryFeeCents: deliveryFeeCents == null ? undefined : deliveryFeeCents,
      })
        .then(result => {
          const usable = result.ok || INACTIVE_REASONS.includes(result.reason);
          if (!usable) {
            setFieldError({ reason: result.reason, date: result.date });
            setFieldOpen(true);
            setInput(result.code || code);
            return;
          }
          // One promo per order: applying another swaps it out.
          const promo = result.promo || myPromos.find(p => p.code === result.code);
          setApplied({ code: result.code, title: promo?.title || null });
          setAppliedPromoCode(result.code);
          setFieldOpen(false);
          setInput('');
        })
        .catch(() => setFieldError({ reason: 'unavailable' }))
        .finally(() => setChecking(false));
    },
    [deliveryMethod, deliveryFeeCents, myPromos]
  );

  // A promo from an email, a My Promos "Use Now" or an earlier visit.
  useEffect(() => {
    if (!isLoggedIn) return;
    const remembered = getAppliedPromoCode();
    if (remembered) apply(remembered);
    // Only on arrival; later changes are handled by the derived state below.
  }, [isLoggedIn]);

  const remove = () => {
    setApplied(null);
    setFieldError(null);
    clearAppliedPromoCode();
  };

  // Promo dropped at Place Order: take it off and refresh what's left.
  const dropAfterFailedRedeem = () => {
    setApplied(null);
    clearAppliedPromoCode();
    loadMyPromos();
  };

  const isPickup = deliveryMethod === 'pickup';
  const alreadyFree = deliveryMethod === 'shipping' && deliveryFeeCents === 0;
  const isActive =
    !!applied && deliveryMethod === 'shipping' && deliveryFeeCents != null && deliveryFeeCents > 0;
  const inactiveReason =
    applied && isPickup ? 'pickup' : applied && alreadyFree ? 'already-free' : null;

  const freeDeliveriesLeft = myPromos.reduce((sum, p) => sum + (p.usesLeft || 1), 0);
  const showBanner = myPromos.length > 0 && !applied && !isPickup && !alreadyFree;

  return {
    applied,
    isActive,
    inactiveReason,
    showBanner,
    freeDeliveriesLeft,
    applyFirstSaved: () => apply(myPromos[0]?.code),
    apply,
    remove,
    dropAfterFailedRedeem,
    fieldOpen,
    openField: () => setFieldOpen(true),
    input,
    setInput: value => {
      setInput(value);
      setFieldError(null);
    },
    checking,
    fieldError,
  };
};

/**
 * Light green bar offering the customer's own promo with one tap.
 */
export const PromoBanner = ({ promo }) =>
  promo.showBanner ? (
    <div className={css.promoBanner}>
      <span className={css.promoBannerText}>
        <FormattedMessage
          id="CartCheckoutPage.promoBanner"
          values={{ count: promo.freeDeliveriesLeft }}
        />
      </span>
      <button
        type="button"
        className={css.promoBannerApply}
        onClick={promo.applyFirstSaved}
        disabled={promo.checking}
      >
        <FormattedMessage id="CartCheckoutPage.promoApply" />
      </button>
    </div>
  ) : null;

/**
 * "Have a promo code?" link, the code field, or the applied-promo tag.
 */
export const PromoCodeRow = ({ promo }) => {
  const intl = useIntl();
  const { applied, fieldOpen, fieldError, inactiveReason } = promo;

  const errorLine = fieldError ? (
    <p className={css.promoError} role="alert">
      <PromoReasonMessage reason={fieldError.reason} date={fieldError.date} />
    </p>
  ) : null;

  if (applied) {
    return (
      <div className={css.promoRow}>
        <span className={css.promoTag}>
          <span className={css.promoTagCode}>{applied.code}</span>
          {applied.title ? <span className={css.promoTagTitle}> · {applied.title}</span> : null}
          <button
            type="button"
            className={css.promoTagRemove}
            onClick={promo.remove}
            aria-label={intl.formatMessage({ id: 'CartCheckoutPage.promoRemove' })}
          >
            ×
          </button>
        </span>
        {inactiveReason === 'pickup' ? (
          <p className={css.promoError}>
            <PromoReasonMessage reason="pickup" />
          </p>
        ) : inactiveReason === 'already-free' ? (
          <p className={css.promoInfo}>
            <PromoReasonMessage reason="already-free" />
          </p>
        ) : null}
      </div>
    );
  }

  if (!fieldOpen) {
    return (
      <div className={css.promoRow}>
        <button type="button" className={css.promoLink} onClick={promo.openField}>
          <FormattedMessage id="CartCheckoutPage.promoHaveCode" />
        </button>
        {errorLine}
      </div>
    );
  }

  const submit = () => promo.apply(promo.input.trim());

  return (
    <div className={css.promoRow}>
      <div className={css.promoField}>
        <input
          className={css.promoInput}
          value={promo.input}
          onChange={e => promo.setInput(e.target.value)}
          onKeyDown={e => {
            // The field sits inside the checkout form: Enter applies the code
            // instead of placing the order.
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={intl.formatMessage({ id: 'CartCheckoutPage.promoCodePlaceholder' })}
          aria-label={intl.formatMessage({ id: 'CartCheckoutPage.promoCodePlaceholder' })}
          autoCapitalize="characters"
          autoComplete="off"
          aria-invalid={!!fieldError}
        />
        <button
          type="button"
          className={css.promoApplyButton}
          onClick={submit}
          disabled={!promo.input.trim() || promo.checking}
        >
          <FormattedMessage id="CartCheckoutPage.promoApply" />
        </button>
      </div>
      {errorLine}
    </div>
  );
};
