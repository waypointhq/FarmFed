const { getSdk, handleError } = require('../api-util/sdk');
const {
  groupTransactions,
  toOrderGroup,
  buildIncludedIndex,
} = require('../api-util/orderGroups');

// Sharetribe caps perPage at 100. An order group is at most a cartful, so one
// page covers the recent orders any customer view needs; `page` walks back
// through history for the order list.
const PER_PAGE = 100;

const QUERY_PARAMS = {
  only: 'order',
  include: ['listing', 'listing.images', 'provider', 'customer'],
  'fields.listing': ['title'],
  'fields.user': ['profile.displayName'],
  'fields.image': ['variants.square-small', 'variants.square-small2x'],
  perPage: PER_PAGE,
};

/**
 * GET /api/order-groups
 *
 * The customer's own orders, one entry per checkout rather than one per line
 * item (§3.1). Runs as the logged-in user, so it can only ever return their
 * own orders.
 *
 * Query params:
 *   id    — return just this order group (404 when it isn't theirs)
 *   page  — page through older orders (default 1)
 */
module.exports = async (req, res) => {
  const sdk = getSdk(req, res);
  const { id, page } = req.query || {};

  try {
    const response = await sdk.transactions.query({
      ...QUERY_PARAMS,
      page: parseInt(page, 10) || 1,
    });

    const transactions = response.data.data || [];
    const findIncluded = buildIncludedIndex(response.data.included);
    const grouped = groupTransactions(transactions);

    if (id) {
      const txs = grouped.get(id);
      if (!txs) {
        return res.status(404).json({ error: 'Order group not found' });
      }
      return res.status(200).json({ orderGroup: toOrderGroup(id, txs, findIncluded) });
    }

    // Most recent address this buyer had something delivered to, so an upgrade
    // to delivery doesn't make them type it again. There is no address on the
    // user profile to read instead.
    const lastShippingAddress =
      transactions
        .map(tx => tx.attributes?.protectedData?.shippingAddress)
        .find(address => address && address.line1) || null;

    const orderGroups = Array.from(grouped.entries())
      .map(([groupId, txs]) => toOrderGroup(groupId, txs, findIncluded))
      // A group whose only transaction is the standalone delivery charge is an
      // artifact of how delivery is billed, not an order the customer placed.
      .filter(group => group.itemCount > 0)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({
      orderGroups,
      lastShippingAddress,
      meta: response.data.meta || null,
    });
  } catch (e) {
    handleError(res, e);
  }
};
