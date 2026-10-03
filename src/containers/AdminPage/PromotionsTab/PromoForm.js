import React, { useEffect, useState } from 'react';

import {
  adminCreatePromo,
  adminFetchPromo,
  adminGeneratePromoCode,
  adminUpdatePromo,
} from '../../../util/api';
import { centralInputsToIso, promoSummarySentence, toCentralInputs } from '../../../util/promos';
import { usePromoT } from './shared';

import css from './PromotionsTab.module.css';

const EXPIRY_TYPES = ['never', 'date', 'uses', 'both'];
// End dates default to the last minute of the day, Central.
const DEFAULT_END_TIME = '23:59';

const emptyValues = {
  code: '',
  name: '',
  title: 'Free Delivery',
  message: '',
  audience: 'public',
  expiryType: 'never',
  endDate: '',
  endTime: DEFAULT_END_TIME,
  maxUses: '',
  perCustomerLimit: '1',
  startDate: '',
  startTime: '00:00',
};

const valuesFromPromo = promo => {
  const end = toCentralInputs(promo.endsAt);
  const start = toCentralInputs(promo.startsAt);
  return {
    code: promo.code,
    name: promo.name || '',
    title: promo.title || '',
    message: promo.message || '',
    audience: promo.audience,
    expiryType: promo.expiryType,
    endDate: end.date,
    endTime: end.time || DEFAULT_END_TIME,
    maxUses: promo.maxUses != null ? String(promo.maxUses) : '',
    perCustomerLimit: String(promo.perCustomerLimit || 1),
    startDate: start.date,
    startTime: start.time || '00:00',
  };
};

const toPayload = values => {
  const hasDate = values.expiryType === 'date' || values.expiryType === 'both';
  const hasUses = values.expiryType === 'uses' || values.expiryType === 'both';
  return {
    code: values.code.trim().toUpperCase(),
    name: values.name,
    title: values.title,
    message: values.message,
    audience: values.audience,
    expiryType: values.expiryType,
    endsAt: hasDate ? centralInputsToIso(values.endDate, values.endTime) : null,
    maxUses: hasUses ? parseInt(values.maxUses, 10) || null : null,
    perCustomerLimit: parseInt(values.perCustomerLimit, 10) || 1,
    startsAt: values.startDate ? centralInputsToIso(values.startDate, values.startTime) : null,
  };
};

/**
 * Create or edit a promo: details, who can use it, expiration, and a summary
 * sentence that updates as the fields change.
 *
 * @param {Object} props
 * @param {string} [props.promoId] edit this promo; omit to create
 * @param {Function} props.onSaved called with the saved promo
 * @param {Function} props.onCancel
 */
