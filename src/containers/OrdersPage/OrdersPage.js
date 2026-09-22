import React, { useEffect } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { array, bool, func, object } from 'prop-types';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import {
  formatCents,
  formatDeliveryDate,
  formatOrderDate,
  shortOrderId,
  SUBORDER_ACCEPTED,
  SUBORDER_UNAVAILABLE,
} from '../../util/orderGroups';
import { loadOrderGroups, loadOrderGroup } from './OrdersPage.duck';
import { Page, LayoutSingleColumn, NamedLink, H3, IconSpinner } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './OrdersPage.module.css';

const STATUS_LABELS = {
  [SUBORDER_ACCEPTED]: 'OrdersPage.statusAccepted',
  [SUBORDER_UNAVAILABLE]: 'OrdersPage.statusUnavailable',
};

const StatusBadge = ({ status }) => (
  <span className={`${css.badge} ${css[`badge_${status}`] || ''}`}>
    <FormattedMessage id={STATUS_LABELS[status] || 'OrdersPage.statusPending'} />
  </span>
);

const ItemRow = ({ item, intl }) => (
  <li className={css.itemRow}>
    {item.imageUrl ? (
      <img className={css.itemImage} src={item.imageUrl} alt={item.title} />
    ) : (
      <div className={css.itemImagePlaceholder} aria-hidden="true" />
    )}
    <div className={css.itemInfo}>
      <span className={css.itemTitle}>{item.title}</span>
      <span className={css.itemMeta}>
        <FormattedMessage
          id="OrdersPage.itemMeta"
          values={{
            quantity: item.quantity,
            unitPrice: formatCents(intl, item.unitPriceCents, item.currency),
          }}
        />
      </span>
    </div>
    <span className={css.itemTotal}>
      {formatCents(intl, item.lineTotalCents, item.currency)}
    </span>
  </li>
);

/**
 * One vendor's slice of the order. Two vendors selling the same product stay
 * in separate sections — they are separate suborders and never merge.
 *
 * The message link opens the conversation on one of this vendor's
 * transactions. Any of them reaches the same vendor, so it uses the first —
 * the point is that arranging a pickup time shouldn't mean hunting through the
 * inbox for the right thread.
 */
const VendorSection = ({ suborder, intl }) => (
  <section className={css.vendorSection}>
    <header className={css.vendorHeader}>
      <NamedLink className={css.vendorName} name="ProfilePage" params={{ id: suborder.vendorId }}>
        {suborder.vendorName}
      </NamedLink>
      <StatusBadge status={suborder.status} />
    </header>
    <ul className={css.itemList}>
      {suborder.items.map(item => (
        <ItemRow key={item.transactionId} item={item} intl={intl} />
      ))}
    </ul>
    {suborder.transactionIds?.length ? (
      <NamedLink
        className={css.messageVendorLink}
        name="OrderDetailsPage"
        params={{ id: suborder.transactionIds[0] }}
      >
        <FormattedMessage
          id="OrdersPage.messageVendor"
          values={{ vendorName: suborder.vendorName }}
        />
      </NamedLink>
    ) : null}
  </section>
);

const TotalsBlock = ({ totals, intl }) => {
  const { currency } = totals;
  const rows = [
    ['OrdersPage.subtotal', totals.subtotalCents, true],
    ['OrdersPage.deliveryFee', totals.deliveryFeeCents, totals.deliveryFeeCents > 0],
    ['OrdersPage.serviceFee', totals.serviceFeeCents, totals.serviceFeeCents > 0],
    ['OrdersPage.tax', totals.taxCents, totals.taxCents > 0],
  ];

  return (
    <div className={css.totals}>
      {rows
        .filter(([, , show]) => show)
        .map(([id, cents]) => (
          <div key={id} className={css.totalsRow}>
            <span>
              <FormattedMessage id={id} />
            </span>
            <span>{formatCents(intl, cents, currency)}</span>
          </div>
        ))}
      <div className={`${css.totalsRow} ${css.totalsGrand}`}>
        <span>
          <FormattedMessage id="OrdersPage.totalPaid" />
        </span>
        <span>{formatCents(intl, totals.totalPaidCents, currency)}</span>
      </div>
    </div>
  );
};

const OrderGroupDetail = ({ orderGroup, intl }) => {
  const deliveryDate = formatDeliveryDate(orderGroup.deliveryDate);
  // A pickup order has a date but nothing is being delivered, so calling it a
  // delivery date reads as a promise we aren't making.
  const isPickup = orderGroup.deliveryMethod === 'pickup';

  return (
    <div className={css.detail}>
      <NamedLink className={css.backLink} name="OrdersPage">
        <FormattedMessage id="OrdersPage.backToOrders" />
      </NamedLink>

      <header className={css.detailHeader}>
        <H3 as="h1" className={css.detailTitle}>
          <FormattedMessage
            id="OrdersPage.orderNumber"
            values={{ id: shortOrderId(orderGroup.id) }}
          />
        </H3>
        <StatusBadge status={orderGroup.status} />
      </header>

      <dl className={css.detailMeta}>
        <div className={css.detailMetaItem}>
          <dt>
            <FormattedMessage id="OrdersPage.orderDate" />
          </dt>
          <dd>{formatOrderDate(orderGroup.createdAt)}</dd>
        </div>
        {deliveryDate ? (
          <div className={css.detailMetaItem}>
            <dt>
              <FormattedMessage
                id={isPickup ? 'OrdersPage.selfPickup' : 'OrdersPage.deliveryDate'}
              />
            </dt>
            <dd>{deliveryDate}</dd>
          </div>
        ) : null}
      </dl>

      {isPickup ? (
        <p className={css.pickupNotice}>
          <FormattedMessage id="OrdersPage.pickupNotice" />
        </p>
      ) : null}

      {orderGroup.suborders.map(suborder => (
        <VendorSection key={suborder.vendorId} suborder={suborder} intl={intl} />
      ))}

      <TotalsBlock totals={orderGroup.totals} intl={intl} />
    </div>
  );
};

