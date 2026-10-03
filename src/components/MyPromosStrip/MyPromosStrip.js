import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import { clearPromoBadgeCache } from '../../util/usePromoBadge';
import { fetchMyPromos, markPromosSeen } from '../../util/api';
import NamedLink from '../NamedLink/NamedLink';
import PromoCard from '../PromoCard/PromoCard';

import css from './MyPromosStrip.module.css';

/**
 * Slim "My Promos" strip for the top of the profile: the customer's active
 * free-delivery promos, soonest-expiring first, in a row that scrolls
 * sideways. Renders nothing when there are none, so the profile stays clean.
 *
 * @param {Object} props
 * @param {string} [props.className]
 */
const MyPromosStrip = props => {
  const { className } = props;
  const [promos, setPromos] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchMyPromos()
      .then(res => {
        if (cancelled) return;
        const active = res?.active || [];
        setPromos(active);
        // They've now seen these; the NEW tags stay up for this visit only.
        const unseenIds = active.filter(p => p.isNew).map(p => p.id);
        if (unseenIds.length) {
          markPromosSeen({ promoIds: unseenIds })
            .then(clearPromoBadgeCache)
            .catch(() => null);
        }
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  if (promos.length === 0) return null;

  return (
    <section className={classNames(css.root, className)}>
      <div className={css.header}>
        <h2 className={css.title}>
          <FormattedMessage id="MyPromosStrip.title" values={{ count: promos.length }} />
        </h2>
        <NamedLink name="MyPromosPage" className={css.seeAll}>
          <FormattedMessage id="MyPromosStrip.seeAll" />
        </NamedLink>
      </div>
      <div className={classNames(css.cards, { [css.single]: promos.length === 1 })}>
        {promos.map(promo => (
          <PromoCard key={promo.id} promo={promo} className={css.card} />
        ))}
      </div>
    </section>
  );
};

export default MyPromosStrip;
