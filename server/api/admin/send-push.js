const crypto = require('crypto');
const { getSdk, handleError } = require('../../api-util/sdk');
const { getTokens } = require('../../api-util/deviceTokens');
const { sendPushNotifications } = require('../../api-util/pushSender');
const announcements = require('../../api-util/announcements');
const { isAdminUser } = require('../../api-util/admin');

/**
 * POST /api/admin/send-push
 * Body: { title, body, link? }
 *
 * Admin "Push Notification Center": saves the message as an announcement (so it
 * also shows as an in-app home banner) and broadcasts a push notification to
 * every registered device. Admin-only.
 */
module.exports = async (req, res) => {
  const sdk = getSdk(req, res);

  try {
    const response = await sdk.currentUser.show({ include: [] });
    const isAdmin = isAdminUser(response.data.data);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { title, body, link } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    // Broadcast to every registered device token.
    const tokens = getTokens();
    const messages = tokens.map(t => ({
      token: t.token,
      title,
      body,
      data: { type: 'announcement', ...(link ? { link } : {}) },
    }));

    // Fire the push (best-effort — don't fail the request if some tokens error).
    sendPushNotifications(messages).catch(err =>
      console.error('admin send-push broadcast failed:', err)
    );

    const announcement = await announcements.add({
      id: crypto.randomUUID(),
      title,
      body,
      link: link || null,
      createdAt: new Date().toISOString(),
      active: true,
      sentCount: messages.length,
    });

    return res.status(200).json({ success: true, sentCount: messages.length, announcement });
  } catch (e) {
    handleError(res, e);
  }
};
