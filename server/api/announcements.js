const { getSdk, handleError } = require('../api-util/sdk');
const announcements = require('../api-util/announcements');
const { isAdminUser } = require('../api-util/admin');

/**
 * GET /api/announcements — active announcements for the in-app home banner.
 * Public (no auth): any app user can read the current announcements.
 */
const getHandler = (req, res) => {
  try {
    res.status(200).json({ announcements: announcements.getActive() });
  } catch (e) {
    handleError(res, e);
  }
};

const requireAdmin = async (req, res) => {
  const sdk = getSdk(req, res);
  const response = await sdk.currentUser.show({ include: [] });
  return isAdminUser(response.data.data);
};

/**
 * GET /api/announcements/all — full history (admin only).
 */
const getAllHandler = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }
    res.status(200).json({ announcements: announcements.getAll() });
  } catch (e) {
    handleError(res, e);
  }
};

/**
 * PUT /api/announcements/active — toggle an announcement on/off (admin only).
 * Body: { id, active }
 */
const setActiveHandler = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }
    const { id, active } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    await announcements.setActive(id, active !== false);
    res.status(200).json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
};

module.exports = { getHandler, getAllHandler, setActiveHandler };
