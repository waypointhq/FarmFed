import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { adminFetchPromos } from '../../../util/api';
import { StatusBadge, CustomerSearch, usePromoT, usesLabel, expiresLabel } from './shared';

import css from './PromotionsTab.module.css';

const FILTERS = ['all', 'active', 'scheduled', 'paused', 'expired'];

/**
 * All promos, newest first, with search and a status filter. Also where an
 * admin looks up a customer to gift to or revoke from.
 */
const PromoList = props => {
  const { onOpen, onCreate, onGift, onOpenCustomer } = props;
  const t = usePromoT();
  const [promos, setPromos] = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    adminFetchPromos()
      .then(res => {
        setPromos(res?.promos || []);
        setEmailConfigured(res?.emailConfigured !== false);
      })
      .catch(e => setError(e));
  }, []);

  const q = query.trim().toLowerCase();
  const visible = (promos || []).filter(
    p =>
      (filter === 'all' || p.status === filter) &&
      (!q || p.code.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q))
  );

  return (
    <div>
      <div className={css.header}>
        <div>
          <h2 className={css.heading}>{t('title')}</h2>
          <p className={css.subheading}>{t('intro')}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.secondaryButton} onClick={() => onGift()}>
            {t('giftFreeDelivery')}
          </button>
          <button type="button" className={css.primaryButton} onClick={onCreate}>
            {t('createPromo')}
          </button>
        </div>
      </div>

      {!emailConfigured ? <p className={css.notice}>{t('emailNotConfigured')}</p> : null}

      <div className={css.toolbar}>
        <input
          className={css.searchInput}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
        />
        <div className={css.filters} role="group" aria-label={t('statusFilter')}>
          {FILTERS.map(f => (
            <button
              key={f}
              type="button"
              className={filter === f ? css.filterChipActive : css.filterChip}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(`filter.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={css.error}>{t('loadError')}</p>
      ) : promos == null ? (
        <p className={css.muted}>{t('loading')}</p>
      ) : visible.length === 0 ? (
        <p className={css.muted}>{promos.length === 0 ? t('emptyAll') : t('emptyFiltered')}</p>
      ) : (
        <ul className={css.promoList}>
          {visible.map(promo => (
            <li key={promo.id}>
              <button type="button" className={css.promoRow} onClick={() => onOpen(promo.id)}>
                <span>
                  <span className={css.promoCode}>{promo.code}</span>
                  {promo.name ? <span className={css.promoName}> · {promo.name}</span> : null}
                </span>
                <StatusBadge status={promo.status} />
                <span className={css.promoMeta}>
                  <span>{promo.audience === 'gifted' ? t('giftedOnly') : t('everyone')}</span>
                  <span>{t('usesLabel', { uses: usesLabel(promo, t) })}</span>
                  <span>{t('expiresLabel', { date: expiresLabel(promo, t) })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className={classNames(css.customerLookup)}>
        <h3 className={css.sectionTitle}>{t('customerLookupTitle')}</h3>
        <p className={css.hint}>{t('customerLookupHint')}</p>
        <CustomerSearch onPick={customer => onOpenCustomer(customer.id)} />
      </section>
    </div>
  );
};

export default PromoList;
