const crypto = require('crypto');
const moment = require('moment-timezone');
const store = require('./promoStore');
const { itemStatus, isDeliveryTransaction, SUBORDER_UNAVAILABLE } = require('./orderGroups');

/**
 * Free-delivery promos.
 *
 * A promo only ever covers the delivery fee, whatever that fee is when the
 * order is placed — nothing here stores a dollar amount. Farm Fed absorbs the
 * fee by simply not charging the delivery transaction; item prices and vendor
 * payouts never change.
 *
 * A use is counted when the order is placed (redeem), handed back if the
 * checkout fails partway (release), and handed back again if every item in
 * the order is later declined or cancelled (restore).
 */

// All promo dates run on Central time.
const TIMEZONE = 'America/Chicago';

const AUDIENCE_PUBLIC = 'public';
const AUDIENCE_GIFTED = 'gifted';
const EXPIRY_TYPES = ['never', 'date', 'uses', 'both'];

const STATE_DRAFT = 'draft';
const STATE_ACTIVE = 'active';
const STATE_PAUSED = 'paused';
const STATE_ARCHIVED = 'archived';

// Reasons a code can't be used. The client turns these into the customer
// messages listed in the spec.
const REASON_INVALID = 'invalid';
const REASON_NOT_STARTED = 'not-started';
const REASON_EXPIRED = 'expired';
const REASON_LIMIT = 'limit';
const REASON_ALREADY_USED = 'already-used';
const REASON_NOT_YOURS = 'not-yours';
const REASON_PICKUP = 'pickup';
const REASON_ALREADY_FREE = 'already-free';

const REDEMPTION_PENDING = 'pending';
const REDEMPTION_USED = 'used';
const REDEMPTION_RELEASED = 'released';
const REDEMPTION_RESTORED = 'restored';

// A redemption still pending after this long belonged to a checkout that
// never reported back (closed tab, lost connection); reconcile settles it.
const PENDING_GRACE_MS = 30 * 60 * 1000;
// Stop checking an order for cancellation once it's this old.
const RESTORE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

// No 0/O or 1/I, so a code read off a flyer can't be mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class PromoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const normalizeCode = code =>
  String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const isValidCode = code => /^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code);

const randomCode = () => {
  const bytes = crypto.randomBytes(4);
  const suffix = Array.from(bytes)
    .map(b => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('');
  return `FF-${suffix}`;
};

const generateUniqueCode = async () => {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    if (!(await store.getPromoIdByCode(code))) return code;
  }
  throw new PromoError(500, 'Could not generate a unique promo code');
};

const toTime = iso => (iso ? new Date(iso).getTime() : null);

const effectiveEndsAt = promo =>
  promo.expiryType === 'date' || promo.expiryType === 'both' ? promo.endsAt || null : null;

const effectiveMaxUses = promo =>
  promo.expiryType === 'uses' || promo.expiryType === 'both'
    ? Number.isInteger(promo.maxUses)
      ? promo.maxUses
      : null
    : null;

// Earliest of the dates given, ignoring missing ones.
const earliest = (...isos) => {
  const times = isos.filter(Boolean).map(toTime);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
};

/**
 * What the admin list shows: draft, scheduled, active, paused, expired or
 * archived.
 */
const promoStatus = (promo, uses, now = Date.now()) => {
  if (promo.state === STATE_ARCHIVED) return 'archived';
  if (promo.state === STATE_DRAFT) return 'draft';
  const endsAt = effectiveEndsAt(promo);
  const maxUses = effectiveMaxUses(promo);
  const isExpired = (endsAt && now > toTime(endsAt)) || (maxUses != null && uses >= maxUses);
  if (isExpired) return 'expired';
  if (promo.state === STATE_PAUSED) return 'paused';
  if (promo.startsAt && now < toTime(promo.startsAt)) return 'scheduled';
  return 'active';
};

// ================ Validation ================ //

