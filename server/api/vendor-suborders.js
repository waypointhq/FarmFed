const { getSdk, handleError } = require('../api-util/sdk');
const {
  groupTransactions,
  toItem,
  financialsFor,
  rollUpStatus,
  itemStatus,
  buildIncludedIndex,
  isDeliveryTransaction,
  relId,
  currencyOf,
  SUBORDER_UNAVAILABLE,
} = require('../api-util/orderGroups');

const PER_PAGE = 100;
// Enough to cover a delivery cycle's worth of sales without walking the
// vendor's entire history on every page load.
const MAX_PAGES = 5;

const QUERY_PARAMS = {
  only: 'sale',
  include: ['listing', 'listing.images', 'customer'],
  'fields.listing': ['title'],
  'fields.user': ['profile.displayName'],
  'fields.image': ['variants.square-small', 'variants.square-small2x'],
  perPage: PER_PAGE,
};

/**
 * Total units per listing across every customer ordering for this delivery
 * date — what the vendor harvests or pulls before they start packing
 * individual orders (§3.3). Items the vendor already marked unavailable are
 * left out; nobody should be picking those.
 */
const buildRollUp = suborders => {
  const bySku = new Map();

  suborders.forEach(suborder => {
    suborder.items
      .filter(item => item.status !== SUBORDER_UNAVAILABLE)
      .forEach(item => {
        const existing = bySku.get(item.listingId);
        if (existing) {
          existing.quantity += item.quantity;
          existing.orderCount += 1;
        } else {
          bySku.set(item.listingId, {
            listingId: item.listingId,
            title: item.title,
            imageUrl: item.imageUrl,
            quantity: item.quantity,
            orderCount: 1,
          });
        }
      });
  });

  return Array.from(bySku.values()).sort((a, b) => a.title.localeCompare(b.title));
};

/**
 * GET /api/vendor-suborders
 *
 * The logged-in vendor's suborders — one per customer order, listing every
 * item that customer bought from them (§3.3). Runs as the vendor, so it can
 * only return their own sales.
 *
 * Query params:
 *   date — delivery date (YYYY-MM-DD). Defaults to the nearest upcoming date
 *          that has orders, falling back to the most recent one.
 */
module.exports = async (req, res) => {
  const sdk = getSdk(req, res);
  const requestedDate = (req.query || {}).date || null;

  try {
    // Page until the vendor's sales run out or we hit the cap.
    const transactions = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await sdk.transactions.query({ ...QUERY_PARAMS, page });
      const pageTxs = response.data.data || [];
      transactions.push({ txs: pageTxs, included: response.data.included || [] });
      const totalPages = response.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    const allTxs = transactions.flatMap(p => p.txs).filter(tx => !isDeliveryTransaction(tx));
    const findIncluded = buildIncludedIndex(transactions.flatMap(p => p.included));

    // Every delivery date this vendor has orders for, newest first.
    const dateOf = tx => tx.attributes?.protectedData?.deliveryDate || null;
    const deliveryDates = Array.from(
      new Set(allTxs.map(dateOf).filter(Boolean))
    ).sort();

    // Default to the next delivery date that hasn't passed; if they're all in
    // the past, show the most recent one rather than an empty page.
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = deliveryDates.find(d => d >= today);
    const activeDate = requestedDate || upcoming || deliveryDates[deliveryDates.length - 1] || null;

    // Orders with no delivery date stamped predate that field. They only show
    // up when no specific date was asked for, so they aren't silently lost.
    const inScope = allTxs.filter(tx => (activeDate ? dateOf(tx) === activeDate : !dateOf(tx)));
    const grouped = groupTransactions(inScope);

    const suborders = Array.from(grouped.entries())
      .map(([orderGroupId, txs]) => {
        const customerId = relId(txs[0], 'customer');
        const customer = findIncluded('user', customerId);
        const items = txs.map(tx => toItem(tx, findIncluded));
        // Declined items are no longer the vendor's money.
        const acceptedTxs = txs.filter(tx => itemStatus(tx) !== SUBORDER_UNAVAILABLE);

        return {
          orderGroupId,
          customerId,
          customerName: customer?.attributes?.profile?.displayName || 'Customer',
          deliveryDate: dateOf(txs[0]),
          deliveryMethod: txs[0].attributes?.protectedData?.deliveryMethod || null,
          createdAt: txs.map(tx => tx.attributes.createdAt).sort()[0],
          items,
          status: rollUpStatus(items),
          transactionIds: txs.map(tx => tx.id.uuid),
          financials: financialsFor(acceptedTxs),
          currency: currencyOf(txs[0]),
        };
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return res.status(200).json({
      activeDate,
      deliveryDates,
      suborders,
      rollUp: buildRollUp(suborders),
    });
  } catch (e) {
    handleError(res, e);
  }
};