const PromoForm = props => {
  const { promoId, onSaved, onCancel } = props;
  const t = usePromoT();
  const [values, setValues] = useState(emptyValues);
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(!!promoId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!promoId) return;
    adminFetchPromo(promoId)
      .then(res => {
        setExisting(res.promo);
        setValues(valuesFromPromo(res.promo));
      })
      .catch(() => setError(t('loadError')))
      .finally(() => setLoading(false));
  }, [promoId]);

  const set = field => e => setValues(v => ({ ...v, [field]: e.target.value }));

  const generate = () =>
    adminGeneratePromoCode()
      .then(res => setValues(v => ({ ...v, code: res.code })))
      .catch(() => setError(t('generateError')));

  const codeLocked = existing && existing.uses > 0;
  const isDraft = !existing || existing.state === 'draft';
  const payload = toPayload(values);

  const save = activate => {
    setSaving(true);
    setError(null);
    const request = existing
      ? adminUpdatePromo(existing.id, {
          ...payload,
          ...(activate ? { state: 'active' } : {}),
        })
      : adminCreatePromo({ ...payload, activate });
    request
      .then(res => onSaved(res.promo))
      .catch(e => setError(e?.error || t('saveError')))
      .finally(() => setSaving(false));
  };

  if (loading) return <p className={css.muted}>{t('loading')}</p>;

  const showDate = values.expiryType === 'date' || values.expiryType === 'both';
  const showUses = values.expiryType === 'uses' || values.expiryType === 'both';

  return (
    <form
      className={css.form}
      onSubmit={e => {
        e.preventDefault();
        save(isDraft);
      }}
    >
      <div>
        <button type="button" className={css.backLink} onClick={onCancel}>
          ← {existing ? t('backToPromo') : t('backToList')}
        </button>
        <h2 className={css.heading}>{existing ? t('editTitle') : t('createTitle')}</h2>
      </div>

      {/* 1. Promo details */}
      <section className={css.formSection}>
        <h3 className={css.formSectionTitle}>{t('form.detailsTitle')}</h3>
        <div className={css.field}>
          <label className={css.label} htmlFor="promo-code">
            {t('form.code')}
          </label>
          <div className={css.codeInputRow}>
            <input
              id="promo-code"
              className={css.codeInput}
              value={values.code}
              onChange={e => setValues(v => ({ ...v, code: e.target.value.toUpperCase() }))}
              placeholder="FREESAT"
              disabled={codeLocked}
              required
              autoComplete="off"
            />
            <button
              type="button"
              className={css.secondaryButton}
              onClick={generate}
              disabled={codeLocked}
            >
              {t('form.generate')}
            </button>
          </div>
          {codeLocked ? <span className={css.hint}>{t('form.codeLocked')}</span> : null}
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="promo-name">
            {t('form.name')}
          </label>
          <input
            id="promo-name"
            className={css.input}
            value={values.name}
            onChange={set('name')}
            placeholder={t('form.namePlaceholder')}
          />
          <span className={css.hint}>{t('form.nameHint')}</span>
        </div>
        <div className={css.row}>
          <div className={css.field}>
            <label className={css.label} htmlFor="promo-title">
              {t('form.customerTitle')}
            </label>
            <input
              id="promo-title"
              className={css.input}
              value={values.title}
              onChange={set('title')}
              maxLength={60}
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="promo-message">
              {t('form.customerMessage')}
            </label>
            <input
              id="promo-message"
              className={css.input}
              value={values.message}
              onChange={set('message')}
              placeholder={t('form.messagePlaceholder')}
              maxLength={280}
            />
          </div>
        </div>
        <span className={css.hint}>{t('form.customerHint')}</span>
      </section>

      {/* 2. Who can use it */}
      <section className={css.formSection}>
        <h3 className={css.formSectionTitle}>{t('form.audienceTitle')}</h3>
        {['public', 'gifted'].map(audience => (
          <label key={audience} className={css.choice}>
            <input
              type="radio"
              name="audience"
              value={audience}
              checked={values.audience === audience}
              onChange={set('audience')}
            />
            <span>
              {t(`form.audience.${audience}`)}
              <span className={css.choiceHint}>{t(`form.audience.${audience}Hint`)}</span>
            </span>
          </label>
        ))}
      </section>

      {/* 3. Expiration */}
      <section className={css.formSection}>
        <h3 className={css.formSectionTitle}>{t('form.expiryTitle')}</h3>
        {EXPIRY_TYPES.map(type => (
          <label key={type} className={css.choice}>
            <input
              type="radio"
              name="expiryType"
              value={type}
              checked={values.expiryType === type}
              onChange={set('expiryType')}
            />
            <span>{t(`form.expiry.${type}`)}</span>
          </label>
        ))}

        {showDate || showUses ? (
          <div className={css.subFields}>
            {showDate ? (
              <div className={css.row}>
                <div className={css.field}>
                  <label className={css.label} htmlFor="promo-end-date">
                    {t('form.endDate')}
                  </label>
                  <input
                    id="promo-end-date"
                    type="date"
                    className={css.input}
                    value={values.endDate}
                    onChange={set('endDate')}
                    required
                  />
                </div>
                <div className={css.field}>
                  <label className={css.label} htmlFor="promo-end-time">
                    {t('form.endTime')}
                  </label>
                  <input
                    id="promo-end-time"
                    type="time"
                    className={css.input}
                    value={values.endTime}
                    onChange={set('endTime')}
                  />
                </div>
              </div>
            ) : null}
            {showUses ? (
              <div className={css.field}>
                <label className={css.label} htmlFor="promo-max-uses">
                  {t('form.maxUses')}
                </label>
                <input
                  id="promo-max-uses"
                  type="number"
                  min={Math.max(1, existing?.uses || 0)}
                  className={css.input}
                  value={values.maxUses}
                  onChange={set('maxUses')}
                  required
                />
                <span className={css.hint}>{t('form.maxUsesHint')}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={css.row}>
          <div className={css.field}>
            <label className={css.label} htmlFor="promo-per-customer">
              {t('form.perCustomer')}
            </label>
            <input
              id="promo-per-customer"
              type="number"
              min="1"
              className={css.input}
              value={values.perCustomerLimit}
              onChange={set('perCustomerLimit')}
            />
          </div>
          <div className={css.field}>
            <label className={css.label} htmlFor="promo-start-date">
              {t('form.startDate')}
            </label>
            <input
              id="promo-start-date"
              type="date"
              className={css.input}
              value={values.startDate}
              onChange={set('startDate')}
            />
            <span className={css.hint}>{t('form.startHint')}</span>
          </div>
        </div>
        <span className={css.hint}>{t('form.timezoneHint')}</span>
      </section>

      {/* 4. Summary */}
      <section>
        <h3 className={css.formSectionTitle}>{t('form.summaryTitle')}</h3>
        <p className={css.summary} aria-live="polite">
          {promoSummarySentence(payload)}
        </p>
      </section>

      {error ? (
        <p className={css.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={css.formActions}>
        {isDraft ? (
          <>
            <button
              type="button"
              className={css.secondaryButton}
              onClick={() => save(false)}
              disabled={saving}
            >
              {t('form.saveDraft')}
            </button>
            <button type="submit" className={css.primaryButton} disabled={saving}>
              {t('form.activate')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={css.secondaryButton} onClick={onCancel}>
              {t('cancel')}
            </button>
            <button type="submit" className={css.primaryButton} disabled={saving}>
              {t('form.saveChanges')}
            </button>
          </>
        )}
      </div>
    </form>
  );
};

export default PromoForm;
