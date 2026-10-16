const { Expo } = require('expo-server-sdk');
const { describeError } = require('./describeError');

const expo = new Expo();

/**
 * Send push notifications to a list of Expo push tokens.
 *
 * @param {Array<{ token: string, title: string, body: string, data?: object }>} messages
 * @returns {Promise<void>}
 */
const sendPushNotifications = async messages => {
  const pushMessages = [];

  for (const msg of messages) {
    if (!Expo.isExpoPushToken(msg.token)) {
      console.warn(`Invalid Expo push token: ${msg.token}`);
      continue;
    }

    pushMessages.push({
      to: msg.token,
      sound: 'default',
      title: msg.title,
      body: msg.body,
      data: msg.data || {},
    });
  }

  if (pushMessages.length === 0) return;

  const chunks = expo.chunkPushNotifications(pushMessages);

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      // Log failed tickets for debugging
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          console.error('Push notification error:', ticket.message);
        }
      }
    } catch (error) {
      console.error('Error sending push notification chunk:', describeError(error));
    }
  }
};

module.exports = { sendPushNotifications };
