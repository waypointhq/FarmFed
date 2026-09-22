const crypto = require('crypto');

/**
 * Order Groups — one checkout rendered as one order.
 *
 * A Sharetribe transaction holds exactly one listing, so a five-item cart is
 * five transactions. `protectedData.orderGroupId` is what ties them back
 * together: it is stamped on every transaction at initiate time
 * (`server/api/initiate-privileged.js`).
 *
 * `protectedData` is NOT a queryable field on either the Marketplace or the
 * Integration API, so nothing here filters on `orderGroupId` server-side.
 * Instead we query by the fields that ARE indexed — `customerId` / `providerId`
 * plus a created-at window — and group in memory. That is why every read path
 * below takes a user id and a bounded time range rather than a group id alone.
 *
 * All money is read back off the transaction's own line items rather than
 * recomputed, so what these views show always reconciles with what Stripe
 * actually charged.
 */

// Line item codes produced by api-util/lineItems.js.
const CODE_ITEM = 'line-item/item';
const CODE_SHIPPING = 'line-item/shipping-fee';
const CODE_DELIVERY = 'line-item/delivery';
const CODE_TAX = 'line-item/sales-tax';
const CODE_PROCESSING = 'line-item/processing-fee';
const CODE_CUSTOMER_COMMISSION = 'line-item/customer-commission';
const CODE_PROVIDER_COMMISSION = 'line-item/provider-commission';

// Vendor-facing suborder status, per §3.1's badge set.
const SUBORDER_PENDING = 'pending';
const SUBORDER_ACCEPTED = 'accepted';
const SUBORDER_UNAVAILABLE = 'unavailable';

const ACCEPTED_TRANSITIONS = [
  'transition/accept-order',
  'transition/mark-delivered',
  'transition/operator-mark-delivered',
  'transition/mark-received',
  'transition/mark-received-from-purchased',
  'transition/auto-mark-received',
  'transition/operator-mark-received',
  'transition/mark-received-from-disputed',
  'transition/dispute',
  'transition/operator-dispute',
  'transition/auto-complete',
];

const UNAVAILABLE_TRANSITIONS = [
  'transition/decline-order',
  'transition/auto-decline-order',
  'transition/cancel',
  'transition/auto-cancel',
  'transition/cancel-from-disputed',
  'transition/auto-cancel-from-disputed',
  'transition/expire-payment',
];

const generateOrderGroupId = () => `og-${crypto.randomUUID()}`;

/**
 * Status of a single item, derived from where its transaction sits in the
 * purchase process. Anything we don't recognise counts as pending — a badge
 * that says "waiting on the vendor" is a safer default than one that claims
 * the item is confirmed.
 */
const itemStatus = tx => {
  const lastTransition = tx?.attributes?.lastTransition;
  if (ACCEPTED_TRANSITIONS.includes(lastTransition)) return SUBORDER_ACCEPTED;
  if (UNAVAILABLE_TRANSITIONS.includes(lastTransition)) return SUBORDER_UNAVAILABLE;
  return SUBORDER_PENDING;
};

/**
 * Suborder status from its items: unavailable only when nothing survived,
 * accepted once everything still standing has been accepted, pending while
 * the vendor still owes an answer on any item.
 */
const rollUpStatus = items => {
  const statuses = items.map(i => i.status);
  if (statuses.every(s => s === SUBORDER_UNAVAILABLE)) return SUBORDER_UNAVAILABLE;
  if (statuses.some(s => s === SUBORDER_PENDING)) return SUBORDER_PENDING;
  return SUBORDER_ACCEPTED;
};

const amountOf = money => (money && typeof money.amount === 'number' ? money.amount : 0);

/**
 * Sum the line totals of every line item with one of the given codes.
 * Reversal line items are signed the opposite way and are summed as-is, so a
 * refunded order nets to what actually stuck.
 */
const sumLineItems = (tx, codes) =>
  (tx?.attributes?.lineItems || [])
    .filter(li => codes.includes(li.code))
    .reduce((sum, li) => sum + amountOf(li.lineTotal), 0);

