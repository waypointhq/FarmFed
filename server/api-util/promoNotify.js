const moment = require('moment-timezone');
const { sendEmail, escapeHtml } = require('./email');
const { addNotification } = require('./notifications');
const { getTokensForUser } = require('./deviceTokens');
const { sendPushNotifications } = require('./pushSender');
const { getRootURL } = require('./rootURL');
const { TIMEZONE } = require('./promos');

// Used when the hosted branding can't be read.
const FALLBACK_BRAND = {
  color: '#5f9e2f',
  accent: '#453317',
  logoUrl: null,
};

// Hosted branding rarely changes; read it at most every 10 minutes.
const BRAND_TTL_MS = 10 * 60 * 1000;
let brandCache = null;

/**
 * Brand colour and logo from the hosted design/branding.json asset, so the
 * email matches Console's branding without a second copy here.
 *
 * @param {Object} sdk any Sharetribe Marketplace SDK instance
 */
const getBranding = async sdk => {
  if (brandCache && Date.now() - brandCache.at < BRAND_TTL_MS) return brandCache.value;
  let value = FALLBACK_BRAND;
  try {
    const response = await sdk.assetByAlias({ path: 'design/branding.json', alias: 'latest' });
    const branding = response?.data?.data || {};
    const included = response?.data?.included || [];
    const logoRefId = branding.logo?._ref?.id || branding.logo?.id;
    const logoAsset = included.find(a => a.id === logoRefId || a.id?.uuid === logoRefId);
    const variants = logoAsset?.attributes?.variants || {};
    const variant = variants.scaled2x || variants.scaled || Object.values(variants)[0];
    value = {
      color: branding.marketplaceColors?.mainColor || FALLBACK_BRAND.color,
      accent: FALLBACK_BRAND.accent,
      logoUrl: variant?.url || null,
    };
  } catch (e) {
    console.error('[promoNotify] could not read hosted branding:', e.message);
  }
  brandCache = { at: Date.now(), value };
  return value;
};

const formatExpiry = iso => (iso ? moment.tz(iso, TIMEZONE).format('MMM D') : null);

const usesLabel = uses => `${uses} free deliver${uses === 1 ? 'y' : 'ies'}`;

/**
 * Link that opens the shop with this promo already applied to the cart.
 */
const shopUrl = code => `${getRootURL()}/promo/${encodeURIComponent(code)}`;

const giftEmail = ({ code, title, message, uses, expiresAt, brand }) => {
  const expiry = formatExpiry(expiresAt);
  const cardLine = [usesLabel(uses), expiry ? `Expires ${expiry}` : null]
    .filter(Boolean)
    .join(' · ');
  const url = shopUrl(code);
  const color = escapeHtml(brand.color);
  const accent = escapeHtml(brand.accent);
  const font =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const header = brand.logoUrl
    ? `<img src="${escapeHtml(
        brand.logoUrl
      )}" alt="Farm Fed" height="40" style="height:40px;width:auto;border:0" />`
    : `<span style="font-size:24px;font-weight:800;letter-spacing:1px;color:${accent}">FARM FED</span>`;

  const messageBlock = message
    ? `<p style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#484848">${escapeHtml(
        message
      )}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
  <head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /></head>
  <body style="margin:0;padding:0;background:#f7f5f0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f0;font-family:${font}">
      <tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
          <tr><td align="center" style="padding:24px;border-bottom:4px solid ${color}">${header}</td></tr>
          <tr><td style="padding:32px 28px 8px">
            <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;color:#2b2b2b">Free delivery, from our farm family to yours</h1>
            ${messageBlock}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed ${color};border-radius:10px;background:#f6fbf1">
              <tr><td align="center" style="padding:20px 16px">
                <div style="font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${color}">${escapeHtml(
    title || 'Free Delivery'
  )}</div>
                <div style="font-size:28px;font-weight:800;letter-spacing:2px;margin:8px 0;color:#2b2b2b;font-family:Menlo,Consolas,monospace">${escapeHtml(
                  code
                )}</div>
                <div style="font-size:14px;color:#6b6b6b">${escapeHtml(cardLine)}</div>
              </td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
              <tr><td align="center">
                <a href="${escapeHtml(
                  url
                )}" target="_blank" style="display:inline-block;background:${accent};color:#ffffff;font-size:17px;font-weight:700;text-decoration:none;padding:15px 44px;border-radius:6px">Shop Now</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:16px 28px 28px">
            <p style="font-size:12px;line-height:1.5;margin:0;color:#9a9a9a;text-align:center">Covers the delivery fee on one order. One promo per order.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    'Free delivery, from our farm family to yours',
    '',
    message || null,
    message ? '' : null,
    `${title || 'Free Delivery'}: ${code}`,
    cardLine,
    '',
    `Shop now: ${url}`,
    '',
    'Covers the delivery fee on one order. One promo per order.',
  ]
    .filter(line => line !== null)
    .join('\n');

  return { subject: 'Your next Farm Fed delivery is on us', html, text };
};

/**
 * Email the customer about a gifted promo.
 *
 * @returns {Promise<boolean>} whether it went out
 */
const sendGiftEmail = async ({ sdk, to, promo, gift }) => {
  if (!to) return false;
  const brand = await getBranding(sdk);
  const { subject, html, text } = giftEmail({
    code: promo.code,
    title: promo.title,
    message: gift.message || promo.message,
    uses: gift.uses,
    expiresAt: gift.expiresAt || promo.endsAt,
    brand,
  });
  const result = await sendEmail({ to, subject, html, text });
  return result.sent;
};

/**
 * Bell notification plus a push to the customer's devices. Both open My
 * Promos with the new promo first.
 *
 * @returns {Promise<boolean>} whether the in-app notification was created
 */
const sendGiftNotification = async ({ userId, promo }) => {
  const link = '/my-promos';
  const body = 'Free delivery is on us! Tap to see your promo.';
  await addNotification({
    userId,
    type: 'promo',
    promoId: promo.id,
    title: promo.title,
    body,
    link,
  });

  const tokens = getTokensForUser(userId);
  if (tokens.length > 0) {
    sendPushNotifications(
      tokens.map(t => ({
        token: t.token,
        title: promo.title || 'Free Delivery',
        body,
        data: { type: 'promo', promoId: promo.id, link },
      }))
    ).catch(err => console.error('[promoNotify] push failed:', err));
  }
  return true;
};

module.exports = { sendGiftEmail, sendGiftNotification, giftEmail, getBranding };
