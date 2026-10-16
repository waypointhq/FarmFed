const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { addNotification, getNotificationsForUser, markReadForUser } = require('../api-util/notifications');
const { getTokensForUsers } = require('../api-util/deviceTokens');
const { sendPushNotifications } = require('../api-util/pushSender');
const { describeError } = require('../api-util/describeError');

/**
 * GET /api/notifications — fetch unread notifications for the current user
 */
const getNotificationsHandler = async (req, res) => {
  const sdk = getSdk(req, res);

  try {
    const response = await sdk.currentUser.show({ include: [] });
    const userId = response.data.data.id.uuid;
    const notifications = getNotificationsForUser(userId);

    res.status(200).json({ notifications });
  } catch (e) {
    // 401/403 here means the page's session has ended (e.g. an expired
    // "log in as" session) while the bell keeps polling. Expected, so don't
    // log a full error every minute.
    const sessionEnded = e.status === 401 || e.status === 403;
    handleError(res, e, { skipErrorLogging: sessionEnded });
  }
};

/**
 * POST /api/notify-followers — vendor triggers notification to followers
 * Body: { vendorId, listingId, listingTitle }
 */
const notifyFollowersHandler = async (req, res) => {
  const sdk = getSdk(req, res);

  try {
    const { vendorId, listingId, listingTitle } = req.body || {};
    if (!vendorId || !listingId) {
      return res.status(400).json({ error: 'vendorId and listingId are required' });
    }

    // Verify the caller is the vendor
    const currentUserResponse = await sdk.currentUser.show({ include: [] });
    const currentUserId = currentUserResponse.data.data.id.uuid;
    if (currentUserId !== vendorId) {
      return res.status(403).json({ error: 'Can only notify for your own listings' });
    }

    const vendorName = currentUserResponse.data.data.attributes.profile.displayName || 'A vendor';

    // Use integration SDK to find users who follow this vendor
    const integrationSdk = getIntegrationSdk();
    // Query all users — in production, you'd want pagination; for now we fetch up to 100
    const usersResponse = await integrationSdk.users.query({ perPage: 100 });
    const users = usersResponse.data.data || [];

    const notifiedUserIds = [];
    let notifiedCount = 0;

    for (const user of users) {
      const privateData = user.attributes.profile.privateData || {};
      const followedVendors = Array.isArray(privateData.followedVendors)
        ? privateData.followedVendors
        : [];

      if (followedVendors.includes(vendorId)) {
        const userId = user.id.uuid;
        addNotification({
          userId,
          vendorId,
          vendorName,
          listingId,
          listingTitle: listingTitle || 'a new listing',
        });
        notifiedUserIds.push(userId);
        notifiedCount++;
      }
    }

    // Send push notifications to followers' devices
    if (notifiedUserIds.length > 0) {
      const deviceTokens = getTokensForUsers(notifiedUserIds);
      const pushMessages = deviceTokens.map(dt => ({
        token: dt.token,
        title: vendorName,
        body: `New listing: ${listingTitle || 'a new listing'}`,
        data: { listingId, vendorId, listingTitle, type: 'new_listing' },
      }));

      // Fire and forget — don't block the response on push delivery
      sendPushNotifications(pushMessages).catch(err => {
        console.error('Failed to send push notifications:', describeError(err));
      });
    }

    res.status(200).json({ notifiedCount });
  } catch (e) {
    handleError(res, e);
  }
};

/**
 * PUT /api/notifications/read — mark all notifications as read for current user
 */
const markReadHandler = async (req, res) => {
  const sdk = getSdk(req, res);

  try {
    const response = await sdk.currentUser.show({ include: [] });
    const userId = response.data.data.id.uuid;
    markReadForUser(userId);

    res.status(200).json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
};

module.exports = { getNotificationsHandler, notifyFollowersHandler, markReadHandler };
