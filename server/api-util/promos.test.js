const os = require('os');
const path = require('path');
const fs = require('fs');

const dataPath = path.join(os.tmpdir(), `promos-test-${process.pid}.json`);
process.env.PROMO_DATA_PATH = dataPath;

const settingsStore = require('./settingsStore');
const store = require('./promoStore');
const promos = require('./promos');

// Runs against the file fallback by default. Set PROMO_TEST_REDIS_URL to run
// the same cases through the Redis Lua scripts (use a throwaway database: it
// is flushed between tests).
const redisUrl = process.env.PROMO_TEST_REDIS_URL;

beforeAll(async () => {
  if (redisUrl) {
    process.env.REDIS_URL = redisUrl;
    await settingsStore.init([]);
  }
});

const DAY = 24 * 60 * 60 * 1000;
const inDays = n => new Date(Date.now() + n * DAY).toISOString();

const basePromo = overrides => ({
  code: 'freesat',
  name: 'October launch',
  title: 'Free Delivery',
  message: 'On us for your next Saturday order',
  audience: 'public',
  expiryType: 'never',
  perCustomerLimit: 1,
  ...overrides,
});

const redeemFor = (code, userId, extra = {}) =>
  promos.redeem({
    code,
    userId,
    customerName: userId,
    orderGroupId: `og-${userId}-${Math.random()}`,
    deliveryFeeCents: 899,
    ...extra,
  });

beforeEach(async () => {
  try {
    fs.unlinkSync(dataPath);
  } catch (e) {
    // first run
  }
  store._resetFallback();
  if (redisUrl) await settingsStore.getRedisClient().flushDb();
});

afterAll(async () => {
  if (redisUrl) await settingsStore.getRedisClient().quit();
  try {
    fs.unlinkSync(dataPath);
  } catch (e) {
    // already gone
  }
});

describe('promo codes', () => {
  it('saves codes in capitals and finds them in any case', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    expect(promo.code).toBe('FREESAT');
    expect((await promos.findByCode(' freeSat ')).id).toBe(promo.id);
  });

  it('refuses a code that is already taken', async () => {
    await promos.createPromo(basePromo(), { activate: true });
    await expect(promos.createPromo(basePromo())).rejects.toThrow('already taken');
  });

  it('generates FF- codes', async () => {
    expect(await promos.generateUniqueCode()).toMatch(/^FF-[A-Z2-9]{4}$/);
  });
});

