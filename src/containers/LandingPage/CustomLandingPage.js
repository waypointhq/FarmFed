import React from 'react';
import { array, bool } from 'prop-types';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { NamedLink, ListingCard, IconSpinner } from '../../components';

import serviceAreaImage from '../../assets/wilson-county-tn.webp';
import css from './CustomLandingPage.module.css';

// Inline icons keep this marketing page self-contained. They inherit `color`
// via currentColor, so the CSS theme (var(--marketplaceColor)) drives them.
const IconLeaf = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
    <path
      d="M5 19c0-7 5-12 14-13 0 9-5 14-12 14a6 6 0 0 1-2-1Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="M5 19c2-4 5-7 9-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const IconTruck = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
    <path
      d="M2 6h11v9H2zM13 9h4l4 3v3h-8z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="7" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="17.5" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const IconVerified = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    {/* Twitter-style verified badge: solid disc, bold white check. */}
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path
      d="m7.6 12.4 2.9 2.9 5.9-6.2"
      fill="none"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconFarmer = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
    <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M5 7h14M9 7c0-1.7 1.3-3 3-3s3 1.3 3 3"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M5.5 20a6.5 6.5 0 0 1 13 0"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

const TRUST_BADGES = [
  { id: 'locallyGrown', Icon: IconLeaf },
  { id: 'fastDelivery', Icon: IconTruck },
  { id: 'farmerVerified', Icon: IconVerified },
];

/**
 * The FarmFed homepage content: hero, trust badges, featured products, and a
 * "sell with us" banner. The Topbar and Footer are provided by the page
 * scaffolding in LandingPage.js.
 *
 * @param {Object} props
 * @param {Array} props.featuredListings listing entities for the products row
 * @param {boolean} props.inProgress whether featured listings are still loading
 */
const CustomLandingPage = props => {
  const { featuredListings = [], inProgress = false } = props;
  const intl = useIntl();

  return (
    <div className={css.root}>
      {/* (a) Hero */}
      <section className={css.hero}>
        <div className={css.heroContent}>
          <h1 className={css.heroTitle}>
            <FormattedMessage id="LandingPage.heroTitle" />
          </h1>
          <NamedLink name="SearchPage" className={css.heroButton}>
            <FormattedMessage id="LandingPage.heroCta" />
          </NamedLink>
        </div>
        {/* Service-area badge answers "do they deliver to me?" at a glance. */}
        <img
          className={css.serviceArea}
          src={serviceAreaImage}
          alt={intl.formatMessage({ id: 'LandingPage.serviceAreaAlt' })}
        />
      </section>

      {/* (b) Trust badges */}
      <section className={css.badges}>
        {TRUST_BADGES.map(({ id, Icon }) => (
          <div key={id} className={css.badge}>
            <span className={css.badgeIcon}>
              <Icon />
            </span>
            <span className={css.badgeLabel}>
              <FormattedMessage id={`LandingPage.badge.${id}`} />
            </span>
          </div>
        ))}
      </section>

      {/* (c) Featured products */}
      <section className={css.featured}>
        <div className={css.featuredHeader}>
          <h2 className={css.featuredTitle}>
            <FormattedMessage id="LandingPage.featuredTitle" />
          </h2>
          <NamedLink name="SearchPage" className={css.viewAll}>
            <FormattedMessage id="LandingPage.viewAll" />
            <span aria-hidden="true" className={css.viewAllArrow}>
              ›
            </span>
          </NamedLink>
        </div>

        {inProgress && featuredListings.length === 0 ? (
          <div className={css.featuredLoading}>
            <IconSpinner />
          </div>
        ) : featuredListings.length > 0 ? (
          <div className={css.productGrid}>
            {featuredListings.map(l => (
              <ListingCard
                key={l.id.uuid}
                className={css.productCard}
                listing={l}
                showAuthorInfo
                renderSizes="33vw"
              />
            ))}
          </div>
        ) : (
          <p className={css.featuredEmpty}>
            <FormattedMessage id="LandingPage.featuredEmpty" />
          </p>
        )}
      </section>

      {/* (d) Farmer CTA */}
      <NamedLink name="CMSPage" params={{ pageId: 'new_vendors' }} className={css.farmerCta}>
        <span className={css.farmerIcon}>
          <IconFarmer />
        </span>
        <span className={css.farmerText}>
          <FormattedMessage id="LandingPage.farmerCta" />
        </span>
        <span aria-hidden="true" className={css.farmerArrow}>
          →
        </span>
      </NamedLink>
    </div>
  );
};

CustomLandingPage.propTypes = {
  featuredListings: array,
  inProgress: bool,
};

export default CustomLandingPage;
