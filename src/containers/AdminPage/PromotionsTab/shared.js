import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { useIntl } from '../../../util/reactIntl';
import { adminSearchCustomers } from '../../../util/api';
import { formatPromoDate } from '../../../util/promos';

import css from './PromotionsTab.module.css';

/**
 * Translator for the Promotions tab's copy (AdminPage.promos.*).
 */
export const usePromoT = () => {
  const intl = useIntl();
  return (id, values) => intl.formatMessage({ id: `AdminPage.promos.${id}` }, values);
};

export const formatCents = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);

export const StatusBadge = ({ status }) => {
  const t = usePromoT();
  return (
    <span className={classNames(css.badge, css[`badge_${status}`])}>{t(`status.${status}`)}</span>
  );
};

/** "37 of 100", or just "37" when there's no limit. */
export const usesLabel = (promo, t) =>
  promo.maxUses != null
    ? t('usesOf', { uses: promo.uses, max: promo.maxUses })
    : t('usesCount', { uses: promo.uses });

export const expiresLabel = (promo, t) =>
  promo.endsAt ? formatPromoDate(promo.endsAt) : t('never');

/**
 * Search customers by name or email and pick one or more.
 *
 * @param {Object} props
 * @param {Array} props.selected [{ id, name, email }]
 * @param {Function} props.onChange called with the new selection
 * @param {boolean} [props.multiple]
 */
export const CustomerPicker = props => {
  const { selected, onChange, multiple = true, inputId } = props;
  const t = usePromoT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    timer.current = setTimeout(() => {
      setSearching(true);
      adminSearchCustomers(query.trim())
        .then(res => setResults(res?.customers || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query]);

  const pick = customer => {
    const next = multiple ? [...selected.filter(c => c.id !== customer.id), customer] : [customer];
    onChange(next);
    setQuery('');
    setResults([]);
  };

  const remaining = results.filter(r => !selected.some(s => s.id === r.id));

  return (
    <div>
      {selected.length > 0 && multiple ? (
        <div className={classNames(css.chips, css.chipsSpaced)}>
          {selected.map(c => (
            <span key={c.id} className={css.chip}>
              {c.name || c.email}
              <button
                type="button"
                className={css.chipRemove}
                onClick={() => onChange(selected.filter(s => s.id !== c.id))}
                aria-label={t('removeCustomer', { name: c.name || c.email })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        id={inputId}
        className={css.input}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('customerSearchPlaceholder')}
        autoComplete="off"
      />
      {searching ? <p className={css.hint}>{t('searching')}</p> : null}
      {remaining.length > 0 ? (
        <ul className={css.results}>
          {remaining.map(c => (
            <li key={c.id}>
              <button type="button" className={css.result} onClick={() => pick(c)}>
                <span className={css.resultName}>{c.name || t('unnamedCustomer')}</span>
                <span className={css.resultEmail}>{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 && !searching ? (
        <p className={css.hint}>{t('noCustomers')}</p>
      ) : null}
    </div>
  );
};
