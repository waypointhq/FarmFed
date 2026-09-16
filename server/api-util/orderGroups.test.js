const {
  groupTransactions,
  toOrderGroup,
  financialsFor,
  groupTotals,
  itemStatus,
  rollUpStatus,
  buildIncludedIndex,
  generateOrderGroupId,
  SUBORDER_PENDING,
  SUBORDER_ACCEPTED,
  SUBORDER_UNAVAILABLE,
} = require('./orderGroups');

const money = (amount, currency = 'USD') => ({ amount, currency });

// Minimal stand-in for a transaction as the SDK returns it.
const tx = ({
  id,
  orderGroupId,
  provider = 'vendor-1',
  customer = 'buyer-1',
  listing = 'listing-1',
  quantity = 1,
  unitPrice = 900,
  lastTransition = 'transition/confirm-payment',
  createdAt = '2026-09-01T10:00:00.000Z',
  deliveryDate = '2026-09-04',
  deliveryMethod = 'shipping',
  extraLineItems = [],
  isDeliveryOrder = false,
  payinTotal,
}) => ({
  id: { uuid: id },
  attributes: {
    createdAt,
    lastTransition,
    payinTotal: money(payinTotal != null ? payinTotal : unitPrice * quantity),
    protectedData: { orderGroupId, deliveryDate, deliveryMethod, ...(isDeliveryOrder ? { isDeliveryOrder: true } : {}) },
    lineItems: [
      ...(isDeliveryOrder
        ? []
        : [
            {
              code: 'line-item/item',
              unitPrice: money(unitPrice),
              quantity,
              lineTotal: money(unitPrice * quantity),
            },
          ]),
      ...extraLineItems,
    ],
  },
  relationships: {
    provider: { data: { id: { uuid: provider } } },
    customer: { data: { id: { uuid: customer } } },
    listing: { data: { id: { uuid: listing } } },
  },
});

const included = [
  { type: 'user', id: { uuid: 'vendor-1' }, attributes: { profile: { displayName: 'Green Acres' } } },
  { type: 'user', id: { uuid: 'vendor-2' }, attributes: { profile: { displayName: 'Blue Barn' } } },
  { type: 'user', id: { uuid: 'buyer-1' }, attributes: { profile: { displayName: 'Madi' } } },
  { type: 'listing', id: { uuid: 'listing-1' }, attributes: { title: 'Ground Beef 1lb' } },
  { type: 'listing', id: { uuid: 'listing-2' }, attributes: { title: 'Eggs, dozen' } },
];

describe('generateOrderGroupId()', () => {
  it('produces unique prefixed ids', () => {
    const a = generateOrderGroupId();
    const b = generateOrderGroupId();
    expect(a).toMatch(/^og-/);
    expect(a).not.toEqual(b);
  });
});

describe('groupTransactions()', () => {
  it('groups transactions that share an order group id', () => {
    const groups = groupTransactions([
      tx({ id: 'tx-1', orderGroupId: 'og-a' }),
      tx({ id: 'tx-2', orderGroupId: 'og-a' }),
      tx({ id: 'tx-3', orderGroupId: 'og-b' }),
    ]);

    expect(groups.size).toBe(2);
    expect(groups.get('og-a')).toHaveLength(2);
    expect(groups.get('og-b')).toHaveLength(1);
  });

  it('falls back to a group of one for orders placed before group ids existed', () => {
    const legacy = tx({ id: 'tx-legacy', orderGroupId: undefined });
    const groups = groupTransactions([legacy]);

    expect(Array.from(groups.keys())).toEqual(['tx-legacy']);
  });
});

describe('itemStatus() / rollUpStatus()', () => {
  it('maps transitions onto the badge set', () => {
    expect(itemStatus(tx({ id: 'a', lastTransition: 'transition/confirm-payment' }))).toBe(
      SUBORDER_PENDING
    );
    expect(itemStatus(tx({ id: 'b', lastTransition: 'transition/accept-order' }))).toBe(
      SUBORDER_ACCEPTED
    );
    expect(itemStatus(tx({ id: 'c', lastTransition: 'transition/decline-order' }))).toBe(
      SUBORDER_UNAVAILABLE
    );
    expect(itemStatus(tx({ id: 'd', lastTransition: 'transition/auto-decline-order' }))).toBe(
      SUBORDER_UNAVAILABLE
    );
  });

  it('treats an unknown transition as pending rather than confirmed', () => {
    expect(itemStatus(tx({ id: 'e', lastTransition: 'transition/something-new' }))).toBe(
      SUBORDER_PENDING
    );
  });

  it('is unavailable only when every item is, and pending while any is', () => {
    expect(
      rollUpStatus([{ status: SUBORDER_UNAVAILABLE }, { status: SUBORDER_UNAVAILABLE }])
    ).toBe(SUBORDER_UNAVAILABLE);
    expect(rollUpStatus([{ status: SUBORDER_ACCEPTED }, { status: SUBORDER_UNAVAILABLE }])).toBe(
      SUBORDER_ACCEPTED
    );
    expect(rollUpStatus([{ status: SUBORDER_ACCEPTED }, { status: SUBORDER_PENDING }])).toBe(
      SUBORDER_PENDING
    );
  });
});

