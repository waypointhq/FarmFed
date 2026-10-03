const { getBulletins, setBulletins } = require('../api-util/bulletinSettings');
const { getSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

const getHandler = (req, res) => {
  const bulletins = getBulletins();
  // Filter to only active bulletins for public GET
  const now = new Date().toISOString();
  const activeBulletins = bulletins.filter(b => {
    const started = !b.startDate || b.startDate <= now;
    const notEnded = !b.endDate || b.endDate >= now;
    return started && notEnded;
  });
  res.status(200).json({ bulletins: activeBulletins });
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

      const { bulletins } = req.body || {};

      if (!Array.isArray(bulletins)) {
        return res.status(400).json({ error: 'bulletins must be an array' });
      }

      for (const b of bulletins) {
        if (!b.title || typeof b.title !== 'string') {
          return res.status(400).json({ error: 'Each bulletin must have a title' });
        }
      }

      return setBulletins(bulletins).then(() => {
        res.status(200).json({ bulletins });
      });
    })
    .catch(e => handleError(res, e));
};

// Admin-only: returns all bulletins (including inactive)
const getAllHandler = (req, res) => {
  const sdk = getSdk(req, res);

  sdk.currentUser
    .show({ include: [] })
    .then(response => {
      const currentUser = response.data.data;
      const isAdmin = isAdminUser(currentUser);

      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }

      const bulletins = getBulletins();
      res.status(200).json({ bulletins });
    })
    .catch(e => handleError(res, e));
};

module.exports = { getHandler, putHandler, getAllHandler };
