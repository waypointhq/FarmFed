import React, { useState, useEffect, useRef, useCallback } from 'react';
import pickBy from 'lodash/pickBy';
import classNames from 'classnames';

import appSettings from '../../../config/settings';
import { useConfiguration } from '../../../context/configurationContext';
import { useRouteConfiguration } from '../../../context/routeConfigurationContext';

import { FormattedMessage, useIntl } from '../../../util/reactIntl';
import { isMainSearchTypeKeywords, isOriginInUse } from '../../../util/search';
import { parse, stringify } from '../../../util/urlHelpers';
import { createResourceLocatorString, matchPathname, pathByRouteName } from '../../../util/routes';
import {
  Button,
  CartIcon,
  CartPanel,
  IconArrowHead,
  IconSearch,
  LimitedAccessBanner,
  LinkedLogo,
  Modal,
  ModalMissingInformation,
} from '../../../components';
import { getSearchPageResourceLocatorStringParams } from '../../SearchPage/SearchPage.shared';

import usePromoBadge from '../../../util/usePromoBadge';
import MenuIcon from './MenuIcon';
import TopbarSearchForm from './TopbarSearchForm/TopbarSearchForm';
import TopbarMobileMenu from './TopbarMobileMenu/TopbarMobileMenu';
import TopbarDesktop from './TopbarDesktop/TopbarDesktop';
import MobileMenuDrawer from './MobileMenuDrawer/MobileMenuDrawer';

import css from './Topbar.module.css';
import { getCurrentUserTypeRoles, showCreateListingLinkForUser } from '../../../util/userHelpers';

const MAX_MOBILE_SCREEN_WIDTH = 1024;

const SEARCH_DISPLAY_ALWAYS = 'always';
const SEARCH_DISPLAY_NOT_LANDING_PAGE = 'notLandingPage';
const SEARCH_DISPLAY_ONLY_SEARCH_PAGE = 'onlySearchPage';
const MOBILE_MENU_BUTTON_ID = 'mobileMenuButton';

const redirectToURLWithModalState = (history, location, modalStateParam) => {
  const { pathname, search, state } = location;
  const searchString = `?${stringify({ [modalStateParam]: 'open', ...parse(search) })}`;
  history.push(`${pathname}${searchString}`, state);
};

const redirectToURLWithoutModalState = (history, location, modalStateParam) => {
  const { pathname, search, state } = location;
  const queryParams = pickBy(parse(search), (v, k) => {
    return k !== modalStateParam;
  });
  const stringified = stringify(queryParams);
  const searchString = stringified ? `?${stringified}` : '';
  history.push(`${pathname}${searchString}`, state);
};

const isPrimary = o => o.group === 'primary';
const isSecondary = o => o.group === 'secondary';
const compareGroups = (a, b) => {
  const isAHigherGroupThanB = isPrimary(a) && isSecondary(b);
  const isALesserGroupThanB = isSecondary(a) && isPrimary(b);
  // Note: sort order is stable in JS
  return isAHigherGroupThanB ? -1 : isALesserGroupThanB ? 1 : 0;
};
// Returns links in order where primary links are returned first
const sortCustomLinks = customLinks => {
  const links = Array.isArray(customLinks) ? [...customLinks] : [];
  return links.sort(compareGroups);
};

// Resolves in-app links against route configuration
const getResolvedCustomLinks = (customLinks, routeConfiguration) => {
  const links = Array.isArray(customLinks) ? customLinks : [];
  return links.map(linkConfig => {
    const { type, href } = linkConfig;
    const isInternalLink = type === 'internal' || href.charAt(0) === '/';
    if (isInternalLink) {
      // Internal link
      try {
        const testURL = new URL('http://my.marketplace.com' + href);
        const matchedRoutes = matchPathname(testURL.pathname, routeConfiguration);
        if (matchedRoutes.length > 0) {
          const found = matchedRoutes[0];
          const to = { search: testURL.search, hash: testURL.hash };
          return {
            ...linkConfig,
            route: {
              name: found.route?.name,
              params: found.params,
              to,
            },
          };
        }
      } catch (e) {
        return linkConfig;
      }
    }
    return linkConfig;
  });
};

const isCMSPage = found =>
  found.route?.name === 'CMSPage' ? `CMSPage:${found.params?.pageId}` : null;
const isInboxPage = found =>
  found.route?.name === 'InboxPage' ? `InboxPage:${found.params?.tab}` : null;
