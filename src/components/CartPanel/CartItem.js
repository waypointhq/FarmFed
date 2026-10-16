import React from 'react';

import { FormattedMessage } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { types as sdkTypes } from '../../util/sdkLoader';
import { createSlug } from '../../util/urlHelpers';

import { NamedLink, ResponsiveImage } from '../../components';

import css from './CartItem.module.css';

const { Money } = sdkTypes;

const CartItem = props => {
  const { item, intl, onRemove, onUpdateQuantity } = props;
  const { listing, quantity, deliveryMethod, listingId, maxQuantity } = item;

  const title = listing?.attributes?.title || '';
  const price = listing?.attributes?.price;
  const firstImage = listing?.images?.[0];
  const authorName = listing?.author?.attributes?.profile?.displayName || '';
  const slug = createSlug(title);

  const formattedPrice = price ? formatMoney(intl, new Money(price.amount, price.currency)) : '';
  const deliveryLabel = deliveryMethod === 'shipping' ? 'Shipping' : deliveryMethod === 'pickup' ? 'Pickup' : null;
  // maxQuantity is the stock last seen for this listing (see cart.duck); 0 = sold out.
  const isSoldOut = maxQuantity === 0;
  const isAtStockLimit = typeof maxQuantity === 'number' && quantity >= maxQuantity;

  const handleDecrement = () => {
    if (quantity > 1) {
      onUpdateQuantity(listingId, quantity - 1);
    }
  };

  const handleIncrement = () => {
    if (!isAtStockLimit) {
      onUpdateQuantity(listingId, quantity + 1);
    }
  };

  return (
    <div className={css.root}>
      <div className={css.imageWrapper}>
        {firstImage ? (
          <ResponsiveImage
            rootClassName={css.image}
            alt={title}
            image={firstImage}
            variants={['scaled-small']}
          />
        ) : (
          <div className={css.imagePlaceholder} />
        )}
      </div>
      <div className={css.info}>
        <NamedLink
          className={css.title}
          name="ListingPage"
          params={{ id: listingId, slug }}
        >
          {title}
        </NamedLink>
        {authorName ? <span className={css.author}>{authorName}</span> : null}
        <div className={css.priceRow}>
          <span className={css.price}>{formattedPrice}</span>
          {deliveryLabel ? <span className={css.delivery}>{deliveryLabel}</span> : null}
        </div>
        <div className={css.actions}>
          <div className={css.quantityControls}>
            <button className={css.quantityButton} onClick={handleDecrement} type="button" disabled={quantity <= 1}>
              -
            </button>
            <span className={css.quantity}>{quantity}</span>
            <button
              className={css.quantityButton}
              onClick={handleIncrement}
              type="button"
              disabled={isAtStockLimit}
            >
              +
            </button>
          </div>
          <button className={css.removeButton} onClick={() => onRemove(listingId)} type="button">
            <FormattedMessage id="CartItem.remove" />
          </button>
        </div>
        {isSoldOut ? (
          <span className={css.soldOut}>
            <FormattedMessage id="CartItem.soldOut" />
          </span>
        ) : isAtStockLimit ? (
          <span className={css.stockNote}>
            <FormattedMessage id="CartItem.onlyAvailable" values={{ count: maxQuantity }} />
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default CartItem;
