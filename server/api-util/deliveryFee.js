const { geocodeAddress } = require('./geocode');
const { haversineDistanceMiles } = require('./distance');
const { getDeliverySettings } = require('./deliveryRate');
const { checkDeliveryZone } = require('./deliveryZone');

/**
 * The delivery fee for one cart to `shippingAddress`.
 *
 * Hub-and-spoke model: every delivery originates from the configured FarmFed
 * hub address (admin → Delivery settings). The fee is a single hub → buyer
 * leg, regardless of how many vendors are in the cart.
 *
 * Shared by the checkout estimate and the promo redemption, so a free-delivery
 * promo always covers exactly what the buyer would otherwise have paid.
 *
 * @param {Object} shippingAddress { line1, city, state, postalCode, country }
 * @returns {Promise<Object>} { outsideDeliveryZone, reason, totalDistanceMiles,
 *   totalFeeCents, rateCentsPerMile, flatFeeCents }
 */
const estimateDeliveryFee = async shippingAddress => {
  // Checked here as well as at initiate so the buyer is told before they
  // reach the payment step, rather than having the order rejected after
  // they've filled everything in.
  const zone = await checkDeliveryZone(shippingAddress);
  if (!zone.allowed) {
    return {
      outsideDeliveryZone: true,
      reason: zone.reason,
      totalDistanceMiles: 0,
      totalFeeCents: 0,
    };
  }

  const {
    deliveryRatePerMileCents: rateCentsPerMile,
    deliveryFlatFeeCents: flatFeeCents,
    hubOrigin,
  } = getDeliverySettings();

  if ((!rateCentsPerMile || rateCentsPerMile <= 0) && (!flatFeeCents || flatFeeCents <= 0)) {
    return { totalDistanceMiles: 0, totalFeeCents: 0, rateCentsPerMile: 0, flatFeeCents: 0 };
  }

  if (!hubOrigin || !Number.isFinite(hubOrigin.lat) || !Number.isFinite(hubOrigin.lng)) {
    return { totalDistanceMiles: 0, totalFeeCents: flatFeeCents, rateCentsPerMile, flatFeeCents };
  }

  const buyerLocation = await geocodeAddress(shippingAddress);
  const totalDistanceMiles = haversineDistanceMiles(
    hubOrigin.lat,
    hubOrigin.lng,
    buyerLocation.lat,
    buyerLocation.lng
  );
  const totalFeeCents = Math.round(totalDistanceMiles * rateCentsPerMile) + flatFeeCents;

  return {
    totalDistanceMiles: Math.round(totalDistanceMiles * 10) / 10,
    totalFeeCents,
    rateCentsPerMile,
    flatFeeCents,
  };
};

module.exports = { estimateDeliveryFee };