// Find the name of the current route/pathname.
// It's used as handle for currentPage check.
const getResolvedCurrentPage = (location, routeConfiguration) => {
  const matchedRoutes = matchPathname(location.pathname, routeConfiguration);
  if (matchedRoutes.length > 0) {
    const found = matchedRoutes[0];
    const cmsPageName = isCMSPage(found);
    const inboxPageName = isInboxPage(found);
    return cmsPageName ? cmsPageName : inboxPageName ? inboxPageName : `${found.route?.name}`;
  }
};

const GenericError = props => {
  const { show } = props;
  const classes = classNames(css.genericError, {
    [css.genericErrorVisible]: show,
  });
  return show ? (
    <div className={classes} role="alert">
      <div className={css.genericErrorContent}>
        <p className={css.genericErrorText}>
          <FormattedMessage id="Topbar.genericError" />
        </p>
      </div>
    </div>
  ) : null;
};

const TopbarComponent = props => {
  const {
    className,
    rootClassName,
    desktopClassName,
    mobileRootClassName,
    mobileClassName,
    isAuthenticated,
    isLoggedInAs,
    authScopes = [],
    authInProgress,
    currentUser,
    currentUserHasListings,
    currentUserHasOrders,
    currentPage,
    notificationCount = 0,
    intl,
    history,
    location,
    onManageDisableScrolling,
    onResendVerificationEmail,
    sendVerificationEmailInProgress,
    sendVerificationEmailError,
    showGenericError,
    config,
    routeConfiguration,
    cartItems = [],
    cartItemCount = 0,
    isCartOpen = false,
    onOpenCart,
    onCloseCart,
    onRemoveCartItem,
    onUpdateCartItemQuantity,
  } = props;

  // Swipe-to-open: edge detection + direct DOM manipulation for 60fps
  const EDGE_ZONE = 25;
  const OPEN_THRESHOLD = 0.3;
  const OPEN_VELOCITY_THRESHOLD = 0.5;

  const touchStartRef = useRef(null);
  const swipeDirectionRef = useRef(null);
  const touchTimeRef = useRef(null);
  const panelOpenRef = useRef(false);
  const menuOverlayRef = useRef(null);
  const cartOverlayRef = useRef(null);

  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    panelOpenRef.current = isCartOpen || isMobileMenuOpen;
  }, [isCartOpen, isMobileMenuOpen]);

  const clearDragStyles = useCallback((overlayEl) => {
    if (!overlayEl) return;
    const panel = overlayEl.querySelector('[data-panel]');
    const backdrop = overlayEl.querySelector('[data-backdrop]');
    overlayEl.style.visibility = '';
    overlayEl.style.pointerEvents = '';
    if (panel) {
      panel.style.transform = '';
      panel.style.transition = '';
    }
    if (backdrop) {
      backdrop.style.opacity = '';
      backdrop.style.transition = '';
    }
  }, []);

  useEffect(() => {
    const isMobile = window.innerWidth < MAX_MOBILE_SCREEN_WIDTH;
    if (!isMobile) return;

    const handleTouchStart = e => {
      if (panelOpenRef.current) return;
      const touch = e.touches[0];
      const x = touch.clientX;
      const screenWidth = window.innerWidth;

      if (x <= EDGE_ZONE) {
        swipeDirectionRef.current = 'menu';
      } else if (x >= screenWidth - EDGE_ZONE) {
        swipeDirectionRef.current = 'cart';
      } else {
        swipeDirectionRef.current = null;
        return;
      }

      touchStartRef.current = { x, y: touch.clientY };
      touchTimeRef.current = Date.now();
    };

    const handleTouchMove = e => {
      if (!touchStartRef.current || !swipeDirectionRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;

      // Cancel if vertical movement dominates
      if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) {
        clearDragStyles(menuOverlayRef.current);
        clearDragStyles(cartOverlayRef.current);
        swipeDirectionRef.current = null;
        return;
      }

      if (swipeDirectionRef.current === 'menu' && menuOverlayRef.current) {
        const offset = Math.max(0, dx);
        const overlay = menuOverlayRef.current;
        const panel = overlay.querySelector('[data-panel]');
        const backdrop = overlay.querySelector('[data-backdrop]');
        const panelWidth = panel?.offsetWidth || window.innerWidth;
        const clamped = Math.min(offset, panelWidth);

        overlay.style.visibility = 'visible';
        overlay.style.pointerEvents = 'auto';
        panel.style.transform = `translateX(calc(-100% + ${clamped}px))`;
        panel.style.transition = 'none';
        backdrop.style.opacity = clamped / panelWidth;
        backdrop.style.transition = 'none';
      } else if (swipeDirectionRef.current === 'cart' && cartOverlayRef.current) {
        const offset = Math.max(0, -dx);
        const overlay = cartOverlayRef.current;
        const panel = overlay.querySelector('[data-panel]');
        const backdrop = overlay.querySelector('[data-backdrop]');
        const panelWidth = panel?.offsetWidth || 400;
        const clamped = Math.min(offset, panelWidth);

        overlay.style.visibility = 'visible';
        overlay.style.pointerEvents = 'auto';
        panel.style.transform = `translateX(calc(100% - ${clamped}px))`;
        panel.style.transition = 'none';
        backdrop.style.opacity = clamped / panelWidth;
        backdrop.style.transition = 'none';
      }
    };

    const handleTouchEnd = e => {
      if (!touchStartRef.current || !swipeDirectionRef.current) {
        touchStartRef.current = null;
        swipeDirectionRef.current = null;
        return;
      }

      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const elapsed = Date.now() - (touchTimeRef.current || Date.now());
      const velocity = Math.abs(dx) / elapsed;

      const panelWidth = swipeDirectionRef.current === 'menu' ? window.innerWidth : 400;
      const progress = Math.abs(dx) / panelWidth;
      const shouldOpen = progress > OPEN_THRESHOLD || velocity > OPEN_VELOCITY_THRESHOLD;

      if (swipeDirectionRef.current === 'menu') {
        clearDragStyles(menuOverlayRef.current);
        if (dx > 0 && shouldOpen) {
          setMobileMenuOpen(true);
        }
      } else if (swipeDirectionRef.current === 'cart') {
        clearDragStyles(cartOverlayRef.current);
        if (dx < 0 && shouldOpen) {
          onOpenCart();
        }
      }

      touchStartRef.current = null;
      swipeDirectionRef.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onOpenCart, clearDragStyles]);

  const handleCloseMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  // Close menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleSubmit = values => {
    const { currentSearchParams, history, location, config, routeConfiguration } = props;

    const topbarSearchParams = () => {
      if (isMainSearchTypeKeywords(config)) {
        return { keywords: values?.keywords };
      }
      // topbar search defaults to 'location' search
      const { search, selectedPlace } = values?.location || {};
      const { origin, bounds } = selectedPlace || {};
      const originMaybe = isOriginInUse(config) ? { origin } : {};

      return {
        ...originMaybe,
        address: search,
        bounds,
      };
    };
    const searchParams = {
      ...currentSearchParams,
      ...topbarSearchParams(),
    };

    const { routeName, pathParams } = getSearchPageResourceLocatorStringParams(
      routeConfiguration,
      location
    );

    history.push(
      createResourceLocatorString(routeName, routeConfiguration, pathParams, searchParams)
    );
  };

  const handleLogout = () => {
    const { onLogout, history, routeConfiguration } = props;
    onLogout().then(() => {
      const path = pathByRouteName('LandingPage', routeConfiguration);

      // In production we ensure that data is really lost,
      // but in development mode we use stored values for debugging
      if (appSettings.dev) {
        history.push(path);
      } else if (typeof window !== 'undefined') {
        window.location = path;
      }

      console.log('logged out'); // eslint-disable-line
    });
  };

  const showCreateListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { customer: isCustomer, provider: isProvider } = getCurrentUserTypeRoles(
    config,
    currentUser
  );

  /**
   * Determine which tab to use in the inbox link:
   * - if only provider role – sales
   * - if only customer role – orders
   * - if both roles – determine by currentUserHasListings value
   */
  const topbarInboxTab = !isCustomer
    ? 'sales'
    : !isProvider
    ? 'orders'
    : currentUserHasListings
    ? 'sales'
    : 'orders';

  const { mobilesearch, keywords, address, origin, bounds } = parse(location.search, {
    latlng: ['origin'],
    latlngBounds: ['bounds'],
  });

  // Custom links are sorted so that group="primary" are always at the beginning of the list.
  const sortedCustomLinks = sortCustomLinks(config.topbar?.customLinks);
  const customLinks = getResolvedCustomLinks(sortedCustomLinks, routeConfiguration);
  const resolvedCurrentPage = currentPage || getResolvedCurrentPage(location, routeConfiguration);

  // A gifted promo the customer hasn't seen also earns the menu a dot.
  const promoUnseenCount = usePromoBadge(isAuthenticated);
  const notificationDot =
    notificationCount > 0 || promoUnseenCount > 0 ? <div className={css.notificationDot} /> : null;

  const hasMatchMedia = typeof window !== 'undefined' && window?.matchMedia;
  const isMobileLayout = hasMatchMedia
    ? window.matchMedia(`(max-width: ${MAX_MOBILE_SCREEN_WIDTH}px)`)?.matches
    : true;
  const isMobileSearchOpen = isMobileLayout && mobilesearch === 'open';

  const mobileMenu = (
    <TopbarMobileMenu
      isAuthenticated={isAuthenticated}
      currentUser={currentUser}
      onLogout={handleLogout}
      notificationCount={notificationCount}
      promoUnseenCount={promoUnseenCount}
      currentPage={resolvedCurrentPage}
      customLinks={customLinks}
      showCreateListingsLink={showCreateListingsLink}
      inboxTab={topbarInboxTab}
    />
  );

  const topbarSearcInitialValues = () => {
    if (isMainSearchTypeKeywords(config)) {
      return { keywords };
    }

    // Only render current search if full place object is available in the URL params
    const locationFieldsPresent = isOriginInUse(config)
      ? address && origin && bounds
      : address && bounds;
    return {
      location: locationFieldsPresent
        ? {
            search: address,
            selectedPlace: { address, origin, bounds },
          }
        : null,
    };
  };
  const initialSearchFormValues = topbarSearcInitialValues();

  const classes = classNames(rootClassName || css.root, className);

  const { display: searchFormDisplay = SEARCH_DISPLAY_ALWAYS } = config?.topbar?.searchBar || {};

  // Search form is shown conditionally depending on configuration and
  // the current page.
  const showSearchOnAllPages = searchFormDisplay === SEARCH_DISPLAY_ALWAYS;
  const showSearchOnSearchPage =
    searchFormDisplay === SEARCH_DISPLAY_ONLY_SEARCH_PAGE &&
    ['SearchPage', 'SearchPageWithListingType'].includes(resolvedCurrentPage);
  const showSearchNotOnLandingPage =
    searchFormDisplay === SEARCH_DISPLAY_NOT_LANDING_PAGE && resolvedCurrentPage !== 'LandingPage';

  const showSearchForm =
    showSearchOnAllPages || showSearchOnSearchPage || showSearchNotOnLandingPage;


  const handleSkipToMainContent = e => {
    e.preventDefault();
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Focus the main content for screen readers
      mainContent.setAttribute('tabindex', '-1');
      mainContent.focus();
      // Remove tabindex after blur to avoid tabbing into it later
      mainContent.addEventListener(
        'blur',
        () => {
          mainContent.removeAttribute('tabindex');
        },
        { once: true }
      );
    }
  };

  return (
    <div className={classes}>
      <Button onClick={handleSkipToMainContent} className={css.skipToMainContent}>
        <FormattedMessage id="Topbar.skipToMainContent" />
        <IconArrowHead direction="right" size="small" rootClassName={css.skiptoMainArrow} />
      </Button>
      <LimitedAccessBanner
        isAuthenticated={isAuthenticated}
        isLoggedInAs={isLoggedInAs}
        authScopes={authScopes}
        currentUser={currentUser}
        onLogout={handleLogout}
        currentPage={resolvedCurrentPage}
      />
      <nav className={classNames(mobileRootClassName || css.container, mobileClassName)}>
        <Button
          id={MOBILE_MENU_BUTTON_ID}
          rootClassName={css.menu}
          onClick={() => setMobileMenuOpen(true)}
          title={intl.formatMessage({ id: 'Topbar.menuIcon' })}
        >
          <MenuIcon
            className={css.menuIcon}
            ariaLabel={intl.formatMessage({ id: 'Topbar.menuIcon' })}
          />
          {notificationDot}
        </Button>
        <LinkedLogo
          id="logo-topbar-mobile"
          layout={'mobile'}
          alt={intl.formatMessage({ id: 'Topbar.logoIcon' })}
          linkToExternalSite={config?.topbar?.logoLink}
        />
        <CartIcon
          count={cartItemCount}
          onClick={onOpenCart}
          className={css.mobileCartIcon}
        />
      </nav>
      {showSearchForm ? (
        <button
          type="button"
          className={css.mobileSearchBar}
          onClick={() => redirectToURLWithModalState(history, location, 'mobilesearch')}
          aria-label={intl.formatMessage({ id: 'Topbar.searchIcon' })}
        >
          <IconSearch className={css.mobileSearchIcon} />
          <span className={css.mobileSearchText}>
            <FormattedMessage id="Topbar.mobileSearchPlaceholder" />
          </span>
        </button>
      ) : null}
      <div className={css.desktop}>
        <TopbarDesktop
          className={desktopClassName}
          currentUserHasListings={currentUserHasListings}
          currentUser={currentUser}
          currentPage={resolvedCurrentPage}
          initialSearchFormValues={initialSearchFormValues}
          intl={intl}
          isAuthenticated={isAuthenticated}
          notificationCount={notificationCount}
          promoUnseenCount={promoUnseenCount}
          onLogout={handleLogout}
          onSearchSubmit={handleSubmit}
          config={config}
          customLinks={customLinks}
          showSearchForm={showSearchForm}
          showCreateListingsLink={showCreateListingsLink}
          inboxTab={topbarInboxTab}
          cartItemCount={cartItemCount}
          onOpenCart={onOpenCart}
        />
      </div>
      <MobileMenuDrawer
        isOpen={isMobileMenuOpen}
        onClose={handleCloseMenu}
        overlayRef={menuOverlayRef}
      >
        {authInProgress ? null : mobileMenu}
      </MobileMenuDrawer>
      <Modal
        id="TopbarMobileSearch"
        containerClassName={css.modalContainerSearchForm}
        isOpen={isMobileSearchOpen}
        onClose={() => redirectToURLWithoutModalState(history, location, 'mobilesearch')}
        usePortal
        onManageDisableScrolling={onManageDisableScrolling}
      >
        <div className={css.searchContainer}>
          <TopbarSearchForm
            onSubmit={handleSubmit}
            initialValues={initialSearchFormValues}
            isMobile
            appConfig={config}
          />
          <p className={css.mobileHelp}>
            <FormattedMessage id="Topbar.mobileSearchHelp" />
          </p>
        </div>
      </Modal>
      <ModalMissingInformation
        id="MissingInformationReminder"
        containerClassName={css.missingInformationModal}
        currentUser={currentUser}
        currentUserHasListings={currentUserHasListings}
        currentUserHasOrders={currentUserHasOrders}
        location={location}
        onManageDisableScrolling={onManageDisableScrolling}
        onResendVerificationEmail={onResendVerificationEmail}
        sendVerificationEmailInProgress={sendVerificationEmailInProgress}
        sendVerificationEmailError={sendVerificationEmailError}
      />

      <CartPanel
        isOpen={isCartOpen}
        items={cartItems}
        onClose={onCloseCart}
        onRemoveItem={onRemoveCartItem}
        onUpdateQuantity={onUpdateCartItemQuantity}
        onManageDisableScrolling={onManageDisableScrolling}
        history={history}
        overlayRef={cartOverlayRef}
      />

      <GenericError show={showGenericError} />
    </div>
  );
};

