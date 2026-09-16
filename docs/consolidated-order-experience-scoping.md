# Consolidated Order Experience — scoping

**Spec:** "Consolidated Order Experience (Customer + Vendor)", owner Mahdi.
**Related:** [`checkout-consolidation-scoping.md`](./checkout-consolidation-scoping.md),
[`merchant-of-record-memo.md`](./merchant-of-record-memo.md).

This is engineering's read on the spec against the code as it stands. Short version: the customer- and
vendor-facing *views* (§3.1, §3.3) can be built now. The *emails* (§3.2, §3.4, §3.5) cannot be built as
specified without either an email provider or the single-charge rework, because today every email in the system
is emitted by Sharetribe per transaction, and a transaction is one line item.

---

## 1. What already exists

| Spec concept | In the code today | Where |
|---|---|---|
| Order Group | `orderGroupId` string stamped into each transaction's `protectedData` | `CartCheckoutPage.duck.js:148`, `server/api/initiate-privileged.js:88` |
| Cart-wide platform fee | Computed once against the cart subtotal, then split proportionally across the N transactions | `CartCheckoutPage.duck.js:151-176`, `server/api/calculate-cart-fee.js` |
| Consolidated delivery | One standalone delivery transaction per group, items carry $0 shipping | `CartCheckoutPage.duck.js:140-148`, `server/api/link-delivery-items.js` |
| "Add to my order" | Finds the buyer's open group and reuses its delivery choice | `server/api/active-order-group.js` |
| Operator roll-up | Orders awaiting delivery, grouped | `server/api/admin/orders-awaiting-delivery.js` |
| Vendor suborder | **Does not exist.** Vendors see one inbox row per line item | `src/containers/InboxPage/` |
| Order Group record | The group is an id in `protectedData`, reassembled on read | `server/api-util/orderGroups.js` |

## 2. Three findings that change the spec

### 2.1 The commission model in §4 is not the one running in production

The spec's table (`$27.00 paid → $4.05 commission → $22.95 vendor net`) describes a **provider** commission —
deducted from what the vendor receives. What runs today is a **customer** commission: the fee is added on top of
the item price (`line-item/customer-commission`, `lineItems.js:387-398`), so the vendor's payout is the full
item price and the customer pays subtotal + fee.

Under the current model, "vendor net" in the §3.5 email is simply the item subtotal and the commission column is
$0 — which is not what the spec's table shows. Before building §3.5, decide which model FarmFed is on. If the
answer is "the spec's", that is a pricing change (either vendor payouts drop by the commission, or listing prices
rise to absorb it), not a rendering change.

### 2.2 Sharetribe cannot query transactions by `orderGroupId`

`protectedData` is not a queryable field on either the Marketplace or Integration API.
`active-order-group.js` works around this by pulling the 20 most recent transactions and filtering in
JavaScript.

What *is* queryable is `customerId` / `providerId`. That turns out to be enough: a customer's own orders and a
vendor's own sales are both bounded lists, so the reads can filter by the indexed field server-side and group by
`orderGroupId` in memory. `server/api-util/orderGroups.js` does exactly that, which is why the views below
needed no new database.

This still answers open question 2: **no**, Sharetribe has no parent record; the Order Group is an id stamped
across the transactions and reassembled on read.

*Revision:* an earlier draft of this document called for a persisted Order Group record in our own database.
That isn't needed for the views — grouping on read is sufficient at this scale. It becomes necessary only when
something has to be attached to the group that no transaction holds (a group-level status the process doesn't
model, or an audit trail of emails sent). The one thing the transactions did lack — the delivery date — is now
frozen into each transaction's `protectedData` at initiate time rather than stored separately.

### 2.3 There is no email provider in this repo — and it turns out one may not be needed

Every customer- and vendor-facing email is a Sharetribe process notification
(`ext/transaction-processes/default-purchase/process.edn:190-260`) — `order-receipt` to the customer and
`purchase-new-order` to the provider, both fired `:on :transition/confirm-payment`, per transaction. Since one
transaction is one line item, the system today violates acceptance criterion 4 by construction.

A template's context is rooted at **one transaction** and can only iterate that transaction's own line items
(`{{#each tx-line-items}}`). There is no way to reach a sibling transaction, so no amount of template editing
consolidates anything. One email per checkout therefore requires one transaction per checkout.

