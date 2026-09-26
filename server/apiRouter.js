/**
 * This file contains server side endpoints that can be used to perform backend
 * tasks that can not be handled in the browser.
 *
 * The endpoints should not clash with the application routes. Therefore, the
 * endpoints are prefixed in the main server where this file is used.
 */

const express = require('express');
const bodyParser = require('body-parser');
const { deserialize } = require('./api-util/sdk');

const initiateLoginAs = require('./api/initiate-login-as');
const loginAs = require('./api/login-as');
const transactionLineItems = require('./api/transaction-line-items');
const initiatePrivileged = require('./api/initiate-privileged');
const transitionPrivileged = require('./api/transition-privileged');
const deleteAccount = require('./api/delete-account');

const { getHandler: getDeliverySettings, putHandler: putDeliverySettings } = require('./api/delivery-settings');
const { getHandler: getGeofenceSettings, putHandler: putGeofenceSettings } = require('./api/geofence-settings');
const validateGeofence = require('./api/validate-geofence');
const estimateCartDelivery = require('./api/estimate-cart-delivery');
const calculateCartFee = require('./api/calculate-cart-fee');

const { getHandler: getPickupSettings, putHandler: putPickupSettings } = require('./api/pickup-settings');
const { getHandler: getTaxSettings, putHandler: putTaxSettings } = require('./api/tax-settings');
const { getHandler: getBulletins, putHandler: putBulletins, getAllHandler: getAllBulletins } = require('./api/bulletin-settings');
const { followHandler, unfollowHandler, getFollowedHandler } = require('./api/follow-vendor');
const activeOrderGroup = require('./api/active-order-group');
const orderGroups = require('./api/order-groups');
const vendorSuborders = require('./api/vendor-suborders');
const convertOrderToDelivery = require('./api/convert-order-to-delivery');
const {
  postHandler: postCheckoutFailure,
  getHandler: getCheckoutFailures,
} = require('./api/checkout-failures');
const linkDeliveryItems = require('./api/link-delivery-items');
const reconcileDelivery = require('./api/reconcile-delivery');
const reportDeliveryProblem = require('./api/report-delivery-problem');
const dailyOrderCount = require('./api/daily-order-count');
const shuffleListings = require('./api/shuffle-listings');
const {
  getHandler: getShuffleSettings,
  putHandler: putShuffleSettings,
  runHandler: runShuffleNow,
} = require('./api/listing-shuffle-settings');
const { getNotificationsHandler, notifyFollowersHandler, markReadHandler } = require('./api/notifications');
const { registerHandler: registerDeviceToken, unregisterHandler: unregisterDeviceToken } = require('./api/device-tokens');
const pushTransition = require('./api/push-transition');

const adminPendingUsers = require('./api/admin/pending-users');
const adminApproveUser = require('./api/admin/approve-user');
const adminRejectUser = require('./api/admin/reject-user');
const adminListVendors = require('./api/admin/list-vendors');
const adminSetVendorTaxExempt = require('./api/admin/set-vendor-tax-exempt');
const adminOrdersAwaitingDelivery = require('./api/admin/orders-awaiting-delivery');
const adminMarkDelivered = require('./api/admin/mark-delivered');
const adminMarkReceived = require('./api/admin/mark-received');
const adminSendPush = require('./api/admin/send-push');
const {
  getHandler: getAnnouncements,
  getAllHandler: getAllAnnouncements,
  setActiveHandler: setAnnouncementActive,
} = require('./api/announcements');

const createOnfleetTask = require('./api/create-onfleet-task');
const onfleetWebhook = require('./api/onfleet-webhook');

const createUserWithIdp = require('./api/auth/createUserWithIdp');

const { authenticateFacebook, authenticateFacebookCallback } = require('./api/auth/facebook');
const { authenticateGoogle, authenticateGoogleCallback } = require('./api/auth/google');

const router = express.Router();

// ================ API router middleware: ================ //

// Parse Transit body first to a string
router.use(
  bodyParser.text({
    type: 'application/transit+json',
  })
);