/**
 * Topbar containing logo, main search and navigation links.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to components own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {Object} props.desktopClassName add more style rules for TopbarDesktop
 * @param {Object} props.mobileRootClassName overwrite mobile layout root classes
 * @param {Object} props.mobileClassName add more style rules for mobile layout
 * @param {boolean} props.isAuthenticated
 * @param {boolean} props.isLoggedInAs
 * @param {Object} props.currentUser
 * @param {boolean} props.currentUserHasListings
 * @param {boolean} props.currentUserHasOrders
 * @param {string} props.currentPage
 * @param {number} props.notificationCount
 * @param {Function} props.onLogout
 * @param {Function} props.onManageDisableScrolling
 * @param {Function} props.onResendVerificationEmail
 * @param {Object} props.sendVerificationEmailInProgress
 * @param {Object} props.sendVerificationEmailError
 * @param {boolean} props.showGenericError
 * @param {Object} props.history
 * @param {Function} props.history.push
 * @param {Object} props.location
 * @param {string} props.location.search '?foo=bar'
 * @returns {JSX.Element} topbar component
 */
const Topbar = props => {
  const config = useConfiguration();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();
  return (
    <TopbarComponent
      config={config}
      routeConfiguration={routeConfiguration}
      intl={intl}
      {...props}
    />
  );
};

export default Topbar;
