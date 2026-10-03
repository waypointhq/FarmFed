const settingsStore = require('./settingsStore');

// In-app notifications (the bell). Kept in settingsStore so they survive a
// Heroku restart: Redis in production, server/data/notifications.json locally.
const NAMESPACE = 'notifications';
// Oldest entries drop off past this, so the stored value stays small.
const MAX_NOTIFICATIONS = 2000;

const getNotifications = () => {
  const data = settingsStore.get(NAMESPACE);
  return Array.isArray(data?.notifications) ? data.notifications : [];
};

const setNotifications = notifications =>
  settingsStore.set(NAMESPACE, {
    notifications: (notifications || []).slice(-MAX_NOTIFICATIONS),
  });

const addNotification = notification => {
  const notifications = getNotifications();
  notifications.push({
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    read: false,
  });
  return setNotifications(notifications);
};

// Several at once, in one write (e.g. a promo gifted to many customers).
const addNotifications = list => {
  const createdAt = new Date().toISOString();
  const added = list.map(notification => ({
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt,
    read: false,
  }));
  return setNotifications([...getNotifications(), ...added]);
};

const getNotificationsForUser = userId => {
  return getNotifications().filter(n => n.userId === userId);
};

const markReadForUser = userId => {
  const notifications = getNotifications();
  const updated = notifications.map(n =>
    n.userId === userId ? { ...n, read: true } : n
  );
  return setNotifications(updated);
};

module.exports = {
  getNotifications,
  setNotifications,
  addNotification,
  addNotifications,
  getNotificationsForUser,
  markReadForUser,
};
