/**
 * Native app store review prompt.
 *
 * Asks the native shell to show the OS rating dialog (SKStoreReviewController
 * on iOS, In-App Review on Android). No-op on web and during SSR.
 *
 * Apple throttles the dialog to 3 times per 365 days per device and gives no
 * feedback about whether it was actually shown, so we throttle on our side too
 * and only ask after a moment worth rating — a completed order.
 */
import { isNativeApp } from './capacitor';
import { fireToNative } from './nativeBridge';

const LAST_PROMPT_KEY = 'ff_review_last_prompt';
const ORDER_COUNT_KEY = 'ff_review_order_count';

// Don't ask again for four months, even if the OS would have allowed it.
const MIN_DAYS_BETWEEN_PROMPTS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

const readStorage = key => {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    // Private mode / blocked storage — treat as "never prompted".
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    // Ignore: throttling is a nicety, not a correctness requirement.
  }
};

/**
 * Number of orders this device has completed (used for throttling only).
 */
const bumpOrderCount = () => {
  const next = (parseInt(readStorage(ORDER_COUNT_KEY), 10) || 0) + 1;
  writeStorage(ORDER_COUNT_KEY, String(next));
  return next;
};

const isThrottled = () => {
  const last = parseInt(readStorage(LAST_PROMPT_KEY), 10);
  if (!last) return false;
  return Date.now() - last < MIN_DAYS_BETWEEN_PROMPTS * DAY_MS;
};

/**
 * Ask the native shell for the store review dialog.
 * Safe to call unconditionally — returns false when it didn't ask.
 *
 * @returns {boolean} true when the request was sent to native
 */
export const requestAppReview = () => {
  if (!isNativeApp() || isThrottled()) return false;

  writeStorage(LAST_PROMPT_KEY, String(Date.now()));
  fireToNative('requestReview');
  return true;
};

/**
 * Call once when an order completes successfully. Records the order and asks
 * for a review on the way out.
 *
 * @returns {boolean} true when a review request was sent to native
 */
export const requestAppReviewAfterOrder = () => {
  if (typeof window === 'undefined') return false;
  bumpOrderCount();
  return requestAppReview();
};
