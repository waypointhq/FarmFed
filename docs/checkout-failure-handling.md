# Failed checkouts — what happens, and how we find out

**Prompted by:** a customer (Alfa B.) reporting on 25 Sep 2026 that a ~$100 cart
never became an order, and neither she nor the operator could see it anywhere.

**Conclusion:** not a bug. Her card failed and the code behaved correctly. But
the report exposed a real defect nearby, and the fact that it took a customer
phoning in to surface any of it.

---

## 1. What actually happened

Transaction `6ab59e67-a546-4792-9bcd-4c8949448563`, order group `3715fe2b`:

```
2026-09-24 22:04:23 UTC   transition/request-payment   by customer
2026-09-24 22:19:28 UTC   transition/expire-payment    by system
```

Checkout started, the first cart item (Whole roaster, $25) was created, and
Stripe card confirmation failed. `CartCheckoutPage.duck.js` aborted the whole
checkout, so the rest of her cart was never attempted. That single unpaid
transaction expired 15 minutes later on its own.

She saw *"Payment declined. Please check your card details."* No order exists
because none was ever completed — the $100 of items never got as far as a
transaction.

**The `$0.00` shown against it is cosmetic.** `expire-payment` appends
mirror-image negative line items, so the totals net to zero. The real figures
were $25 + $0.41 customer commission − $3.25 provider commission.

**Nothing was charged.** `confirm-payment` never ran, and `expire-payment`
fires `calculate-full-refund` + `stripe-refund-payment` regardless. Worst case
the buyer sees a pending authorisation drop off after a few days. Payment
intent `pi_3UJKkdILEBjcTAYa15DOebCj` if it ever needs checking in Stripe.

**Her cart survived.** Items are only removed from the cart on success, and the
abort path returns before that code runs.

## 2. How often this happens

Every `expire-payment` transaction on the marketplace since launch:

| Month | Failed checkouts |
|---|---|
| May 2026 | 1 |
| Jun 2026 | 5 |
| Jul 2026 | 2 |
| Sep 2026 | 1 |

Nine in total, across six distinct customers — roughly one a month, every one
of them a card problem rather than a platform fault. Alfa's was the first since
July.

## 3. The defect this exposed

The abort guard only fired when the **first** item failed:

```js
// If first item fails (card decline), stop processing
if (i === 0) { return rejectWithValue(...); }
```

A cart checkout creates one transaction per item in sequence, charging the card
each time. So a card that failed on item 3 of 8 left items 1 and 2 **charged**,
items 3–8 never created, and the buyer holding a partial order they never
agreed to. Nobody had hit it — every failure so far happened on the first item —
but it was live, and it gets likelier the more items a cart holds.

Fixed: any payment failure now stops the checkout and unwinds it.

**The awkward part is the refund.** The operator has no refunding transition out
of `pending-acceptance` — only the provider (`decline-order`) or the system
(`auto-decline-order`) does. So the server transitions `decline-order` on the
provider's behalf through the Integration API, which refunds the charge *and*
releases the stock reservation. Refunded items are re-marked as failed so the
results view can't present them as completed orders.

> **Known rough edge:** `decline-order` sends the customer the standard "your
> order was declined" email, which reads oddly when the cause was their own
> card. Money correctness was the priority; a dedicated transition would fix
> the wording properly.

## 4. How we find out now

Two changes, because before them a failed checkout left no order, no email and
no transaction anyone would think to look for.

**Admin → Failed checkouts.** A rolling 200-entry log
(`server/api-util/checkoutFailures.js`, Redis-backed via `settingsStore`),
served by `GET /api/checkout-failures` and rendered in the admin panel. Each row
shows the customer and their email, when it happened, how many items were in the
cart, and the reason. The badge separates the cases that resolved themselves
from the one that needs a human — money taken and the automatic refund failed.

**Cart recovery email.** `default-purchase` v7 adds a notification on
`transition/expire-payment`, which fires 15 minutes after a payment is started
and never confirmed — whether the card failed or the buyer simply closed the
tab. It confirms nothing was charged, names the item, and links back to the
cart. The process previously had no notification on that transition at all,
which is precisely why Alfa heard nothing.

That makes it an abandoned-cart recovery email as much as a failure notice: any
checkout that reaches payment and stops now gets a nudge.

## 5. Caveat worth knowing

**The cart lives in `localStorage`, not on the account** (`ducks/cart.duck.js`,
key `farmfed_cart`). So the recovery email's "pick up where you left off" only
holds on the same device and browser. Abandon on a laptop, open the email on a
phone, and the cart reads as empty.

The email is worded honestly around this — "still saved in the browser you were
shopping in" — rather than promising something that may not be there. Moving the
cart onto the user account is a separate piece of work, and the obvious next
step if recovery emails start converting.

## 6. What shipped

| Change | Where |
|---|---|
| Abort + auto-refund on any payment failure | `src/containers/CartCheckoutPage/CartCheckoutPage.duck.js` |
| Refund + failure recording endpoint | `server/api/checkout-failures.js` |
| Rolling failure log | `server/api-util/checkoutFailures.js` (+ tests) |
| Admin tab | `src/containers/AdminPage/CheckoutFailuresTab/` |
| Cart recovery notification + template | `ext/transaction-processes/default-purchase/` |

`default-purchase/release-1` now points at **version 7**. Orders already in
flight stay on v6, which is expected and harmless.