describe('eligibility', () => {
  it('gives each "won\'t work" reason', async () => {
    const check = code =>
      promos.checkForOrder({
        code,
        userId: 'u1',
        deliveryMethod: 'shipping',
        deliveryFeeCents: 899,
      });

    expect((await check('NOPE')).reason).toBe('invalid');

    await promos.createPromo(basePromo({ code: 'DRAFTY' }));
    expect((await check('DRAFTY')).reason).toBe('invalid');

    await promos.createPromo(basePromo({ code: 'LATER', startsAt: inDays(2) }), { activate: true });
    expect(await check('LATER')).toMatchObject({ reason: 'not-started' });

    await promos.createPromo(basePromo({ code: 'GONE', expiryType: 'date', endsAt: inDays(-1) }), {
      activate: true,
    });
    expect(await check('GONE')).toMatchObject({ reason: 'expired' });

    await promos.createPromo(basePromo({ code: 'MINE', audience: 'gifted' }), { activate: true });
    expect((await check('MINE')).reason).toBe('not-yours');

    await promos.createPromo(basePromo({ code: 'OPEN' }), { activate: true });
    expect(
      (await promos.checkForOrder({
        code: 'OPEN',
        userId: 'u1',
        deliveryMethod: 'pickup',
        deliveryFeeCents: null,
      })).reason
    ).toBe('pickup');
    expect(
      (await promos.checkForOrder({
        code: 'OPEN',
        userId: 'u1',
        deliveryMethod: 'shipping',
        deliveryFeeCents: 0,
      })).reason
    ).toBe('already-free');
    // The checkout applies whatever code comes back, so it must be there.
    expect(await check('open')).toMatchObject({ ok: true, code: 'OPEN', promo: { code: 'OPEN' } });
  });

  it("stops after the total uses and after each customer's own uses", async () => {
    await promos.createPromo(basePromo({ expiryType: 'uses', maxUses: 2 }), { activate: true });

    expect((await redeemFor('FREESAT', 'u1')).ok).toBe(true);
    expect(await redeemFor('FREESAT', 'u1')).toMatchObject({ ok: false, reason: 'already-used' });
    expect((await redeemFor('FREESAT', 'u2')).ok).toBe(true);
    expect(await redeemFor('FREESAT', 'u3')).toMatchObject({ ok: false, reason: 'limit' });
  });

  it('lets only one of two simultaneous buyers take the last use', async () => {
    await promos.createPromo(basePromo({ expiryType: 'uses', maxUses: 1 }), { activate: true });
    const results = await Promise.all([redeemFor('FREESAT', 'u1'), redeemFor('FREESAT', 'u2')]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
  });

  it('does not spend a promo when there is no fee to cover', async () => {
    await promos.createPromo(basePromo(), { activate: true });
    expect(await redeemFor('FREESAT', 'u1', { deliveryFeeCents: 0 })).toMatchObject({
      ok: false,
      reason: 'already-free',
    });
    expect((await redeemFor('FREESAT', 'u1')).ok).toBe(true);
  });
});

describe('redemptions', () => {
  it('gives the use back when a checkout fails, once', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    expect(await store.getUses(promo.id)).toBe(1);

    expect(await promos.releaseRedemption(redemption.id, { userId: 'u1' })).toBe('ok');
    expect(await promos.releaseRedemption(redemption.id, { userId: 'u1' })).toBe('noop');
    expect(await store.getUses(promo.id)).toBe(0);
    expect((await redeemFor('FREESAT', 'u1')).ok).toBe(true);
  });

  it('keeps the use once the order is confirmed', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    await promos.confirmRedemption(redemption.id, { userId: 'u1' });
    expect(await promos.releaseRedemption(redemption.id, { userId: 'u1' })).toBe('noop');
    expect(await store.getUses(promo.id)).toBe(1);
  });

  it("won't let another customer touch a redemption", async () => {
    await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    await expect(promos.releaseRedemption(redemption.id, { userId: 'u2' })).rejects.toThrow(
      'not found'
    );
  });

  it('restores the promo when every item of the order is declined', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    await promos.confirmRedemption(redemption.id, { userId: 'u1' });

    const integrationSdk = {
      transactions: {
        query: () =>
          Promise.resolve({
            data: {
              data: [
                {
                  attributes: {
                    lastTransition: 'transition/decline-order',
                    protectedData: { orderGroupId: redemption.orderGroupId },
                  },
                },
              ],
            },
          }),
      },
    };
    const used = await store.getRedemptions(promo.id);
    expect(await promos.reconcileRedemptions(used, integrationSdk)).toBe(1);
    expect(await store.getUses(promo.id)).toBe(0);
    expect((await redeemFor('FREESAT', 'u1')).ok).toBe(true);
  });
});

const txFor = (orderGroupId, lastTransition) => ({
  attributes: {
    lastTransition,
    createdAt: new Date().toISOString(),
    protectedData: { orderGroupId },
  },
});

const sdkWith = txs => ({
  transactions: {
    query: () => Promise.resolve({ data: { data: txs, meta: { totalPages: 1 } } }),
  },
});

describe('failed checkouts', () => {
  it('gives the use back only when nothing paid is left in the order', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    const group = redemption.orderGroupId;

    // An order that went through can't be released by the customer.
    expect(
      await promos.releaseIfCheckoutFailed(redemption.id, {
        userId: 'u1',
        integrationSdk: sdkWith([txFor(group, 'transition/confirm-payment')]),
      })
    ).toBe('kept');
    expect(await store.getUses(promo.id)).toBe(1);

    // Refunded or never paid: the use comes back.
    expect(
      await promos.releaseIfCheckoutFailed(redemption.id, {
        userId: 'u1',
        integrationSdk: sdkWith([
          txFor(group, 'transition/decline-order'),
          txFor(group, 'transition/request-payment'),
        ]),
      })
    ).toBe('ok');
    expect(await store.getUses(promo.id)).toBe(0);
  });

  it('restores the promo when accepted items are cancelled later', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    const { redemption } = await redeemFor('FREESAT', 'u1');
    await promos.confirmRedemption(redemption.id, { userId: 'u1' });
    const group = redemption.orderGroupId;

    const accepted = sdkWith([txFor(group, 'transition/accept-order')]);
    expect(await promos.reconcileRedemptions(await store.getRedemptions(promo.id), accepted)).toBe(
      0
    );

    const cancelled = sdkWith([txFor(group, 'transition/cancel')]);
    expect(await promos.reconcileRedemptions(await store.getRedemptions(promo.id), cancelled)).toBe(
      1
    );
    expect(await store.getUses(promo.id)).toBe(0);
  });
});

