import PromoCard from './PromoCard';

const DAY = 24 * 60 * 60 * 1000;
const inDays = n => new Date(Date.now() + n * DAY).toISOString();

export const NewGift = {
  component: PromoCard,
  props: {
    promo: {
      id: 'p1',
      code: 'FF-8K2Q',
      title: 'Free Delivery',
      message: "Sorry your eggs were late, next delivery's on us.",
      usesLeft: 1,
      expiresAt: inDays(30),
      isNew: true,
    },
  },
  group: 'promos',
};

export const ExpiringSoonWithCode = {
  component: PromoCard,
  props: {
    showCode: true,
    promo: {
      id: 'p2',
      code: 'FREESAT',
      title: 'Free Delivery',
      message: 'On us for your next Saturday order',
      usesLeft: 2,
      expiresAt: inDays(3),
      isNew: false,
    },
  },
  group: 'promos',
};
