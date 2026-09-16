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

// ---- Daily category shuffle ----------------------------------------------
// Category order comes from the hosted config, which is a fixed list, so the
// categories at the bottom were permanently getting less exposure than the ones
// at the top — and so were the vendors who sell in them.
//
// The order is re-randomised once per day rather than per render or per visit:
// a row order that moves while you are scrolling it is disorienting, and it has
// to be identical on the server and in the browser or hydration mismatches.
// Seeding from the UTC day number gives both, and gives every category a turn
// near the top over a week.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const currentDaySeed = () => Math.floor(Date.now() / MS_PER_DAY);

// mulberry32 — small, fast, and good enough for shuffling a handful of rows.
const seededRandom = seed => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Fisher-Yates with a seeded generator, so the same seed always produces the
 * same order. Does not mutate the input.
 *
 * @param {Array} items
 * @param {number} seed
 * @returns {Array} a new array in shuffled order
 */
export const shuffleWithSeed = (items, seed) => {
  const random = seededRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

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

  // Re-ordered once per day so no category is permanently stuck at the bottom.
  // Recomputed on every render, which is safe precisely because the shuffle is
  // deterministic: the same categories and the same day always produce the same
  // order, so rows never move under the user mid-scroll.
  const orderedCategories = shuffleWithSeed(populatedCategories, currentDaySeed());

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
      {orderedCategories.map(category => (
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
