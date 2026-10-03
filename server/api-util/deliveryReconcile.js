/**
 * Standalone-delivery reconciliation.
 *
 * A delivery transaction (default-delivery process) carries the whole route
 * delivery fee for one cart order group. It sits in the `paid` state (payment
 * authorized, not captured) until the item transactions in its group resolve:
 *
 *   - Every item DENIED (declined / auto-declined / payment-expired)
 *       -> operator-refund the delivery transaction (full refund). This is the
 *          "delivery is only kicked back when the WHOLE order is denied" rule.
 *   - At least one item ACCEPTED and none still pending
 *       -> operator-capture the delivery payment (delivery happens, fee kept).
 *   - Any item still PENDING (awaiting accept/decline)
 *       -> do nothing yet; reconcile again later (cron / next decline).
 *
 * The delivery transaction stores the item transaction ids in its metadata
 * (`itemTransactionIds`), set at checkout via link-delivery-items.
 */

const DELIVERY_PROCESS_NAME = 'default-delivery';

// Item (default-purchase) transitions, classified for reconciliation.
const ITEM_DENIED_TRANSITIONS = [
  'transition/decline-order',
  'transition/auto-decline-order',
  'transition/expire-payment',
];
// Anything from accept-order onward means the order went ahead.
const ITEM_ACCEPTED_TRANSITIONS = [
  'transition/accept-order',
  'transition/operator-accept-order',
  'transition/mark-delivered',
  'transition/operator-mark-delivered',
  'transition/mark-received',
  'transition/mark-received-from-purchased',
  'transition/auto-mark-received',
  'transition/mark-received-from-disputed',
  'transition/dispute',
  'transition/operator-dispute',
  'transition/auto-complete',
];

const classifyItemTransition = lastTransition => {
  if (ITEM_DENIED_TRANSITIONS.includes(lastTransition)) return 'denied';
  if (ITEM_ACCEPTED_TRANSITIONS.includes(lastTransition)) return 'accepted';
  // request-payment, confirm-payment, inquire, etc. -> still awaiting outcome.
  return 'pending';
};

const DELIVERY_REFUND_TRANSITION = 'transition/operator-refund';
const DELIVERY_CAPTURE_TRANSITION = 'transition/operator-capture';
// lastTransition value when the delivery transaction is in the `paid` state.
const DELIVERY_PAID_TRANSITION = 'transition/confirm-payment';

/**
 * Reconcile a single delivery transaction against its item transactions.
 * Idempotent: only acts when the delivery tx is still in `paid` and all items
 * have resolved. Returns a small status object describing what it did.
 *
 * @param {Object} integrationSdk Sharetribe Integration SDK instance
 * @param {string} deliveryTransactionId UUID string of the delivery transaction
 */
const reconcileDeliveryOrder = async (integrationSdk, deliveryTransactionId) => {
  const deliveryResp = await integrationSdk.transactions.show({ id: deliveryTransactionId });
  const delivery = deliveryResp.data.data;

  // Only act on delivery transactions that are still awaiting reconciliation.
  if (delivery?.attributes?.lastTransition !== DELIVERY_PAID_TRANSITION) {
    return { action: 'none', reason: 'delivery not in paid state', deliveryTransactionId };
  }

  const itemIds = delivery?.attributes?.metadata?.itemTransactionIds || [];
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { action: 'none', reason: 'no linked item transactions', deliveryTransactionId };
  }

  // Load every item transaction and classify it.
  const itemTxs = await Promise.all(
    itemIds.map(id =>
      integrationSdk.transactions
        .show({ id })
        .then(r => r.data.data)
        .catch(() => null)
    )
  );

  const classes = itemTxs
    .filter(Boolean)
    .map(tx => classifyItemTransition(tx?.attributes?.lastTransition));

  // If we couldn't load any item, bail rather than wrongly refunding.
  if (classes.length === 0) {
    return { action: 'none', reason: 'could not load item transactions', deliveryTransactionId };
  }

  const anyPending = classes.includes('pending');
  if (anyPending) {
    return { action: 'wait', reason: 'items still pending', deliveryTransactionId };
  }

  const allDenied = classes.every(c => c === 'denied');
  const transition = allDenied ? DELIVERY_REFUND_TRANSITION : DELIVERY_CAPTURE_TRANSITION;

  await integrationSdk.transactions.transition({
    id: deliveryTransactionId,
    transition,
    params: {},
  });

  return {
    action: allDenied ? 'refunded' : 'captured',
    transition,
    deliveryTransactionId,
    itemCount: classes.length,
  };
};

/**
 * Reconcile every open delivery transaction (state `paid`). Used by the cron
 * job so manual AND 24h auto-declines are caught even if no client pinged us.
 *
 * @param {Object} integrationSdk Sharetribe Integration SDK instance
 * @param {number} [perPage] page size for the transaction query
 */
const reconcileAllOpenDeliveries = async (integrationSdk, perPage = 100) => {
  // First, collect ALL open delivery transaction ids across every page WITHOUT
  // mutating them. Reconciling mid-pagination would transition rows out of the
  // `paid` (confirm-payment) filter set, shifting the result window and causing
  // later pages to skip transactions. So we paginate to completion first.
  // confirm-payment is shared with default-purchase, so filter to delivery txs.
  const deliveryTxIds = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await integrationSdk.transactions.query({
      lastTransitions: [DELIVERY_PAID_TRANSITION],
      page,
      perPage,
    });
    const txs = resp.data.data || [];
    txs
      .filter(
        tx =>
          tx?.attributes?.processName === DELIVERY_PROCESS_NAME ||
          tx?.attributes?.protectedData?.isDeliveryOrder === true
      )
      .forEach(tx => deliveryTxIds.push(tx.id.uuid));

    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
    page += 1;
  }

  // Then reconcile each (idempotent — re-running a resolved one is a no-op).
  const results = [];
  for (const id of deliveryTxIds) {
    try {
      results.push(await reconcileDeliveryOrder(integrationSdk, id));
    } catch (e) {
      results.push({ action: 'error', deliveryTransactionId: id, error: e.message });
    }
  }
  return results;
};

module.exports = {
  reconcileDeliveryOrder,
  reconcileAllOpenDeliveries,
  classifyItemTransition,
  DELIVERY_PROCESS_NAME,
};
