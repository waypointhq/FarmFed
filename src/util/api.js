// These helpers are calling this template's own server-side routes
// so, they are not directly calling Marketplace API or Integration API.
// You can find these api endpoints from 'server/api/...' directory

import appSettings from '../config/settings';
import { types as sdkTypes, transit } from './sdkLoader';
import Decimal from 'decimal.js';

export const apiBaseUrl = marketplaceRootURL => {
  const port = process.env.REACT_APP_DEV_API_SERVER_PORT;
  const useDevApiServer = process.env.NODE_ENV === 'development' && !!port;

  // In development, the dev API server is running in a different port
  if (useDevApiServer) {
    return `http://localhost:${port}`;
  }

  // Otherwise, use the given marketplaceRootURL parameter or the same domain and port as the frontend
  return marketplaceRootURL ? marketplaceRootURL.replace(/\/$/, '') : `${window.location.origin}`;
};

// Application type handlers for JS SDK.
//
// NOTE: keep in sync with `typeHandlers` in `server/api-util/sdk.js`
export const typeHandlers = [
  // Use Decimal type instead of SDK's BigDecimal.
  {
    type: sdkTypes.BigDecimal,
    customType: Decimal,
    writer: v => new sdkTypes.BigDecimal(v.toString()),
    reader: v => new Decimal(v.value),
  },
];

const serialize = data => {
  return transit.write(data, { typeHandlers, verbose: appSettings.sdk.transitVerbose });
};

const deserialize = str => {
  return transit.read(str, { typeHandlers });
};

const methods = {
  POST: 'POST',
  GET: 'GET',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
};

// If server/api returns data from SDK, you should set Content-Type to 'application/transit+json'
const request = (path, options = {}) => {
  const url = `${apiBaseUrl()}${path}`;
  const { credentials, headers, body, ...rest } = options;

  // If headers are not set, we assume that the body should be serialized as transit format.
  const shouldSerializeBody =
    (!headers || headers['Content-Type'] === 'application/transit+json') && body;
  const bodyMaybe = shouldSerializeBody ? { body: serialize(body) } : body ? { body } : {};

  const fetchOptions = {
    credentials: credentials || 'include',
    // Since server/api mostly talks to Marketplace API using SDK,
    // we default to 'application/transit+json' as content type (as SDK uses transit).
    headers: headers || { 'Content-Type': 'application/transit+json' },
    ...bodyMaybe,
    ...rest,
  };

  return window.fetch(url, fetchOptions).then(res => {
    const contentTypeHeader = res.headers.get('Content-Type');
    const contentType = contentTypeHeader ? contentTypeHeader.split(';')[0] : null;

    if (res.status >= 400) {
      return res.json().then(data => {
        let e = new Error();
        e = Object.assign(e, data);

        throw e;
      });
    }
    if (contentType === 'application/transit+json') {
      return res.text().then(deserialize);
    } else if (contentType === 'application/json') {
      return res.json();
    }
    return res.text();
  });
};

// Keep the previous parameter order for the post method.
// For now, only POST has own specific function, but you can create more or use request directly.
const post = (path, body, options = {}) => {
  const requestOptions = {
    ...options,
    method: methods.POST,
    body,
  };

  return request(path, requestOptions);
};

// Fetch transaction line items from the local API endpoint.
//
// See `server/api/transaction-line-items.js` to see what data should
// be sent in the body.
export const transactionLineItems = body => {
  return post('/api/transaction-line-items', body);
};

// Initiate a privileged transaction.
//
// With privileged transitions, the transactions need to be created
// from the backend. This endpoint enables sending the order data to
// the local backend, and passing that to the Marketplace API.
//
// See `server/api/initiate-privileged.js` to see what data should be
// sent in the body.
export const initiatePrivileged = body => {
  return post('/api/initiate-privileged', body);
};

