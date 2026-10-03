const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

/**
 * POST /api/admin/mark-delivered
 * Body: { transactionId }
 *
 * Operator-marks a purchased order as delivered (transition/operator-mark-delivered)
 * via the Integration API. This is how FarmFed marks orders delivered now that
 * vendors can't — used from the admin Orders tab. Admin-only.
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
          transition: 'transition/operator-mark-delivered',
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
