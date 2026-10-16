/**
 * The app also answers on its herokuapp.com address. A visitor who lands there
 * gets a CSP written for the marketplace domain, so some scripts are blocked,
 * and a login separate from the one on the real domain, since cookies are per
 * host. Send page loads to the marketplace domain instead.
 *
 * Only GET and HEAD outside /api are redirected: a webhook or API call
 * pointed at the herokuapp.com address must keep working, and a redirect
 * would drop a POST body.
 *
 * @param {String} rootUrl The marketplace root URL (REACT_APP_MARKETPLACE_ROOT_URL)
 * @return {Function} Express middleware
 */
const canonicalHostRedirect = rootUrl => {
  let canonical = null;
  try {
    canonical = new URL(rootUrl);
  } catch (e) {
    // No usable root URL: never redirect.
  }

  return (req, res, next) => {
    const hostname = req.hostname || '';
    const shouldRedirect =
      !!canonical &&
      hostname.endsWith('.herokuapp.com') &&
      hostname !== canonical.hostname &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/.well-known');

    if (!shouldRedirect) {
      return next();
    }
    return res.redirect(301, `${canonical.origin}${req.originalUrl}`);
  };
};

module.exports = { canonicalHostRedirect };
