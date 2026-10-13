const MAX_RESULTS = 8;

/**
 * Name matches rank above bio matches; every word of the search has to be
 * found.
 */
const matchVendors = (vendors, query) => {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];
  const score = vendor => {
    const name = vendor.displayName.toLowerCase();
    const bio = vendor.bio.toLowerCase();
    if (name.includes(q)) return 3;
    if (words.every(w => name.includes(w))) return 2;
    if (words.every(w => name.includes(w) || bio.includes(w))) return 1;
    return 0;
  };
  return vendors
    .map(vendor => ({ vendor, score: score(vendor) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.vendor.displayName.localeCompare(b.vendor.displayName))
    .slice(0, MAX_RESULTS)
    .map(({ vendor: { bio, ...publicFields } }) => publicFields);
};

module.exports = { matchVendors };
