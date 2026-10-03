const { getSdk, getIntegrationSdk, handleError } = require('../api-util/sdk');
const { estimateDeliveryFee } = require('../api-util/deliveryFee');
const promos = require('../api-util/promos');

/**
 * Customer-facing promo endpoints: My Promos, checking and applying a code at
 * checkout, and counting a use when the order is placed. All need a logged-in
 * customer.
 */

const currentCustomer = async (req, res) => {
  const response = await getSdk(req, res).currentUser.show({ include: [] });
  const user = response.data.data;
  const profile = user.attributes.profile || {};
  return {
    id: user.id.uuid,
    name: profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
  };
};

const integrationSdkOrNull = () => {
  try {
    return getIntegrationSdk();
  } catch (e) {
    return null;
  }
};

const sendPromoError = (res, e) => {
  if (e instanceof promos.PromoError) {
    return res.status(e.status).json({ error: e.message });
  }
  return handleError(res, e);
};

/**
 * GET /api/promos/mine — { active, used, expired, unseenCount }
 */
const mine = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    res.status(200).json(await promos.listForUser(user.id, integrationSdkOrNull()));
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * GET /api/promos/unseen — { count } of new promos, for the menu dot.
 */
const unseen = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    res.status(200).json({ count: await promos.unseenCount(user.id) });
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * POST /api/promos/seen { promoIds? } — clears the NEW tags (all when no ids).
 */
const seen = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    const { promoIds } = req.body || {};
    await promos.markSeen(user.id, Array.isArray(promoIds) ? promoIds : null);
    res.status(200).json({ ok: true });
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * POST /api/promos/save { code } — keep a code from a flyer in My Promos.
 */
const save = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    res.status(200).json(await promos.savePromoForUser((req.body || {}).code, user.id));
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * POST /api/promos/check { code, deliveryMethod, deliveryFeeCents }
 *
 * Whether the code would work on this order. Nothing is counted here; a
 * promo is only used when the order is placed.
 */
const check = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    const { code, deliveryMethod, deliveryFeeCents } = req.body || {};
    res.status(200).json(
      await promos.checkForOrder({
        code,
        userId: user.id,
        deliveryMethod,
        deliveryFeeCents: Number.isFinite(deliveryFeeCents) ? deliveryFeeCents : null,
      })
    );
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * POST /api/promos/redeem { code, orderGroupId, shippingAddress, currency }
 *
 * Called at Place Order, before anything is charged. Counts one use
 * atomically and returns { ok, redemptionId, coveredCents }, or { ok: false,
 * reason } if the promo stopped working since it was applied (expired, last
 * use taken...). The fee is recomputed here, so a promo always covers exactly
 * the delivery fee the buyer would otherwise pay.
 */
const redeem = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    const { code, orderGroupId, shippingAddress, currency } = req.body || {};
    if (!code || !orderGroupId || !shippingAddress) {
      return res.status(400).json({ error: 'code, orderGroupId and shippingAddress are required' });
    }
    const estimate = await estimateDeliveryFee(shippingAddress);
    if (estimate.outsideDeliveryZone) {
      return res.status(200).json({ ok: false, reason: 'outside-zone' });
    }
    const result = await promos.redeem({
      code,
      userId: user.id,
      customerName: user.name,
      orderGroupId,
      deliveryFeeCents: estimate.totalFeeCents,
      currency,
    });
    if (!result.ok) {
      return res.status(200).json({ ok: false, reason: result.reason, date: result.date || null });
    }
    res.status(200).json({
      ok: true,
      redemptionId: result.redemption.id,
      coveredCents: result.redemption.deliveryFeeCents,
      code: result.promo.code,
    });
  } catch (e) {
    sendPromoError(res, e);
  }
};

/**
 * POST /api/promos/confirm { redemptionId, transactionId } — the order went
 * through; the use stands.
 *
 * There is deliberately no customer "release": a failed checkout gives the
 * use back through /api/checkout-failures, which checks the order first.
 */
const confirm = async (req, res) => {
  try {
    const user = await currentCustomer(req, res);
    const { redemptionId, transactionId } = req.body || {};
    await promos.confirmRedemption(redemptionId, { userId: user.id, transactionId });
    res.status(200).json({ ok: true });
  } catch (e) {
    sendPromoError(res, e);
  }
};

module.exports = { mine, unseen, seen, save, check, redeem, confirm };
