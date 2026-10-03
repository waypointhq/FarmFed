/* eslint-disable no-console */
//
// Reconcile standalone delivery transactions.
//
// Scans every open delivery transaction (default-delivery process, `paid`
// state) and, based on its linked item transactions:
//   - refunds the delivery in full if EVERY item was denied
//     (declined / auto-declined / payment-expired), or
//   - captures the delivery payment once at least one item is accepted.
//
// This is the robust backstop for the "delivery is only kicked back when the
// whole order is denied" rule — it catches the 24h auto-declines that never
// ping the server. Run it on a schedule (see comment below).
//
// It also settles free-delivery promo uses the same way: a promo order whose
// items were all declined or cancelled gets its promo back, and a use left
// pending by an abandoned checkout is released.
//
// Usage:
//   node scripts/reconcile-deliveries.js
//
// Requires Integration API credentials in the environment (the same ones
// server/api-util/sdk.js uses):
//   INTEGRATION_CLIENT_ID, INTEGRATION_CLIENT_SECRET
//
// Schedule it however your host supports, e.g.:
//   - Render / Heroku Scheduler: `node scripts/reconcile-deliveries.js` every 15 min
//   - crontab:  */15 * * * *  cd /app && node scripts/reconcile-deliveries.js
//   - or hit POST /api/reconcile-delivery (no body) from an uptime pinger.
require('dotenv').config();

const { getIntegrationSdk } = require('../server/api-util/sdk');
const { reconcileAllOpenDeliveries } = require('../server/api-util/deliveryReconcile');
const settingsStore = require('../server/api-util/settingsStore');
const { reconcileAllRedemptions } = require('../server/api-util/promos');

(async () => {
  const integrationSdk = getIntegrationSdk();
  const results = await reconcileAllOpenDeliveries(integrationSdk);

  const summary = results.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] || 0) + 1;
    return acc;
  }, {});

  console.log(`Reconciled ${results.length} delivery order(s):`, JSON.stringify(summary));
  results
    .filter(r => r.action === 'refunded' || r.action === 'captured' || r.action === 'error')
    .forEach(r => console.log(' -', JSON.stringify(r)));

  // Promo storage lives in Redis; connect, settle, and let the process exit.
  await settingsStore.init([]);
  const promoChanges = await reconcileAllRedemptions(integrationSdk);
  console.log(`Settled ${promoChanges} promo use(s).`);
  const redis = settingsStore.getRedisClient();
  if (redis) await redis.quit();
})().catch(e => {
  console.error('FATAL reconcile-deliveries:', e.message);
  process.exit(1);
});
