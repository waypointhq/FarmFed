const { canonicalHostRedirect } = require('./canonicalHost');

const run = (rootUrl, { hostname, method = 'GET', path = '/', originalUrl = path }) => {
  const res = { redirect: jest.fn() };
  const next = jest.fn();
  canonicalHostRedirect(rootUrl)({ hostname, method, path, originalUrl }, res, next);
  return { res, next };
};

const ROOT = 'https://www.farmfed.us';
const HEROKU = 'farmfed-e9c8faa5736a.herokuapp.com';

describe('canonicalHostRedirect', () => {
  it('sends page loads on the herokuapp.com address to the marketplace domain', () => {
    const { res, next } = run(ROOT, {
      hostname: HEROKU,
      path: '/l/eggs/123',
      originalUrl: '/l/eggs/123?ref=x',
    });
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://www.farmfed.us/l/eggs/123?ref=x');
    expect(next).not.toHaveBeenCalled();
  });

  it('leaves the marketplace domain alone', () => {
    const { res, next } = run(ROOT, { hostname: 'www.farmfed.us' });
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('never redirects API calls or webhooks', () => {
    expect(run(ROOT, { hostname: HEROKU, path: '/api/onfleet-webhook' }).next).toHaveBeenCalled();
    expect(
      run(ROOT, { hostname: HEROKU, method: 'POST', path: '/csp-report' }).next
    ).toHaveBeenCalled();
    expect(run(ROOT, { hostname: HEROKU, path: '/.well-known/apple-app-site-association' }).next)
      .toHaveBeenCalled();
  });

  it('does nothing without a usable root URL, or when it is the herokuapp.com address', () => {
    expect(run(undefined, { hostname: HEROKU }).next).toHaveBeenCalled();
    expect(run(`https://${HEROKU}`, { hostname: HEROKU }).next).toHaveBeenCalled();
  });
});
