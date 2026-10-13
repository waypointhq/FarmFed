import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { searchVendors } from '../../../util/api';
import { NamedLink } from '../../../components';

import css from './VendorMatches.module.css';

/**
 * Shops whose name (or bio) matches the search, shown above the listing
 * results so the search bar finds vendor profiles too. Renders nothing when
 * no shop matches.
 *
 * @param {Object} props
 * @param {string} props.keywords the search text
 * @param {string} [props.className]
 */
const VendorMatches = props => {
  const { keywords, className } = props;
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    const q = (keywords || '').trim();
    if (q.length < 2) {
      setVendors([]);
      return undefined;
    }
    let cancelled = false;
    searchVendors(q)
      .then(res => {
        if (!cancelled) setVendors(res?.vendors || []);
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keywords]);

  if (vendors.length === 0) return null;

  return (
    <section className={classNames(css.root, className)}>
      <h2 className={css.title}>
        <FormattedMessage
          id="SearchPage.vendorMatches.title"
          values={{ keywords: keywords.trim() }}
        />
      </h2>
      <ul className={css.list}>
        {vendors.map(vendor => (
          <li key={vendor.id} className={css.item}>
            <NamedLink name="ProfilePage" params={{ id: vendor.id }} className={css.vendor}>
              {vendor.imageUrl ? (
                <img
                  className={css.avatar}
                  src={vendor.imageUrl}
                  srcSet={
                    vendor.imageUrl2x ? `${vendor.imageUrl} 1x, ${vendor.imageUrl2x} 2x` : undefined
                  }
                  alt=""
                />
              ) : (
                <span className={css.initials} aria-hidden="true">
                  {vendor.abbreviatedName}
                </span>
              )}
              <span className={css.text}>
                <span className={css.name}>{vendor.displayName}</span>
                <span className={css.cta}>
                  <FormattedMessage id="SearchPage.vendorMatches.viewShop" />
                </span>
              </span>
            </NamedLink>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default VendorMatches;