// Transition a transaction with a privileged transition.
//
// This is similar to the `initiatePrivileged` above. It will use the
// backend for the transition. The backend endpoint will add the
// payment line items to the transition params.
//
// See `server/api/transition-privileged.js` to see what data should
// be sent in the body.
export const transitionPrivileged = body => {
  return post('/api/transition-privileged', body);
};

// Create user with identity provider (e.g. Facebook or Google)
//
// If loginWithIdp api call fails and user can't authenticate to Marketplace API with idp
// we will show option to create a new user with idp.
// For that user needs to confirm data fetched from the idp.
// After the confirmation, this endpoint is called to create a new user with confirmed data.
//
// See `server/api/auth/createUserWithIdp.js` to see what data should
// be sent in the body.
export const createUserWithIdp = body => {
  return post('/api/auth/create-user-with-idp', body);
};

// Check if user can be deleted and then delete the user. Endpoint logic
// must be modified to accommodate the transaction processes used in
// the marketplace.
export const deleteUserAccount = body => {
  return post('/api/delete-account', body);
};

// Fetch the marketplace-wide delivery rate settings.
export const fetchDeliverySettings = () => {
  return request('/api/delivery-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Update the marketplace-wide delivery rate settings (admin only).
export const updateDeliverySettings = body => {
  return request('/api/delivery-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// Estimate delivery fee for a cart using consecutive route (supplier → supplier → buyer).
export const estimateCartDelivery = ({ listingIds, shippingAddress }) => {
  return request('/api/estimate-cart-delivery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingIds, shippingAddress }),
  });
};

// Calculate the FarmFed platform fee for an entire cart in a single call.
// Returns { data: { feeCents, percentage, minimumCents } }.
export const calculateCartFee = ({ subtotalCents }) => {
  return request('/api/calculate-cart-fee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtotalCents }),
  });
};

// Fetch the geofence polygon settings.
export const fetchGeofenceSettings = () => {
  return request('/api/geofence-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Update the geofence polygon settings (admin only).
export const updateGeofenceSettings = body => {
  return request('/api/geofence-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// Fetch users in pending-approval state (admin only).
export const fetchPendingUsers = () => {
  return request('/api/admin/pending-users', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Approve a pending user (admin only).
export const approveUser = ({ userId }) => {
  return request('/api/admin/approve-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
};

// Reject (ban) a pending user (admin only).
export const rejectUser = ({ userId }) => {
  return request('/api/admin/reject-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
};

// List vendor users with tax-exempt flags (admin only).
export const fetchVendors = () => {
  return request('/api/admin/vendors', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Toggle a vendor's tax-exempt flag (admin only).
export const setVendorTaxExempt = ({ userId, taxExempt }) => {
  return request('/api/admin/set-vendor-tax-exempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, taxExempt }),
  });
};

// List orders awaiting FarmFed delivery (purchased state) — admin only.
export const fetchOrdersAwaitingDelivery = () => {
  return request('/api/admin/orders-awaiting-delivery', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Operator-mark an order delivered — admin only.
export const adminMarkDelivered = ({ transactionId }) => {
  return request('/api/admin/mark-delivered', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
};

// Operator-mark a delivered order received — admin only. Escape hatch to push
// orders stuck in the "delivered" state through to completion (pays out vendor).
export const adminMarkReceived = ({ transactionId }) => {
  return request('/api/admin/mark-received', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
};

// ====== Push Notification Center ====== //

// Broadcast a push notification + in-app announcement to all app users (admin).
export const sendPushBroadcast = ({ title, body, link }) => {
  return request('/api/admin/send-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, link }),
  });
};

// Full announcement history (admin).
export const fetchAllAnnouncements = () => {
  return request('/api/announcements/all', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Active announcements for the in-app home banner (public).
export const fetchAnnouncements = () => {
  return request('/api/announcements', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Toggle an announcement on/off (admin).
export const setAnnouncementActive = ({ id, active }) => {
  return request('/api/announcements/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, active }),
  });
};

// Create an OnFleet delivery task for a shipping transaction.
export const createOnfleetTask = ({ transactionId }) => {
  return request('/api/create-onfleet-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
};

// Validate an address against the geofence during signup.
export const validateGeofence = body => {
  return request('/api/validate-geofence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// ====== Pickup Schedule Settings ====== //

export const fetchPickupSettings = () => {
  return request('/api/pickup-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const updatePickupSettings = body => {
  return request('/api/pickup-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// ====== Tax Settings ====== //

export const fetchTaxSettings = () => {
  return request('/api/tax-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const updateTaxSettings = body => {
  return request('/api/tax-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// ====== Listing Shuffle ====== //

export const fetchListingShuffleSettings = () => {
  return request('/api/listing-shuffle-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const updateListingShuffleSettings = body => {
  return request('/api/listing-shuffle-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

export const runListingShuffle = () => {
  return request('/api/listing-shuffle-settings/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
};

// ====== Bulletin Board ====== //

export const fetchBulletins = () => {
  return request('/api/bulletin-settings', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const fetchAllBulletins = () => {
  return request('/api/bulletin-settings/all', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const updateBulletins = body => {
  return request('/api/bulletin-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// ====== Follow Vendor ====== //

export const followVendor = ({ vendorId }) => {
  return request('/api/follow-vendor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorId }),
  });
};

export const unfollowVendor = ({ vendorId }) => {
  return request('/api/follow-vendor', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorId }),
  });
};

export const fetchFollowedVendors = () => {
  return request('/api/follow-vendor', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// ====== Order Group (Add to Existing Order) ====== //

export const fetchActiveOrderGroup = () => {
  return request('/api/active-order-group', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// ====== Consolidated Order Views ====== //

// The customer's orders, one entry per checkout instead of one per line item.
// Pass `id` to fetch a single order group.
export const fetchOrderGroups = ({ id, page } = {}) => {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (page) params.set('page', String(page));
  const query = params.toString();
  return request(`/api/order-groups${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// The logged-in vendor's suborders for a delivery date, plus the per-SKU
// roll-up of everything they need to pull for that date.
export const fetchVendorSuborders = ({ date } = {}) => {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return request(`/api/vendor-suborders${query}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

// Link item transactions to a standalone delivery transaction's order group
// so reconciliation can decide whether the whole order was denied.
export const linkDeliveryItems = ({ deliveryTransactionId, itemTransactionIds }) => {
  return request('/api/link-delivery-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryTransactionId, itemTransactionIds }),
  }).catch(() => null);
};

// Reconcile a delivery transaction (refund if all items denied, capture if any
// accepted). Best-effort fast path; the cron job is the robust backstop.
export const reconcileDeliveryOrder = ({ deliveryTransactionId }) => {
  return request('/api/reconcile-delivery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deliveryTransactionId }),
  }).catch(() => null);
};

// ====== Delivery Problem Report ====== //

export const reportDeliveryProblem = ({ transactionId, category, description }) => {
  return request('/api/report-delivery-problem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId, category, description }),
  });
};

// ====== Notifications ====== //

export const fetchNotifications = () => {
  return request('/api/notifications', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};

export const notifyFollowers = ({ vendorId, listingId, listingTitle }) => {
  return request('/api/notify-followers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorId, listingId, listingTitle }),
  });
};

export const markNotificationsRead = () => {
  return request('/api/notifications/read', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
};

// ====== Push Notification Device Tokens ====== //

export const registerDeviceToken = ({ token, platform }) => {
  return request('/api/device-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, platform }),
  });
};

export const unregisterDeviceToken = ({ token }) => {
  return request('/api/device-tokens', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
};

// Notify the server that a transaction transition just occurred so it can
// dispatch a push notification to the relevant party (vendor or customer).
// Fire-and-forget — never throw on failure, push is best-effort.
export const notifyTransition = ({ transactionId, transition }) => {
  return request('/api/push/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId, transition }),
  }).catch(() => null);
};

// ====== Daily Order Count ====== //

export const fetchDailyOrderCount = ({ listingId }) => {
  return request(`/api/daily-order-count?listingId=${listingId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
};