// Deserialize Transit body string to JS data
router.use((req, res, next) => {
  if (req.get('Content-Type') === 'application/transit+json' && typeof req.body === 'string') {
    try {
      req.body = deserialize(req.body);
    } catch (e) {
      console.error('Failed to parse request body as Transit:');
      console.error(e);
      res.status(400).send('Invalid Transit in request body.');
      return;
    }
  }
  next();
});

// Parse JSON body for delivery-settings, geofence-settings, and validate-geofence endpoints
router.use('/delivery-settings', bodyParser.json());
router.use('/geofence-settings', bodyParser.json());
router.use('/validate-geofence', bodyParser.json());
router.use('/estimate-cart-delivery', bodyParser.json());
router.use('/calculate-cart-fee', bodyParser.json());
router.use('/admin', bodyParser.json());
router.use('/create-onfleet-task', bodyParser.json());
// The OnFleet webhook needs its RAW body to check the signature: a re-serialized
// object is not byte-identical to what was signed, so `bodyParser.json()` here
// would make every HMAC fail. The handler parses it itself, after verifying.
router.use('/onfleet-webhook', bodyParser.raw({ type: '*/*', limit: '1mb' }));
router.use('/pickup-settings', bodyParser.json());
router.use('/tax-settings', bodyParser.json());
router.use('/bulletin-settings', bodyParser.json());
router.use('/follow-vendor', bodyParser.json());
router.use('/active-order-group', bodyParser.json());
router.use('/order-groups', bodyParser.json());
router.use('/vendor-suborders', bodyParser.json());
router.use('/convert-order-to-delivery', bodyParser.json());
router.use('/checkout-failures', bodyParser.json());
router.use('/link-delivery-items', bodyParser.json());
router.use('/reconcile-delivery', bodyParser.json());
router.use('/report-delivery-problem', bodyParser.json());
router.use('/daily-order-count', bodyParser.json());
router.use('/listing-shuffle-settings', bodyParser.json());
router.use('/notifications', bodyParser.json());
router.use('/announcements', bodyParser.json());
router.use('/notify-followers', bodyParser.json());
router.use('/device-tokens', bodyParser.json());
router.use('/push/transition', bodyParser.json());

// ================ API router endpoints: ================ //

router.get('/initiate-login-as', initiateLoginAs);
router.get('/login-as', loginAs);
router.post('/transaction-line-items', transactionLineItems);
router.post('/initiate-privileged', initiatePrivileged);
router.post('/transition-privileged', transitionPrivileged);
router.post('/delete-account', deleteAccount);

// Delivery settings endpoints
router.get('/delivery-settings', getDeliverySettings);
router.put('/delivery-settings', putDeliverySettings);

// Geofence settings endpoints
router.get('/geofence-settings', getGeofenceSettings);
router.put('/geofence-settings', putGeofenceSettings);
router.post('/validate-geofence', validateGeofence);
router.post('/estimate-cart-delivery', estimateCartDelivery);
router.post('/calculate-cart-fee', calculateCartFee);

// Pickup schedule settings endpoints
router.get('/pickup-settings', getPickupSettings);
router.put('/pickup-settings', putPickupSettings);

// Tax settings endpoints
router.get('/tax-settings', getTaxSettings);
router.put('/tax-settings', putTaxSettings);

// Bulletin board endpoints
router.get('/bulletin-settings', getBulletins);
router.put('/bulletin-settings', putBulletins);
router.get('/bulletin-settings/all', getAllBulletins);

// Vendor follow endpoints
router.post('/follow-vendor', followHandler);
router.delete('/follow-vendor', unfollowHandler);
router.get('/follow-vendor', getFollowedHandler);

// Order group endpoint (for add-to-existing-order feature)
router.get('/active-order-group', activeOrderGroup);

// Consolidated order views: one checkout rendered as one order on the customer
// side, and one packing list per customer on the vendor side.
router.get('/order-groups', orderGroups);
router.get('/vendor-suborders', vendorSuborders);

// Upgrade a pickup order to delivery after the fact (fee already charged on a
// standalone delivery transaction by the client).
router.post('/convert-order-to-delivery', convertOrderToDelivery);