describe('gifts', () => {
  it('lets only the gifted customer use a gifted promo, and revokes quietly', async () => {
    const promo = await promos.createPromo(basePromo({ audience: 'gifted' }), { activate: true });
    await promos.giftPromo({
      promo,
      user: { id: 'u1', name: 'Sarah M' },
      uses: 2,
      expiresAt: inDays(30),
    });

    expect((await redeemFor('FREESAT', 'u2')).reason).toBe('not-yours');

    const list = await promos.listForUser('u1', null);
    expect(list.active).toHaveLength(1);
    expect(list.active[0]).toMatchObject({ code: 'FREESAT', usesLeft: 2, isNew: true });
    expect(list.unseenCount).toBe(1);

    await promos.markSeen('u1');
    expect((await promos.listForUser('u1', null)).unseenCount).toBe(0);

    await promos.revokeGift(promo.id, 'u1');
    expect((await promos.listForUser('u1', null)).active).toHaveLength(0);
    expect((await redeemFor('FREESAT', 'u1')).reason).toBe('not-yours');
  });

  it("won't revoke a gift that has been used", async () => {
    const promo = await promos.createPromo(basePromo({ audience: 'gifted' }), { activate: true });
    await promos.giftPromo({ promo, user: { id: 'u1' }, uses: 1 });
    await redeemFor('FREESAT', 'u1');
    await expect(promos.revokeGift(promo.id, 'u1')).rejects.toThrow('already been used');
  });

  it("adds a gift's uses on top of what the customer already used", async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    await redeemFor('FREESAT', 'u1');
    expect((await redeemFor('FREESAT', 'u1')).reason).toBe('already-used');
    await promos.giftPromo({ promo, user: { id: 'u1' }, uses: 1 });
    expect((await redeemFor('FREESAT', 'u1')).ok).toBe(true);
  });

  it('expires a gift on its own date', async () => {
    const promo = await promos.createPromo(basePromo(), { activate: true });
    await promos.giftPromo({ promo, user: { id: 'u1' }, uses: 1, expiresAt: inDays(-1) });
    expect((await redeemFor('FREESAT', 'u1')).reason).toBe('expired');
  });

  it('creates a one-time personal code', async () => {
    const promo = await promos.createPersonalPromo({
      user: { id: 'u1', name: 'Sarah M' },
      uses: 1,
      expiresAt: inDays(30),
    });
    expect(promo).toMatchObject({ audience: 'gifted', personal: true, state: 'active' });
    await promos.giftPromo({ promo, user: { id: 'u1' }, uses: 1, expiresAt: inDays(30) });
    expect((await redeemFor(promo.code, 'u1')).ok).toBe(true);
    expect((await redeemFor(promo.code, 'u1')).ok).toBe(false);
  });
});

describe('editing rules', () => {
  it("locks the code once used, and keeps limits above what's used", async () => {
    const promo = await promos.createPromo(basePromo({ expiryType: 'uses', maxUses: 5 }), {
      activate: true,
    });
    await redeemFor('FREESAT', 'u1');
    await redeemFor('FREESAT', 'u2');

    await expect(promos.updatePromo(promo.id, { code: 'NEWCODE' })).rejects.toThrow('Duplicate');
    await expect(promos.updatePromo(promo.id, { maxUses: 1 })).rejects.toThrow('already been used');
    const updated = await promos.updatePromo(promo.id, { maxUses: 10, title: 'Free Saturday' });
    expect(updated).toMatchObject({ maxUses: 10, title: 'Free Saturday' });

    await expect(promos.deletePromo(promo.id)).rejects.toThrow('archived');
    await promos.archivePromo(promo.id);
    expect((await redeemFor('FREESAT', 'u3')).reason).toBe('invalid');
  });

  it('never frees a code that another promo has since taken', async () => {
    const old = await promos.createPromo(basePromo(), { activate: true });
    await promos.archivePromo(old.id);
    const replacement = await promos.createPromo(basePromo(), { activate: true });

    await expect(promos.deletePromo(old.id)).rejects.toThrow('kept for order history');
    await promos.archivePromo(old.id);
    expect((await promos.findByCode('FREESAT')).id).toBe(replacement.id);
  });

  it('reports status for the admin list', async () => {
    const now = Date.now();
    const p = basePromo();
    expect(promos.promoStatus({ ...p, state: 'draft' }, 0, now)).toBe('draft');
    expect(promos.promoStatus({ ...p, state: 'active', startsAt: inDays(1) }, 0, now)).toBe(
      'scheduled'
    );
    expect(promos.promoStatus({ ...p, state: 'paused' }, 0, now)).toBe('paused');
    expect(
      promos.promoStatus({ ...p, state: 'active', expiryType: 'uses', maxUses: 3 }, 3, now)
    ).toBe('expired');
    expect(promos.promoStatus({ ...p, state: 'active' }, 3, now)).toBe('active');
  });
});
