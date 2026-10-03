const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    const currentUserResponse = await sdk.currentUser.show({ include: [] });
    const isAdmin = isAdminUser(currentUserResponse.data.data);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { userId, taxExempt } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    if (typeof taxExempt !== 'boolean') {
      return res.status(400).json({ error: 'taxExempt must be a boolean' });
    }

    const integrationSdk = getIntegrationSdk();
    await integrationSdk.users.updateProfile({
      id: userId,
      privateData: { taxExempt },
    });

    res.status(200).json({ userId, taxExempt });
  } catch (e) {
    handleError(res, e);
  }
};
