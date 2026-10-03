// The Expo push client ships as ES modules, which this Jest setup can't load.
jest.mock('./pushSender', () => ({ sendPushNotifications: jest.fn() }));

const { sendGiftEmails } = require('./promoNotify');

const promo = { id: 'p1', code: 'FF-8K2Q', title: 'Free Delivery', message: '' };
// Branding lookup fails: the email falls back to the default look.
const sdk = { assetByAlias: () => Promise.reject(new Error('offline')) };

describe('sendGiftEmails', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    global.fetch = originalFetch;
  });

  it('sends a whole-list gift in batches of 100', async () => {
    const recipients = Array.from({ length: 150 }, (_, i) => ({
      userId: `u${i}`,
      email: `u${i}@example.com`,
      gift: { uses: 1, message: 'On us' },
    }));
    recipients.push({ userId: 'no-email', email: '', gift: { uses: 1 } });

    const sent = await sendGiftEmails({ sdk, promo, recipients });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.resend.com/emails/batch');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toHaveLength(50);
    expect(sent.u0).toBe(true);
    expect(sent.u149).toBe(true);
    expect(sent['no-email']).toBe(false);
  });

  it('reports a rejected batch as not sent', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 422, json: () => Promise.resolve({ message: 'bad' }) })
    );
    const sent = await sendGiftEmails({
      sdk,
      promo,
      recipients: [{ userId: 'u1', email: 'u1@example.com', gift: { uses: 1 } }],
    });
    expect(sent.u1).toBe(false);
  });
});
