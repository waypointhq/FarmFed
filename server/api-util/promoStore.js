const fs = require('fs');
const path = require('path');
const settingsStore = require('./settingsStore');

/**
 * Storage for free-delivery promos.
 *
 * Promos need two things the whole-value settingsStore can't give: changes
 * that show up on every dyno immediately (no per-process cache), and usage
 * limits that hold when two buyers grab the last use at the same moment. In
 * production everything lives in Redis and every use is counted by a Lua
 * script, which Redis runs atomically. Without Redis (local dev) the same
 * operations run against an in-memory copy mirrored to server/data/promos.json;
 * a single Node process makes those atomic too.
 *
 * Keys (all under farmfed:promo:):
 *   promos               hash  promoId -> promo JSON
 *   codes                hash  CODE -> promoId
 *   uses:<promoId>       int   uses counted so far (pending + used)
 *   user-uses:<promoId>  hash  userId -> uses by that customer
 *   redemptions:<promoId> hash redemptionId -> redemption JSON
 *   redemption-index     hash  redemptionId -> promoId
 *   gifts:<promoId>      hash  userId -> gift JSON
 *   user:<userId>        hash  promoId -> { source, addedAt, seenAt } (My Promos)
 *   user-redemptions:<userId> hash redemptionId -> promoId
 */

const PREFIX = 'farmfed:promo:';
const DATA_PATH = process.env.PROMO_DATA_PATH || path.resolve(__dirname, '../data/promos.json');

const keys = {
  promos: () => `${PREFIX}promos`,
  codes: () => `${PREFIX}codes`,
  uses: promoId => `${PREFIX}uses:${promoId}`,
  userUses: promoId => `${PREFIX}user-uses:${promoId}`,
  redemptions: promoId => `${PREFIX}redemptions:${promoId}`,
  redemptionIndex: () => `${PREFIX}redemption-index`,
  gifts: promoId => `${PREFIX}gifts:${promoId}`,
  user: userId => `${PREFIX}user:${userId}`,
  userRedemptions: userId => `${PREFIX}user-redemptions:${userId}`,
};

// Count one use, unless the promo's total limit or the customer's own limit is
// already reached, and record the redemption — all in one atomic step.
// KEYS: uses, user-uses, redemptions, redemption-index, user-redemptions
// ARGV: userId, maxUses (-1 = unlimited), userLimit, redemptionId, redemptionJSON, promoId
const RESERVE_SCRIPT = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local mine = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
local maxUses = tonumber(ARGV[2])
if maxUses >= 0 and total >= maxUses then return 'limit' end
if mine >= tonumber(ARGV[3]) then return 'user-limit' end
redis.call('INCR', KEYS[1])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
redis.call('HSET', KEYS[4], ARGV[4], ARGV[6])
redis.call('HSET', KEYS[5], ARGV[4], ARGV[6])
return 'ok'
`;

// Move a redemption from one of `fromStatuses` to `toStatus`, giving the use
// back when asked. Doing the status check and the counter change together
// means a release racing a confirm (or two releases) can't double-count.
// KEYS: uses, user-uses, redemptions
// ARGV: redemptionId, fromStatuses (comma separated), toStatus, giveBack (1/0), patchJSON
const SET_STATUS_SCRIPT = `
local raw = redis.call('HGET', KEYS[3], ARGV[1])
if not raw then return 'missing' end
local r = cjson.decode(raw)
local allowed = false
for s in string.gmatch(ARGV[2], '[^,]+') do
  if r.status == s then allowed = true end
end
if not allowed then return 'noop' end
local patch = cjson.decode(ARGV[5])
for k, v in pairs(patch) do r[k] = v end
r.status = ARGV[3]
redis.call('HSET', KEYS[3], ARGV[1], cjson.encode(r))
if ARGV[4] == '1' then
  local total = tonumber(redis.call('GET', KEYS[1]) or '0')
  if total > 0 then redis.call('DECR', KEYS[1]) end
  local mine = tonumber(redis.call('HGET', KEYS[2], r.userId) or '0')
  if mine > 0 then redis.call('HINCRBY', KEYS[2], r.userId, -1) end
