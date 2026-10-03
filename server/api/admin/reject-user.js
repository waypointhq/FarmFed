const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

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

      const { userId } = req.body || {};
      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      const integrationSdk = getIntegrationSdk();

      return integrationSdk.users
        .ban({ id: userId })
        .then(() => {
          res.status(200).json({ success: true, userId });
        });
    })
    .catch(e => {
      handleError(res, e);
    });
};
