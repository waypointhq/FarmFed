const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');

// Mirrors auto-decline-order in default-purchase/process.edn: an order nobody
// accepts is declined and refunded a day after payment.
const AUTO_DECLINE_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/admin/orders-pending-acceptance
 *
 * Lists paid default-purchase orders still waiting on the vendor
 * (lastTransition confirm-payment), so an admin can accept on the vendor's
 * behalf when the farm is closed. Each row carries the auto-decline deadline.
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

    const integrationSdk = getIntegrationSdk();
    const txResponse = await integrationSdk.transactions.query({
      lastTransitions: ['transition/confirm-payment'],
      include: ['listing', 'customer', 'provider'],
      'fields.user': ['profile.displayName'],
      'fields.listing': ['title'],
      perPage: 100,
    });

    const txs = txResponse.data.data || [];
    const included = txResponse.data.included || [];
    const findIncluded = (type, id) => included.find(x => x.type === type && x.id.uuid === id);

    const orders = txs
      // The standalone delivery transaction also ends on confirm-payment, but
      // it has no vendor to accept it.
      .filter(tx => tx.attributes.protectedData?.isDeliveryOrder !== true)
      .map(tx => {
        const customer = findIncluded('user', tx.relationships?.customer?.data?.id?.uuid);
        const provider = findIncluded('user', tx.relationships?.provider?.data?.id?.uuid);
        const listing = findIncluded('listing', tx.relationships?.listing?.data?.id?.uuid);
        const pd = tx.attributes.protectedData || {};
        const paidAt = tx.attributes.lastTransitionedAt;

        return {
          id: tx.id.uuid,
          paidAt,
          autoDeclineAt: paidAt
            ? new Date(new Date(paidAt).getTime() + AUTO_DECLINE_MS).toISOString()
            : null,
          deliveryMethod: pd.deliveryMethod || null,
          orderGroupId: pd.orderGroupId || null,
          listingTitle: listing?.attributes?.title || 'Listing',
          customerName: customer?.attributes?.profile?.displayName || 'Customer',
          providerName: provider?.attributes?.profile?.displayName || 'Vendor',
        };
      })
      // Most urgent first.
      .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));

    res.status(200).json({ orders });
  } catch (e) {
    handleError(res, e);
  }
};
