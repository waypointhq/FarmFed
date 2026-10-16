import React, { useEffect } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import loadable from '@loadable/component';

import { sendVerificationEmail, hasCurrentUserErrors } from '../../ducks/user.duck';
import { logout, authenticationInProgress } from '../../ducks/auth.duck';
import {
  getCartItems,
  getCartItemCount,
  getIsCartOpen,
  openCartPanel,
  closeCartPanel,
  removeItem,
  updateQuantity,
  refreshCartStock,
} from '../../ducks/cart.duck';
import { manageDisableScrolling } from '../../ducks/ui.duck';

const Topbar = loadable(() => import(/* webpackChunkName: "Topbar" */ './Topbar/Topbar'));

/**
 * Topbar container component, which is connected to Redux Store.
 * @component
 * @param {Object} props
 * @param {number} props.notificationCount number of notifications
 * @param {Function} props.onLogout logout function
 * @param {Function} props.onManageDisableScrolling manage disable scrolling function
 * @param {Function} props.onResendVerificationEmail resend verification email function
 * @param {Object} props.sendVerificationEmailInProgress send verification email in progress
 * @param {Object} props.sendVerificationEmailError send verification email error
 * @param {boolean} props.hasGenericError has generic error
 * @returns {JSX.Element}
 */
export const TopbarContainerComponent = props => {
  const { notificationCount = 0, hasGenericError, onRefreshCartStock, ...rest } = props;

  // Stock may have changed since items went into the cart; re-check whenever
  // it opens so quantities are capped at what's actually available.
  useEffect(() => {
    if (rest.isCartOpen && onRefreshCartStock) onRefreshCartStock();
  }, [rest.isCartOpen]);

  return (
    <Topbar notificationCount={notificationCount} showGenericError={hasGenericError} {...rest} />
  );
};

const mapStateToProps = state => {
  // Topbar needs isAuthenticated and isLoggedInAs
  const { isAuthenticated, isLoggedInAs, logoutError, authScopes } = state.auth;
  // Topbar needs user info.
  const {
    currentUser,
    currentUserHasListings,
    currentUserHasOrders,
    currentUserSaleNotificationCount = 0,
    currentUserOrderNotificationCount = 0,
    sendVerificationEmailInProgress,
    sendVerificationEmailError,
  } = state.user;
  const hasGenericError = !!(logoutError || hasCurrentUserErrors(state));
  return {
    authInProgress: authenticationInProgress(state),
    currentUser,
    currentUserHasListings,
    currentUserHasOrders,
    notificationCount: currentUserSaleNotificationCount + currentUserOrderNotificationCount,
    isAuthenticated,
    isLoggedInAs,
    authScopes,
    sendVerificationEmailInProgress,
    sendVerificationEmailError,
    hasGenericError,
    cartItems: getCartItems(state),
    cartItemCount: getCartItemCount(state),
    isCartOpen: getIsCartOpen(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onLogout: historyPush => dispatch(logout(historyPush)),
  onManageDisableScrolling: (componentId, disableScrolling) =>
    dispatch(manageDisableScrolling(componentId, disableScrolling)),
  onResendVerificationEmail: () => dispatch(sendVerificationEmail()),
  onOpenCart: () => dispatch(openCartPanel()),
  onCloseCart: () => dispatch(closeCartPanel()),
  onRemoveCartItem: listingId => dispatch(removeItem({ listingId })),
  onUpdateCartItemQuantity: (listingId, quantity) =>
    dispatch(updateQuantity({ listingId, quantity })),
  onRefreshCartStock: () => dispatch(refreshCartStock()),
});

// Note: it is important that the withRouter HOC is **outside** the
// connect HOC, otherwise React Router won't rerender any Route
// components since connect implements a shouldComponentUpdate
// lifecycle hook.
//
// See: https://github.com/ReactTraining/react-router/issues/4671
const TopbarContainer = compose(
  withRouter,
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(TopbarContainerComponent);

export default TopbarContainer;
