const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { getCheckoutFailures, recordCheckoutFailure } = require('../api-util/checkoutFailures');

// Refunds a paid-for item and releases its stock. The operator has no
// refunding transition out of `pending-acceptance` — only the provider or the
// system does — but the Integration API can transition on the provider's
// behalf, which is what makes unwinding a half-finished checkout possible.
const REFUND_TRANSITION = 'transition/decline-order';

/**
 * POST /api/checkout-failures
 *
 * Called by the client when a cart checkout fails partway. Does two things:
 *
 *  1. Refunds every item that was already paid for in that same checkout, so a
 *     card that fails on item 3 of 8 doesn't leave the buyer charged for items
 *     1 and 2 and holding a partial order they never agreed to.
 *  2. Records the failure, because nothing else in the system does. A failed
 *     checkout leaves no order, no email and no trace — the only other signal
 *     is the customer getting in touch.
 *
 * Body: { orderGroupId, reason, itemCount, chargedOrderIds: string[] }
 */
const postHandler = async (req, res) => {
  const { orderGroupId, reason, itemCount, chargedOrderIds = [] } = req.body || {};

  try {
    const sdk = getSdk(req, res);
    const userResponse = await sdk.currentUser.show({ include: [] });
    const currentUser = userResponse.data.data;

    const refunded = [];
    const refundFailed = [];

    if (chargedOrderIds.length > 0) {
      const integrationSdk = getIntegrationSdk();
      // Sequential: each refund is a separate charge reversal, and one failing
      // must not prevent the rest from being attempted.
      for (const id of chargedOrderIds) {
        try {
          await integrationSdk.transactions.transition({
            id,
            transition: REFUND_TRANSITION,
            params: {},
          });
          refunded.push(id);
        } catch (e) {
          console.error('[checkout-failures] refund failed for', id, e.message);
          refundFailed.push(id);
        }
      }
    }

    await recordCheckoutFailure({
      orderGroupId: orderGroupId || null,
      customerId: currentUser?.id?.uuid || null,
      customerEmail: currentUser?.attributes?.email || null,
      customerName: currentUser?.attributes?.profile?.displayName || null,
      reason: reason || 'unknown',
      itemCount: itemCount || 0,
      chargedOrderIds,
      refunded,
      refundFailed,
    });

    return res.status(200).json({ ok: true, refunded, refundFailed });
  } catch (e) {
    handleError(res, e);
  }
};

/**
 * GET /api/checkout-failures — admin only. Recent checkouts that failed
 * partway, newest first.
 */
const getHandler = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    const response = await sdk.currentUser.show({ include: [] });
    const isAdmin = response.data.data?.attributes?.profile?.privateData?.isAdmin === true;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }
    return res.status(200).json({ failures: getCheckoutFailures() });
  } catch (e) {
    handleError(res, e);
  }
};

module.exports = { postHandler, getHandler };
