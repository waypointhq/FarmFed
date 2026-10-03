const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

const OPERATOR_ACCEPT = 'transition/operator-accept-order';

/**
 * POST /api/admin/accept-order
 * Body: { transactionId }
 *
 * Accepts a pending order on the vendor's behalf
 * (transition/operator-accept-order) via the Integration API. Used from the
 * admin Orders tab when a farm is closed and would otherwise let the order
 * auto-decline. Captures payment exactly like the vendor's own accept.
 *
 * Admin-only.
 */
module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    const currentUserResponse = await sdk.currentUser.show({ include: [] });
    if (!isAdminUser(currentUserResponse.data.data)) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { transactionId } = req.body || {};
    if (!transactionId) {
      return res.status(400).json({ error: 'Missing transactionId' });
    }

    const integrationSdk = getIntegrationSdk();
    const txResponse = await integrationSdk.transactions.show({ id: transactionId });
    if (txResponse.data.data.attributes.lastTransition !== 'transition/confirm-payment') {
      return res.status(409).json({
        error: 'This order is no longer waiting on the vendor. Refresh the list.',
      });
    }

    try {
      await integrationSdk.transactions.transition({
        id: transactionId,
        transition: OPERATOR_ACCEPT,
        params: {},
      });
    } catch (e) {
      // Orders are pinned to the process version they were placed on, so ones
      // placed before operator-accept-order was deployed can't take it.
      const code = e.data?.errors?.[0]?.code || '';
      if ((e.status === 400 || e.status === 409) && code.includes('transition')) {
        return res.status(409).json({
          error:
            'This order was placed before admin accept was turned on, so it has to be accepted as the vendor (Console → Log in as user).',
          code,
        });
      }
      throw e;
    }

    res.status(200).json({ success: true, transactionId });
  } catch (e) {
    handleError(res, e);
  }
};
