const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

/**
 * POST /api/admin/mark-received
 * Body: { transactionId }
 *
 * Operator-marks a delivered order as received (transition/operator-mark-received)
 * via the Integration API. This is the escape hatch for orders that are stuck in
 * the "delivered" state — e.g. ones pinned to an older process version whose
 * auto-mark-received timer hasn't fired yet. It pays out the vendor (same Stripe
 * payout action as auto-mark-received) and lets the order auto-complete. Admin-only.
 */
module.exports = (req, res) => {
  const sdk = getSdk(req, res);

  sdk.currentUser
    .show({ include: [] })
    .then(response => {
      const currentUser = response.data.data;
      const isAdmin = isAdminUser(currentUser);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }

      const { transactionId } = req.body || {};
      if (!transactionId) {
        return res.status(400).json({ error: 'Missing transactionId' });
      }

      const integrationSdk = getIntegrationSdk();
      return integrationSdk.transactions
        .transition({
          id: transactionId,
          transition: 'transition/operator-mark-received',
          params: {},
        })
        .then(() => {
          res.status(200).json({ success: true, transactionId });
        });
    })
    .catch(e => {
      handleError(res, e);
    });
};
