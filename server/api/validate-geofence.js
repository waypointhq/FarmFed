const { getGeofence, getVendorPolygon, getConsumerPolygon } = require('../api-util/geofence');
const { isPointInPolygon } = require('../api-util/pointInPolygon');
const { describeError } = require('../api-util/describeError');

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_ACCESS_TOKEN;

const geocodeAddress = async (street, city, state, zip, country) => {
  const query = encodeURIComponent(`${street}, ${city}, ${state} ${zip}, ${country}`);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Geocoding request failed');
  }

  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    throw new Error('No geocoding results found');
  }

  // Mapbox returns [lng, lat]
  const [lng, lat] = data.features[0].center;
  return { lat, lng };
};

const handler = async (req, res) => {
  try {
    const { street, city, state, zip, country = 'US', userType } = req.body || {};

    // Select polygon based on userType (dual service radius feature)
    let polygon;
    if (userType === 'vendor' || userType === 'provider') {
      polygon = getVendorPolygon();
    } else if (userType === 'consumer' || userType === 'customer') {
      polygon = getConsumerPolygon();
    } else {
      // Default: use the consumer/general polygon
      polygon = getGeofence();
    }

    // If no geofence is set for this user type, all addresses are valid
    if (!polygon) {
      return res.status(200).json({ valid: true });
    }

    if (!street || !city || !state || !zip) {
      return res.status(400).json({ error: 'Missing required address fields' });
    }

    let coords;
    try {
      coords = await geocodeAddress(street, city, state, zip, country);
    } catch (e) {
      // If geocoding fails, block signup (unverifiable address)
      return res.status(200).json({ valid: false, reason: 'geocoding_failed' });
    }

    const valid = isPointInPolygon(coords.lat, coords.lng, polygon.coordinates);
    res.status(200).json({ valid });
  } catch (e) {
    console.error('Geofence validation error:', describeError(e));
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = handler;