describe('financialsFor()', () => {
  it('reports a customer-side commission without reducing the payout', () => {
    const transactions = [
      tx({
        id: 'tx-1',
        orderGroupId: 'og-a',
        unitPrice: 900,
        quantity: 3,
        extraLineItems: [
          { code: 'line-item/customer-commission', unitPrice: money(405), quantity: 1, lineTotal: money(405) },
        ],
      }),
    ];

    expect(financialsFor(transactions)).toEqual({
      itemSubtotalCents: 2700,
      providerCommissionCents: 0,
      customerCommissionCents: 405,
      platformRevenueCents: 405,
      vendorNetCents: 2700,
      commissionModel: 'customer',
    });
  });

  it('deducts a provider-side commission from the payout', () => {
    const transactions = [
      tx({
        id: 'tx-1',
        orderGroupId: 'og-a',
        unitPrice: 900,
        quantity: 3,
        extraLineItems: [
          {
            code: 'line-item/provider-commission',
            unitPrice: money(-405),
            quantity: 1,
            lineTotal: money(-405),
          },
        ],
      }),
    ];

    const result = financialsFor(transactions);
    expect(result.providerCommissionCents).toBe(405);
    expect(result.vendorNetCents).toBe(2295);
    expect(result.commissionModel).toBe('provider');
  });

  it('excludes delivery, tax and the processing fee from every vendor figure', () => {
    const transactions = [
      tx({
        id: 'tx-1',
        orderGroupId: 'og-a',
        unitPrice: 1000,
        quantity: 1,
        extraLineItems: [
          { code: 'line-item/shipping-fee', unitPrice: money(1200), quantity: 1, lineTotal: money(1200) },
          { code: 'line-item/sales-tax', unitPrice: money(80), quantity: 1, lineTotal: money(80) },
          { code: 'line-item/processing-fee', unitPrice: money(30), quantity: 1, lineTotal: money(30) },
        ],
      }),
    ];

    const result = financialsFor(transactions);
    expect(result.itemSubtotalCents).toBe(1000);
    expect(result.vendorNetCents).toBe(1000);
    expect(result.platformRevenueCents).toBe(0);
  });
});

describe('groupTotals()', () => {
  it('takes the total paid from the transactions payin totals', () => {
    const transactions = [
      tx({
        id: 'tx-1',
        orderGroupId: 'og-a',
        unitPrice: 900,
        quantity: 3,
        payinTotal: 3185,
        extraLineItems: [
          { code: 'line-item/customer-commission', unitPrice: money(405), quantity: 1, lineTotal: money(405) },
          { code: 'line-item/sales-tax', unitPrice: money(80), quantity: 1, lineTotal: money(80) },
        ],
      }),
      tx({
        id: 'tx-delivery',
        orderGroupId: 'og-a',
        isDeliveryOrder: true,
        payinTotal: 1200,
        extraLineItems: [
          { code: 'line-item/delivery', unitPrice: money(1200), quantity: 1, lineTotal: money(1200) },
        ],
      }),
    ];

    expect(groupTotals(transactions)).toEqual({
      subtotalCents: 2700,
      deliveryFeeCents: 1200,
      taxCents: 80,
      serviceFeeCents: 405,
      totalPaidCents: 4385,
      currency: 'USD',
    });
  });
});

describe('toOrderGroup()', () => {
  const findIncluded = buildIncludedIndex(included);

  it('splits a cart across two vendors into one suborder each', () => {
    const transactions = [
      tx({ id: 'tx-1', orderGroupId: 'og-a', provider: 'vendor-1', listing: 'listing-1' }),
      tx({ id: 'tx-2', orderGroupId: 'og-a', provider: 'vendor-1', listing: 'listing-2' }),
      tx({ id: 'tx-3', orderGroupId: 'og-a', provider: 'vendor-2', listing: 'listing-2' }),
    ];

    const group = toOrderGroup('og-a', transactions, findIncluded);

    expect(group.itemCount).toBe(3);
    expect(group.suborders).toHaveLength(2);
    expect(group.suborders.map(s => s.vendorName).sort()).toEqual(['Blue Barn', 'Green Acres']);
    expect(group.suborders.find(s => s.vendorId === 'vendor-1').items).toHaveLength(2);
  });

  it('keeps the same product from two vendors in separate suborders', () => {
    const transactions = [
      tx({ id: 'tx-1', orderGroupId: 'og-a', provider: 'vendor-1', listing: 'listing-1' }),
      tx({ id: 'tx-2', orderGroupId: 'og-a', provider: 'vendor-2', listing: 'listing-1' }),
    ];

    const group = toOrderGroup('og-a', transactions, findIncluded);
    expect(group.suborders).toHaveLength(2);
  });

  it('renders a single-item order through the same structure', () => {
    const group = toOrderGroup('og-a', [tx({ id: 'tx-1', orderGroupId: 'og-a' })], findIncluded);

    expect(group.itemCount).toBe(1);
    expect(group.suborders).toHaveLength(1);
    expect(group.suborders[0].items).toHaveLength(1);
    expect(group.totals.totalPaidCents).toBe(900);
  });

  it('leaves declined items out of the vendor money but keeps them on the packing list', () => {
    const transactions = [
      tx({ id: 'tx-1', orderGroupId: 'og-a', unitPrice: 900, lastTransition: 'transition/accept-order' }),
      tx({
        id: 'tx-2',
        orderGroupId: 'og-a',
        unitPrice: 700,
        listing: 'listing-2',
        lastTransition: 'transition/decline-order',
      }),
    ];

    const group = toOrderGroup('og-a', transactions, findIncluded);
    const suborder = group.suborders[0];

    expect(suborder.items).toHaveLength(2);
    expect(suborder.financials.itemSubtotalCents).toBe(900);
    expect(suborder.status).toBe(SUBORDER_ACCEPTED);
  });

  it('carries the delivery date and method frozen onto the order', () => {
    const group = toOrderGroup('og-a', [tx({ id: 'tx-1', orderGroupId: 'og-a' })], findIncluded);

    expect(group.deliveryDate).toBe('2026-09-04');
    expect(group.deliveryMethod).toBe('shipping');
    expect(group.customerName).toBe('Madi');
  });
});
