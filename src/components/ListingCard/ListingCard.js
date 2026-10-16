import React from 'react';
import classNames from 'classnames';
import { useDispatch } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  displayPrice,
  isPriceVariationsEnabled,
  requireListingImage,
} from '../../util/configHelpers';
import { lazyLoadWithDimensions } from '../../util/uiHelpers';
import { formatMoney } from '../../util/currency';
import { ensureListing, ensureUser } from '../../util/data';
import { richText } from '../../util/richText';
import { createSlug } from '../../util/urlHelpers';
import { isBookingProcessAlias, isPurchaseProcessAlias } from '../../transactions/transaction';
import { addItem, openCartPanel } from '../../ducks/cart.duck';

import {
  AspectRatioWrapper,
  NamedLink,
  ResponsiveImage,
  ListingCardThumbnail,
} from '../../components';

import appSettings from '../../config/settings';
import css from './ListingCard.module.css';

const MIN_LENGTH_FOR_LONG_WORDS = 10;

const priceData = (price, currency, intl) => {
  if (price && price.currency === currency) {
    const formattedPrice = formatMoney(intl, price);
    return { formattedPrice, priceTitle: formattedPrice };
  } else if (price) {
    return {
      formattedPrice: intl.formatMessage(
        { id: 'ListingCard.unsupportedPrice' },
        { currency: price.currency }
      ),
      priceTitle: intl.formatMessage(
        { id: 'ListingCard.unsupportedPriceTitle' },
        { currency: price.currency }
      ),
    };
  }
  return {};
};

const LazyImage = lazyLoadWithDimensions(ResponsiveImage, { loadAfterInitialRendering: 3000 });

const PriceMaybe = props => {
  const { price, publicData, config, intl, listingTypeConfig } = props;
  const showPrice = displayPrice(listingTypeConfig);
  if (!showPrice && price) {
    return null;
  }

  const isPriceVariationsInUse = isPriceVariationsEnabled(publicData, listingTypeConfig);
  const hasMultiplePriceVariants = isPriceVariationsInUse && publicData?.priceVariants?.length > 1;

  const isBookable = isBookingProcessAlias(publicData?.transactionProcessAlias);
  const { formattedPrice, priceTitle } = priceData(price, config.currency, intl);

  const priceValue = <span className={css.priceValue}>{formattedPrice}</span>;
  const pricePerUnit = isBookable ? (
    <span className={css.perUnit}>
      <FormattedMessage id="ListingCard.perUnit" values={{ unitType: publicData?.unitType }} />
    </span>
  ) : (
    ''
  );

  return (
    <div className={css.price} title={priceTitle}>
      {hasMultiplePriceVariants ? (
        <FormattedMessage
          id="ListingCard.priceStartingFrom"
          values={{ priceValue, pricePerUnit }}
        />
      ) : (
        <FormattedMessage id="ListingCard.price" values={{ priceValue, pricePerUnit }} />
      )}
    </div>
  );
};

const SoldOutBadgeMaybe = props => {
  const { listing, intl } = props;
  if (!appSettings.featureFlags.soldOutVisibility) return null;

  const currentStock = listing?.currentStock?.attributes?.quantity;
  const publicData = listing?.attributes?.publicData || {};
  const soldOutBehavior = publicData.soldOutBehavior;

  // Show badge only when stock is 0 and vendor chose "backNextWeek"
  if (currentStock !== 0 || soldOutBehavior !== 'backNextWeek') return null;

  return (
    <div className={css.soldOutOverlay}>
      <FormattedMessage id="ListingCard.backNextWeek" />
    </div>
  );
};

/**
 * ListingCardImage
 * Component responsible for rendering the image part of the listing card.
 * It either renders the first image from the listing's images array with lazy loading,
 * or a stylized placeholder if images are disabled for the listing type.
 * Also wraps the image in a fixed aspect ratio container for consistent layout.
 * @component
 * @param {Object} props
 * @param {Object} props.currentListing listing entity with image data
 * @param {Function?} props.setActivePropsMaybe mouse enter/leave handlers for map highlighting
 * @param {string} props.title listing title for alt text
 * @param {string} props.renderSizes img/srcset size rules
 * @param {number} props.aspectWidth aspect ratio width
 * @param {number} props.aspectHeight aspect ratio height
 * @param {string} props.variantPrefix image variant prefix (e.g. "listing-card")
 * @param {boolean} props.showListingImage whether to show actual listing image or not
 * @param {Object?} props.style the background color for the listing card with no image
 * @returns {JSX.Element} listing image with fixed aspect ratio or fallback preview
 */
