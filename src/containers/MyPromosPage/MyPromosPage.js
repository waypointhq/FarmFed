import React, { useCallback, useEffect, useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { clearPromoBadgeCache } from '../../util/usePromoBadge';
import { fetchMyPromos, markPromosSeen, savePromoCode } from '../../util/api';
import { formatPromoDate, promoReasonMessageId } from '../../util/promos';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn, NamedLink, H3, IconSpinner } from '../../components';
import PromoCard from '../../components/PromoCard/PromoCard';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './MyPromosPage.module.css';

const TABS = ['active', 'used', 'expired'];

const AddPromoCode = ({ onAdded }) => {
  const intl = useIntl();
  const [code, setCode] = useState('');
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(null);

  const submit = e => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setInProgress(true);
    setError(null);
    setAdded(null);
    savePromoCode({ code: trimmed })
      .then(res => {
        if (res.ok) {
          setAdded(res.promo.code);
          setCode('');
          onAdded();
        } else {
          setError({ reason: res.reason, date: res.date });
        }
      })
      .catch(() => setError({ reason: 'unavailable' }))
      .finally(() => setInProgress(false));
  };

  return (
    <form className={css.addForm} onSubmit={submit}>
      <label className={css.addLabel} htmlFor="add-promo-code">
        <FormattedMessage id="MyPromosPage.addLabel" />
      </label>
      <div className={css.addRow}>
        <input
          id="add-promo-code"
          className={css.addInput}
          value={code}
          onChange={e => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder={intl.formatMessage({ id: 'MyPromosPage.addPlaceholder' })}
          autoCapitalize="characters"
          autoComplete="off"
          aria-invalid={!!error}
        />
        <button type="submit" className={css.addButton} disabled={!code.trim() || inProgress}>
          <FormattedMessage id="MyPromosPage.addButton" />
        </button>
      </div>
      {error ? (
        <p className={css.addError} role="alert">
          <FormattedMessage
            id={promoReasonMessageId(error.reason)}
            values={{ date: formatPromoDate(error.date) }}
          />
        </p>
      ) : null}
      {added ? (
        <p className={css.addSuccess}>
          <FormattedMessage id="MyPromosPage.added" values={{ code: added }} />
        </p>
      ) : null}
    </form>
  );
};

const UsedRow = ({ promo }) => (
  <li className={css.usedRow}>
    <div className={css.usedInfo}>
      <span className={css.usedTitle}>
        {promo.title} · <span className={css.usedCode}>{promo.code}</span>
      </span>
      <span className={css.usedDate}>
        <FormattedMessage
          id="MyPromosPage.usedOn"
          values={{ date: formatPromoDate(promo.usedAt) }}
        />
      </span>
    </div>
    {promo.transactionId ? (
      <NamedLink
        name="OrderDetailsPage"
        params={{ id: promo.transactionId }}
        className={css.orderLink}
      >
        <FormattedMessage id="MyPromosPage.viewOrder" />
      </NamedLink>
    ) : null}
  </li>
);

/**
 * The customer's free-delivery promos: active ones to use, used ones with
 * their order, and expired ones for reference. A code from a flyer can be
 * saved here before shopping.
 */
export const MyPromosPageComponent = props => {
  const { scrollingDisabled } = props;
  const intl = useIntl();
  const [tab, setTab] = useState('active');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    fetchMyPromos()
      .then(res => {
        setData(res);
        setError(null);
        // Viewing the page counts as seeing them; NEW stays up for this visit.
        const unseenIds = (res?.active || []).filter(p => p.isNew).map(p => p.id);
        if (unseenIds.length) {
          markPromosSeen({ promoIds: unseenIds })
            .then(clearPromoBadgeCache)
            .catch(() => null);
        }
      })
      .catch(e => setError(e));
  }, []);

  // Client-side only: the promo endpoints need the browser's session cookie.
  useEffect(load, [load]);

  // A just-gifted promo (from the notification) goes first.
  const active = [...(data?.active || [])].sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
  const lists = { active, used: data?.used || [], expired: data?.expired || [] };

  const renderList = () => {
    const items = lists[tab];
    if (items.length === 0) {
      return (
        <p className={css.empty}>
          <FormattedMessage id={`MyPromosPage.empty.${tab}`} />
        </p>
      );
    }
    if (tab === 'used') {
      return (
        <ul className={css.usedList}>
          {items.map(p => (
            <UsedRow key={p.id} promo={p} />
          ))}
        </ul>
      );
    }
    return (
      <div className={css.cardList}>
        {items.map(p => (
          <div key={p.id} className={classNames({ [css.expired]: tab === 'expired' })}>
            <PromoCard promo={tab === 'expired' ? { ...p, isNew: false } : p} showCode />
          </div>
        ))}
      </div>
    );
  };

  return (
    <Page
      title={intl.formatMessage({ id: 'MyPromosPage.title' })}
      scrollingDisabled={scrollingDisabled}
    >
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="MyPromosPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <H3 as="h1" className={css.title}>
            <FormattedMessage id="MyPromosPage.title" />
          </H3>

          <AddPromoCode onAdded={load} />

          <div className={css.tabs} role="tablist">
            {TABS.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={classNames(css.tab, { [css.tabActive]: tab === t })}
                onClick={() => setTab(t)}
              >
                <FormattedMessage id={`MyPromosPage.tab.${t}`} />
                {data ? <span className={css.tabCount}>{lists[t].length}</span> : null}
              </button>
            ))}
          </div>

          {error ? (
            <p className={css.error}>
              <FormattedMessage id="MyPromosPage.loadError" />
            </p>
          ) : !data ? (
            <div className={css.loading}>
              <IconSpinner />
            </div>
          ) : (
            renderList()
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => ({
  scrollingDisabled: isScrollingDisabled(state),
});

const MyPromosPage = compose(connect(mapStateToProps))(MyPromosPageComponent);

export default MyPromosPage;
