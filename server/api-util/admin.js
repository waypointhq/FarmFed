/**
 * Admin status lives in profile.metadata, which only the operator can write
 * (Console or the Integration API). profile.privateData is writable by the
 * user themselves through currentUser.updateProfile, so it must never be used
 * for authorization.
 *
 * @param {Object} user a currentUser / user resource from the SDK
 * @returns {boolean}
 */
const isAdminUser = user => user?.attributes?.profile?.metadata?.isAdmin === true;

module.exports = { isAdminUser };
