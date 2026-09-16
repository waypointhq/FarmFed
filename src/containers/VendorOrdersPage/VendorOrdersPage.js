import React, { useEffect, useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { array, bool, func, object, string } from 'prop-types';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import {
  formatCents,
  formatDeliveryDate,
  shortOrderId,
  SUBORDER_ACCEPTED,
  SUBORDER_PENDING,
  SUBORDER_UNAVAILABLE,
} from '../../util/orderGroups';
import {
  loadSuborders,
  transitionItems,
  ACCEPT_TRANSITION,
  DECLINE_TRANSITION,
} from './VendorOrdersPage.duck';
import {
  Page,
  LayoutSingleColumn,
  NamedLink,
  H3,
  H4,
  IconSpinner,
  PrimaryButton,
  SecondaryButton,
  InlineTextButton,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './VendorOrdersPage.module.css';

const STATUS_LABELS = {
  [SUBORDER_ACCEPTED]: 'VendorOrdersPage.statusAccepted',
  [SUBORDER_UNAVAILABLE]: 'VendorOrdersPage.statusUnavailable',
};

const StatusBadge = ({ status }) => (
  <span className={`${css.badge} ${css[`badge_${status}`] || ''}`}>
    <FormattedMessage id={STATUS_LABELS[status] || 'VendorOrdersPage.statusPending'} />
  </span>
);

/**
 * Everything this vendor needs to pull for the delivery date, totalled across
 * customers — harvest first, then pack the individual orders.
 */
const RollUp = ({ rollUp }) => {
  const [expanded, setExpanded] = useState(true);

  if (rollUp.length === 0) {
    return null;
  }

  return (
    <section className={css.rollUp}>
      <header className={css.rollUpHeader}>
        <H4 as="h2" className={css.rollUpTitle}>
          <FormattedMessage id="VendorOrdersPage.rollUpTitle" />
        </H4>
        <InlineTextButton type="button" onClick={() => setExpanded(!expanded)}>
          <FormattedMessage
            id={expanded ? 'VendorOrdersPage.hide' : 'VendorOrdersPage.show'}
          />
        </InlineTextButton>
      </header>
      {expanded ? (
        <ul className={css.rollUpList}>
          {rollUp.map(sku => (
            <li key={sku.listingId} className={css.rollUpRow}>
              <span className={css.rollUpQuantity}>{sku.quantity}</span>
              <span className={css.rollUpName}>{sku.title}</span>
              <span className={css.rollUpOrders}>
                <FormattedMessage
                  id="VendorOrdersPage.acrossOrders"
                  values={{ count: sku.orderCount }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

/**
 * The money for one suborder (§4). Delivery, tax and the platform's service
 * fee are FarmFed revenue and are deliberately absent — every number here is
 * about this vendor's own items.
 *
 * Which commission model the marketplace runs is a Console setting, so the
 * server reports what the line items actually say and this renders that rather
 * than assuming. Under a customer-side fee, the vendor is paid the full item
 * subtotal and the commission row is the fee FarmFed charged the buyer on top.
 */
const Financials = ({ financials, currency, intl }) => {
  const {
    itemSubtotalCents,
    providerCommissionCents,
    customerCommissionCents,
    vendorNetCents,
    commissionModel,
  } = financials;

  return (
    <div className={css.financials}>
      <div className={css.financialsRow}>
        <span>
          <FormattedMessage id="VendorOrdersPage.customerPaid" />
        </span>
        <span>{formatCents(intl, itemSubtotalCents, currency)}</span>
      </div>
      {providerCommissionCents > 0 ? (
        <div className={css.financialsRow}>
          <span>
            <FormattedMessage id="VendorOrdersPage.commission" />
          </span>
          <span>-{formatCents(intl, providerCommissionCents, currency)}</span>
        </div>
      ) : null}
      {customerCommissionCents > 0 ? (
        <div className={`${css.financialsRow} ${css.financialsNote}`}>
          <span>
            <FormattedMessage id="VendorOrdersPage.buyerServiceFee" />
          </span>
          <span>{formatCents(intl, customerCommissionCents, currency)}</span>
        </div>
      ) : null}
      <div className={`${css.financialsRow} ${css.financialsNet}`}>
        <span>
          <FormattedMessage id="VendorOrdersPage.yourPayout" />
        </span>
        <span>{formatCents(intl, vendorNetCents, currency)}</span>
      </div>
      {commissionModel === 'customer' ? (
        <p className={css.financialsExplainer}>
          <FormattedMessage id="VendorOrdersPage.customerFeeExplainer" />
        </p>
      ) : null}
    </div>
  );
};

const ItemRow = ({ item, currency, busy, onTransition, intl }) => {
  const isPending = item.status === SUBORDER_PENDING;

  return (
    <li className={css.itemRow}>
      {item.imageUrl ? (
        <img className={css.itemImage} src={item.imageUrl} alt={item.title} />
      ) : (
        <div className={css.itemImagePlaceholder} aria-hidden="true" />
      )}
      <span className={css.itemQuantity}>{item.quantity}×</span>
      <div className={css.itemInfo}>
        <span className={css.itemTitle}>{item.title}</span>
        <span className={css.itemMeta}>
          {formatCents(intl, item.unitPriceCents, currency)}
          {' · '}
          {formatCents(intl, item.lineTotalCents, currency)}
        </span>
      </div>
      {isPending ? (
        <div className={css.itemActions}>
          <InlineTextButton
            type="button"
            disabled={busy}
            onClick={() => onTransition([item.transactionId], ACCEPT_TRANSITION)}
          >
            <FormattedMessage id="VendorOrdersPage.accept" />
          </InlineTextButton>
          <InlineTextButton
            type="button"
            className={css.declineButton}
            disabled={busy}
            onClick={() => onTransition([item.transactionId], DECLINE_TRANSITION)}
          >
            <FormattedMessage id="VendorOrdersPage.markUnavailable" />
          </InlineTextButton>
        </div>
      ) : (
        <StatusBadge status={item.status} />
      )}
    </li>
  );
};

const Suborder = ({ suborder, busyIds, onTransition, intl }) => {
  const pendingIds = suborder.items
    .filter(item => item.status === SUBORDER_PENDING)
    .map(item => item.transactionId);
  const busy = suborder.transactionIds.some(id => busyIds.includes(id));
  const deliveryDate = formatDeliveryDate(suborder.deliveryDate, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <section className={css.suborder}>
      <header className={css.suborderHeader}>
        <div>
          <span className={css.customerName}>{suborder.customerName}</span>
          <span className={css.suborderMeta}>
            <FormattedMessage
              id="VendorOrdersPage.orderNumber"
              values={{ id: shortOrderId(suborder.orderGroupId) }}
            />
            {deliveryDate ? ` · ${deliveryDate}` : null}
          </span>
        </div>
        <StatusBadge status={suborder.status} />
      </header>

      <ul className={css.itemList}>
        {suborder.items.map(item => (
          <ItemRow
            key={item.transactionId}
            item={item}
            currency={suborder.currency}
            busy={busy}
            onTransition={onTransition}
            intl={intl}
          />
        ))}
      </ul>

      {pendingIds.length > 0 ? (
        <div className={css.suborderActions}>
          <PrimaryButton
            type="button"
            inProgress={busy}
            disabled={busy}
            onClick={() => onTransition(pendingIds, ACCEPT_TRANSITION)}
          >
            <FormattedMessage
              id="VendorOrdersPage.acceptAll"
              values={{ count: pendingIds.length }}
            />
          </PrimaryButton>
          <SecondaryButton
            type="button"
            disabled={busy}
            onClick={() => onTransition(pendingIds, DECLINE_TRANSITION)}
          >
            <FormattedMessage id="VendorOrdersPage.declineAll" />
          </SecondaryButton>
        </div>
      ) : null}

      <Financials financials={suborder.financials} currency={suborder.currency} intl={intl} />
    </section>
  );
};

/**
 * The vendor's orders for one delivery date: a packing list per customer with
 * accept / mark-unavailable at both item and suborder level, and a per-SKU
 * roll-up across every customer (§3.3 of the consolidated order spec).
 *
 * Four items bought from this farm in one checkout are one suborder here, not
 * four separate inbox rows.
 */
export const VendorOrdersPageComponent = props => {
  const {
    suborders = [],
    rollUp = [],
    deliveryDates = [],
    activeDate = null,
    fetchInProgress = false,
    fetchError = null,
    transitionInProgressIds = [],
    transitionError = null,
    scrollingDisabled = false,
    onLoadSuborders,
    onTransitionItems,
  } = props;
  const intl = useIntl();
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    onLoadSuborders(selectedDate);
  }, [selectedDate, onLoadSuborders]);

  const handleTransition = (transactionIds, transitionName) =>
    onTransitionItems({ transactionIds, transitionName, date: activeDate });

  const title = intl.formatMessage({ id: 'VendorOrdersPage.title' });
  const totalItems = suborders.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="VendorOrdersPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <header className={css.listHeader}>
            <H3 as="h1" className={css.title}>
              <FormattedMessage id="VendorOrdersPage.title" />
            </H3>
            <NamedLink className={css.messagesLink} name="InboxPage" params={{ tab: 'messages' }}>
              <FormattedMessage id="VendorOrdersPage.messagesLink" />
            </NamedLink>
          </header>

          {deliveryDates.length > 1 ? (
            <div className={css.dateTabs}>
              {deliveryDates.map(date => (
                <button
                  key={date}
                  type="button"
                  className={`${css.dateTab} ${date === activeDate ? css.dateTabActive : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  {formatDeliveryDate(date, { month: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
          ) : null}

          {fetchInProgress ? (
            <div className={css.loading}>
              <IconSpinner />
            </div>
          ) : fetchError ? (
            <p className={css.error}>
              <FormattedMessage id="VendorOrdersPage.loadFailed" />
            </p>
          ) : suborders.length === 0 ? (
            <p className={css.empty}>
              <FormattedMessage id="VendorOrdersPage.noOrders" />
            </p>
          ) : (
            <>
              <p className={css.summaryLine}>
                <FormattedMessage
                  id="VendorOrdersPage.summary"
                  values={{ orderCount: suborders.length, itemCount: totalItems }}
                />
              </p>

              <RollUp rollUp={rollUp} />

              {transitionError ? (
                <p className={css.error}>
                  <FormattedMessage id="VendorOrdersPage.transitionFailed" />
                </p>
              ) : null}

              {suborders.map(suborder => (
                <Suborder
                  key={suborder.orderGroupId}
                  suborder={suborder}
                  busyIds={transitionInProgressIds}
                  onTransition={handleTransition}
                  intl={intl}
                />
              ))}
            </>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

VendorOrdersPageComponent.propTypes = {
  suborders: array,
  rollUp: array,
  deliveryDates: array,
  activeDate: string,
  fetchInProgress: bool,
  fetchError: object,
  transitionInProgressIds: array,
  transitionError: object,
  scrollingDisabled: bool,
  onLoadSuborders: func.isRequired,
  onTransitionItems: func.isRequired,
};

const mapStateToProps = state => {
  const {
    suborders,
    rollUp,
    deliveryDates,
    activeDate,
    fetchInProgress,
    fetchError,
    transitionInProgressIds,
    transitionError,
  } = state.VendorOrdersPage;

  return {
    suborders,
    rollUp,
    deliveryDates,
    activeDate,
    fetchInProgress,
    fetchError,
    transitionInProgressIds,
    transitionError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onLoadSuborders: date => dispatch(loadSuborders({ date })),
  onTransitionItems: params => dispatch(transitionItems(params)),
});

const VendorOrdersPage = compose(connect(mapStateToProps, mapDispatchToProps))(
  VendorOrdersPageComponent
);

export default VendorOrdersPage;
