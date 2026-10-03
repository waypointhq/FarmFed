/**
 * Outgoing email through Resend (https://resend.com).
 *
 * Sharetribe's built-in emails only go to the two parties of a transaction,
 * so anything else (e.g. a gifted promo) is sent from here.
 *
 * Env:
 *   RESEND_API_KEY  required; without it nothing is sent and callers get
 *                   { sent: false, reason: 'not-configured' }
 *   EMAIL_FROM      sender, e.g. "Farm Fed <hello@farmfed.com>" (the domain
 *                   must be verified in Resend)
 *   EMAIL_REPLY_TO  optional reply-to address
 */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Farm Fed <hello@farmfed.com>';

const isEmailConfigured = () => !!process.env.RESEND_API_KEY;

/**
 * @param {Object} params
 * @param {string|string[]} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} params.text plain-text alternative
 * @returns {Promise<{ sent: boolean, id?: string, reason?: string }>}
 */
const sendEmail = async ({ to, subject, html, text }) => {
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'not-configured' };
  }
  try {
    const replyTo = process.env.EMAIL_REPLY_TO;
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[email] Resend rejected the message:', response.status, body?.message);
      return { sent: false, reason: body?.message || `HTTP ${response.status}` };
    }
    return { sent: true, id: body.id };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { sent: false, reason: e.message };
  }
};

const escapeHtml = value =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

module.exports = { sendEmail, isEmailConfigured, escapeHtml };
