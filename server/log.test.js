// @sentry/node doesn't load under the server's jest setup; the logger only
// needs it when a DSN is configured.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  withScope: jest.fn(),
  captureException: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
}));

const log = require('./log');
const { describeError } = require('./api-util/describeError');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-user-token';

// The shape the Sharetribe SDK rejects with: an AxiosError carrying the
// outgoing request (with the user's token) plus status and data.
const sdkError = () =>
  Object.assign(new Error('Request failed with status code 403'), {
    name: 'AxiosError',
    code: 'ERR_BAD_REQUEST',
    config: { headers: { Authorization: `Bearer ${TOKEN}` } },
    request: { _header: `GET /v1/api/current_user/show HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}` },
    status: 403,
    statusText: 'Forbidden',
    data: { errors: [{ status: 403, code: 'forbidden', title: 'Forbidden' }] },
  });

describe('describeError', () => {
  it('summarises an SDK error without the request or its token', () => {
    const summary = describeError(sdkError());

    expect(summary).toEqual({
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      status: 403,
      statusText: 'Forbidden',
      code: 'ERR_BAD_REQUEST',
      apiErrors: [{ status: 403, code: 'forbidden', meta: undefined }],
    });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it('takes the status from a plain axios response', () => {
    const e = Object.assign(new Error('Request failed with status code 502'), {
      response: { status: 502, statusText: 'Bad Gateway', config: { headers: { Authorization: TOKEN } } },
    });
    expect(describeError(e)).toEqual(
      expect.objectContaining({ status: 502, statusText: 'Bad Gateway' })
    );
    expect(JSON.stringify(describeError(e))).not.toContain(TOKEN);
  });

  it('keeps the stack for errors from our own code', () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(describeError(e).stack).toBe(e.stack);
  });

  it('passes non-objects through', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(undefined)).toBeUndefined();
  });
});

describe('log.error', () => {
  let printed;
  beforeEach(() => {
    printed = [];
    jest.spyOn(console, 'error').mockImplementation((...args) => printed.push(args.join(' ')));
  });
  afterEach(() => jest.restoreAllMocks());

  it('never prints an access token', () => {
    const e = sdkError();
    log.error(e, 'local-api-request-failed', e.data);

    const output = printed.join('\n');
    expect(output).toContain('local-api-request-failed');
    expect(output).toContain('forbidden');
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain('Bearer');
  });

  it('prints one line, plus the stack for our own errors', () => {
    log.error(sdkError(), 'local-api-request-failed');
    expect(printed).toHaveLength(1);

    printed = [];
    log.error(new Error('csp broke'), 'csp-violation');
    expect(printed).toHaveLength(2);
    expect(printed[1]).toContain('Error: csp broke');
  });
});
