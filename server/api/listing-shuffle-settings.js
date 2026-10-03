const {
  getListingShuffleSettings,
  setListingShuffleEnabled,
  recordListingShuffleRun,
} = require('../api-util/listingShuffleSettings');
const { shuffleAllListings } = require('../api-util/shuffleListings');
const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

// Resolve to true only for admins; otherwise respond 403 and resolve false.
const requireAdmin = (req, res) =>
  getSdk(req, res)
    .currentUser.show({ include: [] })
    .then(response => {
      const isAdmin = isAdminUser(response.data.data);
      if (!isAdmin) {
        res.status(403).json({ error: 'Forbidden: admin access required' });
        return false;
      }
      return true;
    });

// GET — current shuffle settings (enabled + last run summary).
const getHandler = (req, res) => {
  res.status(200).json(getListingShuffleSettings());
};

// PUT — toggle whether the daily shuffle is the default browse order (admin).
const putHandler = (req, res) => {
  requireAdmin(req, res)
    .then(ok => {
      if (!ok) return;
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      return setListingShuffleEnabled(enabled).then(data => res.status(200).json(data));
    })
    .catch(e => handleError(res, e));
};

// POST /run — re-shuffle every listing right now (admin). For very large
// catalogs prefer the scheduled `yarn shuffle-listings` job, since a synchronous
// run here is bounded by the platform's request timeout.
const runHandler = (req, res) => {
  requireAdmin(req, res)
    .then(async ok => {
      if (!ok) return;
      const integrationSdk = getIntegrationSdk();
      const result = await shuffleAllListings({
        integrationSdk,
        throttleMs: 25,
        // eslint-disable-next-line no-console
        log: msg => console.log('[shuffle-listings]', msg),
      });
      const settings = await recordListingShuffleRun({
        total: result.total,
        updated: result.updated,
        failures: result.failures.length,
      });
      return res.status(200).json({ ok: true, ...result, settings });
    })
    .catch(e => handleError(res, e));
};

module.exports = { getHandler, putHandler, runHandler };
