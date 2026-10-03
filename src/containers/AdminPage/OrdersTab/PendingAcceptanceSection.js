import React, { useEffect, useState } from 'react';
import { useIntl, FormattedMessage } from '../../../util/reactIntl';
import {
  fetchOrdersPendingAcceptance,
  adminAcceptOrder,
  notifyTransition,
} from '../../../util/api';

import css from './OrdersTab.module.css';

const OPERATOR_ACCEPT = 'transition/operator-accept-order';
// Flag orders this close to auto-declining.
const URGENT_MS = 6 * 60 * 60 * 1000;

const formatDate = dateStr =>
  new Date(dateStr).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Paid orders the vendor hasn't accepted yet. An admin can accept on the
 * vendor's behalf when the farm is closed (e.g. weekends), so the order isn't
 * auto-declined and refunded after a day.
 *
 * @param {Object} props
 * @param {Function} props.onAccepted called after an accept, so the parent can
 *   refresh its "awaiting delivery" list
 */
const PendingAcceptanceSection = props => {
  const { onAccepted } = props;
  const intl = useIntl();
  const [orders, setOrders] = useState([]);
  const [inProgress, setInProgress] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);
  const [acceptError, setAcceptError] = useState(null);

  const load = () => {
    setInProgress(true);
    fetchOrdersPendingAcceptance()
      .then(res => {
        setOrders(res?.orders || []);
        setFetchError(null);
      })
      .catch(e => setFetchError(e))
      .finally(() => setInProgress(false));
  };

  useEffect(load, []);

  const handleAccept = order => {
    const confirmed = window.confirm(
      intl.formatMessage(
        { id: 'AdminPage.pendingAcceptConfirm' },
        { vendor: order.providerName, listingTitle: order.listingTitle }
      )
    );
    if (!confirmed) return;

    setAcceptingId(order.id);
    setAcceptError(null);
    adminAcceptOrder({ transactionId: order.id })
      .then(() => {
        notifyTransition({ transactionId: order.id, transition: OPERATOR_ACCEPT });
        setOrders(prev => prev.filter(o => o.id !== order.id));
        if (onAccepted) onAccepted();
      })
      .catch(e => {
        setAcceptError(e?.error || intl.formatMessage({ id: 'AdminPage.pendingAcceptError' }));
      })
      .finally(() => setAcceptingId(null));
  };

  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>
        <FormattedMessage id="AdminPage.pendingHeading" />
        {!inProgress && !fetchError ? <span className={css.count}>({orders.length})</span> : null}
      </h3>
      <p className={css.intro}>
        <FormattedMessage id="AdminPage.pendingIntro" />
      </p>

      {acceptError ? <p className={css.error}>{acceptError}</p> : null}

      {inProgress ? (
        <p className={css.loading}>
          <FormattedMessage id="AdminPage.ordersLoading" />
        </p>
      ) : fetchError ? (
        <p className={css.error}>
          <FormattedMessage id="AdminPage.ordersFetchError" />
        </p>
      ) : orders.length === 0 ? (
        <p className={css.emptyState}>
          <FormattedMessage id="AdminPage.pendingEmpty" />
        </p>
      ) : (
        <div className={css.orderList}>
          {orders.map(order => {
            const isAccepting = acceptingId === order.id;
            const isUrgent =
              order.autoDeclineAt && new Date(order.autoDeclineAt) - Date.now() < URGENT_MS;
            const methodLabel =
              order.deliveryMethod === 'shipping'
                ? intl.formatMessage({ id: 'AdminPage.ordersMethodDelivery' })
                : order.deliveryMethod === 'pickup'
                ? intl.formatMessage({ id: 'AdminPage.ordersMethodPickup' })
                : null;

            return (
              <div key={order.id} className={css.orderRow}>
                <div className={css.orderInfo}>
                  <span className={css.orderTitle}>{order.listingTitle}</span>
                  <span className={css.orderMeta}>
                    <FormattedMessage
                      id="AdminPage.ordersMeta"
                      values={{ customer: order.customerName, vendor: order.providerName }}
                    />
                  </span>
                  <span className={css.orderSub}>
                    {methodLabel ? <span className={css.methodBadge}>{methodLabel}</span> : null}
                    {order.autoDeclineAt ? (
                      <span className={isUrgent ? css.deadlineUrgent : css.orderDate}>
                        <FormattedMessage
                          id="AdminPage.pendingAutoDeclines"
                          values={{ when: formatDate(order.autoDeclineAt) }}
                        />
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className={css.orderActions}>
                  <button
                    className={css.markButton}
                    onClick={() => handleAccept(order)}
                    disabled={!!acceptingId}
                    type="button"
                  >
                    {isAccepting ? (
                      <FormattedMessage id="AdminPage.pendingAccepting" />
                    ) : (
                      <FormattedMessage id="AdminPage.pendingAcceptButton" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default PendingAcceptanceSection;
