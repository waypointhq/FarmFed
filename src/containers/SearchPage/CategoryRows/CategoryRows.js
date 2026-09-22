import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { ListingCard, NamedLink } from '../../../components';

import css from './CategoryRows.module.css';

// How far one arrow click scrolls, as a fraction of the visible row width.
// Slightly less than a full page so a partially visible card stays on screen
// and the row reads as continuous rather than paginated.
const SCROLL_STEP_RATIO = 0.8;

// Tolerance in px when deciding whether a row is scrolled fully left/right.
// Sub-pixel layout rounding means scrollLeft rarely hits the exact bounds.
const SCROLL_EDGE_TOLERANCE = 8;

// Cards are a fraction of the row width (see --cardsPerView), which on mobile
// is roughly a quarter of the viewport and on desktop caps out at 300px.
const CARD_RENDER_SIZES = ['(max-width: 767px) 30vw', '300px'].join(', ');

const IconArrow = ({ direction }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path
      d={direction === 'left' ? 'M10.5 2.5 L5 8 l5.5 5.5' : 'M5.5 2.5 L11 8 l-5.5 5.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * One horizontally scrolling row of listings for a single top-level category.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.category - Category config object ({ id, name })
 * @param {Array} props.listings - Listings belonging to this category
 * @param {string} props.searchPageName - Route name for the "see all" link
 * @param {Object} props.searchPagePathParams - Path params for the "see all" link
 * @returns {JSX.Element|null}
 */
const CategoryRow = props => {
  const { category, listings = [], searchPageName, searchPagePathParams } = props;
  const scrollerRef = useRef(null);
  const [scrollState, setScrollState] = useState({ atStart: true, atEnd: true });

  const updateScrollState = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    setScrollState({
      atStart: el.scrollLeft <= SCROLL_EDGE_TOLERANCE,
      // maxScroll is 0 when everything already fits, which correctly reports
      // both edges as reached and hides the arrows.
      atEnd: el.scrollLeft >= maxScroll - SCROLL_EDGE_TOLERANCE,
    });
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el || typeof window === 'undefined') {
      return;
    }
    window.addEventListener('resize', updateScrollState);
    return () => window.removeEventListener('resize', updateScrollState);
  }, [updateScrollState, listings.length]);

  const scrollByStep = direction => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const distance = el.clientWidth * SCROLL_STEP_RATIO;
    el.scrollBy({ left: direction === 'left' ? -distance : distance, behavior: 'smooth' });
  };

  // A category with nothing published in it is noise on the browse page.
  if (listings.length === 0) {
    return null;
  }

  const hasOverflow = !(scrollState.atStart && scrollState.atEnd);

  return (
    <section className={css.row}>
      <div className={css.rowHeader}>
        <h2 className={css.rowTitle}>{category.name}</h2>
        <NamedLink
          className={css.seeAllLink}
          name={searchPageName}
          params={searchPagePathParams}
          to={{ search: `?pub_categoryLevel1=${encodeURIComponent(category.id)}` }}
        >
          <FormattedMessage id="CategoryRows.seeAll" />
          <IconArrow direction="right" />
        </NamedLink>
      </div>

      <div className={css.scrollerWrapper}>
        {hasOverflow ? (
          <button
            type="button"
            className={classNames(css.arrow, css.arrowLeft)}
            onClick={() => scrollByStep('left')}
            disabled={scrollState.atStart}
            aria-hidden="true"
            tabIndex={-1}
          >
            <IconArrow direction="left" />
          </button>
        ) : null}

        <ul className={css.scroller} ref={scrollerRef} onScroll={updateScrollState}>
          {listings.map(l => (
            <li key={l.id.uuid} className={css.cardItem}>
              <ListingCard
                className={css.listingCard}
                listing={l}
                renderSizes={CARD_RENDER_SIZES}
                showAddToCart
              />
            </li>
          ))}
        </ul>

        {hasOverflow ? (
          <button
            type="button"
            className={classNames(css.arrow, css.arrowRight)}
            onClick={() => scrollByStep('right')}
            disabled={scrollState.atEnd}
            aria-hidden="true"
            tabIndex={-1}
          >
            <IconArrow direction="right" />
          </button>
        ) : null}
      </div>
    </section>
  );
};

/**
 * Browse view rendered as one horizontally scrolling row per top-level category
 * (Meat, Eggs & Dairy, Produce, Baked Goods, …) instead of a single flat grid.
 *
 * Category names and ordering come from the hosted category configuration, so
 * adding or reordering categories in Console is reflected here without a code
 * change.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class for the root element
 * @param {Array} props.categories - Top-level categories from category config
 * @param {Object} props.listingsByCategory - Map of category id -> listings array
 * @param {boolean} [props.inProgress] - Whether the row queries are still running
 * @param {string} [props.listingTypeParam] - Listing type path param, if any
 * @returns {JSX.Element}
 */
const CategoryRows = props => {
  const {
    className,
    categories = [],
    listingsByCategory = {},
    inProgress = false,
    listingTypeParam,
  } = props;

  const searchPageName = listingTypeParam ? 'SearchPageWithListingType' : 'SearchPage';
  const searchPagePathParams = listingTypeParam ? { listingType: listingTypeParam } : {};

  const populatedCategories = categories.filter(c => (listingsByCategory[c.id] || []).length > 0);

  if (inProgress && populatedCategories.length === 0) {
    return (
      <div className={classNames(css.root, className)}>
        <div className={css.loading}>
          <FormattedMessage id="CategoryRows.loading" />
        </div>
      </div>
    );
  }

  return (
    <div className={classNames(css.root, className)}>
      {populatedCategories.map(category => (
        <CategoryRow
          key={category.id}
          category={category}
          listings={listingsByCategory[category.id]}
          searchPageName={searchPageName}
          searchPagePathParams={searchPagePathParams}
        />
      ))}
    </div>
  );
};

export default CategoryRows;
