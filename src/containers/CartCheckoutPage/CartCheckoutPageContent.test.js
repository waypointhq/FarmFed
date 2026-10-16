import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, getDefaultConfiguration } from '../../util/testHelpers';
import CartCheckoutPageContent from './CartCheckoutPageContent';

// Plain functions: the test config resets jest.fn implementations between
// tests. Requests never settle, which is all these tests need.
jest.mock('../../util/api', () => {
  const pending = () => new Promise(() => {});
  return {
    calculateCartFee: pending,
    estimateCartDelivery: pending,
    fetchPickupSettings: pending,
    fetchActiveOrderGroup: pending,
  };
});

const makeItem = (listingId, title, extra = {}) => ({
  listingId,
  quantity: 1,
  listing: {
    attributes: { title, price: { amount: 1000, currency: 'USD' }, publicData: {} },
  },
  ...extra,
});

const checkoutState = {
  checkoutInProgress: false,
  currentItemIndex: 0,
  completedResults: null,
  checkoutError: null,
  promoError: null,
  stockError: null,
};

const renderContent = props =>
  render(
    <CartCheckoutPageContent
      cartItems={[]}
      checkoutState={checkoutState}
      onProcessCheckout={() => {}}
      onClearPromoError={() => {}}
      onRemoveCartItem={() => {}}
      currentUser={null}
      stripeCustomer={null}
      config={getDefaultConfiguration()}
      intl={{ formatNumber: n => `${n}` }}
      {...props}
    />,
    { config: getDefaultConfiguration() }
  );

describe('CartCheckoutPageContent stock', () => {
  it('flags a sold-out item, lets the buyer remove it, and blocks the order', () => {
    const onRemoveCartItem = jest.fn();
    const { getByText } = renderContent({
      cartItems: [makeItem('l1', 'Eggs'), makeItem('l2', 'Pork box', { maxQuantity: 0 })],
      onRemoveCartItem,
    });

    expect(getByText('CartCheckoutPage.itemSoldOut')).toBeInTheDocument();
    expect(getByText('CartCheckoutPage.removeSoldOutItems')).toBeInTheDocument();
    expect(getByText('CartCheckoutPage.submitButton').closest('button')).toBeDisabled();

    getByText('CartCheckoutPage.removeItem').click();
    expect(onRemoveCartItem).toHaveBeenCalledWith('l2');
  });

  it('notes when an item is at its stock limit', () => {
    const { getByText } = renderContent({
      cartItems: [makeItem('l1', 'Eggs', { quantity: 2, maxQuantity: 2 })],
    });
    expect(getByText('CartItem.onlyAvailable')).toBeInTheDocument();
  });

  it('explains a stock change instead of a payment failure', () => {
    const { getByText, queryByText } = renderContent({
      cartItems: [makeItem('l1', 'Eggs')],
      checkoutState: { ...checkoutState, stockError: { refunded: false } },
    });
    expect(getByText('CartCheckoutPage.stockChanged')).toBeInTheDocument();
    expect(queryByText('CartCheckoutPage.errorPayment')).not.toBeInTheDocument();
  });
});
