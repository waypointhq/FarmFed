const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { getTokensForUser } = require('../api-util/deviceTokens');
const { sendPushNotifications } = require('../api-util/pushSender');
const { reconcileAllOpenDeliveries } = require('../api-util/deliveryReconcile');
const { reconcileAllRedemptions } = require('../api-util/promos');

/**
 * Push notification templates per transition. Each entry decides who gets
 * the push (`recipient`: 'provider' | 'customer'), and produces a title/body
 * from the transaction. Returning `null` skips the push.
 */
const TRANSITION_TEMPLATES = {
  'transition/confirm-payment': {
    recipient: 'provider',
    build: ({ listingTitle, customerName }) => ({
      title: 'New order',
      body: `${customerName} ordered ${listingTitle}. Tap to accept or decline.`,
    }),
  },
  'transition/accept-order': {
    recipient: 'customer',
    build: ({ listingTitle, providerName }) => ({
      title: 'Order accepted',
      body: `${providerName} accepted your order for ${listingTitle}.`,
    }),
  },
  'transition/operator-accept-order': {
    recipient: 'customer',
    build: ({ listingTitle, providerName }) => ({
      title: 'Order accepted',
      body: `${providerName} accepted your order for ${listingTitle}.`,
    }),
  },
  'transition/decline-order': {
    recipient: 'customer',
    build: ({ listingTitle, providerName }) => ({
      title: 'Order declined',
      body: `${providerName} declined your order for ${listingTitle}. You'll be refunded.`,
    }),
  },
  'transition/auto-decline-order': {
    recipient: 'customer',
    build: ({ listingTitle }) => ({
      title: 'Order auto-declined',
      body: `Your order for ${listingTitle} expired before the vendor responded. You'll be refunded.`,
    }),
  },
  'transition/mark-delivered': {
    recipient: 'customer',
    build: ({ listingTitle }) => ({
      title: 'Order marked delivered',
      body: `Your order for ${listingTitle} is on its way (or ready for pickup).`,
    }),
  },
  'transition/mark-received': {
    recipient: 'provider',
    build: ({ listingTitle, customerName }) => ({
      title: 'Order received',
      body: `${customerName} confirmed receipt of ${listingTitle}.`,
    }),
  },
};

const getName = user =>
  user?.attributes?.profile?.displayName ||
  user?.attributes?.email ||
  'Someone';

/**
 * POST /api/push/transition
 * Body: { transactionId, transition }
 *
 * Called by the frontend right after it successfully runs a Sharetribe
 * transition. The server looks up the transaction (via Integration SDK to
 * resolve listing + customer + provider) and sends a push to the right party
 * if a template exists for this transition.
 *
 * No auth required beyond standard SDK; we re-fetch the transaction
 * server-side rather than trusting the request body, so the worst a
 * malicious caller can do is trigger a duplicate push.
 */
module.exports = async (req, res) => {
  try {
    const { transactionId, transition } = req.body || {};
    if (!transactionId || !transition) {
      return res.status(400).json({ error: 'transactionId and transition are required' });
    }

    const template = TRANSITION_TEMPLATES[transition];
    if (!template) {
      return res.status(200).json({ skipped: true, reason: 'no template for transition' });
    }

    const integrationSdk = getIntegrationSdk();

    // Runs before the push lookups below, so a recipient without the app
    // still gets this.
    //
    // Fast path for the standalone-delivery refund rule: when a vendor declines
    // an item, reconcile open delivery orders so a fully-denied order refunds
    // its delivery promptly. (24h auto-declines don't reach this endpoint — the
    // reconcile cron is the robust backstop for those.) Best-effort, idempotent.
    if (transition === 'transition/decline-order') {
      reconcileAllOpenDeliveries(integrationSdk).catch(err => {
        console.error('push-transition delivery reconcile failed:', err);
      });
      // Same for free-delivery promos: a fully declined order gets its promo back.
      reconcileAllRedemptions(integrationSdk).catch(err => {
        console.error('push-transition promo reconcile failed:', err);
      });
    }

    const txResp = await integrationSdk.transactions.show({
      id: transactionId,
      include: ['customer', 'provider', 'listing'],
    });
    const tx = txResp.data.data;
    const included = txResp.data.included || [];
    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    const listingId = tx.relationships?.listing?.data?.id?.uuid;
    const customer = included.find(x => x.type === 'user' && x.id.uuid === customerId);
    const provider = included.find(x => x.type === 'user' && x.id.uuid === providerId);
    const listing = included.find(x => x.type === 'listing' && x.id.uuid === listingId);

    const recipientId = template.recipient === 'provider' ? providerId : customerId;
    if (!recipientId) {
      return res.status(200).json({ skipped: true, reason: 'no recipient resolved' });
    }

    const tokens = getTokensForUser(recipientId);
    if (tokens.length === 0) {
      return res.status(200).json({ skipped: true, reason: 'no device tokens for recipient' });
    }

    const messageData = template.build({
      listingTitle: listing?.attributes?.title || 'your order',
      customerName: getName(customer),
      providerName: getName(provider),
    });

    const pushMessages = tokens.map(t => ({
      token: t.token,
      title: messageData.title,
      body: messageData.body,
      data: {
        transactionId,
        transition,
        type: 'transaction',
      },
    }));

    sendPushNotifications(pushMessages).catch(err => {
      console.error('push-transition send failed:', err);
    });

    res.status(200).json({ pushed: pushMessages.length });
  } catch (e) {
    handleError(res, e);
  }
};
