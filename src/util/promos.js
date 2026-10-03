import moment from 'moment-timezone/builds/moment-timezone-with-data-10-year-range.min';

/**
 * Shared helpers for free-delivery promos: Central-time dates, the customer
 * messages for codes that won't work, the admin summary sentence, and the
 * promo a customer has applied to their cart.
 */

// All promo dates run on Central time.
export const PROMO_TIMEZONE = 'America/Chicago';

const DAY_MS = 24 * 60 * 60 * 1000;
// Under this many days, a promo card warns that it expires soon.
export const EXPIRING_SOON_DAYS = 7;

const APPLIED_PROMO_KEY = 'farmfed.appliedPromo';

const formatter = options =>
  new Intl.DateTimeFormat('en-US', { timeZone: PROMO_TIMEZONE, ...options });

/** "Oct 31" */
export const formatPromoDate = iso =>
  iso ? formatter({ month: 'short', day: 'numeric' }).format(new Date(iso)) : '';

/** "Oct 31 at 11:59 PM" */
export const formatPromoDateTime = iso => {
  if (!iso) return '';
  const date = formatPromoDate(iso);
  const time = formatter({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return `${date} at ${time}`;
};

/** Whole days until `iso`, rounded up; 0 once it has passed. */
export const daysUntil = (iso, now = Date.now()) =>
  iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS)) : null;

export const isExpiringSoon = (iso, now = Date.now()) => {
  const days = daysUntil(iso, now);
  return days != null && days < EXPIRING_SOON_DAYS;
};

/**
 * Central wall-clock parts of an ISO time, for date/time inputs.
 *
 * @returns {{ date: string, time: string }} e.g. { date: '2026-10-31', time: '23:59' }
 */
export const toCentralInputs = iso => {
  if (!iso) return { date: '', time: '' };
  const parts = formatter({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(iso))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

/**
 * ISO time for a Central wall-clock date and time from the admin form.
 *
 * @param {string} date YYYY-MM-DD
 * @param {string} time HH:mm
 * @returns {string|null}
 */
export const centralInputsToIso = (date, time = '00:00') => {
  if (!date) return null;
  const m = moment.tz(`${date}T${time || '00:00'}`, PROMO_TIMEZONE);
  return m.isValid() ? m.toISOString() : null;
};

/** Today's date in Central time, plus `days`, as YYYY-MM-DD. */
export const centralDatePlusDays = (days, now = Date.now()) =>
  toCentralInputs(new Date(now + days * DAY_MS).toISOString()).date;

/**
 * Translation id for why a code won't work. The ids carry the spec's copy;
 * `date` (for not-started / expired) is passed as a formatted value.
 */
export const promoReasonMessageId = reason => {
  const known = [
    'invalid',
    'not-started',
    'expired',
    'limit',
    'already-used',
    'not-yours',
    'pickup',
    'already-free',
    'outside-zone',
    'unavailable',
  ];
  return `Promo.reason.${known.includes(reason) ? reason : 'invalid'}`;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The admin form's plain-language summary, updated as fields change, e.g.
 * "FREESAT gives free delivery on 1 order per customer, up to 100 total
 * uses, until Oct 31 at 11:59 PM, whichever comes first."
 *
 * @param {Object} promo code, audience, expiryType, endsAt (ISO), maxUses,
 *   perCustomerLimit, startsAt (ISO)
 */
export const promoSummarySentence = promo => {
  const code = (promo.code || '').trim().toUpperCase() || 'This promo';
  const perCustomer = parseInt(promo.perCustomerLimit, 10) || 1;
  const maxUses = parseInt(promo.maxUses, 10);
  const hasUses = (promo.expiryType === 'uses' || promo.expiryType === 'both') && maxUses > 0;
  const hasDate = (promo.expiryType === 'date' || promo.expiryType === 'both') && promo.endsAt;

  const limits = [];
  if (hasUses) limits.push(`up to ${plural(maxUses, 'total use', 'total uses')}`);
  if (hasDate) limits.push(`until ${formatPromoDateTime(promo.endsAt)}`);

  let sentence = `${code} gives free delivery on ${plural(
    perCustomer,
    'order',
    'orders'
  )} per customer`;
  if (limits.length) {
    sentence += `, ${limits.join(', ')}`;
    if (limits.length === 2) sentence += ', whichever comes first';
  } else {
    sentence += ', with no end date';
  }
  sentence += '.';

  if (promo.startsAt) sentence += ` Starts ${formatPromoDateTime(promo.startsAt)}.`;
  if (promo.audience === 'gifted') sentence += ' Only customers you gift it to can use it.';
  return sentence;
};

// ================ Promo applied to the cart ================ //

// localStorage can throw (private mode, blocked storage), so every access is
// guarded; checkout still works without it.
export const getAppliedPromoCode = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(APPLIED_PROMO_KEY) : null;
  } catch (e) {
    return null;
  }
};

export const setAppliedPromoCode = code => {
  try {
    if (typeof window !== 'undefined' && code) {
      window.localStorage.setItem(
        APPLIED_PROMO_KEY,
        String(code)
          .trim()
          .toUpperCase()
      );
    }
  } catch (e) {
    // Not remembered; the customer can still type the code at checkout.
  }
};

export const clearAppliedPromoCode = () => {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(APPLIED_PROMO_KEY);
  } catch (e) {
    // Nothing to clear.
  }
};