const OrderGroupRow = ({ orderGroup, intl }) => {
  const vendorNames = orderGroup.suborders.map(s => s.vendorName).join(', ');
  const deliveryDate = formatDeliveryDate(orderGroup.deliveryDate, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <li className={css.orderRow}>
      <NamedLink
        className={css.orderLink}
        name="OrderGroupPage"
        params={{ groupId: orderGroup.id }}
      >
        <div className={css.orderRowMain}>
          <span className={css.orderRowId}>
            <FormattedMessage
              id="OrdersPage.orderNumber"
              values={{ id: shortOrderId(orderGroup.id) }}
            />
          </span>
          <span className={css.orderRowVendors}>{vendorNames}</span>
          <span className={css.orderRowMeta}>
            <FormattedMessage
              id="OrdersPage.orderRowMeta"
              values={{ itemCount: orderGroup.itemCount, date: formatOrderDate(orderGroup.createdAt) }}
            />
            {deliveryDate ? (
              <>
                {' · '}
                <FormattedMessage
                  id={
                    orderGroup.deliveryMethod === 'pickup'
                      ? 'OrdersPage.readyForPickup'
                      : 'OrdersPage.arriving'
                  }
                  values={{ date: deliveryDate }}
                />
              </>
            ) : null}
          </span>
        </div>
        <div className={css.orderRowSide}>
          <span className={css.orderRowTotal}>
            {formatCents(intl, orderGroup.totals.totalPaidCents, orderGroup.totals.currency)}
          </span>
          <StatusBadge status={orderGroup.status} />
        </div>
      </NamedLink>
    </li>
  );
};

/**
 * The customer's orders: one row per checkout, not one per line item, and a
 * detail view that groups the items under the vendor that sold them (§3.1 of
 * the consolidated order spec). A single-item order renders through exactly
 * the same structure as a ten-item one.
 */
export const OrdersPageComponent = props => {
  const {
    orderGroups = [],
    orderGroup = null,
    fetchInProgress = false,
    fetchError = null,
    scrollingDisabled = false,
    params = {},
    onLoadOrderGroups,
    onLoadOrderGroup,
  } = props;
  const intl = useIntl();
  const groupId = params.groupId;

  useEffect(() => {
    if (groupId) {
      onLoadOrderGroup(groupId);
    } else {
      onLoadOrderGroups();
    }
  }, [groupId, onLoadOrderGroup, onLoadOrderGroups]);

  const title = intl.formatMessage({ id: 'OrdersPage.title' });

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="OrdersPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {fetchInProgress ? (
            <div className={css.loading}>
              <IconSpinner />
            </div>
          ) : fetchError ? (
            <p className={css.error}>
              <FormattedMessage id="OrdersPage.loadFailed" />
            </p>
          ) : groupId ? (
            orderGroup ? (
              <OrderGroupDetail orderGroup={orderGroup} intl={intl} />
            ) : (
              <p className={css.empty}>
                <FormattedMessage id="OrdersPage.notFound" />
              </p>
            )
          ) : (
            <>
              <header className={css.listHeader}>
                <H3 as="h1" className={css.title}>
                  <FormattedMessage id="OrdersPage.title" />
                </H3>
                <NamedLink className={css.messagesLink} name="InboxPage" params={{ tab: 'messages' }}>
                  <FormattedMessage id="OrdersPage.messagesLink" />
                </NamedLink>
              </header>
              {orderGroups.length === 0 ? (
                <p className={css.empty}>
                  <FormattedMessage id="OrdersPage.noOrders" />
                </p>
              ) : (
                <ul className={css.orderList}>
                  {orderGroups.map(group => (
                    <OrderGroupRow key={group.id} orderGroup={group} intl={intl} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

OrdersPageComponent.propTypes = {
  orderGroups: array,
  orderGroup: object,
  fetchInProgress: bool,
  fetchError: object,
  scrollingDisabled: bool,
  params: object,
  onLoadOrderGroups: func.isRequired,
  onLoadOrderGroup: func.isRequired,
};

const mapStateToProps = state => {
  const { orderGroups, orderGroup, fetchInProgress, fetchError } = state.OrdersPage;
  return {
    orderGroups,
    orderGroup,
    fetchInProgress,
    fetchError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onLoadOrderGroups: () => dispatch(loadOrderGroups()),
  onLoadOrderGroup: id => dispatch(loadOrderGroup({ id })),
});

const OrdersPage = compose(connect(mapStateToProps, mapDispatchToProps))(OrdersPageComponent);

export default OrdersPage;
