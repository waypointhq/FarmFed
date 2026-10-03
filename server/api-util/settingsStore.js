const fs = require('fs');
const path = require('path');

// Heroku's dyno filesystem is ephemeral — writes to server/data/*.json
// disappear on restart. This module stores admin settings in Redis (when
// REDIS_URL is set) and mirrors them to the JSON files so local dev still
// works without Redis.

const DATA_DIR = path.resolve(__dirname, '../data');
const REDIS_KEY_PREFIX = 'farmfed:settings:';

let redisClient = null;
const cache = {};

const filePath = namespace => path.join(DATA_DIR, `${namespace}.json`);

const loadFromFile = namespace => {
  try {
    return JSON.parse(fs.readFileSync(filePath(namespace), 'utf8'));
  } catch (e) {
    return null;
  }
};

const saveToFile = (namespace, data) => {
  try {
    fs.writeFileSync(filePath(namespace), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // Read-only FS in some hosting environments — fine as long as Redis is up.
  }
};

const init = async (namespaces = []) => {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const { createClient } = require('redis');
      const useTls = url.startsWith('rediss://');
      redisClient = createClient({
        url,
        socket: useTls ? { tls: true, rejectUnauthorized: false } : undefined,
      });
      redisClient.on('error', err => console.error('[settingsStore] Redis error:', err.message));
      await redisClient.connect();
      console.log('[settingsStore] Redis connected');
    } catch (e) {
      console.error('[settingsStore] Redis connect failed, using file fallback:', e.message);
      redisClient = null;
    }
  } else {
    console.log('[settingsStore] No REDIS_URL set — using JSON file fallback (ephemeral on Heroku).');
  }

  for (const ns of namespaces) {
    let value = null;

    if (redisClient) {
      try {
        const raw = await redisClient.get(REDIS_KEY_PREFIX + ns);
        if (raw) value = JSON.parse(raw);
      } catch (e) {
        console.error(`[settingsStore] hydrate ${ns} from Redis failed:`, e.message);
      }
    }

    if (!value) {
      const fileValue = loadFromFile(ns);
      if (fileValue) {
        value = fileValue;
        if (redisClient) {
          try {
            await redisClient.set(REDIS_KEY_PREFIX + ns, JSON.stringify(value));
          } catch (e) {
            console.error(`[settingsStore] seed ${ns} to Redis failed:`, e.message);
          }
        }
      }
    }

    if (value) cache[ns] = value;
  }
};

const get = namespace => cache[namespace] || null;

const set = async (namespace, data) => {
  cache[namespace] = data;
  if (redisClient) {
    try {
      await redisClient.set(REDIS_KEY_PREFIX + namespace, JSON.stringify(data));
    } catch (e) {
      console.error(`[settingsStore] Redis set ${namespace} failed:`, e.message);
    }
  }
  saveToFile(namespace, data);
};

const isRedisConnected = () => !!redisClient;

// For stores that need atomic operations (e.g. promo usage limits) rather than
// whole-value reads and writes. null when running on the file fallback.
const getRedisClient = () => redisClient;

module.exports = { init, get, set, isRedisConnected, getRedisClient };
