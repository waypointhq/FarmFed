import React, { useEffect, useRef, useState } from 'react';

import { adminFetchPromos, adminGiftPromo } from '../../../util/api';
import { centralDatePlusDays } from '../../../util/promos';
import { usePromoT } from './shared';
import CustomerMultiSelect from './CustomerMultiSelect';

import css from './PromotionsTab.module.css';

const NEW_PERSONAL = 'new';
const DEFAULT_EXPIRY_DAYS = 30;
// Ask before sending to this many people or more.
const CONFIRM_FROM = 10;

/**
 * The Gift Free Delivery window. Opened from a promo (customers to pick) or
 * from a customer (promo defaults to a new one-time personal code).
 *
 * @param {Object} props
 * @param {string} [props.promoId] preselected promo
 * @param {Array} [props.customers] preselected customers [{ id, name, email }]
 * @param {Function} props.onClose
 * @param {Function} props.onSent called with the server's per-customer results
 */
const GiftModal = props => {
  const { promoId, customers: initialCustomers = [], onClose, onSent } = props;
  const t = usePromoT();
  const dialogRef = useRef(null);
  const [activePromos, setActivePromos] = useState([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [customers, setCustomers] = useState(initialCustomers);
  const [values, setValues] = useState({
    promoId: promoId || NEW_PERSONAL,
    uses: '1',
    expiresOn: centralDatePlusDays(DEFAULT_EXPIRY_DAYS),
    message: '',
    note: '',
    sendEmail: true,
    sendNotification: true,
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminFetchPromos()
      .then(res => {
        // Active promos, plus the one this window was opened from (e.g. a
        // scheduled promo), so the dropdown shows what will be sent.
        setActivePromos((res?.promos || []).filter(p => p.status === 'active' || p.id === promoId));
        setEmailConfigured(res?.emailConfigured !== false);
      })
      .catch(() => null);
  }, []);

  // Esc closes; focus starts inside the window.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector('input, select')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = field => e =>
    setValues(v => ({
      ...v,
      [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

  const send = e => {
    e.preventDefault();
    if (customers.length === 0) {
      setError(t('gift.pickCustomer'));
      return;
    }
    if (
      customers.length >= CONFIRM_FROM &&
      !window.confirm(t('gift.confirmMany', { count: customers.length }))
    ) {
      return;
    }
    setSending(true);
    setError(null);
    adminGiftPromo({
      promoId: values.promoId,
      userIds: customers.map(c => c.id),
      uses: parseInt(values.uses, 10) || 1,
      expiresAt: values.expiresOn || null,
      message: values.message,
      note: values.note,
      sendEmail: values.sendEmail,
      sendNotification: values.sendNotification,
    })
      .then(res => onSent(res.results || [], { emailRequested: values.sendEmail }))
      .catch(err => setError(err?.error || t('gift.error')))
      .finally(() => setSending(false));
  };

  return (
    <div
      className={css.overlay}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-dialog-title"
        onSubmit={send}
      >
        <h2 id="gift-dialog-title" className={css.dialogTitle}>
          {t('gift.title')}
        </h2>

        <div className={css.field}>
          <span className={css.label}>{t('gift.customers')}</span>
          <CustomerMultiSelect selected={customers} onChange={setCustomers} />
        </div>

        <div className={css.field}>
          <label className={css.label} htmlFor="gift-promo">
            {t('gift.promo')}
          </label>
          <select
            id="gift-promo"
            className={css.select}
            value={values.promoId}
            onChange={set('promoId')}
          >
            <option value={NEW_PERSONAL}>
              {customers.length > 1 ? t('gift.newGroup') : t('gift.newPersonal')}
            </option>
            {activePromos.map(p => (
              <option key={p.id} value={p.id}>
                {p.code}
                {p.name ? ` · ${p.name}` : ''}
              </option>
            ))}
          </select>
          {values.promoId === NEW_PERSONAL ? (
            <span className={css.hint}>
              {customers.length > 1 ? t('gift.newGroupHint') : t('gift.newPersonalHint')}
            </span>
          ) : null}
        </div>

        <div className={css.row}>
          <div className={css.field}>
            <label className={css.label} htmlFor="gift-uses">
              {t('gift.uses')}
            </label>
            <input
              id="gift-uses"
              type="number"
              min="1"
              className={css.input}
              value={values.uses}
              onChange={set('uses')}
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="gift-expires">
              {t('gift.expires')}
            </label>
            <input
              id="gift-expires"
              type="date"
              className={css.input}
              value={values.expiresOn}
              onChange={set('expiresOn')}
            />
          </div>
        </div>

        <div className={css.field}>
          <label className={css.label} htmlFor="gift-message">
            {t('gift.message')}
          </label>
          <textarea
            id="gift-message"
            className={css.textarea}
            value={values.message}
            onChange={set('message')}
            placeholder={t('gift.messagePlaceholder')}
            maxLength={280}
          />
          <span className={css.hint}>{t('gift.messageHint')}</span>
        </div>

        <div className={css.field}>
          <label className={css.label} htmlFor="gift-note">
            {t('gift.note')}
          </label>
          <input
            id="gift-note"
            className={css.input}
            value={values.note}
            onChange={set('note')}
            placeholder={t('gift.notePlaceholder')}
          />
        </div>

        <div className={css.field}>
          <label className={css.checkbox}>
            <input type="checkbox" checked={values.sendEmail} onChange={set('sendEmail')} />
            {t('gift.sendEmail')}
          </label>
          {!emailConfigured && values.sendEmail ? (
            <span className={css.hint}>{t('gift.emailNotConfigured')}</span>
          ) : null}
          <label className={css.checkbox}>
            <input
              type="checkbox"
              checked={values.sendNotification}
              onChange={set('sendNotification')}
            />
            {t('gift.sendNotification')}
          </label>
        </div>

        {error ? (
          <p className={css.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={css.formActions}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className={css.primaryButton} disabled={sending}>
            {sending
              ? t('gift.sending')
              : customers.length > 1
              ? t('gift.sendTo', { count: customers.length })
              : t('gift.send')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GiftModal;
