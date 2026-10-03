# Free-delivery promo codes

**Spec:** "Free Delivery Promo Codes — Build spec for Nick", 28 Sep 2026.

A promo covers the delivery fee on one order, whatever that fee is when the
order is placed. Nothing stores a dollar amount. Farm Fed covers the fee by not
charging the delivery: item prices and vendor payouts don't change.

---

## 1. How a promo is used

1. **Applying is free.** The checkout calls `POST /api/promos/check` when the
   customer taps Apply (or types a code). Nothing is counted.
2. **Place Order counts the use.** Before anything is charged,
   `CartCheckoutPage.duck.js` calls `POST /api/promos/redeem`. The server
   recomputes the delivery fee from the address (`api-util/deliveryFee.js`) and
   counts one use in a Redis Lua script, so two buyers can't both take the last
   use. If the promo stopped working since it was applied, the checkout stops
   with nothing charged, the promo comes off, and the buyer confirms the new
   total.
3. **With the promo, there's no delivery charge.** The standalone delivery
   transaction isn't created and every item carries `customShippingFeeCents: 0`.
4. **Settling the use:**

   | What happens | Effect | Done by |
   |---|---|---|
   | Order goes through | redemption `pending` → `used` | `POST /api/promos/confirm` from the checkout |
   | Payment fails partway | `pending` → `released`, use given back | `/api/checkout-failures` |
   | Every item declined or cancelled | `used` → `restored`, use given back | reconcile (below) |
   | Checkout abandoned mid-way | after 30 min: `used` if an item was paid, else `released` | reconcile |

   Reconcile runs from `scripts/reconcile-deliveries.js` (the existing delivery
   cron), on a vendor decline (`/api/push/transition`), and whenever the
   customer opens My Promos or an admin opens the promo.

## 2. Rules

- One promo per order; applying another swaps it out.
- Codes are saved in capitals and match in any case.
- All dates are Central time (`America/Chicago`). Admin dates are entered as
  Central wall-clock time; end dates default to 11:59 PM.
- Pickup orders, and orders whose delivery is already free (including adding
  to an existing order), don't spend a promo.
- A gift gives its uses on top of whatever the customer had already used of
  that promo, and can carry its own expiry (the earlier of the gift's and the
  promo's wins).
- Once a promo has been used its code is fixed; Duplicate makes a new version.
  Used promos can be archived but not deleted.
- An unused gift can be revoked; it disappears from the customer's promos
  quietly.
- Gifting one person with "New personal promo" makes a code just for them.
  Gifting several makes one gifted-only code they share, each with their own
  number of free deliveries. The gift window lists everyone who can shop,
  filtered by Customers / Vendors, with "Select all shown".
- Gifts to many people go out in batches (Resend's batch API, 100 emails per
  call; one notification write; one push batch), so a whole-list gift stays
  inside Heroku's 30-second request limit. Up to 1,000 people per gift.

## 3. Where things live

- **Server rules:** `server/api-util/promos.js` (tests in `promos.test.js`;
  set `PROMO_TEST_REDIS_URL` to run them against Redis).
- **Storage:** `server/api-util/promoStore.js`. Redis keys under
  `farmfed:promo:`; locally, `server/data/promos.json` (git-ignored).
- **Customer endpoints:** `server/api/promos.js` (`/api/promos/*`).
- **Admin endpoints:** `server/api/admin/promos.js` (`/api/admin/promos/*`,
  `/api/admin/customers*`), admin-only via `metadata.isAdmin`.
- **Gift email and notifications:** `server/api-util/promoNotify.js`. The email
  goes through Resend (`api-util/email.js`). The bell notification and Expo
  push both link to `/my-promos`.
- **Checkout UI:** `CartCheckoutPage/CheckoutPromo.js`.
- **My Promos:** `/my-promos` (`MyPromosPage`), plus the strip at the top of
  Profile settings (`components/MyPromosStrip`).
- **Admin UI:** Admin → Promotions (`AdminPage/PromotionsTab`). The customer
  lookup at the bottom of the list is the customer's promo profile, with Gift
  Free Delivery and Revoke.
- **"Shop Now" links:** `/promo/:code` saves the code for checkout, then opens
  the shop.

## 4. Setup

- `REDIS_URL` must be set in production. Without it, promo data lives only on
  the dyno and is lost on restart.
- `RESEND_API_KEY` and `EMAIL_FROM` (domain verified in Resend) send the gift
  email. Without them, gifts still arrive in-app and by push, and the admin
  Promotions page says email is off.
- Optional: `REACT_APP_CONSOLE_TRANSACTION_URL` (with `{id}`) links "Used on
  orders" rows to Console.
- Push taps open the linked page in the mobile app from the next app build
  (`mobile/App.tsx`). Older builds open the app's home page.

## 5. Known limits

- The server still trusts the browser to create the delivery charge at all.
  That gap predates promos, and promos don't widen it.
- Customer search in the gift window reads every user (Sharetribe can't search
  by name or email) and caches the list for a minute.
- In-app notifications now live in the settings store (Redis), so they survive
  restarts. Before this change they were wiped on every deploy.
