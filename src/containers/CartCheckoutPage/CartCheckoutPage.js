import React, { useEffect } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getCartItems } from '../../ducks/cart.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';

import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import {
  getCheckoutState,
  processCartCheckout,
  resetCheckout,
  clearPromoError,
} from './CartCheckoutPage.duck';
import CartCheckoutPageContent from './CartCheckoutPageContent';

import css from './CartCheckoutPage.module.css';

export const CartCheckoutPageComponent = props => {
  const {
    scrollingDisabled,
    cartItems,
    checkoutState,
    onProcessCheckout,
    onClearPromoError,
    onResetCheckout,
    onFetchCurrentUser,
    currentUser,
  } = props;

  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();

  // Fetch user with stripe customer + default payment method
  useEffect(() => {
    onFetchCurrentUser({
      callParams: { include: ['stripeCustomer.defaultPaymentMethod'] },
      updateHasListings: false,
      updateNotifications: false,
    });
    return () => {
      onResetCheckout();
    };
  }, []);

  const title = intl.formatMessage({ id: 'CartCheckoutPage.title' });

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <CartCheckoutPageContent
          cartItems={cartItems}
          checkoutState={checkoutState}
          onProcessCheckout={onProcessCheckout}
          onClearPromoError={onClearPromoError}
          currentUser={currentUser}
          stripeCustomer={currentUser?.stripeCustomer}
          config={config}
          routeConfiguration={routeConfiguration}
          intl={intl}
        />
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  return {
    scrollingDisabled: isScrollingDisabled(state),
    cartItems: getCartItems(state),
    checkoutState: getCheckoutState(state),
    currentUser,
  };
};

const mapDispatchToProps = dispatch => ({
  onProcessCheckout: params => dispatch(processCartCheckout(params)),
  onResetCheckout: () => dispatch(resetCheckout()),
  onClearPromoError: () => dispatch(clearPromoError()),
  onFetchCurrentUser: params => dispatch(fetchCurrentUser(params)),
});

const CartCheckoutPage = compose(
  connect(mapStateToProps, mapDispatchToProps)
)(CartCheckoutPageComponent);

export default CartCheckoutPage;
