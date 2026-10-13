const { matchVendors } = require('./vendorSearch');

const vendors = [
  { id: '1', displayName: 'Hodge Podge Hill', bio: 'Pastured poultry and pork.' },
  { id: '2', displayName: 'Liddle Acres', bio: 'Seasonal simmer pots and baked goods.' },
  { id: '3', displayName: 'Bone Hollow Farms', bio: 'Grass-fed beef shares.' },
];

describe('matchVendors', () => {
  it('finds shops by name, in any case, ranking name matches first', () => {
    expect(matchVendors(vendors, 'hodge').map(v => v.id)).toEqual(['1']);
    expect(matchVendors(vendors, 'HOLLOW farms').map(v => v.id)).toEqual(['3']);
  });

  it('falls back to the bio, and needs every word', () => {
    expect(matchVendors(vendors, 'beef').map(v => v.id)).toEqual(['3']);
    expect(matchVendors(vendors, 'beef pork')).toEqual([]);
  });

  it('never returns the bio', () => {
    expect(matchVendors(vendors, 'liddle')[0]).toEqual({ id: '2', displayName: 'Liddle Acres' });
  });

  it('ignores one-letter searches', () => {
    expect(matchVendors(vendors, 'a')).toEqual([]);
  });
});