const quantityOf = tx => {
  const itemLine = (tx?.attributes?.lineItems || []).find(li => li.code === CODE_ITEM);
  const q = itemLine?.quantity;
  // The SDK hands back quantity as a Decimal-like object.
  const parsed = q == null ? 1 : Number(q.toString ? q.toString() : q);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const unitPriceOf = tx => {
  const itemLine = (tx?.attributes?.lineItems || []).find(li => li.code === CODE_ITEM);
  return amountOf(itemLine?.unitPrice);
};

const currencyOf = tx => {
  const lineItems = tx?.attributes?.lineItems || [];
  const withCurrency = lineItems.find(li => li.lineTotal?.currency || li.unitPrice?.currency);
  return withCurrency?.lineTotal?.currency || withCurrency?.unitPrice?.currency || 'USD';
};

const isDeliveryTransaction = tx => tx?.attributes?.protectedData?.isDeliveryOrder === true;

/**
 * Delivery method for a transaction.
 *
 * `protectedData` is fixed once the transaction is created — only a transition
 * with an update-protected-data action can change it, and the purchase process
 * has no such transition after checkout. Metadata, on the other hand, is
 * writable by the operator at any time via the Integration API. So a pickup
 * order that the buyer later upgrades to delivery records the change in
 * metadata, and metadata wins here.
 */
const deliveryMethodOf = tx =>
  tx?.attributes?.metadata?.deliveryMethod || tx?.attributes?.protectedData?.deliveryMethod || null;

const wasUpgradedToDelivery = tx => !!tx?.attributes?.metadata?.upgradedToDeliveryAt;

/**
 * Money for one vendor's slice of an order, per §4.
 *
 * Two commission models are possible and the marketplace is configured for one
 * of them in Console, so both are reported rather than assumed:
 *
 * - provider commission is deducted from the vendor's payout
 * - customer commission is added on top of the item price and never touches
 *   the payout
 *
 * `vendorNetCents` is what Stripe actually pays the vendor either way, so it
 * is the only number a vendor-facing surface should treat as "yours".
 * Delivery, tax and the processing fee are FarmFed revenue and are excluded
 * from every vendor-facing figure.
 */
const financialsFor = transactions => {
  const itemSubtotalCents = transactions.reduce((s, tx) => s + sumLineItems(tx, [CODE_ITEM]), 0);
  // Provider commission arrives as a negative line total.
  const providerCommissionCents = Math.abs(
    transactions.reduce((s, tx) => s + sumLineItems(tx, [CODE_PROVIDER_COMMISSION]), 0)
  );
  const customerCommissionCents = transactions.reduce(
    (s, tx) => s + sumLineItems(tx, [CODE_CUSTOMER_COMMISSION]),
    0
  );

  const commissionModel =
    providerCommissionCents > 0 && customerCommissionCents > 0
      ? 'mixed'
      : providerCommissionCents > 0
      ? 'provider'
      : customerCommissionCents > 0
      ? 'customer'
      : 'none';

  return {
    itemSubtotalCents,
    providerCommissionCents,
    customerCommissionCents,
    // Everything FarmFed keeps off this vendor's items, however it was charged.
    platformRevenueCents: providerCommissionCents + customerCommissionCents,
    // What the vendor is actually paid out. Only provider commission reduces it.
    vendorNetCents: itemSubtotalCents - providerCommissionCents,
    commissionModel,
  };
};

/**
 * Group-level totals for the customer view (§3.1). `totalPaidCents` comes from
 * each transaction's own payin total rather than from summing our own
 * breakdown, so the figure always matches the card statement even if a line
 * item code shows up here that this module doesn't know about.
 */
const groupTotals = transactions => {
  const itemTxs = transactions.filter(tx => !isDeliveryTransaction(tx));
  const deliveryTxs = transactions.filter(isDeliveryTransaction);

  return {
    subtotalCents: itemTxs.reduce((s, tx) => s + sumLineItems(tx, [CODE_ITEM]), 0),
    deliveryFeeCents:
      itemTxs.reduce((s, tx) => s + sumLineItems(tx, [CODE_SHIPPING]), 0) +
      deliveryTxs.reduce((s, tx) => s + sumLineItems(tx, [CODE_DELIVERY, CODE_SHIPPING]), 0),
    taxCents: transactions.reduce((s, tx) => s + sumLineItems(tx, [CODE_TAX]), 0),
    serviceFeeCents: transactions.reduce(
      (s, tx) => s + sumLineItems(tx, [CODE_CUSTOMER_COMMISSION, CODE_PROCESSING]),
      0
    ),
    totalPaidCents: transactions.reduce((s, tx) => s + amountOf(tx?.attributes?.payinTotal), 0),
    currency: currencyOf(transactions[0]),
  };
};

/**
 * Index the `included` array of an SDK response for lookup by type and id.
 */
const buildIncludedIndex = included => {
  const index = {};
  (included || []).forEach(entity => {
    index[`${entity.type}:${entity.id.uuid}`] = entity;
  });
  return (type, id) => (id ? index[`${type}:${id}`] : null);
};

const relId = (tx, rel) => tx?.relationships?.[rel]?.data?.id?.uuid || null;

/**
 * Turn one transaction into a line on a packing list / order view.
 */
const toItem = (tx, findIncluded) => {
  const listingId = relId(tx, 'listing');
  const listing = findIncluded('listing', listingId);
  const images = listing?.relationships?.images?.data || [];
  const image = images.length ? findIncluded('image', images[0].id.uuid) : null;
  const quantity = quantityOf(tx);
  const unitPriceCents = unitPriceOf(tx);

  return {
    transactionId: tx.id.uuid,
    listingId,
    title: listing?.attributes?.title || 'Item',
    // First variant we can find — the views only need a thumbnail.
    imageUrl: image ? Object.values(image.attributes?.variants || {})[0]?.url || null : null,
    quantity,
    unitPriceCents,
    // Read the line total rather than multiplying: §4's rounding rule is
    // "round at the line item, then sum", which is exactly what Sharetribe
    // already stored.
    lineTotalCents: sumLineItems(tx, [CODE_ITEM]),
    status: itemStatus(tx),
    lastTransition: tx.attributes.lastTransition,
    currency: currencyOf(tx),
  };
};

/**
 * Split a group's transactions into one suborder per vendor (§3.3). Two
 * vendors selling the same product stay in separate suborders because they
 * are separate providers — they are never merged.
 */
const toSuborders = (transactions, findIncluded) => {
  const byVendor = new Map();

  transactions.filter(tx => !isDeliveryTransaction(tx)).forEach(tx => {
    const vendorId = relId(tx, 'provider');
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
    byVendor.get(vendorId).push(tx);
  });

  return Array.from(byVendor.entries()).map(([vendorId, txs]) => {
    const vendor = findIncluded('user', vendorId);
    const items = txs.map(tx => toItem(tx, findIncluded));
    // Money follows what the vendor actually keeps, so declined items are out.
    const acceptedTxs = txs.filter(tx => itemStatus(tx) !== SUBORDER_UNAVAILABLE);

    return {
      vendorId,
      vendorName: vendor?.attributes?.profile?.displayName || 'Vendor',
      items,
      status: rollUpStatus(items),
      transactionIds: txs.map(tx => tx.id.uuid),
      financials: financialsFor(acceptedTxs),
      currency: currencyOf(txs[0]),
    };
  });
};

/**
 * Assemble one Order Group from the transactions that share its id.
 */
const toOrderGroup = (orderGroupId, transactions, findIncluded) => {
  const itemTxs = transactions.filter(tx => !isDeliveryTransaction(tx));
  const first = itemTxs[0] || transactions[0];
  const pd = first?.attributes?.protectedData || {};
  const customerId = relId(first, 'customer');
  const customer = findIncluded('user', customerId);
  const suborders = toSuborders(transactions, findIncluded);
  const deliveryTx = transactions.find(isDeliveryTransaction);

  // Earliest transaction in the group is when the customer checked out; the
  // rest were created milliseconds later in the same loop.
  const createdAt = transactions
    .map(tx => tx.attributes.createdAt)
    .sort()
    .shift();

  return {
    id: orderGroupId,
    createdAt,
    customerId,
    customerName: customer?.attributes?.profile?.displayName || 'Customer',
    deliveryDate: pd.deliveryDate || null,
    deliveryMethod: deliveryMethodOf(first) || (deliveryTx ? 'shipping' : 'pickup'),
    upgradedToDelivery: itemTxs.some(wasUpgradedToDelivery),
    deliveryTransactionId: deliveryTx?.id?.uuid || null,
    status: rollUpStatus(suborders.length ? suborders.flatMap(s => s.items) : []),
    itemCount: itemTxs.length,
    suborders,
    totals: groupTotals(transactions),
  };
};

/**
 * Group a flat list of transactions by `protectedData.orderGroupId`.
 *
 * Orders placed before group ids were stamped unconditionally have no id. They
 * fall back to a group of one keyed by their own transaction id, so historic
 * orders still render through the group structure instead of disappearing.
 */
const groupTransactions = transactions => {
  const groups = new Map();

  transactions.forEach(tx => {
    const groupId = tx.attributes?.protectedData?.orderGroupId || tx.id.uuid;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(tx);
  });

  return groups;
};

module.exports = {
  generateOrderGroupId,
  deliveryMethodOf,
  wasUpgradedToDelivery,
  groupTransactions,
  toOrderGroup,
  toSuborders,
  toItem,
  financialsFor,
  groupTotals,
  itemStatus,
  rollUpStatus,
  buildIncludedIndex,
  isDeliveryTransaction,
  relId,
  currencyOf,
  quantityOf,
  SUBORDER_PENDING,
  SUBORDER_ACCEPTED,
  SUBORDER_UNAVAILABLE,
};
