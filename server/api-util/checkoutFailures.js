const settingsStore = require('./settingsStore');

const NAMESPACE = 'checkout-failures';

// A rolling window, not an audit log. Enough to spot a pattern ("six declines
// this week, all on the same vendor") without turning the settings store into
// a database.
const MAX_RECORDS = 200;

const getCheckoutFailures = () => {
  const data = settingsStore.get(NAMESPACE) || {};
  return Array.isArray(data.failures) ? data.failures : [];
};

/**
 * Record a checkout that failed partway. Nothing else in the system knows a
 * failed checkout happened: it leaves no transaction anyone can see, no email
 * and no order, so without this the only signal is the customer getting in
 * touch.
 */
const recordCheckoutFailure = async failure => {
  const failures = getCheckoutFailures();
  failures.unshift({ ...failure, at: new Date().toISOString() });
  await settingsStore.set(NAMESPACE, {
    failures: failures.slice(0, MAX_RECORDS),
    updatedAt: new Date().toISOString(),
  });
};

module.exports = { getCheckoutFailures, recordCheckoutFailure, NAMESPACE };
