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

      const integrationSdk = getIntegrationSdk();

      return integrationSdk.users
        .query({
          include: [],
        })
        .then(usersResponse => {
          const allUsers = usersResponse.data.data || [];

          // Filter to only pending-approval users (states param not reliably supported)
          const pendingUsers = allUsers
            .filter(user => user.attributes.state === 'pendingApproval')
            .map(user => {
              const { profile, createdAt, email } = user.attributes;
              const protectedData = profile?.protectedData || {};
              const publicData = profile?.publicData || {};

              return {
                id: user.id.uuid,
                firstName: profile?.firstName || '',
                lastName: profile?.lastName || '',
                email: email || '',
                createdAt,
                userType: publicData.userType || '',
                address: protectedData.address || null,
                outsideDeliveryZone: protectedData.outsideDeliveryZone || false,
              };
            });

          res.status(200).json({ users: pendingUsers });
        });
    })
    .catch(e => {
      handleError(res, e);
    });
};
