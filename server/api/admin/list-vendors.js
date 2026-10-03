const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

// Admin-only: list all non-consumer (vendor) users with their tax-exempt flag.
// We pull everyone and filter client-side because Sharetribe's query metadata
// filter is case-sensitive and different marketplaces use different labels
// ("Farmer", "Provider", "Vendor", etc.). Anything that isn't labeled a consumer
// counts as a vendor here.
module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    const currentUserResponse = await sdk.currentUser.show({ include: [] });
    const isAdmin = isAdminUser(currentUserResponse.data.data);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const integrationSdk = getIntegrationSdk();
    const perPage = 100;
    let page = 1;
    const vendors = [];

    while (true) {
      const resp = await integrationSdk.users.query({ perPage, page });
      const batch = resp.data.data || [];

      for (const user of batch) {
        const profile = user.attributes?.profile || {};
        const userType = (profile.publicData?.userType || '').toString();
        const normalized = userType.toLowerCase();
        const state = user.attributes?.state;
        const isExcludedState = state === 'pendingApproval' || state === 'banned' || state === 'deleted';
        const isConsumer = normalized === 'consumer' || normalized === 'customer' || normalized === 'buyer';

        if (isExcludedState || isConsumer) continue;

        vendors.push({
          id: user.id?.uuid || user.id,
          firstName: profile.firstName || '',
          lastName: profile.lastName || '',
          displayName: profile.displayName || '',
          email: user.attributes?.email || '',
          userType,
          taxExempt: profile.privateData?.taxExempt === true,
        });
      }

      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages || batch.length === 0) break;
      page += 1;
    }

    res.status(200).json({ vendors });
  } catch (e) {
    handleError(res, e);
  }
};
