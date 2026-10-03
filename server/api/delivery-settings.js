const {
  getDeliverySettings,
  setDeliverySettings,
  resolveHubOrigin,
} = require('../api-util/deliveryRate');
const { getSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

const getHandler = (req, res) => {
  res.status(200).json(getDeliverySettings());
};

const putHandler = (req, res) => {
  const sdk = getSdk(req, res);

  sdk.currentUser
    .show({ include: [] })
    .then(async response => {
      const currentUser = response.data.data;
      const isAdmin = isAdminUser(currentUser);

      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }

      const current = getDeliverySettings();
      const body = req.body || {};

      const ratePerMileRaw = body.deliveryRatePerMileCents;
      const flatFeeRaw = body.deliveryFlatFeeCents;

      const ratePerMile =
        ratePerMileRaw === undefined ? current.deliveryRatePerMileCents : parseInt(ratePerMileRaw, 10);
      const flatFee =
        flatFeeRaw === undefined ? current.deliveryFlatFeeCents : parseInt(flatFeeRaw, 10);

      if (!Number.isInteger(ratePerMile) || ratePerMile < 0) {
        return res.status(400).json({ error: 'deliveryRatePerMileCents must be a non-negative integer' });
      }
      if (!Number.isInteger(flatFee) || flatFee < 0) {
        return res.status(400).json({ error: 'deliveryFlatFeeCents must be a non-negative integer' });
      }

      let hubOrigin = current.hubOrigin;
      if (body.hubOrigin) {
        const { line1, city, state, postalCode, country, lat, lng } = body.hubOrigin;
        if (!line1 || !city) {
          return res.status(400).json({ error: 'hubOrigin requires line1 and city' });
        }
        try {
          hubOrigin = await resolveHubOrigin({ line1, city, state, postalCode, country, lat, lng });
        } catch (e) {
          return res.status(400).json({ error: `Failed to geocode hubOrigin: ${e.message}` });
        }
      }

      await setDeliverySettings({
        deliveryRatePerMileCents: ratePerMile,
        deliveryFlatFeeCents: flatFee,
        hubOrigin,
      });

      res.status(200).json({
        deliveryRatePerMileCents: ratePerMile,
        deliveryFlatFeeCents: flatFee,
        hubOrigin,
      });
    })
    .catch(e => handleError(res, e));
};

module.exports = { getHandler, putHandler };