// A cart checkout that failed partway: refunds anything already charged in it
// and records the failure, which nothing else in the system does.
router.post('/checkout-failures', postCheckoutFailure);
router.get('/checkout-failures', getCheckoutFailures);

// Standalone delivery: link item transactions to a delivery order, and
// reconcile delivery orders (refund-on-full-denial / capture-on-accept).
router.post('/link-delivery-items', linkDeliveryItems);
router.post('/reconcile-delivery', reconcileDelivery);

// Delivery problem reporting
router.post('/report-delivery-problem', reportDeliveryProblem);

// Daily order count for vendor order cap
router.get('/daily-order-count', dailyOrderCount);

// Daily listing shuffle: re-randomizes metadata.sortRandom on every listing.
// Secret-protected; intended to be hit once per day by an external scheduler.
router.post('/shuffle-listings', shuffleListings);

// Admin-managed shuffle settings: read status, toggle the default-sort shuffle,
// and trigger an immediate re-shuffle from the admin panel.
router.get('/listing-shuffle-settings', getShuffleSettings);
router.put('/listing-shuffle-settings', putShuffleSettings);
router.post('/listing-shuffle-settings/run', runShuffleNow);

// Notification endpoints
router.get('/notifications', getNotificationsHandler);
router.post('/notify-followers', notifyFollowersHandler);
router.put('/notifications/read', markReadHandler);

// Push notification device token endpoints
router.post('/device-tokens', registerDeviceToken);
router.delete('/device-tokens', unregisterDeviceToken);
router.post('/push/transition', pushTransition);

// Admin user management endpoints
router.get('/admin/pending-users', adminPendingUsers);
router.post('/admin/approve-user', adminApproveUser);
router.post('/admin/reject-user', adminRejectUser);
router.get('/admin/vendors', adminListVendors);
router.post('/admin/set-vendor-tax-exempt', adminSetVendorTaxExempt);
router.get('/admin/orders-awaiting-delivery', adminOrdersAwaitingDelivery);
router.post('/admin/mark-delivered', adminMarkDelivered);
router.post('/admin/mark-received', adminMarkReceived);

// Admin Push Notification Center: broadcast a push + in-app announcement.
router.post('/admin/send-push', adminSendPush);
router.get('/announcements', getAnnouncements);
router.get('/announcements/all', getAllAnnouncements);
router.put('/announcements/active', setAnnouncementActive);

// OnFleet delivery integration endpoints
router.post('/create-onfleet-task', createOnfleetTask);
router.get('/onfleet-webhook', (req, res) => {
  // OnFleet webhook validation: echo back the check value.
  //
  // `res.send(string)` answers with Content-Type text/html, so echoing the
  // query parameter as-is made this a reflected XSS: `?check=<script>...`
  // ran in the browser of anyone who followed the link. OnFleet only needs
  // the bytes back, so the response is text/plain, where markup is inert.
  const check = req.query.check;
  if (typeof check === 'string' && check) {
    return res.status(200).type('text/plain').send(check);
  }
  return res.status(200).type('text/plain').send('ok');
});
router.post('/onfleet-webhook', onfleetWebhook);

// Create user with identity provider (e.g. Facebook or Google)
// This endpoint is called to create a new user after user has confirmed
// they want to continue with the data fetched from IdP (e.g. name and email)
router.post('/auth/create-user-with-idp', createUserWithIdp);

// Facebook authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Facebook
router.get('/auth/facebook', authenticateFacebook);

// This is the route for callback URL the user is redirected after authenticating
// with Facebook. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/facebook/callback', authenticateFacebookCallback);

// Google authentication endpoints

// This endpoint is called when user wants to initiate authenticaiton with Google
router.get('/auth/google', authenticateGoogle);

// This is the route for callback URL the user is redirected after authenticating
// with Google. In this route a Passport.js custom callback is used for calling
// loginWithIdp endpoint in Sharetribe Auth API to authenticate user to the marketplace
router.get('/auth/google/callback', authenticateGoogleCallback);

module.exports = router;
