const { getGeofence, setGeofence, getVendorPolygon, getConsumerPolygon, setDualGeofence } = require('../api-util/geofence');
const { getSdk, handleError } = require('../api-util/sdk');
const { isAdminUser } = require('../api-util/admin');

const isValidPolygon = polygon => {
  return (
    polygon &&
    polygon.type === 'Polygon' &&
    Array.isArray(polygon.coordinates) &&
    Array.isArray(polygon.coordinates[0]) &&
    polygon.coordinates[0].length >= 4
  );
};

const getHandler = (req, res) => {
  const polygon = getGeofence();
  const vendorPolygon = getVendorPolygon();
  const consumerPolygon = getConsumerPolygon();
  res.status(200).json({ polygon, vendorPolygon, consumerPolygon });
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

      const { polygon, vendorPolygon, consumerPolygon } = req.body || {};

      // Support dual polygon update
      if (vendorPolygon !== undefined || consumerPolygon !== undefined) {
        if (vendorPolygon !== null && vendorPolygon !== undefined && !isValidPolygon(vendorPolygon)) {
          return res.status(400).json({ error: 'Invalid vendor polygon' });
        }
        if (consumerPolygon !== null && consumerPolygon !== undefined && !isValidPolygon(consumerPolygon)) {
          return res.status(400).json({ error: 'Invalid consumer polygon' });
        }

        return setDualGeofence({
          vendorPolygon: vendorPolygon || getVendorPolygon(),
          consumerPolygon: consumerPolygon || getConsumerPolygon(),
        }).then(() => {
          res.status(200).json({
            polygon: getGeofence(),
            vendorPolygon: getVendorPolygon(),
            consumerPolygon: getConsumerPolygon(),
          });
        });
      }

      // Legacy single polygon update
      if (polygon === null) {
        return setGeofence(null).then(() => {
          res.status(200).json({ polygon: null, vendorPolygon: getVendorPolygon(), consumerPolygon: null });
        });
      }

      if (!isValidPolygon(polygon)) {
        return res.status(400).json({ error: 'Invalid polygon: must be a GeoJSON Polygon with at least 4 coordinates' });
      }

      return setGeofence(polygon).then(() => {
        res.status(200).json({ polygon, vendorPolygon: getVendorPolygon(), consumerPolygon: polygon });
      });
    })
    .catch(e => {
      handleError(res, e);
    });
};

module.exports = { getHandler, putHandler };
