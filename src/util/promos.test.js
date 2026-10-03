import {
  centralInputsToIso,
  daysUntil,
  formatPromoDate,
  formatPromoDateTime,
  isExpiringSoon,
  promoReasonMessageId,
  promoSummarySentence,
  toCentralInputs,
} from './promos';

// 2026-10-31 23:59 Central (CDT, UTC-5).
const OCT_31_END = '2026-11-01T04:59:00.000Z';

describe('promo dates', () => {
  it('formats in Central time', () => {
    expect(formatPromoDate(OCT_31_END)).toBe('Oct 31');
    expect(formatPromoDateTime(OCT_31_END)).toBe('Oct 31 at 11:59 PM');
  });

  it('round-trips the admin date and time inputs through Central', () => {
    expect(centralInputsToIso('2026-10-31', '23:59')).toBe(OCT_31_END);
    expect(toCentralInputs(OCT_31_END)).toEqual({ date: '2026-10-31', time: '23:59' });
  });

  it('counts days left and flags the last week', () => {
    const now = new Date('2026-10-28T12:00:00Z').getTime();
    expect(daysUntil(OCT_31_END, now)).toBe(4);
    expect(isExpiringSoon(OCT_31_END, now)).toBe(true);
    expect(isExpiringSoon('2026-12-31T00:00:00Z', now)).toBe(false);
  });
});

describe('promoSummarySentence', () => {
  const base = { code: 'freesat', perCustomerLimit: 1, audience: 'public' };

  it('reads like the spec for both limits', () => {
    expect(
      promoSummarySentence({ ...base, expiryType: 'both', maxUses: 100, endsAt: OCT_31_END })
    ).toBe(
      'FREESAT gives free delivery on 1 order per customer, up to 100 total uses, until Oct 31 at 11:59 PM, whichever comes first.'
    );
  });

  it('covers the other expiration options', () => {
    expect(promoSummarySentence({ ...base, expiryType: 'never' })).toBe(
      'FREESAT gives free delivery on 1 order per customer, with no end date.'
    );
    expect(promoSummarySentence({ ...base, expiryType: 'uses', maxUses: 1 })).toBe(
      'FREESAT gives free delivery on 1 order per customer, up to 1 total use.'
    );
    expect(
      promoSummarySentence({ ...base, expiryType: 'date', endsAt: OCT_31_END, perCustomerLimit: 2 })
    ).toBe('FREESAT gives free delivery on 2 orders per customer, until Oct 31 at 11:59 PM.');
  });

  it('mentions gifted-only promos', () => {
    expect(promoSummarySentence({ ...base, expiryType: 'never', audience: 'gifted' })).toMatch(
      /Only customers you gift it to can use it\.$/
    );
  });
});

describe('promoReasonMessageId', () => {
  it('falls back to the invalid-code message', () => {
    expect(promoReasonMessageId('expired')).toBe('Promo.reason.expired');
    expect(promoReasonMessageId('something-new')).toBe('Promo.reason.invalid');
  });
});
