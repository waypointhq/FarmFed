jest.mock('./settingsStore', () => {
  let store = {};
  return {
    get: ns => store[ns] || null,
    set: async (ns, data) => {
      store[ns] = data;
    },
    __reset: () => {
      store = {};
    },
  };
});

const settingsStore = require('./settingsStore');
const { getCheckoutFailures, recordCheckoutFailure } = require('./checkoutFailures');

describe('checkout failure log', () => {
  beforeEach(() => settingsStore.__reset());

  it('starts empty', () => {
    expect(getCheckoutFailures()).toEqual([]);
  });

  it('records a failure with a timestamp', async () => {
    await recordCheckoutFailure({ orderGroupId: 'og-1', reason: 'card_declined', itemCount: 4 });
    const [failure] = getCheckoutFailures();

    expect(failure.orderGroupId).toBe('og-1');
    expect(failure.reason).toBe('card_declined');
    expect(failure.at).toEqual(expect.any(String));
  });

  it('keeps the newest failure first', async () => {
    await recordCheckoutFailure({ orderGroupId: 'first' });
    await recordCheckoutFailure({ orderGroupId: 'second' });

    expect(getCheckoutFailures().map(f => f.orderGroupId)).toEqual(['second', 'first']);
  });

  it('caps the log so the settings store cannot grow without bound', async () => {
    for (let i = 0; i < 205; i++) {
      await recordCheckoutFailure({ orderGroupId: `og-${i}` });
    }
    const failures = getCheckoutFailures();

    expect(failures).toHaveLength(200);
    // The oldest entries are the ones dropped.
    expect(failures[0].orderGroupId).toBe('og-204');
  });

  it('keeps what was refunded, so a partial unwind is visible afterwards', async () => {
    await recordCheckoutFailure({
      orderGroupId: 'og-1',
      chargedOrderIds: ['tx-1', 'tx-2'],
      refunded: ['tx-1'],
      refundFailed: ['tx-2'],
    });
    const [failure] = getCheckoutFailures();

    expect(failure.refunded).toEqual(['tx-1']);
    expect(failure.refundFailed).toEqual(['tx-2']);
  });
});
