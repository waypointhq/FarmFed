const responseApiErrorInfo = err =>
  (err && err.data && err.data.errors ? err.data.errors : []).map(e => ({
    status: e.status,
    code: e.code,
    meta: e.meta,
  }));

/**
 * A summary of an error that is safe to print. Never print an SDK or HTTP
 * client error whole: it carries the outgoing request, including the
 * `Authorization: Bearer` header with the user's (or the Integration API's)
 * access token. Printing those put live tokens in the logs.
 *
 * HTTP errors are summarised by status and API error codes; anything else
 * (a bug in our own code) keeps its stack trace.
 *
 * @param {*} e Error that occurred
 * @return {*} Plain object safe to log, or `e` itself if it isn't an object
 */
const describeError = e => {
  if (!e || typeof e !== 'object') return e;
  const status = e.status || e.response?.status;
  const isHttpError = !!(status || e.request || e.config);
  const apiErrors = responseApiErrorInfo(e);
  return {
    name: e.name,
    message: e.message,
    ...(status ? { status, statusText: e.statusText || e.response?.statusText } : {}),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(apiErrors.length > 0 ? { apiErrors } : {}),
    ...(isHttpError ? {} : { stack: e.stack }),
  };
};

module.exports = { describeError };
