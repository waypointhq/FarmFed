import React, { useRef, useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';

import { useIntl, FormattedMessage } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { types as sdkTypes } from '../../util/sdkLoader';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { createResourceLocatorString } from '../../util/routes';

import { IconClose, NamedLink } from '../../components';
import { mediumImpact } from '../../util/haptics';
import CartItem from './CartItem';

import css from './CartPanel.module.css';

const { Money } = sdkTypes;

const SWIPE_THRESHOLD = 0.3; // 30% of panel width to trigger close
const VELOCITY_THRESHOLD = 0.5; // px/ms
const PANEL_WIDTH = 400;

const CartPanel = props => {
  const {
    isOpen,
    items,
    onClose,
    onRemoveItem,
    onUpdateQuantity,
    onManageDisableScrolling,
    history,
    overlayRef,
  } = props;

  const intl = useIntl();
  const routeConfiguration = useRouteConfiguration();

  const panelRef = useRef(null);
  const touchStartRef = useRef(null);
  const touchTimeRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Handle touch gestures for swipe-to-close
  const handleTouchStart = useCallback(e => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchTimeRef.current = Date.now();
    setIsDragging(false);
  }, []);

  const handleTouchMove = useCallback(e => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // Only track horizontal movement (rightward = positive = closing)
    if (!isDragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      setIsDragging(true);
    }

    if (isDragging || (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy))) {
      // Only allow rightward drag (closing direction)
      const offset = Math.max(0, dx);
      setDragOffset(offset);
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback(e => {
    if (!touchStartRef.current || !isDragging) {
      touchStartRef.current = null;
      return;
    }

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const elapsed = Date.now() - (touchTimeRef.current || Date.now());
    const velocity = Math.abs(dx) / elapsed;

    const panelWidth = panelRef.current?.offsetWidth || 400;
    const progress = dx / panelWidth;

    if (progress > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      onClose();
    }

    setDragOffset(0);
    setIsDragging(false);
    touchStartRef.current = null;
  }, [isDragging, onClose]);

  // Reset drag state when panel opens/closes
  useEffect(() => {
    setDragOffset(0);
    setIsDragging(false);
  }, [isOpen]);

  // Calculate subtotal
  const subtotal = items.reduce((sum, item) => {
    const price = item.listing?.attributes?.price;
    if (price) {
      return sum + price.amount * (item.quantity || 1);
    }
    return sum;
  }, 0);

  const currency = items[0]?.listing?.attributes?.price?.currency || 'USD';
  const formattedSubtotal = subtotal > 0 ? formatMoney(intl, new Money(subtotal, currency)) : null;

  const hasSoldOutItems = items.some(item => item.maxQuantity === 0);

  const handleCheckout = () => {
    mediumImpact();
    onClose();
    const path = createResourceLocatorString('CartCheckoutPage', routeConfiguration, {}, {});
    history.push(path);
  };

  const overlayClasses = classNames(css.overlay, { [css.overlayOpen]: isOpen });

  const panelStyle = isDragging
    ? { transform: `translateX(${dragOffset}px)`, transition: 'none' }
    : {};

  const backdropStyle = isDragging
    ? { opacity: 1 - (dragOffset / (panelRef.current?.offsetWidth || PANEL_WIDTH)), transition: 'none' }
    : {};

  return (
    <div className={overlayClasses} ref={overlayRef}>
      <div className={css.backdrop} onClick={onClose} role="presentation" style={backdropStyle} data-backdrop />
      <div
        ref={panelRef}
        className={css.panel}
        style={panelStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-panel
      >
        <div className={css.header}>
          <h2 className={css.title}>
            <FormattedMessage id="CartPanel.title" />
          </h2>
          <button className={css.closeButton} onClick={onClose} type="button">
            <IconClose rootClassName={css.closeIcon} />
          </button>
        </div>

        {items.length === 0 ? (
          <div className={css.emptyState}>
            <p className={css.emptyText}>
              <FormattedMessage id="CartPanel.emptyCart" />
            </p>
          </div>
        ) : (
          <>
            <div className={css.itemList}>
              {items.map(item => (
                <CartItem
                  key={item.listingId}
                  item={item}
                  intl={intl}
                  onRemove={onRemoveItem}
                  onUpdateQuantity={onUpdateQuantity}
                />
              ))}
            </div>
            <div className={css.footer}>
              {formattedSubtotal ? (
                <div className={css.subtotalRow}>
                  <span className={css.subtotalLabel}>
                    <FormattedMessage id="CartPanel.subtotal" />
                  </span>
                  <span className={css.subtotalAmount}>{formattedSubtotal}</span>
                </div>
              ) : null}
              {hasSoldOutItems ? (
                <p className={css.soldOutNotice}>
                  <FormattedMessage id="CartPanel.removeSoldOutItems" />
                </p>
              ) : null}
              <button
                className={css.checkoutButton}
                onClick={handleCheckout}
                type="button"
                disabled={hasSoldOutItems}
              >
                <FormattedMessage id="CartPanel.checkoutButton" />
              </button>
              <button className={css.continueShoppingButton} onClick={onClose} type="button">
                <FormattedMessage id="CartPanel.continueShoppingButton" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CartPanel;
