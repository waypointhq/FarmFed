jest.mock('./geofence', () => ({ getConsumerPolygon: jest.fn() }));
jest.mock('./geocode', () => ({ geocodeAddress: jest.fn() }));

const { getConsumerPolygon } = require('./geofence');
const { geocodeAddress } = require('./geocode');
const { checkDeliveryZone } = require('./deliveryZone');

// GeoJSON: coordinates is an array of rings, each point [lng, lat]. A box
// around Lebanon, TN — roughly where the real hub sits.
const TN_SQUARE = {
  coordinates: [
    [
      [-86.5, 36.0],
      [-86.0, 36.0],
      [-86.0, 36.4],
      [-86.5, 36.4],
      [-86.5, 36.0],
    ],
  ],
};

const address = { line1: '1 Main St', city: 'Lebanon', state: 'TN', postalCode: '37087' };

describe('checkDeliveryZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows everything when no geofence is configured', async () => {
    getConsumerPolygon.mockReturnValue(null);
    await expect(checkDeliveryZone(address)).resolves.toEqual({ allowed: true });
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('allows an address inside the zone', async () => {
    getConsumerPolygon.mockReturnValue(TN_SQUARE);
    geocodeAddress.mockResolvedValue({ lat: 36.2, lng: -86.27 });
    await expect(checkDeliveryZone(address)).resolves.toEqual({ allowed: true });
  });

  it('refuses an address outside the zone', async () => {
    // Chesapeake, Virginia — the order that had to be refunded by hand.
    getConsumerPolygon.mockReturnValue(TN_SQUARE);
    geocodeAddress.mockResolvedValue({ lat: 36.819, lng: -76.275 });
    await expect(checkDeliveryZone(address)).resolves.toEqual({
      allowed: false,
      reason: 'outside',
    });
  });

  it('refuses rather than allows when geocoding fails', async () => {
    // We can't price a delivery to an address we can't place, so taking the
    // money would be worse than asking the buyer to check what they typed.
    getConsumerPolygon.mockReturnValue(TN_SQUARE);
    geocodeAddress.mockRejectedValue(new Error('Mapbox down'));
    await expect(checkDeliveryZone(address)).resolves.toEqual({
      allowed: false,
      reason: 'unverifiable',
    });
  });

  it('refuses a missing or empty address', async () => {
    getConsumerPolygon.mockReturnValue(TN_SQUARE);
    await expect(checkDeliveryZone(null)).resolves.toEqual({
      allowed: false,
      reason: 'unverifiable',
    });
    await expect(checkDeliveryZone({ city: 'Lebanon' })).resolves.toEqual({
      allowed: false,
      reason: 'unverifiable',
    });
  });

  it('accepts a bare rings array as well as a {coordinates} object', async () => {
    getConsumerPolygon.mockReturnValue(TN_SQUARE.coordinates);
    geocodeAddress.mockResolvedValue({ lat: 36.2, lng: -86.27 });
    await expect(checkDeliveryZone(address)).resolves.toEqual({ allowed: true });
  });
});
