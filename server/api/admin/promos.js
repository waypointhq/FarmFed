const moment = require('moment-timezone');
const { getSdk, getIntegrationSdk, handleError } = require('../../api-util/sdk');
const { isAdminUser } = require('../../api-util/admin');
const { isEmailConfigured } = require('../../api-util/email');
const promos = require('../../api-util/promos');
const { sendGiftEmail, sendGiftNotification } = require('../../api-util/promoNotify');

/**
 * Admin Promotions: create and manage free-delivery promos, gift them to
 * customers, and revoke unused gifts. Admin-only.
 */

const DEFAULT_GIFT_DAYS = 30;

const requireAdmin = async (req, res) => {
  const response = await getSdk(req, res).currentUser.show({ include: [] });
  const user = response.data.data;
  if (!isAdminUser(user)) {
    res.status(403).json({ error: 'Forbidden: admin access required' });
    return null;
  }
  return { id: user.id.uuid, name: user.attributes.profile.displayName };
};

const sendError = (res, e) => {
  if (e instanceof promos.PromoError) {
    return res.status(e.status).json({ error: e.message });
  }
  return handleError(res, e);
};

// Wraps a handler with the admin check and error handling.
const adminHandler = fn => async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    await fn(req, res, admin);
  } catch (e) {
    sendError(res, e);
  }
};

const userSummary = user => {
  const profile = user.attributes?.profile || {};
  return {
    id: user.id.uuid,
    name:
      profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || '',
    email: user.attributes?.email || '',
    userType: profile.publicData?.userType || null,
  };
};

// Customer search reads every user (Sharetribe can't search by name or
// email), so the list is kept for a minute between keystrokes.
const USERS_TTL_MS = 60 * 1000;
let usersCache = null;

const allUsers = async () => {
  if (usersCache && Date.now() - usersCache.at < USERS_TTL_MS) return usersCache.users;
  const integrationSdk = getIntegrationSdk();
  const users = [];
  let page = 1;
  while (true) {
    const response = await integrationSdk.users.query({ perPage: 100, page });
    const batch = response.data.data || [];
    batch
      .filter(u => !['banned', 'deleted'].includes(u.attributes?.state))
      .forEach(u => users.push(userSummary(u)));
    const totalPages = response.data.meta?.totalPages || 1;
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }
  usersCache = { at: Date.now(), users };
  return users;
};

/**
 * GET /api/admin/promos
 */
const list = adminHandler(async (req, res) => {
  res.status(200).json({
    promos: await promos.listPromosForAdmin(),
    emailConfigured: isEmailConfigured(),
  });
});

/**
 * GET /api/admin/promos/generate-code
 */
const generateCode = adminHandler(async (req, res) => {
  res.status(200).json({ code: await promos.generateUniqueCode() });
});

/**
 * POST /api/admin/promos { ...fields, activate }
 */
const create = adminHandler(async (req, res, admin) => {
  const body = req.body || {};
  const promo = await promos.createPromo(body, {
    createdBy: admin.name,
    activate: body.activate === true,
  });
  res.status(201).json({ promo });
});

/**
 * GET /api/admin/promos/:id
 */
const show = adminHandler(async (req, res) => {
  let integrationSdk = null;
  try {
    integrationSdk = getIntegrationSdk();
  } catch (e) {
    // Detail still renders; cancelled orders just aren't settled this time.
  }
  res.status(200).json(await promos.promoDetailForAdmin(req.params.id, integrationSdk));
});

/**
 * PUT /api/admin/promos/:id { ...fields, state? }
 */
const update = adminHandler(async (req, res) => {
  res.status(200).json({ promo: await promos.updatePromo(req.params.id, req.body || {}) });
});

/**
 * POST /api/admin/promos/:id/state { state: 'active' | 'paused' }
 */
const setState = adminHandler(async (req, res) => {
  const { state } = req.body || {};
  if (state !== promos.STATE_ACTIVE && state !== promos.STATE_PAUSED) {
    return res.status(400).json({ error: 'state must be active or paused' });
  }
  res.status(200).json({ promo: await promos.setPromoState(req.params.id, state) });
});

/**
 * POST /api/admin/promos/:id/duplicate
 */
