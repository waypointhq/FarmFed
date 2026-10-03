/* eslint-disable no-console */
//
// Move admins onto the operator-only admin flag.
//
// Admin access used to come from profile.privateData.isAdmin, which users can
// write themselves. It now comes from profile.metadata.isAdmin, which only the
// operator can set. This lists who held either flag and grants the new one.
//
// Usage:
//   node scripts/admin-metadata.js --list
//   node scripts/admin-metadata.js --grant <userId> [<userId> ...]
//
// --list first: the old flag was self-writable, so check every name before
// granting. Requires the Integration API credentials in the environment:
//   SHARETRIBE_INTEGRATION_API_CLIENT_ID, SHARETRIBE_INTEGRATION_API_CLIENT_SECRET
require('dotenv').config();

const { getIntegrationSdk } = require('../server/api-util/sdk');

const allUsers = async sdk => {
  const users = [];
  for (let page = 1; ; page++) {
    const response = await sdk.users.query({ perPage: 100, page });
    users.push(...(response.data.data || []));
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }
  return users;
};

const describe = user => {
  const profile = user.attributes.profile || {};
  return [
    user.id.uuid,
    profile.displayName || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    `<${user.attributes.email || ''}>`,
    `created ${new Date(user.attributes.createdAt).toISOString().slice(0, 10)}`,
  ].join('  ');
};

const list = async sdk => {
  const users = await allUsers(sdk);
  const flagged = users.filter(
    u =>
      u.attributes.profile?.privateData?.isAdmin === true ||
      u.attributes.profile?.metadata?.isAdmin === true
  );
  console.log(`${users.length} users; ${flagged.length} with an admin flag:\n`);
  flagged.forEach(u => {
    const hasNew = u.attributes.profile?.metadata?.isAdmin === true;
    console.log(`${hasNew ? '[admin]       ' : '[needs grant] '}${describe(u)}`);
  });
};

const grant = async (sdk, ids) => {
  for (const id of ids) {
    const response = await sdk.users.updateProfile(
      { id, metadata: { isAdmin: true } },
      { expand: true }
    );
    console.log(`granted  ${describe(response.data.data)}`);
  }
};

(async () => {
  const [command, ...ids] = process.argv.slice(2);
  const sdk = getIntegrationSdk();
  if (command === '--list') return list(sdk);
  if (command === '--grant' && ids.length) return grant(sdk, ids);
  console.log('Usage: node scripts/admin-metadata.js --list | --grant <userId> [...]');
  process.exitCode = 1;
})().catch(e => {
  console.error('FATAL admin-metadata:', e.data?.errors?.[0]?.title || e.message);
  process.exit(1);
});
