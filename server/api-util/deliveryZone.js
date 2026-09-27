const { getConsumerPolygon } = require('./geofence');
const { isPointInPolygon } = require('./pointInPolygon');
const { geocodeAddress } = require('./geocode');

/**
 * Is this address somewhere FarmFed actually delivers?
 *
 * The geofence used to be checked only when someone signed up
 * (`AddressAutocompleteInput` in the signup forms). The checkout shipping
 * address was free text with no check at all, so an in-zone signup address
 * followed by an out-of-zone delivery address sailed straight through — which
 * is how an order for Chesapeake, Virginia got accepted and had to be refunded
 * by hand.
 *
 * Results:
 *   { allowed: true }                     — inside the zone, or no zone configured
 *   { allowed: false, reason: 'outside' } — geocoded fine, outside the polygon
 *   { allowed: false, reason: 'unverifiable' } — could not be geocoded
 *
 * An address we cannot geocode is refused rather than waved through. We can't
 * price a delivery to an address we can't place, so accepting money for one is
 * worse than asking the buyer to check what they typed.
 */
const checkDeliveryZone = async shippingAddress => {
  const polygon = getConsumerPolygon();

  // No geofence configured means the marketplace hasn't opted into one.
  if (!polygon) {
    return { allowed: true };
  }

  if (!shippingAddress || !shippingAddress.line1) {
    return { allowed: false, reason: 'unverifiable' };
  }

  let location;
  try {
    location = await geocodeAddress(shippingAddress);
  } catch (e) {
    console.error('[deliveryZone] geocoding failed:', e.message);
    return { allowed: false, reason: 'unverifiable' };
  }

  const coordinates = polygon.coordinates || polygon;
  const inside = isPointInPolygon(location.lat, location.lng, coordinates);

  return inside ? { allowed: true } : { allowed: false, reason: 'outside' };
};

module.exports = { checkDeliveryZone };
