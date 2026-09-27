const { geocodeAddress } = require('../api-util/geocode');
const { haversineDistanceMiles } = require('../api-util/distance');
const { getDeliverySettings } = require('../api-util/deliveryRate');
const { checkDeliveryZone } = require('../api-util/deliveryZone');

/**
 * POST /api/estimate-cart-delivery
 *
 * Hub-and-spoke model: every delivery originates from the configured FarmFed
 * hub address (admin → Delivery settings). Total fee is a single
 * hub → buyer leg, regardless of how many vendors are in the cart.
 *
 * Body: { listingIds: string[], shippingAddress: { line1, city, state, postalCode, country } }
 * Response: { totalDistanceMiles, totalFeeCents, rateCentsPerMile, flatFeeCents }
 */
module.exports = async (req, res) => {
  try {
    const { shippingAddress } = req.body;
    if (!shippingAddress) {
      return res.status(400).json({ error: 'shippingAddress is required' });
    }

    // Checked here as well as at initiate so the buyer is told before they
    // reach the payment step, rather than having the order rejected after
    // they've filled everything in.
    const zone = await checkDeliveryZone(shippingAddress);
    if (!zone.allowed) {
      return res.status(200).json({
        outsideDeliveryZone: true,
        reason: zone.reason,
        totalDistanceMiles: 0,
        totalFeeCents: 0,
      });
    }

    const {
      deliveryRatePerMileCents: rateCentsPerMile,
      deliveryFlatFeeCents: flatFeeCents,
      hubOrigin,
    } = getDeliverySettings();

    if ((!rateCentsPerMile || rateCentsPerMile <= 0) && (!flatFeeCents || flatFeeCents <= 0)) {
      return res.json({ totalDistanceMiles: 0, totalFeeCents: 0, rateCentsPerMile: 0, flatFeeCents: 0 });
    }

    if (!hubOrigin || !Number.isFinite(hubOrigin.lat) || !Number.isFinite(hubOrigin.lng)) {
      return res.json({ totalDistanceMiles: 0, totalFeeCents: flatFeeCents, rateCentsPerMile, flatFeeCents });
    }

    const buyerLocation = await geocodeAddress(shippingAddress);
    const totalDistanceMiles = haversineDistanceMiles(
      hubOrigin.lat,
      hubOrigin.lng,
      buyerLocation.lat,
      buyerLocation.lng
    );
    const totalFeeCents = Math.round(totalDistanceMiles * rateCentsPerMile) + flatFeeCents;

    return res.json({
      totalDistanceMiles: Math.round(totalDistanceMiles * 10) / 10,
      totalFeeCents,
      rateCentsPerMile,
      flatFeeCents,
    });
  } catch (e) {
    console.error('estimate-cart-delivery error:', e);
    return res.status(500).json({ error: 'Failed to estimate delivery' });
  }
};
