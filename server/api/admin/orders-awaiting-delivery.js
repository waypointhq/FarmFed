const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

/**
 * GET /api/admin/orders-awaiting-delivery
 *
 * Lists default-purchase orders in the `purchased` state (lastTransition
 * accept-order) — i.e. accepted by the vendor and awaiting FarmFed delivery.
 * The operator marks these delivered from the admin Orders tab via
 * /api/admin/mark-delivered (vendors can no longer mark delivered).
 *
 * Admin-only.
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

      const integrationSdk = getIntegrationSdk();
      return integrationSdk.transactions
        .query({
          lastTransitions: ['transition/accept-order'],
          include: ['listing', 'customer', 'provider'],
          'fields.user': ['profile.displayName'],
          'fields.listing': ['title'],
          perPage: 100,
        })
        .then(txResponse => {
          const txs = txResponse.data.data || [];
          const included = txResponse.data.included || [];
          const findIncluded = (type, id) =>
            included.find(x => x.type === type && x.id.uuid === id);

          const orders = txs
            // Skip the standalone delivery transactions — they're not item orders.
            .filter(tx => tx.attributes.protectedData?.isDeliveryOrder !== true)
            .map(tx => {
              const customerId = tx.relationships?.customer?.data?.id?.uuid;
              const providerId = tx.relationships?.provider?.data?.id?.uuid;
              const listingId = tx.relationships?.listing?.data?.id?.uuid;
              const customer = findIncluded('user', customerId);
              const provider = findIncluded('user', providerId);
              const listing = findIncluded('listing', listingId);
              const pd = tx.attributes.protectedData || {};

              return {
                id: tx.id.uuid,
                createdAt: tx.attributes.createdAt,
                lastTransitionedAt: tx.attributes.lastTransitionedAt,
                deliveryMethod: pd.deliveryMethod || null,
                orderGroupId: pd.orderGroupId || null,
                listingTitle: listing?.attributes?.title || 'Listing',
                customerName: customer?.attributes?.profile?.displayName || 'Customer',
                providerName: provider?.attributes?.profile?.displayName || 'Vendor',
              };
            });

          res.status(200).json({ orders });
        });
    })
    .catch(e => {
      handleError(res, e);
    });
};
