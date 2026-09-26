import React from 'react';
import { connect } from 'react-redux';
import { compose } from 'redux';
import { useIntl } from '../../util/reactIntl';
import { useHistory, useLocation } from 'react-router-dom';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import appSettings from '../../config/settings';
import {
  Page,
  LayoutSingleColumn,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import {
  updateDeliverySettings,
  clearDeliveryUpdateSuccess,
  updateGeofenceSettings,
  clearGeofenceUpdateSuccess,
  approveUser,
  rejectUser,
  updatePickupSettings,
  clearPickupUpdateSuccess,
  updateTaxSettings,
  clearTaxUpdateSuccess,
  updateListingShuffleSettings,
  runListingShuffle,
  clearShuffleUpdateSuccess,
  updateBulletins,
  clearBulletinsUpdateSuccess,
  setVendorTaxExempt,
  markOrderDelivered,
  sendPushBroadcast,
  setAnnouncementActive,
  clearSendPushSuccess,
} from './AdminPage.duck';

import DeliverySettingsTab from './DeliverySettingsTab/DeliverySettingsTab';
import GeofenceTab from './GeofenceTab/GeofenceTab';
import UserManagementTab from './UserManagementTab/UserManagementTab';
import OrdersTab from './OrdersTab/OrdersTab';
import PushNotificationsTab from './PushNotificationsTab/PushNotificationsTab';
import PickupScheduleTab from './PickupScheduleTab/PickupScheduleTab';
import TaxSettingsTab from './TaxSettingsTab/TaxSettingsTab';
import ListingShuffleTab from './ListingShuffleTab/ListingShuffleTab';
import BulletinBoardTab from './BulletinBoardTab/BulletinBoardTab';
import CheckoutFailuresTab from './CheckoutFailuresTab/CheckoutFailuresTab';

import css from './AdminPage.module.css';

const DELIVERY_TAB = 'delivery';
const GEOFENCE_TAB = 'geofence';
const USERS_TAB = 'users';
const ORDERS_TAB = 'orders';
const PUSH_TAB = 'push';
const PICKUP_TAB = 'pickup';
const TAX_TAB = 'tax';
const SHUFFLE_TAB = 'shuffle';
const BULLETIN_TAB = 'bulletin';
const CHECKOUT_FAILURES_TAB = 'checkout-failures';

const AdminPageComponent = props => {
  const {
    currentUser,
    deliveryRatePerMileCents,
    deliveryFlatFeeCents,
    hubOrigin,
    deliveryFetchInProgress,
    deliveryUpdateInProgress,
    deliveryUpdateSuccess,
    deliveryError,
    geofencePolygon,
    geofenceVendorPolygon,
    geofenceConsumerPolygon,
    geofenceUpdateInProgress,
    geofenceUpdateSuccess,
    geofenceError,
    pendingUsers,
    pendingUsersFetchInProgress,
    pendingUsersFetchError,
    userActionInProgress,
    userActionError,
    ordersAwaitingDelivery,
    ordersFetchInProgress,
    ordersFetchError,
    markDeliveredInProgress,
    markDeliveredError,
    announcements,
    announcementsFetchInProgress,
    sendPushInProgress,
    sendPushSuccess,
    sendPushError,
    pickupSettings,
    pickupUpdateInProgress,
    pickupUpdateSuccess,
    pickupError,
    taxSettings,
    taxUpdateInProgress,
    taxUpdateSuccess,
    taxError,
    shuffleSettings,
    shuffleUpdateInProgress,
    shuffleUpdateSuccess,
    shuffleRunInProgress,
    shuffleRunResult,
    shuffleError,
    bulletins,
    bulletinsUpdateInProgress,
    bulletinsUpdateSuccess,
    bulletinsError,
    vendors,
    vendorTaxExemptInProgress,
    scrollingDisabled,
    onUpdateDeliverySettings,
    onClearDeliverySuccess,
    onUpdateGeofenceSettings,
    onClearGeofenceSuccess,
    onApproveUser,
    onRejectUser,
    onUpdatePickupSettings,
    onClearPickupSuccess,
    onUpdateTaxSettings,
    onClearTaxSuccess,
    onUpdateShuffleSettings,
    onRunShuffle,
    onClearShuffleSuccess,
    onUpdateBulletins,
    onClearBulletinsSuccess,
    onSetVendorTaxExempt,
    onMarkDelivered,
    onSendPush,
    onToggleAnnouncement,
    onClearSendPushSuccess,
  } = props;

  const intl = useIntl();
  const location = useLocation();
  const history = useHistory();

  const searchParams = new URLSearchParams(location.search);
  const activeTab = searchParams.get('tab') || DELIVERY_TAB;

  const isAdmin = currentUser?.attributes?.profile?.privateData?.isAdmin === true;

  if (!isAdmin && !deliveryFetchInProgress) {
    return (
      <Page title={intl.formatMessage({ id: 'AdminPage.title' })} scrollingDisabled={scrollingDisabled}>
        <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
          <div className={css.notAdmin}>
            <p>You do not have permission to access this page.</p>
          </div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  const switchTab = tab => {
    history.push({ pathname: '/admin', search: `?tab=${tab}` });
  };

  const flags = appSettings.featureFlags;

  const tabs = [
    { id: DELIVERY_TAB, label: 'AdminPage.deliveryTab', show: true },
    { id: GEOFENCE_TAB, label: 'AdminPage.geofenceTab', show: true },
    { id: USERS_TAB, label: 'AdminPage.usersTab', show: true },
    { id: ORDERS_TAB, label: 'AdminPage.ordersTab', show: true },
    { id: PUSH_TAB, label: 'AdminPage.pushTab', show: true },
    { id: PICKUP_TAB, label: 'AdminPage.pickupTab', show: flags.pickupSchedule },
    { id: TAX_TAB, label: 'AdminPage.taxTab', show: flags.taxBreakdown },
    { id: SHUFFLE_TAB, label: 'AdminPage.shuffleTab', show: flags.listingShuffle },
    { id: BULLETIN_TAB, label: 'AdminPage.bulletinTab', show: flags.vendorBulletin },
    { id: CHECKOUT_FAILURES_TAB, label: 'AdminPage.checkoutFailuresTab', show: true },
  ].filter(t => t.show);

  return (
    <Page title={intl.formatMessage({ id: 'AdminPage.title' })} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          <div className={css.content}>
            <h1 className={css.title}>
              {intl.formatMessage({ id: 'AdminPage.title' })}
            </h1>

            <nav className={css.tabs}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={activeTab === tab.id ? css.tabSelected : css.tab}
                  onClick={() => switchTab(tab.id)}
                >
                  {intl.formatMessage({ id: tab.label })}
                </button>
              ))}
            </nav>

            {activeTab === DELIVERY_TAB && (
              <DeliverySettingsTab
                deliveryRatePerMileCents={deliveryRatePerMileCents}
                deliveryFlatFeeCents={deliveryFlatFeeCents}
                hubOrigin={hubOrigin}
                updateInProgress={deliveryUpdateInProgress}
                updateSuccess={deliveryUpdateSuccess}
                error={deliveryError}
                onUpdateSettings={onUpdateDeliverySettings}
                onClearSuccess={onClearDeliverySuccess}
              />
            )}

            {activeTab === GEOFENCE_TAB && (
              <GeofenceTab
                polygon={geofencePolygon}
                vendorPolygon={geofenceVendorPolygon}
                consumerPolygon={geofenceConsumerPolygon}
                updateInProgress={geofenceUpdateInProgress}
                updateSuccess={geofenceUpdateSuccess}
                error={geofenceError}
                onSaveGeofence={onUpdateGeofenceSettings}
                onClearSuccess={onClearGeofenceSuccess}
              />
            )}

            {activeTab === USERS_TAB && (
              <UserManagementTab
                pendingUsers={pendingUsers}
                fetchInProgress={pendingUsersFetchInProgress}
                fetchError={pendingUsersFetchError}
                actionInProgress={userActionInProgress}
                actionError={userActionError}
                onApproveUser={onApproveUser}
                onRejectUser={onRejectUser}
              />
            )}

            {activeTab === ORDERS_TAB && (
              <OrdersTab
                orders={ordersAwaitingDelivery}
                fetchInProgress={ordersFetchInProgress}
                fetchError={ordersFetchError}
                markInProgress={markDeliveredInProgress}
                markError={markDeliveredError}
                onMarkDelivered={onMarkDelivered}
              />
            )}

            {activeTab === PUSH_TAB && (
              <PushNotificationsTab
                announcements={announcements}
                fetchInProgress={announcementsFetchInProgress}
                sendInProgress={sendPushInProgress}
                sendSuccess={sendPushSuccess}
                sendError={sendPushError}
                onSend={onSendPush}
                onToggleActive={onToggleAnnouncement}
                onClearSuccess={onClearSendPushSuccess}
              />
            )}

            {activeTab === PICKUP_TAB && flags.pickupSchedule && (
              <PickupScheduleTab
                pickupSettings={pickupSettings}
                updateInProgress={pickupUpdateInProgress}
                updateSuccess={pickupUpdateSuccess}
                error={pickupError}
                onUpdateSettings={onUpdatePickupSettings}
                onClearSuccess={onClearPickupSuccess}
              />
            )}

            {activeTab === TAX_TAB && flags.taxBreakdown && (
              <TaxSettingsTab
                taxSettings={taxSettings}
                updateInProgress={taxUpdateInProgress}
                updateSuccess={taxUpdateSuccess}
                error={taxError}
                onUpdateSettings={onUpdateTaxSettings}
                onClearSuccess={onClearTaxSuccess}
                vendors={vendors}
                vendorTaxExemptInProgress={vendorTaxExemptInProgress}
                onSetVendorTaxExempt={onSetVendorTaxExempt}
              />
            )}

            {activeTab === SHUFFLE_TAB && flags.listingShuffle && (
              <ListingShuffleTab
                shuffleSettings={shuffleSettings}
                updateInProgress={shuffleUpdateInProgress}
                updateSuccess={shuffleUpdateSuccess}
                error={shuffleError}
                runInProgress={shuffleRunInProgress}
                runResult={shuffleRunResult}
                onUpdateSettings={onUpdateShuffleSettings}
                onRunNow={onRunShuffle}
                onClearSuccess={onClearShuffleSuccess}
              />
            )}

            {activeTab === CHECKOUT_FAILURES_TAB && <CheckoutFailuresTab />}

            {activeTab === BULLETIN_TAB && flags.vendorBulletin && (
              <BulletinBoardTab
                bulletins={bulletins}
                updateInProgress={bulletinsUpdateInProgress}
                updateSuccess={bulletinsUpdateSuccess}
                error={bulletinsError}
                onUpdateBulletins={onUpdateBulletins}
                onClearSuccess={onClearBulletinsSuccess}
              />
            )}
          </div>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    deliveryRatePerMileCents,
    deliveryFlatFeeCents,
    hubOrigin,
    deliveryFetchInProgress,
    deliveryUpdateInProgress,
    deliveryUpdateSuccess,
    deliveryError,
    geofencePolygon,
    geofenceVendorPolygon,
    geofenceConsumerPolygon,
    geofenceUpdateInProgress,
    geofenceUpdateSuccess,
    geofenceError,
    pendingUsers,
    pendingUsersFetchInProgress,
    pendingUsersFetchError,
    userActionInProgress,
    userActionError,
    ordersAwaitingDelivery,
    ordersFetchInProgress,
    ordersFetchError,
    markDeliveredInProgress,
    markDeliveredError,
    announcements,
    announcementsFetchInProgress,
    sendPushInProgress,
    sendPushSuccess,
    sendPushError,
    pickupSettings,
    pickupUpdateInProgress,
    pickupUpdateSuccess,
    pickupError,
    taxSettings,
    taxUpdateInProgress,
    taxUpdateSuccess,
    taxError,
    shuffleSettings,
    shuffleUpdateInProgress,
    shuffleUpdateSuccess,
    shuffleRunInProgress,
    shuffleRunResult,
    shuffleError,
    bulletins,
    bulletinsUpdateInProgress,
    bulletinsUpdateSuccess,
    bulletinsError,
    vendors,
    vendorTaxExemptInProgress,
  } = state.AdminPage;

  return {
    currentUser,
    deliveryRatePerMileCents,
    deliveryFlatFeeCents,
    hubOrigin,
    deliveryFetchInProgress,
    deliveryUpdateInProgress,
    deliveryUpdateSuccess,
    deliveryError,
    geofencePolygon,
    geofenceVendorPolygon,
    geofenceConsumerPolygon,
    geofenceUpdateInProgress,
    geofenceUpdateSuccess,
    geofenceError,
    pendingUsers,
    pendingUsersFetchInProgress,
    pendingUsersFetchError,
    userActionInProgress,
    userActionError,
    ordersAwaitingDelivery,
    ordersFetchInProgress,
    ordersFetchError,
    markDeliveredInProgress,
    markDeliveredError,
    announcements,
    announcementsFetchInProgress,
    sendPushInProgress,
    sendPushSuccess,
    sendPushError,
    pickupSettings,
    pickupUpdateInProgress,
    pickupUpdateSuccess,
    pickupError,
    taxSettings,
    taxUpdateInProgress,
    taxUpdateSuccess,
    taxError,
    shuffleSettings,
    shuffleUpdateInProgress,
    shuffleUpdateSuccess,
    shuffleRunInProgress,
    shuffleRunResult,
    shuffleError,
    bulletins,
    bulletinsUpdateInProgress,
    bulletinsUpdateSuccess,
    bulletinsError,
    vendors,
    vendorTaxExemptInProgress,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onUpdateDeliverySettings: params => dispatch(updateDeliverySettings(params)),
  onClearDeliverySuccess: () => dispatch(clearDeliveryUpdateSuccess()),
  onUpdateGeofenceSettings: params => dispatch(updateGeofenceSettings(params)),
  onClearGeofenceSuccess: () => dispatch(clearGeofenceUpdateSuccess()),
  onApproveUser: userId => dispatch(approveUser({ userId })),
  onRejectUser: userId => dispatch(rejectUser({ userId })),
  onUpdatePickupSettings: params => dispatch(updatePickupSettings(params)),
  onClearPickupSuccess: () => dispatch(clearPickupUpdateSuccess()),
  onUpdateTaxSettings: params => dispatch(updateTaxSettings(params)),
  onClearTaxSuccess: () => dispatch(clearTaxUpdateSuccess()),
  onUpdateShuffleSettings: params => dispatch(updateListingShuffleSettings(params)),
  onRunShuffle: () => dispatch(runListingShuffle()),
  onClearShuffleSuccess: () => dispatch(clearShuffleUpdateSuccess()),
  onUpdateBulletins: params => dispatch(updateBulletins(params)),
  onClearBulletinsSuccess: () => dispatch(clearBulletinsUpdateSuccess()),
  onSetVendorTaxExempt: params => dispatch(setVendorTaxExempt(params)),
  onMarkDelivered: transactionId => dispatch(markOrderDelivered({ transactionId })),
  onSendPush: params => dispatch(sendPushBroadcast(params)),
  onToggleAnnouncement: params => dispatch(setAnnouncementActive(params)),
  onClearSendPushSuccess: () => dispatch(clearSendPushSuccess()),
});

const AdminPage = compose(
  connect(mapStateToProps, mapDispatchToProps)
)(AdminPageComponent);

export default AdminPage;