**The carrier-transaction approach.** A transaction whose only job is to be that one transaction: created after
payment succeeds, carrying the whole order (or the whole of one vendor's slice) so its template can render the
lot. It has no Stripe actions and no stock actions — the real per-item transactions already took the money and
hold the stock reservations, so the carrier moves nothing and reserves nothing. This generalises the standalone
delivery transaction, which is already an operator-owned, once-per-order-group transaction in production.

A spike validated the process definition (`ext/transaction-processes/notification-carrier/`, see §8).

**What this changes:** the emails no longer depend on standing up SendGrid/Postmark, and no longer depend on the
merchant-of-record decision, because no money passes through a carrier. It costs one extra Sharetribe
transaction per checkout and one per vendor per order — which makes the volume-fee question (§5 of the
merchant-of-record memo) decisive again: percentage-of-value makes carriers free, flat-per-transaction makes
them a real line item on the Sharetribe bill.

*Revision:* an earlier draft of this document concluded that an email provider was required either way. That
looks wrong. It remains the fallback if the carrier approach fails its remaining live test.

## 3. Answers to the spec's open questions

1. **Commission rate — platform-wide or per-vendor?** Platform-wide today: a single `customerCommission`
   percentage plus minimum, read from the Console asset `transactions/commission.json`
   (`server/api/calculate-cart-fee.js`). There is no per-vendor rate anywhere in the code. Adding one means a
   field on the vendor's profile extended data and a server-side override in `calculate-cart-fee.js` and
   `transaction-line-items.js` — perhaps two days, but it also means the cart-level fee stops being one number
   and becomes a per-vendor sum. Recommend staying platform-wide for this phase.
2. **Parent record in Sharetribe?** No — see §2.2. Own layer, transactions referenced by id.
3. **Should vendors see delivery fee and tax?** Recommend showing them as a clearly labelled "not included in
   your payout" line rather than hiding them. Vendors reconcile against what the customer told them they paid;
   a number they cannot account for generates more support load than a labelled exclusion does.
4. **Does the post-acceptance summary replace an existing payout notification?** It sits alongside. Stripe sends
   its own payout notifications from the connected account, and those are not ours to suppress. The §3.5 email
   should state the expected amount and timing and explicitly reference that Stripe will confirm separately.

## 4. Gaps between the spec and current behaviour

- ~~**`orderGroupId` is not always set.**~~ Fixed: it is generated for every checkout, and stamped
  server-side so single-item orders get one too.
- **Delivery fee is not a $12 flat fee.** It is distance-based from the hub with a flat-fee fallback, both
  admin-configurable (`server/api-util/deliveryRate.js`). §4 should say "the delivery fee, whatever the settings
  compute" rather than naming an amount.
- ~~**No delivery date on the group.**~~ Fixed: resolved once at initiate time from `pickupSchedule.js` and
  frozen into `protectedData.deliveryDate`. Orders placed before this change have no date and are shown
  separately on the vendor page rather than silently dropped.
- **Partial acceptance has no customer-facing adjustment notice** (§6). Today a declined item is its own
  transaction that simply cancels and refunds; nothing tells the customer their order changed.

## 5. Suggested sequence

1. **Always generate `orderGroupId`** — one-line change, unblocks everything else.
2. **Order Group assembly** — group the transactions on read and freeze the delivery date onto each one.
   No backfill: orders placed before group ids were stamped unconditionally fall back to a group of one.
3. **Customer order view (§3.1)** and **vendor suborder view + roll-up (§3.3)** — both read the new record.
   These are the highest-visibility deliverables and carry no money risk.
4. **Email provider + the three emails (§3.2, §3.4, §3.5)**, with the per-transaction Sharetribe notifications
   removed from `process.edn` in the same change so nothing double-sends.
5. **Single-charge rework** — separate project, still gated on the merchant-of-record decision. It changes what
   the emails describe, not whether they exist, so it does not have to come first.

Steps 1–3 are independent of the merchant-of-record decision and can start now. Step 4 depends on picking a
provider and having DNS access to the sending domain.

## 6. Decisions still open

- Which commission model (§2.1) — this determines what the vendor summary email can say, and whether §3.5's
  table is achievable as drawn.
- Whether "delivery date" for a pickup order means the pickup date. Assumed yes and built that way — the
  customer view labels it "Pickup date" when the order is a pickup.
- Email provider choice and who owns the sending domain's DNS.

---

## 7. What has shipped

Steps 1–3 of the sequence above are built.

**Every order now belongs to a group.** `orderGroupId` is generated for every checkout rather than only for
carts that create a standalone delivery transaction, and it is stamped server-side in
`initiate-privileged.js`, so a single-item checkout that never touched the cart gets one too. The same change
freezes `deliveryDate` onto the transaction — reading it back off the pickup schedule later would return the
*next* delivery date, not the one the order was placed for.

**`server/api-util/orderGroups.js`** regroups transactions into orders and computes the money. Every figure is
read back off the transactions' own line items rather than recomputed, so the views always reconcile with what
Stripe charged, and §4's "round at the line item, then sum" rule holds because Sharetribe already stored the
rounded line totals. Covered by `orderGroups.test.js`.

**Customer order view (§3.1)** — `/orders` lists one row per checkout; `/orders/:groupId` shows the items
grouped under the vendor that sold them, with a per-vendor status badge and a totals block. Served by
`GET /api/order-groups`.

**Vendor order view (§3.3)** — `/vendor-orders` shows one suborder per customer order for a delivery date, each
a packing list with accept / mark-unavailable at both item and suborder level, plus the per-SKU roll-up across
all customers. Served by `GET /api/vendor-suborders`.

Both pages are linked from the profile menu; the vendor page only appears for users who can create listings.

### Deliberately not built yet

- **The three emails (§3.2, §3.4, §3.5).** Blocked on an email provider — see §2.3.
- **Partial-acceptance adjustment notice (§6).** It is a notification, so it lands with the email work.
- **The vendor money breakdown is honest but provisional.** It renders whichever commission model the line items
  actually show and labels it accordingly, because §2.1 is unresolved. Under today's customer-side fee it reads
  "your payout = the full item total" with the buyer's service fee shown separately as FarmFed's. If the
  business switches to a provider-side commission in Console, the same view starts showing a deduction with no
  code change — but §3.5's table only reads as written under that model.

---

## 8. Carrier spike — results

Ran against `flex-cli` locally. The process definition validates; the live half is blocked on marketplace
credentials.

**Confirmed:**

- **A process with `privileged-set-line-items` and no Stripe or stock actions is valid.** This is the crux —
  carriers are structurally legal, and nothing about them touches money or inventory.
- **Notifications fire on both `issue` and `accept`,** giving exactly one §3.4 email per vendor per order and
  exactly one §3.5 email per suborder. Because the vendor resolves the whole suborder in a single transition,
  §5's "hold the summary until the whole suborder is resolved" comes for free rather than needing to be
  engineered.
- **An initial transition cannot be operator-actored** — Sharetribe requires `:actor.role/customer` or
  `:actor.role/provider`. So the carrier is customer-actored and issued server-side on the buyer's behalf,
  exactly how the standalone delivery transaction is created today.
- **`transition/operator-accept` is valid,** which also answers a standing request from the business: accepting
  an order on a vendor's behalf when the farm is closed.
- **The zero-total question was the wrong question.** With no Stripe actions there is no charge, so a carrier can
  carry the real amounts. No balancing negative line item is needed.
- **§3.5's table cannot be built from line items.** A line item has code, unit price, quantity and line total —
  no listing title — and the template language cannot do arithmetic, so it cannot derive a per-item commission
  and net. The server computes the rows instead (`financialsFor()` in `server/api-util/orderGroups.js` already
  produces exactly these figures) and stores them on the carrier's protected data for the template to iterate.

**Still to verify — needs marketplace access:**

- That a template can iterate an arbitrary protected-data array (`{{#each protected-data.summaryRows}}`). Both
  templates depend on this. Settled by `flex-cli notifications preview --template <dir> -m <marketplace>`.
- End to end: push the process, issue one carrier, confirm exactly one email arrives and renders.

The local API key is denied for the marketplace idents tried, so this needs the correct ident and a key with
access to it.