const ListingCardImage = props => {
  const {
    currentListing,
    setActivePropsMaybe,
    title,
    renderSizes,
    aspectWidth,
    aspectHeight,
    variantPrefix,
    showListingImage,
    style,
  } = props;

  const firstImage =
    currentListing.images && currentListing.images.length > 0 ? currentListing.images[0] : null;
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  // Render the listing image only if listing images are enabled in the listing type
  return showListingImage ? (
    <AspectRatioWrapper
      className={css.aspectRatioWrapper}
      width={aspectWidth}
      height={aspectHeight}
      {...setActivePropsMaybe}
    >
      <LazyImage
        rootClassName={css.rootForImage}
        alt={title}
        image={firstImage}
        variants={variants}
        sizes={renderSizes}
      />
    </AspectRatioWrapper>
  ) : (
    <ListingCardThumbnail
      style={style}
      listingTitle={title}
      className={css.aspectRatioWrapper}
      width={aspectWidth}
      height={aspectHeight}
      setActivePropsMaybe={setActivePropsMaybe}
    />
  );
};

/**
 * ListingCard
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {Object} props.listing API entity: listing or ownListing
 * @param {string?} props.renderSizes for img/srcset
 * @param {Function?} props.setActiveListing
 * @param {boolean?} props.showAuthorInfo
 * @returns {JSX.Element} listing card to be used in search result panel etc.
 */
export const ListingCard = props => {
  const config = useConfiguration();
  const intl = props.intl || useIntl();

  const {
    className,
    rootClassName,
    listing,
    renderSizes,
    setActiveListing,
    showAuthorInfo = true,
    showAddToCart = false,
  } = props;

  const dispatch = useDispatch();

  const classes = classNames(rootClassName || css.root, className);

  const currentListing = ensureListing(listing);
  const id = currentListing.id.uuid;
  const { title = '', price, publicData } = currentListing.attributes;
  const slug = createSlug(title);

  const author = ensureUser(listing.author);
  const authorName = author.attributes.profile.displayName;

  const { listingType, cardStyle } = publicData || {};
  const validListingTypes = config.listing.listingTypes;
  const foundListingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);
  const showListingImage = requireListingImage(foundListingTypeConfig);

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;

  // Sets the listing as active in the search map when hovered (if the search map is enabled)
  const setActivePropsMaybe = setActiveListing
    ? {
        onMouseEnter: () => setActiveListing(currentListing.id),
        onMouseLeave: () => setActiveListing(null),
      }
    : null;

  // Quick add-to-cart (shown on the search grid). Only for in-stock, purchasable
  // listings with a price. Mirrors the cart snapshot built on the listing page.
  const currentStock = listing?.currentStock?.attributes?.quantity;
  const isSoldOut = currentStock === 0;
  const canQuickAdd =
    showAddToCart &&
    !!price &&
    !isSoldOut &&
    isPurchaseProcessAlias(publicData?.transactionProcessAlias);

  const handleQuickAdd = e => {
    // The card is wrapped in a link to the listing page — don't navigate.
    e.preventDefault();
    e.stopPropagation();
    const listingSnapshot = {
      id: currentListing.id,
      attributes: {
        title: currentListing.attributes.title,
        price: currentListing.attributes.price,
        publicData: currentListing.attributes.publicData,
      },
      images: currentListing.images?.map(img => ({ id: img.id, attributes: img.attributes })),
      author: listing.author
        ? {
            id: listing.author.id,
            attributes: { profile: { displayName: listing.author.attributes?.profile?.displayName } },
          }
        : null,
    };
    dispatch(
      addItem({
        listingId: id,
        listing: listingSnapshot,
        quantity: 1,
        deliveryMethod: null,
        // Search results don't include stock; the cart re-checks it on open.
        maxQuantity: currentStock,
      })
    );
    dispatch(openCartPanel());
  };

  return (
    <NamedLink className={classes} name="ListingPage" params={{ id, slug }}>
      <div className={css.imageOverlay}>
        <SoldOutBadgeMaybe listing={listing} intl={intl} />
        <ListingCardImage
          renderSizes={renderSizes}
          title={title}
          currentListing={currentListing}
          config={config}
          setActivePropsMaybe={setActivePropsMaybe}
          aspectWidth={aspectWidth}
          aspectHeight={aspectHeight}
          variantPrefix={variantPrefix}
          style={cardStyle}
          showListingImage={showListingImage}
        />
        {canQuickAdd ? (
          <button
            type="button"
            className={css.quickAddButton}
            onClick={handleQuickAdd}
            aria-label={intl.formatMessage({ id: 'ListingCard.addToCart' })}
            title={intl.formatMessage({ id: 'ListingCard.addToCart' })}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
      <div className={css.info}>
        <PriceMaybe
          price={price}
          publicData={publicData}
          config={config}
          intl={intl}
          listingTypeConfig={foundListingTypeConfig}
        />
        <div className={css.mainInfo}>
          {showListingImage && (
            <div className={css.title}>
              {richText(title, {
                longWordMinLength: MIN_LENGTH_FOR_LONG_WORDS,
                longWordClass: css.longWord,
              })}
            </div>
          )}
          {showAuthorInfo ? (
            <div className={css.authorInfo}>
              <FormattedMessage id="ListingCard.author" values={{ authorName }} />
            </div>
          ) : null}
        </div>
      </div>
    </NamedLink>
  );
};

export default ListingCard;