const duplicate = adminHandler(async (req, res, admin) => {
  res
    .status(201)
    .json({ promo: await promos.duplicatePromo(req.params.id, { createdBy: admin.name }) });
});

/**
 * POST /api/admin/promos/:id/archive
 */
const archive = adminHandler(async (req, res) => {
  res.status(200).json({ promo: await promos.archivePromo(req.params.id) });
});

/**
 * DELETE /api/admin/promos/:id — only promos that were never used.
 */
const remove = adminHandler(async (req, res) => {
  await promos.deletePromo(req.params.id);
  res.status(200).json({ ok: true });
});

/**
 * POST /api/admin/promos/gift
 * { promoId ('new' for a personal code), userIds, uses, expiresAt, message,
 *   note, sendEmail, sendNotification }
 *
 * The email and the in-app/push notification go out straight away; the
 * result says, per customer, whether each one did.
 */
const gift = adminHandler(async (req, res, admin) => {
  const {
    promoId,
    userIds = [],
    uses = 1,
    expiresAt,
    message,
    note,
    sendEmail = true,
    sendNotification = true,
  } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'Pick at least one customer.' });
  }
  const isNewPersonal = !promoId || promoId === 'new';
  const existing = isNewPersonal ? null : await promos.getPromoOrThrow(promoId);
  if (existing && ![promos.STATE_ACTIVE].includes(existing.state)) {
    return res.status(409).json({ error: 'Only active promos can be gifted.' });
  }
  // Left out: 30 days from today, Central. Sent empty: the gift itself
  // doesn't expire (the promo's own end date still applies).
  const giftExpiry =
    expiresAt === undefined
      ? moment
          .tz(promos.TIMEZONE)
          .add(DEFAULT_GIFT_DAYS, 'days')
          .format('YYYY-MM-DD')
      : expiresAt || null;

  const integrationSdk = getIntegrationSdk();
  const sdk = getSdk(req, res);
  const results = [];
  for (const userId of userIds) {
    const userResponse = await integrationSdk.users.show({ id: userId });
    const user = userSummary(userResponse.data.data);

    const promo =
      existing ||
      (await promos.createPersonalPromo({
        user,
        uses,
        expiresAt: giftExpiry,
        message,
        createdBy: admin.name,
      }));
    let giftRecord = await promos.giftPromo({
      promo,
      user,
      uses,
      expiresAt: giftExpiry,
      message,
      note,
      giftedBy: admin.name,
    });

    const emailSent = sendEmail
      ? await sendGiftEmail({ sdk, to: user.email, promo, gift: giftRecord })
      : false;
    const notificationSent = sendNotification
      ? await sendGiftNotification({ userId, promo }).catch(e => {
          console.error('[admin/promos] notification failed:', e.message);
          return false;
        })
      : false;
    giftRecord = await promos.updateGift(promo.id, userId, { emailSent, notificationSent });

    results.push({
      userId,
      name: user.name,
      promoId: promo.id,
      code: promo.code,
      emailSent,
      notificationSent,
    });
  }
  res.status(200).json({ results, emailConfigured: isEmailConfigured() });
});

/**
 * POST /api/admin/promos/:id/revoke { userId } — unused gifts only; the
 * customer isn't told.
 */
const revoke = adminHandler(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  await promos.revokeGift(req.params.id, userId);
  res.status(200).json({ ok: true });
});

/**
 * GET /api/admin/customers?q= — search customers by name or email.
 */
const searchCustomers = adminHandler(async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .toLowerCase();
  if (q.length < 2) return res.status(200).json({ customers: [] });
  const customers = (await allUsers())
    .filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .slice(0, 20);
  res.status(200).json({ customers });
});

/**
 * GET /api/admin/customers/:id/promos — the customer's gifts, for revoking
 * from their profile.
 */
const customerPromos = adminHandler(async (req, res) => {
  const integrationSdk = getIntegrationSdk();
  const userResponse = await integrationSdk.users.show({ id: req.params.id });
  res.status(200).json({
    customer: userSummary(userResponse.data.data),
    gifts: await promos.giftsForCustomer(req.params.id),
  });
});

module.exports = {
  list,
  generateCode,
  create,
  show,
  update,
  setState,
  duplicate,
  archive,
  remove,
  gift,
  revoke,
  searchCustomers,
  customerPromos,
};