end
return 'ok'
`;

const parse = raw => {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

const parseHash = hash =>
  Object.entries(hash || {}).reduce((acc, [field, raw]) => {
    const value = parse(raw);
    if (value != null) acc[field] = value;
    return acc;
  }, {});

// ================ Redis backend ================ //

const redisBackend = client => ({
  hget: async (key, field) => parse(await client.hGet(key, field)),
  hgetRaw: (key, field) => client.hGet(key, field),
  hgetall: async key => parseHash(await client.hGetAll(key)),
  hgetallRaw: key => client.hGetAll(key),
  hset: (key, field, value) => client.hSet(key, field, JSON.stringify(value)),
  hsetRaw: (key, field, value) => client.hSet(key, field, value),
  hdel: (key, field) => client.hDel(key, field),
  getInt: async key => parseInt((await client.get(key)) || '0', 10),
  reserve: ({ promoId, userId, maxUses, userLimit, redemption }) =>
    client.eval(RESERVE_SCRIPT, {
      keys: [
        keys.uses(promoId),
        keys.userUses(promoId),
        keys.redemptions(promoId),
        keys.redemptionIndex(),
        keys.userRedemptions(userId),
      ],
      arguments: [
        userId,
        String(maxUses == null ? -1 : maxUses),
        String(userLimit),
        redemption.id,
        JSON.stringify(redemption),
        promoId,
      ],
    }),
  setRedemptionStatus: ({ promoId, redemptionId, fromStatuses, toStatus, giveBack, patch }) =>
    client.eval(SET_STATUS_SCRIPT, {
      keys: [keys.uses(promoId), keys.userUses(promoId), keys.redemptions(promoId)],
      arguments: [
        redemptionId,
        fromStatuses.join(','),
        toStatus,
        giveBack ? '1' : '0',
        JSON.stringify(patch || {}),
      ],
    }),
});

// ================ File backend (local dev) ================ //

const fileBackend = () => {
  let db;
  const load = () => {
    if (db) return db;
    try {
      db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch (e) {
      db = {};
    }
    return db;
  };
  const save = () => {
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
      // Read-only filesystem: the in-memory copy still works for this process.
    }
  };
  const hash = key => {
    const d = load();
    d[key] = d[key] || {};
    return d[key];
  };

  return {
    hget: async (key, field) => parse(hash(key)[field]),
    hgetRaw: async (key, field) => hash(key)[field] ?? null,
    hgetall: async key => parseHash(hash(key)),
    hgetallRaw: async key => ({ ...hash(key) }),
    hset: async (key, field, value) => {
      hash(key)[field] = JSON.stringify(value);
      save();
    },
    hsetRaw: async (key, field, value) => {
      hash(key)[field] = value;
      save();
    },
    hdel: async (key, field) => {
      delete hash(key)[field];
      save();
    },
    getInt: async key => parseInt(load()[key] || '0', 10),
    reserve: async ({ promoId, userId, maxUses, userLimit, redemption }) => {
      const d = load();
      const total = parseInt(d[keys.uses(promoId)] || '0', 10);
      const userUses = hash(keys.userUses(promoId));
      const mine = parseInt(userUses[userId] || '0', 10);
      if (maxUses != null && total >= maxUses) return 'limit';
      if (mine >= userLimit) return 'user-limit';
      d[keys.uses(promoId)] = String(total + 1);
      userUses[userId] = String(mine + 1);
      hash(keys.redemptions(promoId))[redemption.id] = JSON.stringify(redemption);
      hash(keys.redemptionIndex())[redemption.id] = promoId;
      hash(keys.userRedemptions(userId))[redemption.id] = promoId;
      save();
      return 'ok';
    },
    setRedemptionStatus: async ({
      promoId,
      redemptionId,
      fromStatuses,
      toStatus,
      giveBack,
      patch,
    }) => {
      const d = load();
      const redemptions = hash(keys.redemptions(promoId));
      const r = parse(redemptions[redemptionId]);
      if (!r) return 'missing';
      if (!fromStatuses.includes(r.status)) return 'noop';
      redemptions[redemptionId] = JSON.stringify({ ...r, ...(patch || {}), status: toStatus });
      if (giveBack) {
        const total = parseInt(d[keys.uses(promoId)] || '0', 10);
        if (total > 0) d[keys.uses(promoId)] = String(total - 1);
        const userUses = hash(keys.userUses(promoId));
        const mine = parseInt(userUses[r.userId] || '0', 10);
        if (mine > 0) userUses[r.userId] = String(mine - 1);
      }
      save();
      return 'ok';
    },
  };
};

let fallback = null;
const backend = () => {
  const client = settingsStore.getRedisClient();
  if (client) return redisBackend(client);
  fallback = fallback || fileBackend();
  return fallback;
};

// ================ Public API ================ //

const getPromo = promoId => backend().hget(keys.promos(), promoId);
const getAllPromos = async () => Object.values(await backend().hgetall(keys.promos()));
const savePromo = promo => backend().hset(keys.promos(), promo.id, promo);
const deletePromo = promoId => backend().hdel(keys.promos(), promoId);

const getPromoIdByCode = code => backend().hgetRaw(keys.codes(), code);
const setCode = (code, promoId) => backend().hsetRaw(keys.codes(), code, promoId);
const deleteCode = code => backend().hdel(keys.codes(), code);

const getUses = promoId => backend().getInt(keys.uses(promoId));
const getUserUses = async (promoId, userId) =>
  parseInt((await backend().hgetRaw(keys.userUses(promoId), userId)) || '0', 10);

const getRedemptions = async promoId =>
  Object.values(await backend().hgetall(keys.redemptions(promoId)));
const getRedemption = async redemptionId => {
  const promoId = await backend().hgetRaw(keys.redemptionIndex(), redemptionId);
  if (!promoId) return null;
  return backend().hget(keys.redemptions(promoId), redemptionId);
};
const getUserRedemptions = async userId => {
  const index = await backend().hgetallRaw(keys.userRedemptions(userId));
  const results = await Promise.all(
    Object.entries(index || {}).map(([redemptionId, promoId]) =>
      backend().hget(keys.redemptions(promoId), redemptionId)
    )
  );
  return results.filter(Boolean);
};

const reserveUse = params => backend().reserve(params);
const setRedemptionStatus = params => backend().setRedemptionStatus(params);

const getGifts = async promoId => Object.values(await backend().hgetall(keys.gifts(promoId)));
const getGift = (promoId, userId) => backend().hget(keys.gifts(promoId), userId);
const saveGift = gift => backend().hset(keys.gifts(gift.promoId), gift.userId, gift);

const getUserPromoEntries = userId => backend().hgetall(keys.user(userId));
const saveUserPromoEntry = (userId, promoId, entry) =>
  backend().hset(keys.user(userId), promoId, entry);
const deleteUserPromoEntry = (userId, promoId) => backend().hdel(keys.user(userId), promoId);

module.exports = {
  getPromo,
  getAllPromos,
  savePromo,
  deletePromo,
  getPromoIdByCode,
  setCode,
  deleteCode,
  getUses,
  getUserUses,
  getRedemptions,
  getRedemption,
  getUserRedemptions,
  reserveUse,
  setRedemptionStatus,
  getGifts,
  getGift,
  saveGift,
  getUserPromoEntries,
  saveUserPromoEntry,
  deleteUserPromoEntry,
  // Exposed for tests.
  _resetFallback: () => {
    fallback = null;
  },
};
