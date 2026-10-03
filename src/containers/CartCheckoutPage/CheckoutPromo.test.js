import React from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../util/testHelpers';
import { useCheckoutPromo, PromoBanner, PromoCodeRow } from './CheckoutPromo';

jest.mock('../../util/api', () => ({
  fetchMyPromos: jest.fn(),
  checkPromoCode: jest.fn(),
}));

const api = require('../../util/api');
const { screen, userEvent, waitFor } = testingLibrary;

const Harness = ({ deliveryMethod = 'shipping', deliveryFeeCents = 899, onState }) => {
  const promo = useCheckoutPromo({ isLoggedIn: true, deliveryMethod, deliveryFeeCents });
  onState(promo);
  return (
    <>
      <PromoBanner promo={promo} />
      <PromoCodeRow promo={promo} />
    </>
  );
};

describe('checkout promo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    api.fetchMyPromos.mockResolvedValue({ active: [] });
  });

  it('applies a typed code so Place Order sends it', async () => {
    api.checkPromoCode.mockResolvedValue({
      ok: true,
      code: 'FREESAT',
      promo: { code: 'FREESAT', title: 'Free Delivery' },
    });
    let state;
    render(<Harness onState={s => (state = s)} />);

    userEvent.click(screen.getByText('CartCheckoutPage.promoHaveCode'));
    userEvent.type(screen.getByRole('textbox'), 'freesat');
    userEvent.click(screen.getByText('CartCheckoutPage.promoApply'));

    await waitFor(() => expect(screen.getByText('FREESAT')).toBeInTheDocument());
    expect(api.checkPromoCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'freesat',
        deliveryMethod: 'shipping',
        deliveryFeeCents: 899,
      })
    );
    expect(state.isActive).toBe(true);
    expect(state.applied.code).toBe('FREESAT');
    expect(window.localStorage.getItem('farmfed.appliedPromo')).toBe('FREESAT');
  });

  it("shows why a code won't work", async () => {
    api.checkPromoCode.mockResolvedValue({ ok: false, reason: 'limit', code: 'FREESAT' });
    render(<Harness onState={() => null} />);

    userEvent.click(screen.getByText('CartCheckoutPage.promoHaveCode'));
    userEvent.type(screen.getByRole('textbox'), 'FREESAT');
    userEvent.click(screen.getByText('CartCheckoutPage.promoApply'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Promo.reason.limit'));
  });

  it('offers a saved promo with one tap, but not on pickup', async () => {
    api.fetchMyPromos.mockResolvedValue({ active: [{ id: 'p1', code: 'FF-8K2Q', usesLeft: 1 }] });
    const { unmount } = render(<Harness onState={() => null} />);
    await waitFor(() =>
      expect(screen.getByText('CartCheckoutPage.promoBanner')).toBeInTheDocument()
    );
    unmount();

    render(<Harness deliveryMethod="pickup" deliveryFeeCents={null} onState={() => null} />);
    await waitFor(() => expect(api.fetchMyPromos).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('CartCheckoutPage.promoBanner')).not.toBeInTheDocument();
  });
});
