const {
  getPickupSettings,
  setPickupSettings,
  getNextPickupDate,
  isCutoffPassed,
  isValidTimezone,
} = require('../api-util/pickupSchedule');
const { getSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

const VALID_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const getHandler = (req, res) => {
  const settings = getPickupSettings();
  const nextPickupDate = getNextPickupDate();
  const cutoffPassed = isCutoffPassed();
  res.status(200).json({ ...settings, nextPickupDate, cutoffPassed });
};

const putHandler = (req, res) => {
  const sdk = getSdk(req, res);

  sdk.currentUser
    .show({ include: [] })
    .then(response => {
      const currentUser = response.data.data;
      const isAdmin = isAdminUser(currentUser);

      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }

      const { pickupDays, cutoffDay, cutoffTime, timezone } = req.body || {};

      if (!Array.isArray(pickupDays) || pickupDays.length === 0) {
        return res.status(400).json({ error: 'pickupDays must be a non-empty array' });
      }

      if (!pickupDays.every(d => VALID_DAYS.includes(d))) {
        return res.status(400).json({ error: 'Invalid pickup day' });
      }

      if (!VALID_DAYS.includes(cutoffDay)) {
        return res.status(400).json({ error: 'Invalid cutoff day' });
      }

      if (!/^\d{2}:\d{2}$/.test(cutoffTime)) {
        return res.status(400).json({ error: 'Invalid cutoff time format (expected HH:MM)' });
      }

      // Keep the previously saved timezone if the request doesn't include one.
      const resolvedTimezone = timezone || getPickupSettings().timezone;
      if (!isValidTimezone(resolvedTimezone)) {
        return res.status(400).json({ error: 'Invalid timezone (expected IANA name, e.g. America/Toronto)' });
      }

      return setPickupSettings({ pickupDays, cutoffDay, cutoffTime, timezone: resolvedTimezone }).then(() => {
        const nextPickupDate = getNextPickupDate();
        res
          .status(200)
          .json({ pickupDays, cutoffDay, cutoffTime, timezone: resolvedTimezone, nextPickupDate });
      });
    })
    .catch(e => handleError(res, e));
};

module.exports = { getHandler, putHandler };
