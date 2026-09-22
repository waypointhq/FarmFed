const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { isCutoffPassed } = require('../api-util/pickupSchedule');
const { deliveryMethodOf, isDeliveryTransaction } = require('../api-util/orderGroups');
const { addNotification } = require('../api-util/notifications');
const { getTokensForUser } = require('../api-util/deviceTokens');
const { sendPushNotifications } = require('../api-util/pushSender');

// One page covers any plausible order group; the buyer's own recent orders are
// a short list.
const PER_PAGE = 100;

/**
 * POST /api/convert-order-to-delivery
 *
 * Finishes a pickup -> delivery upgrade. The delivery fee has already been
 * charged by the client on its own standalone delivery transaction (the same
 * shape checkout creates), so this endpoint does the bookkeeping:
 *
 *   - flips each item in the order group from pickup to delivery
 *   - links the items to the delivery transaction, so the existing
 *     reconciliation refunds the delivery fee if the whole order is declined
 *   - tells each vendor their packing list changed
 *
 * The flip is recorded in metadata rather than protectedData: protectedData is
 * fixed at creation and the purchase process has no post-checkout transition
 * that could rewrite it, whereas metadata is operator-writable at any time.
 * Every reader resolves the method through `deliveryMethodOf`.
 *
 * Body: { orderGroupId, deliveryTransactionId, shippingAddress }
 */
module.exports = async (req, res) => {
  const { orderGroupId, deliveryTransactionId, shippingAddress } = req.body || {};

  if (!orderGroupId || !deliveryTransactionId) {
    return res
      .status(400)
      .json({ error: 'orderGroupId and deliveryTransactionId are required' });
  }

  try {
    // Upgrades close with the weekly ordering cutoff — after it, the van's
    // manifest is already set.
    if (isCutoffPassed()) {
      return res.status(409).json({ error: 'cutoff-passed' });
    }

    const sdk = getSdk(req, res);
    // Query as the buyer, so this can only ever act on the caller's own orders.
    const response = await sdk.transactions.query({
      only: 'order',
      include: ['provider', 'listing'],
      'fields.listing': ['title'],
      perPage: PER_PAGE,
    });

    const transactions = (response.data.data || []).filter(
      tx => tx.attributes?.protectedData?.orderGroupId === orderGroupId
    );
    const itemTxs = transactions.filter(tx => !isDeliveryTransaction(tx));

    if (itemTxs.length === 0) {
      return res.status(404).json({ error: 'Order group not found' });
    }

    const alreadyDelivery = itemTxs.filter(tx => deliveryMethodOf(tx) === 'shipping');
    if (alreadyDelivery.length === itemTxs.length) {
      return res.status(409).json({ error: 'already-delivery' });
    }

    const integrationSdk = getIntegrationSdk();
    const upgradedAt = new Date().toISOString();

    // Sequential rather than parallel: a partial failure has to leave the rest
    // of the order untouched and reportable, not buried in a rejected
    // Promise.all.
    const converted = [];
    const failed = [];
    for (const tx of itemTxs) {
      try {
        await integrationSdk.transactions.updateMetadata({
          id: tx.id.uuid,
          metadata: {
            deliveryMethod: 'shipping',
            upgradedToDeliveryAt: upgradedAt,
            deliveryTransactionId,
            ...(shippingAddress ? { shippingAddress } : {}),
          },
        });
        converted.push(tx);
      } catch (e) {
        console.error('[convert-order-to-delivery] failed for', tx.id.uuid, e.message);
        failed.push(tx.id.uuid);
      }
    }

    if (converted.length === 0) {
      return res.status(500).json({ error: 'Could not convert any items' });
    }

    // Link the items to the delivery transaction so reconciliation can decide
    // refund-vs-capture for the whole order, exactly as it does for an order
    // that chose delivery at checkout.
    try {
      const existingResp = await integrationSdk.transactions.show({ id: deliveryTransactionId });
      const existing = existingResp.data.data?.attributes?.metadata?.itemTransactionIds || [];
      const merged = Array.from(
        new Set([...existing, ...converted.map(tx => tx.id.uuid)].filter(Boolean))
      );
      await integrationSdk.transactions.updateMetadata({
        id: deliveryTransactionId,
        metadata: { itemTransactionIds: merged },
      });
    } catch (e) {
      // The items are converted and the fee is paid; a linking failure must not
      // fail the request. The reconciliation cron re-derives this.
      console.error('[convert-order-to-delivery] linking failed:', e.message);
    }

    // The vendor may already have accepted and planned to hand the order over
    // in person, so this genuinely changes how they pack it.
    const included = response.data.included || [];
    const vendorIds = Array.from(
      new Set(converted.map(tx => tx.relationships?.provider?.data?.id?.uuid).filter(Boolean))
    );

    await Promise.all(
      vendorIds.map(async vendorId => {
        const vendorItems = converted.filter(
          tx => tx.relationships?.provider?.data?.id?.uuid === vendorId
        );
        const listingTitles = vendorItems
          .map(tx => {
            const listingId = tx.relationships?.listing?.data?.id?.uuid;
            const listing = included.find(x => x.type === 'listing' && x.id.uuid === listingId);
            return listing?.attributes?.title;
          })
          .filter(Boolean);

        const body =
          listingTitles.length > 0
            ? `${listingTitles.join(', ')} changed from customer pickup to FarmFed delivery.`
            : 'An order changed from customer pickup to FarmFed delivery.';

        try {
          addNotification({
            userId: vendorId,
            title: 'Order changed to delivery',
            body,
            type: 'order-upgraded-to-delivery',
          });
        } catch (e) {
          console.error('[convert-order-to-delivery] in-app notify failed:', e.message);
        }

        try {
          const tokens = await getTokensForUser(vendorId);
          if (tokens?.length) {
            await sendPushNotifications(
              tokens.map(token => ({
                token: typeof token === 'string' ? token : token.token,
                title: 'Order changed to delivery',
                body,
                data: { orderGroupId },
              }))
            );
          }
        } catch (e) {
          console.error('[convert-order-to-delivery] push failed:', e.message);
        }
      })
    );

    return res.status(200).json({
      ok: true,
      convertedTransactionIds: converted.map(tx => tx.id.uuid),
      failedTransactionIds: failed,
      notifiedVendorCount: vendorIds.length,
    });
  } catch (e) {
    handleError(res, e);
  }
};
