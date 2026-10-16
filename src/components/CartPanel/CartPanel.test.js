import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, getDefaultConfiguration } from '../../util/testHelpers';
import CartPanel from './CartPanel';

const noop = () => {};

const makeListing = (id, title, amount = 1000) => ({
  attributes: {
    title,
    price: { amount, currency: 'USD' },
    publicData: {},
  },
});

const makeItem = (id, title, quantity = 1, amount = 1000) => ({
  listingId: id,
  listing: makeListing(id, title, amount),
  quantity,
  deliveryMethod: null,
  addedAt: '2024-01-01T00:00:00.000Z',
});

describe('CartPanel', () => {
  const defaultProps = {
    isOpen: true,
    items: [],
    onClose: noop,
    onRemoveItem: noop,
    onUpdateQuantity: noop,
    onManageDisableScrolling: noop,
    history: { push: noop },
    overlayRef: { current: null },
  };

  it('renders empty state when no items', () => {
    const { getByText } = render(<CartPanel {...defaultProps} />, {
      config: getDefaultConfiguration(),
    });
    // FormattedMessage renders translation key as ID in test environment
    expect(getByText('CartPanel.emptyCart')).toBeInTheDocument();
  });

  it('renders cart items', () => {
    const items = [
      makeItem('l1', 'Fresh Tomatoes', 2, 500),
      makeItem('l2', 'Organic Eggs', 1, 800),
    ];

    const { getByText } = render(<CartPanel {...defaultProps} items={items} />, {
      config: getDefaultConfiguration(),
    });

    expect(getByText('Fresh Tomatoes')).toBeInTheDocument();
    expect(getByText('Organic Eggs')).toBeInTheDocument();
  });

  it('renders checkout button when items exist', () => {
    const items = [makeItem('l1', 'Fresh Tomatoes', 1)];

    const { getByText } = render(<CartPanel {...defaultProps} items={items} />, {
      config: getDefaultConfiguration(),
    });

    expect(getByText('CartPanel.checkoutButton')).toBeInTheDocument();
  });

  it('renders subtotal when items exist', () => {
    const items = [
      makeItem('l1', 'Tomatoes', 2, 500),
    ];

    const { getByText } = render(<CartPanel {...defaultProps} items={items} />, {
      config: getDefaultConfiguration(),
    });

    expect(getByText('CartPanel.subtotal')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();

    const { container } = render(
      <CartPanel {...defaultProps} onClose={onClose} />,
      { config: getDefaultConfiguration() }
    );

    // Find the close button by its type attribute
    const buttons = container.querySelectorAll('button[type="button"]');
    const closeButton = Array.from(buttons).find(btn => btn.querySelector('svg'));
    if (closeButton) {
      closeButton.click();
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('renders title', () => {
    const { getByText } = render(<CartPanel {...defaultProps} />, {
      config: getDefaultConfiguration(),
    });

    expect(getByText('CartPanel.title')).toBeInTheDocument();
  });

  it('does not render checkout button in empty state', () => {
    const { queryByText } = render(<CartPanel {...defaultProps} items={[]} />, {
      config: getDefaultConfiguration(),
    });

    expect(queryByText('CartPanel.checkoutButton')).not.toBeInTheDocument();
  });

  it('stops the + button at the stock limit', () => {
    const onUpdateQuantity = jest.fn();
    const items = [{ ...makeItem('l1', 'Pork box', 2), maxQuantity: 2 }];

    const { getByText } = render(
      <CartPanel {...defaultProps} items={items} onUpdateQuantity={onUpdateQuantity} />,
      { config: getDefaultConfiguration() }
    );

    const plus = getByText('+');
    expect(plus).toBeDisabled();
    plus.click();
    expect(onUpdateQuantity).not.toHaveBeenCalled();
    expect(getByText('CartItem.onlyAvailable')).toBeInTheDocument();
  });

  it('blocks checkout while a sold-out item is in the cart', () => {
    const items = [makeItem('l1', 'Eggs', 1), { ...makeItem('l2', 'Pork box', 1), maxQuantity: 0 }];

    const { getByText } = render(<CartPanel {...defaultProps} items={items} />, {
      config: getDefaultConfiguration(),
    });

    expect(getByText('CartItem.soldOut')).toBeInTheDocument();
    expect(getByText('CartPanel.removeSoldOutItems')).toBeInTheDocument();
    expect(getByText('CartPanel.checkoutButton').closest('button')).toBeDisabled();
  });
});
