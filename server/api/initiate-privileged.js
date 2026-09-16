const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const { attachAuthorToListing } = require('../api-util/attachAuthor');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');
const { getNextPickupDate } = require('../api-util/pickupSchedule');
const { generateOrderGroupId } = require('../api-util/orderGroups');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body;
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(async ([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const currency = listing.attributes.price?.currency || orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      await attachAuthorToListing(listing, bodyParams?.params?.listingId);

      lineItems = await transactionLineItems(
        listing,
        getFullOrderData(orderData, bodyParams, currency),
        providerCommission,
        customerCommission
      );
      metadataMaybe = getMetadata(orderData, transitionName);

      return getTrustedSdk(req);
    })
    .then(trustedSdk => {
      const { params } = bodyParams;

      // Persist deliveryMethod and orderGroupId in protectedData so the
      // transaction record carries them through to the vendor's inbox,
      // OnFleet task creation, and the transaction breakdown UI.
      const extraProtectedData = {};
      if (orderData?.deliveryMethod) extraProtectedData.deliveryMethod = orderData.deliveryMethod;
      // Every order belongs to a group, including a single-item checkout that
      // never went through the cart — the consolidated order views read this,
      // and a one-item order has to render through the same structure as a
      // ten-item one. The cart sends its own shared id; anything else gets a
      // group of one generated here.
      extraProtectedData.orderGroupId = orderData?.orderGroupId || generateOrderGroupId();
      // Freeze the delivery date onto the order. Reading it back from the
      // pickup schedule later would return the *next* delivery date, not the
      // one this order was placed for.
      const deliveryDate = getNextPickupDate();
      if (deliveryDate) extraProtectedData.deliveryDate = deliveryDate;
      // Standalone delivery linkage: the delivery transaction marks itself with
      // isDeliveryOrder; each item transaction stores the delivery transaction's
      // id so reconciliation can find the delivery order for the group.
      if (orderData?.isDeliveryOrder) extraProtectedData.isDeliveryOrder = true;
      if (orderData?.deliveryTransactionId)
        extraProtectedData.deliveryTransactionId = orderData.deliveryTransactionId;
      const protectedDataMaybe = Object.keys(extraProtectedData).length
        ? { protectedData: { ...(params.protectedData || {}), ...extraProtectedData } }
        : {};

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          lineItems,
          ...metadataMaybe,
          ...protectedDataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams);
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
