import React, { useCallback, useEffect, useState } from 'react';

import {
  adminArchivePromo,
  adminDeletePromo,
  adminDuplicatePromo,
  adminFetchPromo,
  adminRevokePromoGift,
  adminSetPromoState,
} from '../../../util/api';
import { formatPromoDate, promoSummarySentence } from '../../../util/promos';
import { StatusBadge, formatCents, usePromoT } from './shared';

import css from './PromotionsTab.module.css';

// Optional link from "Used on orders" to the order in Sharetribe Console,
// e.g. https://console.sharetribe.com/.../transactions/{id}
const CONSOLE_TRANSACTION_URL = process.env.REACT_APP_CONSOLE_TRANSACTION_URL;

const orderNumber = orderGroupId =>
  orderGroupId
    ? `#${orderGroupId
        .replace(/^og-/, '')
        .slice(0, 8)
        .toUpperCase()}`
    : '—';

const OrderLink = ({ redemption }) => {
  const label = orderNumber(redemption.orderGroupId);
  return CONSOLE_TRANSACTION_URL && redemption.transactionId ? (
    <a
      href={CONSOLE_TRANSACTION_URL.replace('{id}', redemption.transactionId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
};

/**
 * One promo: its summary, usage stats, actions, and who used it or holds it.
 *
 * @param {Object} props
 * @param {string} props.promoId
 * @param {number} props.refreshKey bump to reload (e.g. after a gift)
 * @param {Function} props.onBack
 * @param {Function} props.onEdit
 * @param {Function} props.onGift called with the promo
 * @param {Function} props.onOpenPromo open another promo (after Duplicate)
 * @param {Function} props.onToast
 */
const PromoDetail = props => {
  const { promoId, refreshKey, onBack, onEdit, onGift, onOpenPromo, onToast } = props;
  const t = usePromoT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('used');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminFetchPromo(promoId)
      .then(res => {
        setData(res);
        setError(null);
      })
      .catch(e => setError(e?.error || t('loadError')));
  }, [promoId]);

  useEffect(load, [load, refreshKey]);

  const run = (request, successMessage, after) => {
    setBusy(true);
    request()
      .then(res => {
        if (successMessage) onToast(successMessage);
        if (after) after(res);
        else load();
      })
      .catch(e => onToast(e?.error || t('actionError')))
      .finally(() => setBusy(false));
  };

  if (error) return <p className={css.error}>{error}</p>;
  if (!data) return <p className={css.muted}>{t('loading')}</p>;

  const { promo, stats, redemptions, gifts } = data;
  const isArchived = promo.state === 'archived';
  const canPause = promo.state === 'active' && promo.status !== 'expired';
  const canResume = promo.state === 'paused';
  const canGift = promo.state === 'active' && promo.status !== 'expired';
  const neverUsed = promo.uses === 0 && redemptions.length === 0;

  return (
    <div>
      <button type="button" className={css.backLink} onClick={onBack}>
        ← {t('backToList')}
      </button>

      <div className={css.detailTitleRow}>
        <h2 className={css.detailCode}>{promo.code}</h2>
        <StatusBadge status={promo.status} />
      </div>
      {promo.name ? <p className={css.subheading}>{promo.name}</p> : null}
      <p className={css.detailSummary}>{promoSummarySentence(promo)}</p>

      <div className={css.actions}>
        {canGift ? (
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => onGift(promo)}
            disabled={busy}
          >
            {t('detail.gift')}
          </button>
        ) : null}
        {!isArchived ? (
          <button type="button" className={css.secondaryButton} onClick={onEdit} disabled={busy}>
            {t('detail.edit')}
          </button>
        ) : null}
        {canPause ? (
          <button
            type="button"
            className={css.secondaryButton}
            disabled={busy}
            onClick={() => run(() => adminSetPromoState(promo.id, 'paused'), t('detail.paused'))}
          >
            {t('detail.pause')}
          </button>
        ) : null}
        {canResume ? (
          <button
            type="button"
            className={css.secondaryButton}
            disabled={busy}
            onClick={() => run(() => adminSetPromoState(promo.id, 'active'), t('detail.resumed'))}
          >
            {t('detail.resume')}
          </button>
        ) : null}
        <button
          type="button"
          className={css.secondaryButton}
          disabled={busy}
          onClick={() =>
            run(() => adminDuplicatePromo(promo.id), t('detail.duplicated'), res =>
              onOpenPromo(res.promo.id, true)
            )
          }
        >
          {t('detail.duplicate')}
        </button>
        {!isArchived && neverUsed ? (
          <button
            type="button"
            className={css.dangerButton}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('detail.deleteConfirm', { code: promo.code }))) {
                run(() => adminDeletePromo(promo.id), t('detail.deleted'), onBack);
              }
            }}
          >
            {t('detail.delete')}
          </button>
        ) : !isArchived ? (
          <button
            type="button"
            className={css.dangerButton}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('detail.archiveConfirm', { code: promo.code }))) {
                run(() => adminArchivePromo(promo.id), t('detail.archived'));
              }
            }}
          >
            {t('detail.archive')}
          </button>
        ) : null}
      </div>

      <div className={css.stats}>
        <div className={css.statCard}>
          <span className={css.statValue}>{stats.timesUsed}</span>
          <span className={css.statLabel}>{t('stats.timesUsed')}</span>
        </div>
        <div className={css.statCard}>
          <span className={css.statValue}>{stats.usesLeft != null ? stats.usesLeft : '∞'}</span>
          <span className={css.statLabel}>{t('stats.usesLeft')}</span>
        </div>
        <div className={css.statCard}>
          <span className={css.statValue}>{stats.daysLeft != null ? stats.daysLeft : '—'}</span>
          <span className={css.statLabel}>
            {stats.daysLeft != null ? t('stats.daysLeft') : t('stats.noEndDate')}
          </span>
        </div>
        <div className={css.statCard}>
          <span className={css.statValue}>{formatCents(stats.feesCoveredCents)}</span>
          <span className={css.statLabel}>{t('stats.feesCovered')}</span>
        </div>
      </div>

      <div className={css.subTabs} role="tablist">
        {['used', 'gifted'].map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? css.subTabActive : css.subTab}
            onClick={() => setTab(id)}
          >
            {t(`detail.tab.${id}`, { count: id === 'used' ? redemptions.length : gifts.length })}
          </button>
        ))}
      </div>

      {tab === 'used' ? (
        redemptions.length === 0 ? (
          <p className={css.muted}>{t('detail.noUses')}</p>
        ) : (
          <ul className={css.table}>
            {redemptions.map(r => (
              <li key={r.id} className={css.tableRow}>
                <span className={css.tableMain}>
                  <span className={css.tableName}>{r.customerName || t('unnamedCustomer')}</span>
                  <span className={css.tableMeta}>
                    <OrderLink redemption={r} /> · {formatCents(r.deliveryFeeCents, r.currency)}
                  </span>
                </span>
                <span className={css.tableMeta}>{formatPromoDate(r.usedAt || r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )
      ) : gifts.length === 0 ? (
        <p className={css.muted}>{t('detail.noGifts')}</p>
      ) : (
        <ul className={css.table}>
          {gifts.map(g => (
            <li key={g.userId} className={css.tableRow}>
              <span className={css.tableMain}>
                <span className={css.tableName}>{g.customerName || g.customerEmail}</span>
                <span className={css.tableMeta}>
                  {t('detail.giftUsesLeft', { count: g.usesLeft })}
                  {g.expiresAt
                    ? ` · ${t('expiresLabel', { date: formatPromoDate(g.expiresAt) })}`
                    : ''}
                </span>
                <span className={css.tableMeta}>
                  <span className={g.emailSent ? css.yes : css.no}>
                    {g.emailSent ? '✓' : '✗'} {t('detail.email')}
                  </span>
                  {' · '}
                  <span className={g.notificationSent ? css.yes : css.no}>
                    {g.notificationSent ? '✓' : '✗'} {t('detail.notification')}
                  </span>
                </span>
                {g.note ? (
                  <span className={css.tableMeta}>{t('detail.note', { note: g.note })}</span>
                ) : null}
              </span>
              {!g.used ? (
                <button
                  type="button"
                  className={css.linkButton}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => adminRevokePromoGift(promo.id, g.userId),
                      t('detail.revoked', { name: g.customerName || g.customerEmail })
                    )
                  }
                >
                  {t('detail.revoke')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PromoDetail;
