/**
 * Shared helpers for the consolidated order views (customer and vendor).
 *
 * The server (`server/api-util/orderGroups.js`) computes every figure from the
 * transactions' own line items and hands them over as integer cents, so
 * nothing here recalculates money — it only formats it.
 */
import { types as sdkTypes } from './sdkLoader';
import { formatMoney } from './currency';

const { Money } = sdkTypes;

export const SUBORDER_PENDING = 'pending';
export const SUBORDER_ACCEPTED = 'accepted';
export const SUBORDER_UNAVAILABLE = 'unavailable';

/**
 * Format an integer amount of cents as marketplace currency.
 */
export const formatCents = (intl, cents, currency = 'USD') =>
  formatMoney(intl, new Money(cents || 0, currency));

/**
 * Short, human-quotable form of an order group id. Customer and vendor see the
 * same string, and it's the one used in emails — never invent a second id.
 */
export const shortOrderId = orderGroupId => {
  if (!orderGroupId) return '';
  const withoutPrefix = orderGroupId.replace(/^og-/, '');
  return withoutPrefix.slice(0, 8).toUpperCase();
};

/**
 * Delivery dates arrive as date-only strings (YYYY-MM-DD) in the marketplace
 * timezone. `new Date('YYYY-MM-DD')` reads them as UTC midnight and shifts the
 * weekday back a day west of UTC, so parse the calendar parts by hand.
 */
export const parseDateOnly = dateStr => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

export const formatDeliveryDate = (dateStr, options) => {
  const date = parseDateOnly(dateStr);
  if (!date) return null;
  return date.toLocaleDateString(
    undefined,
    options || { weekday: 'long', month: 'long', day: 'numeric' }
  );
};

export const formatOrderDate = isoString => {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};
