import React, { useCallback, useEffect, useState } from 'react';

import { adminFetchCustomerPromos, adminRevokePromoGift } from '../../../util/api';
import { formatPromoDate } from '../../../util/promos';
import { usePromoT } from './shared';

import css from './PromotionsTab.module.css';

/**
 * A customer's promo profile: their gifted promos, a Gift Free Delivery
 * button (the fast way to make up for a late or missing delivery), and
 * Revoke for unused gifts.
 *
 * @param {Object} props
 * @param {string} props.userId
 * @param {number} props.refreshKey bump to reload (e.g. after a gift)
 * @param {Function} props.onBack
 * @param {Function} props.onGift called with the customer
 * @param {Function} props.onOpenPromo
 * @param {Function} props.onToast
 */
const CustomerPromos = props => {
  const { userId, refreshKey, onBack, onGift, onOpenPromo, onToast } = props;
  const t = usePromoT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminFetchCustomerPromos(userId)
      .then(res => {
        setData(res);
        setError(null);
      })
      .catch(e => setError(e?.error || t('loadError')));
  }, [userId]);

  useEffect(load, [load, refreshKey]);

  if (error) return <p className={css.error}>{error}</p>;
  if (!data) return <p className={css.muted}>{t('loading')}</p>;

  const { customer, gifts } = data;

  const revoke = gift => {
    setBusy(true);
    adminRevokePromoGift(gift.promoId, userId)
      .then(() => {
        onToast(t('detail.revoked', { name: customer.name || customer.email }));
        load();
      })
      .catch(e => onToast(e?.error || t('actionError')))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <button type="button" className={css.backLink} onClick={onBack}>
        ← {t('backToList')}
      </button>
      <div className={css.header}>
        <div>
          <h2 className={css.heading}>{customer.name || t('unnamedCustomer')}</h2>
          <p className={css.subheading}>{customer.email}</p>
        </div>
        <button type="button" className={css.primaryButton} onClick={() => onGift(customer)}>
          {t('giftFreeDelivery')}
        </button>
      </div>

      <h3 className={css.sectionTitle}>{t('customer.giftsTitle')}</h3>
      {gifts.length === 0 ? (
        <p className={css.muted}>{t('customer.noGifts')}</p>
      ) : (
        <ul className={css.table}>
          {gifts.map(g => (
            <li key={g.promoId} className={css.tableRow}>
              <span className={css.tableMain}>
                <button
                  type="button"
                  className={css.linkButton}
                  onClick={() => onOpenPromo(g.promoId)}
                >
                  {g.code}
                </button>
                <span className={css.tableMeta}>
                  {t('detail.giftUsesLeft', { count: g.usesLeft })}
                  {g.expiresAt
                    ? ` · ${t('expiresLabel', { date: formatPromoDate(g.expiresAt) })}`
                    : ''}
                </span>
                {g.message ? <span className={css.tableMeta}>“{g.message}”</span> : null}
                {g.note ? (
                  <span className={css.tableMeta}>{t('detail.note', { note: g.note })}</span>
                ) : null}
              </span>
              {!g.used ? (
                <button
                  type="button"
                  className={css.linkButton}
                  onClick={() => revoke(g)}
                  disabled={busy}
                >
                  {t('detail.revoke')}
                </button>
              ) : (
                <span className={css.tableMeta}>{t('customer.used')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CustomerPromos;
