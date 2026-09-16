const crypto = require('crypto');
const { getIntegrationSdk } = require('../api-util/sdk');
const { isConfigured } = require('../api-util/onfleet');

/**
 * OnFleet signs every webhook: `x-onfleet-signature` is the hex HMAC-SHA512 of
 * the RAW request body, keyed with the secret OnFleet returns when the webhook
 * is created. Without this check the endpoint is a money lever — a stranger who
 * guesses a transactionId can POST a taskCompleted event and transition that
 * transaction to "delivered", which is what releases funds to the provider.
 *
 * It is enforced the moment ONFLEET_WEBHOOK_SECRET is set. While it is unset
 * the request is still processed, because failing closed on a secret that has
 * never been provisioned would stop real deliveries from ever being marked
 * delivered — but it logs at error level on EVERY call so the gap is alarmable
 * rather than silent. Set the secret and the endpoint is closed.
 */
const verifySignature = (rawBody, signature) => {
  const secret = process.env.ONFLEET_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      'onfleet-webhook: ONFLEET_WEBHOOK_SECRET is not set — accepting an UNVERIFIED webhook. ' +
        'Anyone who can reach this URL can mark a transaction delivered.'
    );
    return true;
  }
  if (!signature) return false;
  // OnFleet's secret is hex; the HMAC is keyed with those BYTES, not the text.
  const key = /^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0
    ? Buffer.from(secret, 'hex')
    : Buffer.from(secret, 'utf8');
  const expected = crypto.createHmac('sha512', key).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  // Length has to match before timingSafeEqual, which throws on a mismatch.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// OnFleet webhook trigger IDs
// 0 = taskStart, 1 = taskETA, 2 = taskArrival, 3 = taskCompleted, 4 = taskFailed
const TRIGGER_TASK_COMPLETED = 3;

/**
 * POST /api/onfleet-webhook
 *
 * Receives webhook callbacks from OnFleet when task status changes.
 * On task completion (triggerId=3), transitions the linked Sharetribe
 * transaction to "delivered" via operator-mark-delivered (requires Integration API).
 *
 * OnFleet webhook payload:
 * {
 *   triggerId: number,
 *   taskId: string,
 *   data: { task: { metadata: [{ name, type, value }], ... } }
 * }
 *
 * Also handles OnFleet's webhook validation check:
 * OnFleet sends a check value — we respond 200 with it to confirm.
 */
module.exports = async (req, res) => {
  try {
    // If OnFleet is not configured, silently accept the webhook
    if (!isConfigured()) {
      return res.status(200).json({ ok: true });
    }

    // `apiRouter` gives this route a RAW body so the signature can be checked
    // against the exact bytes OnFleet signed.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    if (!verifySignature(rawBody, req.get('x-onfleet-signature'))) {
      console.warn('onfleet-webhook: rejected — bad or missing signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let body;
    try {
      body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : null;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // OnFleet validation: if no body or just a check field, respond 200
    if (!body || body.check) {
      return res.status(200).json(body?.check || 'ok');
    }

    const { triggerId, data } = body;

    // Only process task completion events
    if (triggerId !== TRIGGER_TASK_COMPLETED) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Extract transactionId from task metadata
    const taskMetadata = data?.task?.metadata || [];
    const txMeta = taskMetadata.find(m => m.name === 'transactionId');
    const transactionId = txMeta?.value;

    if (!transactionId) {
      console.warn('onfleet-webhook: No transactionId in task metadata');
      return res.status(200).json({ ok: true, warning: 'no transactionId' });
    }

    // Transition the transaction to delivered via Integration SDK.
    // This requires Integration API access enabled in Sharetribe Console
    // (Build -> Applications -> enable Integration API for your client).
    try {
      const integrationSdk = getIntegrationSdk();
      await integrationSdk.transactions.transition({
        id: transactionId,
        transition: 'transition/operator-mark-delivered',
        params: {},
      });
      console.log(`onfleet-webhook: Transaction ${transactionId} marked as delivered`);
    } catch (integrationErr) {
      // Integration API may not be available (403).
      // Log so the operator can mark it delivered manually.
      console.error(
        'onfleet-webhook: Could not auto-transition %s to delivered.', transactionId,
        `Mark it manually in Sharetribe Console. Error: ${integrationErr.message}`
      );
      return res.status(200).json({
        ok: false,
        transactionId,
        warning: 'Integration API unavailable — mark delivered manually in Console',
      });
    }

    return res.status(200).json({ ok: true, transactionId });
  } catch (e) {
    console.error('onfleet-webhook error:', e);
    // Always respond 200 to prevent OnFleet from retrying endlessly
    return res.status(200).json({ ok: false, error: e.message });
  }
};
