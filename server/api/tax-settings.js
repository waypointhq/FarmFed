const { getTaxSettings, setTaxSettings } = require('../api-util/taxSettings');
const { getSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

const getHandler = (req, res) => {
  const settings = getTaxSettings();
  res.status(200).json(settings);
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

      const { taxRate, taxLabel, enabled } = req.body || {};

      if (typeof taxRate !== 'number' || taxRate < 0 || taxRate > 1) {
        return res.status(400).json({ error: 'taxRate must be a number between 0 and 1' });
      }

      if (typeof taxLabel !== 'string' || taxLabel.trim().length === 0) {
        return res.status(400).json({ error: 'taxLabel must be a non-empty string' });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }

      return setTaxSettings({ taxRate, taxLabel, enabled }).then(() => {
        res.status(200).json({ taxRate, taxLabel, enabled });
      });
    })
    .catch(e => handleError(res, e));
};

module.exports = { getHandler, putHandler };
