const { estimateDeliveryFee } = require('../api-util/deliveryFee');

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

    return res.json(await estimateDeliveryFee(shippingAddress));
  } catch (e) {
    console.error('estimate-cart-delivery error:', e);
    return res.status(500).json({ error: 'Failed to estimate delivery' });
  }
};
