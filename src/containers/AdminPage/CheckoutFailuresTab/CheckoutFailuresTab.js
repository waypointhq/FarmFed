import React, { useEffect, useState } from 'react';
import { useIntl } from '../../../util/reactIntl';
import { fetchCheckoutFailures } from '../../../util/api';

import css from './CheckoutFailuresTab.module.css';

const formatWhen = iso => {
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
};

/**
 * Cart checkouts that failed partway.
 *
 * These leave no order, no email and no transaction anyone would think to look
 * for, so without this list the only signal is a customer getting in touch.
 * Every row is someone who tried to buy something and couldn't.
 */
const CheckoutFailuresTab = () => {
  const intl = useIntl();
  const [failures, setFailures] = useState([]);
  const [inProgress, setInProgress] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setInProgress(true);
    fetchCheckoutFailures()
      .then(res => {
        setFailures(res?.failures || []);
        setError(null);
      })
      .catch(e => setError(e))
      .finally(() => setInProgress(false));
  };

  useEffect(load, []);

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div>
          <h2 className={css.title}>
            {intl.formatMessage({ id: 'AdminPage.checkoutFailuresTitle' })}
          </h2>
          <p className={css.blurb}>
            {intl.formatMessage({ id: 'AdminPage.checkoutFailuresBlurb' })}
          </p>
        </div>
        <button type="button" className={css.refresh} onClick={load} disabled={inProgress}>
          {intl.formatMessage({ id: 'AdminPage.checkoutFailuresRefresh' })}
        </button>
      </div>

      {inProgress ? (
        <p className={css.empty}>{intl.formatMessage({ id: 'AdminPage.checkoutFailuresLoading' })}</p>
      ) : error ? (
        <p className={css.error}>{intl.formatMessage({ id: 'AdminPage.checkoutFailuresError' })}</p>
      ) : failures.length === 0 ? (
        <p className={css.empty}>{intl.formatMessage({ id: 'AdminPage.checkoutFailuresEmpty' })}</p>
      ) : (
        <ul className={css.list}>
          {failures.map((failure, index) => {
            const chargedCount = failure.chargedOrderIds?.length || 0;
            const refundFailedCount = failure.refundFailed?.length || 0;

            return (
              <li key={`${failure.at}-${index}`} className={css.row}>
                <div className={css.rowMain}>
                  <span className={css.customer}>
                    {failure.customerName || failure.customerEmail || 'Unknown customer'}
                  </span>
                  <span className={css.meta}>
                    {formatWhen(failure.at)}
                    {failure.itemCount ? ` · ${failure.itemCount} items in cart` : null}
                  </span>
                  <span className={css.reason}>{failure.reason}</span>
                  {failure.customerEmail ? (
                    <a className={css.email} href={`mailto:${failure.customerEmail}`}>
                      {failure.customerEmail}
                    </a>
                  ) : null}
                </div>

                <div className={css.rowSide}>
                  {refundFailedCount > 0 ? (
                    // The one case that needs a human: money was taken and the
                    // automatic refund didn't go through.
                    <span className={css.badgeAlert}>
                      {intl.formatMessage(
                        { id: 'AdminPage.checkoutFailuresRefundFailed' },
                        { count: refundFailedCount }
                      )}
                    </span>
                  ) : chargedCount > 0 ? (
                    <span className={css.badgeOk}>
                      {intl.formatMessage(
                        { id: 'AdminPage.checkoutFailuresRefunded' },
                        { count: failure.refunded?.length || 0 }
                      )}
                    </span>
                  ) : (
                    <span className={css.badgeNeutral}>
                      {intl.formatMessage({ id: 'AdminPage.checkoutFailuresNoCharge' })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CheckoutFailuresTab;
