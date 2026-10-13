const { getIntegrationSdk, handleError } = require('../api-util/sdk');
const { matchVendors } = require('../api-util/vendorSearch');

/**
 * GET /api/search-vendors?q=hodge
 *
 * Shops whose name (or bio) matches a search, so the search bar finds vendor
 * profiles as well as listings. Sharetribe's public API can't search users,
 * so the vendor list is read through the Integration API and kept for a few
 * minutes. Only public profile fields are returned.
 *
 * Response: { vendors: [{ id, displayName, abbreviatedName, imageUrl, imageUrl2x }] }
 */

const CACHE_MS = 5 * 60 * 1000;
const MAX_QUERY_LENGTH = 60;
// Marketplaces label buyers differently; anyone else with a shop is a vendor
// (same rule as admin/list-vendors).
const CUSTOMER_TYPES = ['consumer', 'customer', 'buyer'];

let cache = null;

const loadVendors = async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.vendors;
  const sdk = getIntegrationSdk();
  const vendors = [];
  for (let page = 1; ; page++) {
    const response = await sdk.users.query({
      perPage: 100,
      page,
      include: ['profileImage'],
      'fields.image': ['variants.square-small', 'variants.square-small2x'],
    });
    const images = new Map(
      (response.data.included || []).filter(i => i.type === 'image').map(i => [i.id.uuid, i])
    );
    for (const user of response.data.data || []) {
      const profile = user.attributes.profile || {};
      const userType = String(profile.publicData?.userType || '').toLowerCase();
      if (user.attributes.state !== 'active' || CUSTOMER_TYPES.includes(userType)) continue;
      const imageId = user.relationships?.profileImage?.data?.id?.uuid;
      const variants = images.get(imageId)?.attributes?.variants || {};
      vendors.push({
        id: user.id.uuid,
        displayName: profile.displayName || '',
        abbreviatedName: profile.abbreviatedName || '',
        bio: profile.bio || '',
        imageUrl: variants['square-small']?.url || null,
        imageUrl2x: variants['square-small2x']?.url || null,
      });
    }
    if (page >= (response.data.meta?.totalPages || 1)) break;
  }
  cache = { at: Date.now(), vendors };
  return vendors;
};

const handler = async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, MAX_QUERY_LENGTH);
    if (q.trim().length < 2) return res.status(200).json({ vendors: [] });
    res.status(200).json({ vendors: matchVendors(await loadVendors(), q) });
  } catch (e) {
    handleError(res, e);
  }
};

module.exports = handler;
