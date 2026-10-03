import React, { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';

import { adminFetchAllCustomers } from '../../../util/api';
import { usePromoT } from './shared';

import css from './PromotionsTab.module.css';

const KINDS = ['all', 'customer', 'vendor'];

/**
 * Pick any number of people to gift: filter by type, search by name or
 * email, tick individuals, or select everything shown at once.
 *
 * @param {Object} props
 * @param {Array} props.selected [{ id, name, email }]
 * @param {Function} props.onChange called with the new selection
 */
const CustomerMultiSelect = props => {
  const { selected, onChange } = props;
  const t = usePromoT();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState('customer');
  const [query, setQuery] = useState('');

  useEffect(() => {
    adminFetchAllCustomers()
      .then(res => setPeople(res?.customers || []))
      .catch(() => setError(true));
  }, []);

  const selectedIds = useMemo(() => new Set(selected.map(c => c.id)), [selected]);

  const q = query.trim().toLowerCase();
  const shown = (people || []).filter(
    p =>
      (kind === 'all' || p.kind === kind) &&
      (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  );
  const allShownSelected = shown.length > 0 && shown.every(p => selectedIds.has(p.id));

  const toggle = person =>
    onChange(
      selectedIds.has(person.id) ? selected.filter(c => c.id !== person.id) : [...selected, person]
    );

  const toggleAllShown = () => {
    if (allShownSelected) {
      const shownIds = new Set(shown.map(p => p.id));
      onChange(selected.filter(c => !shownIds.has(c.id)));
    } else {
      onChange([...selected, ...shown.filter(p => !selectedIds.has(p.id))]);
    }
  };

  const countFor = k => (people || []).filter(p => k === 'all' || p.kind === k).length;

  return (
    <div className={css.multiSelect}>
      <div className={css.filters} role="group" aria-label={t('gift.typeFilter')}>
        {KINDS.map(k => (
          <button
            key={k}
            type="button"
            className={kind === k ? css.filterChipActive : css.filterChip}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {t(`gift.kind.${k}`)}
            {people ? ` (${countFor(k)})` : ''}
          </button>
        ))}
      </div>

      <input
        className={css.input}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('customerSearchPlaceholder')}
        aria-label={t('customerSearchPlaceholder')}
        autoComplete="off"
      />

      <div className={css.selectBar}>
        <label className={css.checkbox}>
          <input
            type="checkbox"
            checked={allShownSelected}
            onChange={toggleAllShown}
            disabled={shown.length === 0}
          />
          {t('gift.selectAllShown', { count: shown.length })}
        </label>
        <span className={css.selectCount}>
          {t('gift.selectedCount', { count: selected.length })}
          {selected.length > 0 ? (
            <>
              {' · '}
              <button type="button" className={css.linkButton} onClick={() => onChange([])}>
                {t('gift.clear')}
              </button>
            </>
          ) : null}
        </span>
      </div>

      {error ? (
        <p className={css.error}>{t('loadError')}</p>
      ) : people == null ? (
        <p className={css.hint}>{t('loading')}</p>
      ) : shown.length === 0 ? (
        <p className={css.hint}>{t('noCustomers')}</p>
      ) : (
        <ul className={css.peopleList}>
          {shown.map(person => (
            <li key={person.id}>
              <label
                className={classNames(css.person, {
                  [css.personSelected]: selectedIds.has(person.id),
                })}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(person.id)}
                  onChange={() => toggle(person)}
                />
                <span className={css.personText}>
                  <span className={css.resultName}>{person.name || t('unnamedCustomer')}</span>
                  <span className={css.resultEmail}>{person.email}</span>
                </span>
                {person.userType ? <span className={css.personType}>{person.userType}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CustomerMultiSelect;
