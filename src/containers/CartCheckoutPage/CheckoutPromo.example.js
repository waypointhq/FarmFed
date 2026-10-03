import React from 'react';
import { PromoBanner, PromoCodeRow } from './CheckoutPromo';

const noop = () => null;

const promoState = overrides => ({
  applied: null,
  isActive: false,
  inactiveReason: null,
  showBanner: false,
  freeDeliveriesLeft: 0,
  applyFirstSaved: noop,
  apply: noop,
  remove: noop,
  fieldOpen: false,
  openField: noop,
  input: '',
  setInput: noop,
  checking: false,
  fieldError: null,
  ...overrides,
});

const Summary = ({ promo }) => (
  <div style={{ maxWidth: 380 }}>
    <PromoBanner promo={promo} />
    <PromoCodeRow promo={promo} />
  </div>
);

export const BannerAndLink = {
  component: Summary,
  props: { promo: promoState({ showBanner: true, freeDeliveriesLeft: 1 }) },
  group: 'promos',
};

export const CodeFieldWithError = {
  component: Summary,
  props: {
    promo: promoState({
      fieldOpen: true,
      input: 'FREESATT',
      fieldError: { reason: 'invalid' },
    }),
  },
  group: 'promos',
};

export const Applied = {
  component: Summary,
  props: {
    promo: promoState({ applied: { code: 'FREESAT', title: 'Free Delivery' }, isActive: true }),
  },
  group: 'promos',
};

export const AppliedOnPickup = {
  component: Summary,
  props: {
    promo: promoState({
      applied: { code: 'FREESAT', title: 'Free Delivery' },
      inactiveReason: 'pickup',
    }),
  },
  group: 'promos',
};