const toPositiveInt = (value, fallback = null) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Admin forms send Central wall-clock times ("2026-10-31T23:59", or a bare
// date); anything with a zone or offset is taken as-is.
const CENTRAL_LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

const toIsoOrNull = (value, { endOfDay = false } = {}) => {
  if (!value) return null;
  if (typeof value === 'string' && CENTRAL_LOCAL.test(value)) {
    const m = moment.tz(value, TIMEZONE);
    if (!m.isValid()) return null;
    return (value.length === 10 && endOfDay ? m.endOf('day') : m).toISOString();
  }
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Pull the editable fields out of an admin request and check them.
 */
const sanitizePromoInput = input => {
  const code = normalizeCode(input.code);
  if (!isValidCode(code)) {
    throw new PromoError(
      400,
      'Promo codes are 3–30 letters, numbers or dashes, starting with a letter or number.'
    );
  }
  const expiryType = EXPIRY_TYPES.includes(input.expiryType) ? input.expiryType : 'never';
  const endsAt = toIsoOrNull(input.endsAt, { endOfDay: true });
  const maxUses = toPositiveInt(input.maxUses);
  if ((expiryType === 'date' || expiryType === 'both') && !endsAt) {
    throw new PromoError(400, 'Pick an end date.');
  }
  if ((expiryType === 'uses' || expiryType === 'both') && !maxUses) {
    throw new PromoError(400, 'Enter the number of uses.');
  }
  const startsAt = toIsoOrNull(input.startsAt);
  if (startsAt && endsAt && toTime(startsAt) >= toTime(endsAt)) {
    throw new PromoError(400, 'The start date has to be before the end date.');
  }

  return {
    code,
    name: String(input.name || '')
      .trim()
      .slice(0, 120),
    title:
      String(input.title || '')
        .trim()
        .slice(0, 60) || 'Free Delivery',
    message: String(input.message || '')
      .trim()
      .slice(0, 280),
    audience: input.audience === AUDIENCE_GIFTED ? AUDIENCE_GIFTED : AUDIENCE_PUBLIC,
    expiryType,
    endsAt: expiryType === 'date' || expiryType === 'both' ? endsAt : null,
    maxUses: expiryType === 'uses' || expiryType === 'both' ? maxUses : null,
    perCustomerLimit: toPositiveInt(input.perCustomerLimit, 1),
    startsAt,
  };
};

// Free a code only if it still points at this promo: an archived promo's code
// may since have been taken by another one.
const releaseCode = async (code, promoId) => {
  if ((await store.getPromoIdByCode(code)) === promoId) await store.deleteCode(code);
};

const assertCodeAvailable = async (code, promoId = null) => {
  const existing = await store.getPromoIdByCode(code);
  if (existing && existing !== promoId) {
    throw new PromoError(409, `The code ${code} is already taken.`);
  }
};

// ================ Admin: create / edit ================ //

const createPromo = async (input, { createdBy, activate = false, personalFor = null } = {}) => {
  const fields = sanitizePromoInput(input);
  await assertCodeAvailable(fields.code);
  const now = new Date().toISOString();
  const promo = {
    id: `promo_${crypto.randomUUID()}`,
    ...fields,
    state: activate ? STATE_ACTIVE : STATE_DRAFT,
    personal: !!personalFor,
    personalFor,
    createdAt: now,
    updatedAt: now,
    createdBy: createdBy || null,
  };
  await store.savePromo(promo);
  await store.setCode(promo.code, promo.id);
  return promo;
};

const getPromoOrThrow = async promoId => {
  const promo = await store.getPromo(promoId);
  if (!promo) throw new PromoError(404, 'Promo not found');
  return promo;
};

/**
 * Admins can always extend the end date, add uses, pause/resume and reword
 * the title and message. Once a promo has been used its code is fixed (use
 * Duplicate for a new version), and its limit can't drop below what's
 * already been used.
 */
const updatePromo = async (promoId, input) => {
  const promo = await getPromoOrThrow(promoId);
  if (promo.state === STATE_ARCHIVED) throw new PromoError(409, 'Archived promos can’t be edited.');
  const uses = await store.getUses(promoId);
  const fields = sanitizePromoInput({ ...promo, ...input });

  if (fields.code !== promo.code) {
    if (uses > 0) {
      throw new PromoError(
        409,
        'This promo has been used, so its code can’t change. Duplicate it instead.'
      );
    }
    await assertCodeAvailable(fields.code, promoId);
  }
  if (fields.maxUses != null && fields.maxUses < uses) {
    throw new PromoError(400, `This promo has already been used ${uses} times.`);
  }

  const updated = { ...promo, ...fields, updatedAt: new Date().toISOString() };
  if (input.state === STATE_ACTIVE || input.state === STATE_PAUSED) {
    updated.state = input.state;
  }
  await store.savePromo(updated);
  if (fields.code !== promo.code) {
    await releaseCode(promo.code, promoId);
    await store.setCode(fields.code, promoId);
  }
  return updated;
};

const setPromoState = async (promoId, state) => {
  const promo = await getPromoOrThrow(promoId);
  if (promo.state === STATE_ARCHIVED) throw new PromoError(409, 'This promo is archived.');
  const updated = { ...promo, state, updatedAt: new Date().toISOString() };
  await store.savePromo(updated);
  return updated;
};

const duplicatePromo = async (promoId, { createdBy } = {}) => {
  const promo = await getPromoOrThrow(promoId);
  return createPromo(
    {
      ...promo,
      code: await generateUniqueCode(),
      name: promo.name ? `${promo.name} (copy)` : '',
    },
    { createdBy }
  );
};

/**
 * Used promos are archived, never deleted, so order history keeps pointing at
 * something real. The code stops working everywhere.
 */
const archivePromo = async promoId => {
  const promo = await getPromoOrThrow(promoId);
  const updated = { ...promo, state: STATE_ARCHIVED, updatedAt: new Date().toISOString() };
  await store.savePromo(updated);
  await releaseCode(promo.code, promoId);
  return updated;
};

const deletePromo = async promoId => {
  const promo = await getPromoOrThrow(promoId);
  if (promo.state === STATE_ARCHIVED) {
    throw new PromoError(409, 'Archived promos are kept for order history.');
  }
  const uses = await store.getUses(promoId);
  const redemptions = await store.getRedemptions(promoId);
  if (uses > 0 || redemptions.length > 0) {
    throw new PromoError(409, 'This promo has been used, so it can only be archived.');
  }
  await releaseCode(promo.code, promoId);
  await store.deletePromo(promoId);
};

// ================ Eligibility ================ //

const activeGift = async (promoId, userId) => {
  if (!userId) return null;
  const gift = await store.getGift(promoId, userId);
  return gift && !gift.revokedAt ? gift : null;
};

/**
 * Can this customer use this promo right now? Checks everything except the
 * order itself (pickup, fee already zero), which the checkout adds on top.
 *
 * @returns {Promise<Object>} { ok, reason?, date?, usesLeft?, expiresAt?, gift? }
 */
const evaluate = async (promo, userId, now = Date.now()) => {
  if (!promo || promo.state === STATE_DRAFT || promo.state === STATE_ARCHIVED) {
    return { ok: false, reason: REASON_INVALID };
  }
  const gift = await activeGift(promo.id, userId);
  if (promo.audience === AUDIENCE_GIFTED && !gift) {
    return { ok: false, reason: REASON_NOT_YOURS };
  }
  if (promo.state === STATE_PAUSED) {
    return { ok: false, reason: REASON_INVALID };
  }
  if (promo.startsAt && now < toTime(promo.startsAt)) {
    return { ok: false, reason: REASON_NOT_STARTED, date: promo.startsAt };
  }
  const expiresAt = earliest(effectiveEndsAt(promo), gift?.expiresAt);
  if (expiresAt && now > toTime(expiresAt)) {
    return { ok: false, reason: REASON_EXPIRED, date: expiresAt };
  }
  const maxUses = effectiveMaxUses(promo);
  const uses = await store.getUses(promo.id);
  if (maxUses != null && uses >= maxUses) {
    return { ok: false, reason: REASON_LIMIT };
  }
  const userUses = userId ? await store.getUserUses(promo.id, userId) : 0;
  // A gift adds its uses on top of whatever the customer had already used of
  // the promo when it was gifted.
  const allowance = gift ? (gift.baseUses || 0) + gift.uses : promo.perCustomerLimit;
  if (userUses >= allowance) {
    return { ok: false, reason: REASON_ALREADY_USED };
  }
  const totalLeft = maxUses != null ? maxUses - uses : Infinity;
  return {
    ok: true,
    usesLeft: Math.min(allowance - userUses, totalLeft),
    expiresAt,
    gift,
  };
};

const findByCode = async code => {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const promoId = await store.getPromoIdByCode(normalized);
  return promoId ? store.getPromo(promoId) : null;
};

/**
 * Checkout check: the promo rules plus the order's own situation.
 *
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.userId
 * @param {string} params.deliveryMethod 'shipping' | 'pickup'
 * @param {number|null} params.deliveryFeeCents the current delivery fee, when known
 */
const checkForOrder = async ({ code, userId, deliveryMethod, deliveryFeeCents }) => {
  const promo = await findByCode(code);
  const result = await evaluate(promo, userId);
  if (!result.ok) return { ...result, code: normalizeCode(code) };
  // The promo itself is fine in these two cases; the order just can't use it.
  const view = customerView(promo, result);
  if (deliveryMethod && deliveryMethod !== 'shipping') {
    return { ok: false, reason: REASON_PICKUP, code: promo.code, promo: view };
  }
  // Nothing to cover, so keep the promo for next time instead of spending it.
  if (deliveryFeeCents === 0) {
    return { ok: false, reason: REASON_ALREADY_FREE, code: promo.code, promo: view };
  }
  // Not the raw result: it carries the gift record, whose note is admin-only.
  return {
    ok: true,
    code: promo.code,
    usesLeft: result.usesLeft,
    expiresAt: result.expiresAt,
    promo: view,
  };
};

// ================ Redemptions ================ //

/**
 * Count one use for this order. Atomic: if two people take the last use at
 * the same moment, only one gets it.
 */
const redeem = async ({ code, userId, customerName, orderGroupId, deliveryFeeCents, currency }) => {
  const promo = await findByCode(code);
  const result = await evaluate(promo, userId);
  if (!result.ok) return result;
  if (!(deliveryFeeCents > 0)) return { ok: false, reason: REASON_ALREADY_FREE };

  const allowance = result.gift
    ? (result.gift.baseUses || 0) + result.gift.uses
    : promo.perCustomerLimit;
  const redemption = {
    id: `rdm_${crypto.randomUUID()}`,
    promoId: promo.id,
    code: promo.code,
    userId,
    customerName: customerName || null,
    orderGroupId,
    deliveryFeeCents,
    currency: currency || 'USD',
    status: REDEMPTION_PENDING,
    createdAt: new Date().toISOString(),
  };
  const outcome = await store.reserveUse({
    promoId: promo.id,
    userId,
    maxUses: effectiveMaxUses(promo),
    userLimit: allowance,
    redemption,
  });
  if (outcome === 'limit') return { ok: false, reason: REASON_LIMIT };
  if (outcome === 'user-limit') return { ok: false, reason: REASON_ALREADY_USED };

  return { ok: true, redemption, promo };
};

const getOwnRedemption = async (redemptionId, userId) => {
  const redemption = await store.getRedemption(redemptionId);
  if (!redemption || (userId && redemption.userId !== userId)) {
    throw new PromoError(404, 'Redemption not found');
  }
  return redemption;
};

const confirmRedemption = async (redemptionId, { userId, transactionId } = {}) => {
  const redemption = await getOwnRedemption(redemptionId, userId);
  return store.setRedemptionStatus({
    promoId: redemption.promoId,
    redemptionId,
    fromStatuses: [REDEMPTION_PENDING],
    toStatus: REDEMPTION_USED,
    giveBack: false,
    patch: { usedAt: new Date().toISOString(), ...(transactionId ? { transactionId } : {}) },
  });
};

const releaseRedemption = async (redemptionId, { userId } = {}) => {
  const redemption = await getOwnRedemption(redemptionId, userId);
  return store.setRedemptionStatus({
    promoId: redemption.promoId,
    redemptionId,
    fromStatuses: [REDEMPTION_PENDING],
    toStatus: REDEMPTION_RELEASED,
    giveBack: true,
    patch: { releasedAt: new Date().toISOString() },
  });
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Enough pages for any one customer's recent orders.
const MAX_ORDER_PAGES = 10;

/**
 * A customer's transactions back to `since` (newest first, paged).
 */
const customerTransactionsSince = async (integrationSdk, customerId, since) => {
  const txs = [];
  for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
    const response = await integrationSdk.transactions.query({ customerId, perPage: 100, page });
    const batch = response.data.data || [];
    txs.push(...batch);
    const oldest = batch[batch.length - 1];
    const reachedSince = oldest && toTime(oldest.attributes.createdAt) < since;
    if (reachedSince || page >= (response.data.meta?.totalPages || 1)) break;
  }
  return txs;
};

const groupItems = (txs, orderGroupId) =>
  txs.filter(
    tx => tx.attributes.protectedData?.orderGroupId === orderGroupId && !isDeliveryTransaction(tx)
  );

// Paid for and not since declined, cancelled or refunded.
const isLiveItem = tx =>
  tx.attributes.lastTransition !== 'transition/request-payment' &&
  itemStatus(tx) !== SUBORDER_UNAVAILABLE;

/**
 * Give the use back for a checkout that failed — but only once the order
 * really has nothing paid left in it. The client asks for this, so it must
 * not be able to hand back the use of an order that went through.
 *
 * @returns {Promise<string>} 'ok' released, 'kept' order still live, 'noop'
 */
const releaseIfCheckoutFailed = async (redemptionId, { userId, integrationSdk }) => {
  const redemption = await getOwnRedemption(redemptionId, userId);
  if (redemption.status !== REDEMPTION_PENDING) return 'noop';
  const txs = await customerTransactionsSince(
    integrationSdk,
    redemption.userId,
    toTime(redemption.createdAt) - DAY_MS
  );
  if (groupItems(txs, redemption.orderGroupId).some(isLiveItem)) return 'kept';
  return releaseRedemption(redemptionId, { userId });
};

/**
 * Settle redemptions against what actually happened to their orders:
 * - pending past the grace period: used if an item was paid for and is
 *   still standing, otherwise released (the checkout never finished);
 * - used, where every item has since been declined or cancelled (including
 *   a cancel after acceptance): the use is given back, so the customer gets
 *   their promo again.
 *
 * @param {Array} redemptions
 * @param {Object} integrationSdk
 * @returns {Promise<number>} how many redemptions changed
 */
const reconcileRedemptions = async (redemptions, integrationSdk) => {
  const now = Date.now();
  const toCheck = redemptions.filter(r => {
    const age = now - toTime(r.createdAt);
    if (r.status === REDEMPTION_PENDING) return age > PENDING_GRACE_MS;
    return r.status === REDEMPTION_USED && age < RESTORE_WINDOW_MS;
  });
  if (toCheck.length === 0 || !integrationSdk) return 0;

  // One paged query per customer covers all of their orders.
  const byUser = toCheck.reduce((acc, r) => {
    acc[r.userId] = acc[r.userId] || [];
    acc[r.userId].push(r);
    return acc;
  }, {});

  let changed = 0;
  for (const [userId, userRedemptions] of Object.entries(byUser)) {
    let txs;
    try {
      const since = Math.min(...userRedemptions.map(r => toTime(r.createdAt))) - DAY_MS;
      txs = await customerTransactionsSince(integrationSdk, userId, since);
    } catch (e) {
      console.error('[promos] reconcile query failed:', e.message);
      continue;
    }

    for (const r of userRedemptions) {
      const items = groupItems(txs, r.orderGroupId);
      const allGone =
        items.length > 0 && items.every(tx => itemStatus(tx) === SUBORDER_UNAVAILABLE);

      let outcome = null;
      if (r.status === REDEMPTION_PENDING) {
        outcome = items.some(isLiveItem)
          ? await store.setRedemptionStatus({
              promoId: r.promoId,
              redemptionId: r.id,
              fromStatuses: [REDEMPTION_PENDING],
              toStatus: REDEMPTION_USED,
              giveBack: false,
              patch: { usedAt: new Date().toISOString() },
            })
          : await store.setRedemptionStatus({
              promoId: r.promoId,
              redemptionId: r.id,
              fromStatuses: [REDEMPTION_PENDING],
              toStatus: REDEMPTION_RELEASED,
              giveBack: true,
              patch: { releasedAt: new Date().toISOString() },
            });
      } else if (allGone) {
        outcome = await store.setRedemptionStatus({
          promoId: r.promoId,
          redemptionId: r.id,
          fromStatuses: [REDEMPTION_USED],
          toStatus: REDEMPTION_RESTORED,
          giveBack: true,
          patch: { restoredAt: new Date().toISOString() },
        });
      }
      if (outcome === 'ok') changed++;
    }
  }
  return changed;
};

const reconcileAllRedemptions = async integrationSdk => {
  const promos = await store.getAllPromos();
  const all = (await Promise.all(promos.map(p => store.getRedemptions(p.id)))).flat();
  return reconcileRedemptions(all, integrationSdk);
};

// ================ Gifts ================ //

/**
 * Gift a promo to one customer. Re-gifting the same promo replaces the
 * earlier gift.
 */
const giftPromo = async ({ promo, user, uses, expiresAt, message, note, giftedBy }) => {
  const userId = user.id;
  const baseUses = await store.getUserUses(promo.id, userId);
  const gift = {
    promoId: promo.id,
    userId,
    customerName: user.name || null,
    customerEmail: user.email || null,
    uses: toPositiveInt(uses, 1),
    baseUses,
    expiresAt: toIsoOrNull(expiresAt, { endOfDay: true }),
    message: String(message || '')
      .trim()
      .slice(0, 280),
    note: String(note || '')
      .trim()
      .slice(0, 500),
    giftedAt: new Date().toISOString(),
    giftedBy: giftedBy || null,
    emailSent: false,
    notificationSent: false,
    revokedAt: null,
  };
  await store.saveGift(gift);
  await store.saveUserPromoEntry(userId, promo.id, {
    source: 'gift',
    addedAt: gift.giftedAt,
    seenAt: null,
  });
  return gift;
};

const updateGift = async (promoId, userId, patch) => {
  const gift = await store.getGift(promoId, userId);
  if (!gift) return null;
  const updated = { ...gift, ...patch };
  await store.saveGift(updated);
  return updated;
};

/**
 * Take back a gift that hasn't been used. It disappears from the customer's
 * promos quietly; nothing is sent.
 */
const revokeGift = async (promoId, userId) => {
  const gift = await activeGift(promoId, userId);
  if (!gift) throw new PromoError(404, 'Gift not found');
  const userUses = await store.getUserUses(promoId, userId);
  if (userUses > (gift.baseUses || 0)) {
    throw new PromoError(409, 'This gift has already been used, so it can’t be revoked.');
  }
  await store.saveGift({ ...gift, revokedAt: new Date().toISOString() });
  await store.deleteUserPromoEntry(userId, promoId);
  // A personal code exists only for this gift.
  const promo = await store.getPromo(promoId);
  if (promo?.personal) await archivePromo(promoId);
};

const createPersonalPromo = async ({ user, uses, expiresAt, message, createdBy }) => {
  const firstName = (user.name || '').split(' ')[0];
  return createPromo(
    {
      code: await generateUniqueCode(),
      name: `Personal${firstName ? ` – ${user.name}` : ''}`,
      title: 'Free Delivery',
      message,
      audience: AUDIENCE_GIFTED,
      expiryType: expiresAt ? 'both' : 'uses',
      endsAt: expiresAt,
      maxUses: toPositiveInt(uses, 1),
      perCustomerLimit: toPositiveInt(uses, 1),
    },
    { createdBy, activate: true, personalFor: user.id }
  );
};

// ================ Customer: My Promos ================ //

const customerView = (promo, evaluation = {}) => ({
  id: promo.id,
  code: promo.code,
  title: promo.title,
  message: evaluation.gift?.message || promo.message || '',
  usesLeft: evaluation.usesLeft ?? null,
  expiresAt: evaluation.expiresAt ?? null,
});

/**
 * Save a public code from a flyer to My Promos before shopping.
 */
const savePromoForUser = async (code, userId) => {
  const promo = await findByCode(code);
  const result = await evaluate(promo, userId);
  if (!result.ok) return { ...result, code: normalizeCode(code) };
  const entries = await store.getUserPromoEntries(userId);
  if (!entries[promo.id]) {
    await store.saveUserPromoEntry(userId, promo.id, {
      source: 'saved',
      addedAt: new Date().toISOString(),
      // They typed it in, so there's nothing new to point out.
      seenAt: new Date().toISOString(),
    });
  }
  return { ok: true, promo: customerView(promo, result) };
};

/**
 * Everything for the My Promos page: active (usable now, soonest-expiring
 * first), used (with the order), and expired.
 */
const listForUser = async (userId, integrationSdk) => {
  // Settle this customer's open redemptions first, so a cancelled order's
  // promo shows up again here.
  let ownRedemptions = await store.getUserRedemptions(userId);
  if (await reconcileRedemptions(ownRedemptions, integrationSdk)) {
    ownRedemptions = await store.getUserRedemptions(userId);
  }

  const entries = await store.getUserPromoEntries(userId);
  const active = [];
  const expired = [];
  for (const [promoId, entry] of Object.entries(entries)) {
    const promo = await store.getPromo(promoId);
    if (!promo) continue;
    const result = await evaluate(promo, userId);
    const card = {
      ...customerView(promo, result),
      isNew: !entry.seenAt,
      addedAt: entry.addedAt,
    };
    if (result.ok) {
      active.push(card);
    } else if (
      [REASON_EXPIRED, REASON_LIMIT, REASON_INVALID].includes(result.reason) &&
      promo.state !== STATE_PAUSED
    ) {
      expired.push({ ...card, expiresAt: result.date || card.expiresAt });
    }
    // Used-up promos appear under Used; paused or not-yet-started ones wait.
  }

  active.sort((a, b) => {
    if (!a.expiresAt) return 1;
    if (!b.expiresAt) return -1;
    return toTime(a.expiresAt) - toTime(b.expiresAt);
  });

  const promosById = {};
  for (const r of ownRedemptions) {
    promosById[r.promoId] = promosById[r.promoId] || (await store.getPromo(r.promoId));
  }
  const used = ownRedemptions
    .filter(r => r.status === REDEMPTION_USED || r.status === REDEMPTION_PENDING)
    .map(r => ({
      id: r.id,
      code: r.code,
      title: promosById[r.promoId]?.title || 'Free Delivery',
      usedAt: r.usedAt || r.createdAt,
      transactionId: r.transactionId || null,
      deliveryFeeCents: r.deliveryFeeCents,
      currency: r.currency,
    }))
    .sort((a, b) => toTime(b.usedAt) - toTime(a.usedAt));

  return {
    active,
    used,
    expired,
    unseenCount: active.filter(p => p.isNew).length,
  };
};

const markSeen = async (userId, promoIds = null) => {
  const entries = await store.getUserPromoEntries(userId);
  const now = new Date().toISOString();
  await Promise.all(
    Object.entries(entries)
      .filter(([promoId, entry]) => !entry.seenAt && (!promoIds || promoIds.includes(promoId)))
      .map(([promoId, entry]) =>
        store.saveUserPromoEntry(userId, promoId, { ...entry, seenAt: now })
      )
  );
};

const unseenCount = async userId => {
  const entries = await store.getUserPromoEntries(userId);
  const unseen = Object.entries(entries).filter(([, entry]) => !entry.seenAt);
  let count = 0;
  for (const [promoId] of unseen) {
    const promo = await store.getPromo(promoId);
    if (promo && (await evaluate(promo, userId)).ok) count++;
  }
  return count;
};

// ================ Admin: views ================ //

const adminSummary = async promo => {
  const uses = await store.getUses(promo.id);
  return {
    ...promo,
    endsAt: effectiveEndsAt(promo),
    maxUses: effectiveMaxUses(promo),
    uses,
    status: promoStatus(promo, uses),
  };
};

const listPromosForAdmin = async () => {
  const promos = await store.getAllPromos();
  const summaries = await Promise.all(promos.map(adminSummary));
  return summaries.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
};

const promoDetailForAdmin = async (promoId, integrationSdk) => {
  const promo = await getPromoOrThrow(promoId);
  let redemptions = await store.getRedemptions(promoId);
  if (await reconcileRedemptions(redemptions, integrationSdk)) {
    redemptions = await store.getRedemptions(promoId);
  }
  const summary = await adminSummary(promo);
  const used = redemptions
    .filter(r => r.status === REDEMPTION_USED || r.status === REDEMPTION_PENDING)
    .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
  const gifts = await Promise.all(
    (await store.getGifts(promoId))
      .filter(g => !g.revokedAt)
      .map(async g => {
        const userUses = await store.getUserUses(promoId, g.userId);
        const usedOfGift = Math.max(0, userUses - (g.baseUses || 0));
        return { ...g, usesLeft: Math.max(0, g.uses - usedOfGift), used: usedOfGift > 0 };
      })
  );

  const endsAt = summary.endsAt;
  const daysLeft = endsAt
    ? Math.max(0, Math.ceil((toTime(endsAt) - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    promo: summary,
    stats: {
      timesUsed: used.length,
      usesLeft: summary.maxUses != null ? Math.max(0, summary.maxUses - summary.uses) : null,
      daysLeft,
      feesCoveredCents: used.reduce((sum, r) => sum + (r.deliveryFeeCents || 0), 0),
    },
    redemptions: used,
    gifts: gifts.sort((a, b) => toTime(b.giftedAt) - toTime(a.giftedAt)),
  };
};

/**
 * Every gift a customer holds, for their admin profile.
 */
const giftsForCustomer = async userId => {
  const entries = await store.getUserPromoEntries(userId);
  const results = [];
  for (const promoId of Object.keys(entries)) {
    const promo = await store.getPromo(promoId);
    const gift = await activeGift(promoId, userId);
    if (!promo || !gift) continue;
    const userUses = await store.getUserUses(promoId, userId);
    const usedOfGift = Math.max(0, userUses - (gift.baseUses || 0));
    results.push({
      ...gift,
      code: promo.code,
      title: promo.title,
      usesLeft: Math.max(0, gift.uses - usedOfGift),
      used: usedOfGift > 0,
    });
  }
  return results;
};

module.exports = {
  TIMEZONE,
  PromoError,
  AUDIENCE_PUBLIC,
  AUDIENCE_GIFTED,
  STATE_DRAFT,
  STATE_ACTIVE,
  STATE_PAUSED,
  STATE_ARCHIVED,
  REASON_INVALID,
  REASON_NOT_STARTED,
  REASON_EXPIRED,
  REASON_LIMIT,
  REASON_ALREADY_USED,
  REASON_NOT_YOURS,
  REASON_PICKUP,
  REASON_ALREADY_FREE,
  normalizeCode,
  generateUniqueCode,
  promoStatus,
  createPromo,
  updatePromo,
  setPromoState,
  duplicatePromo,
  archivePromo,
  deletePromo,
  evaluate,
  findByCode,
  checkForOrder,
  redeem,
  confirmRedemption,
  releaseRedemption,
  releaseIfCheckoutFailed,
  reconcileRedemptions,
  reconcileAllRedemptions,
  giftPromo,
  updateGift,
  revokeGift,
  createPersonalPromo,
  customerView,
  savePromoForUser,
  listForUser,
  markSeen,
  unseenCount,
  listPromosForAdmin,
  promoDetailForAdmin,
  giftsForCustomer,
  getPromoOrThrow,
};
