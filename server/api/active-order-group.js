const { getSdk, handleError } = require('../api-util/sdk');
const { isCutoffPassed } = require('../api-util/pickupSchedule');

const handler = async (req, res) => {
  const sdk = getSdk(req, res);

  try {
    if (isCutoffPassed()) {
      return res.status(200).json({ orderGroupId: null, canAddToOrder: false });
    }

    // Query recent transactions for this customer
    const response = await sdk.transactions.query({
      only: 'order',
      lastTransitions: [
        'transition/confirm-payment',
        'transition/accept-order',
        'transition/operator-accept-order',
      ],
      page: 1,
      perPage: 20,
    });

    const transactions = response.data.data;

    // Find the most recent transaction with an orderGroupId
    const withGroup = transactions.find(tx => {
      const protectedData = tx.attributes.protectedData || {};
      return !!protectedData.orderGroupId;
    });

    if (withGroup) {
      const orderGroupId = withGroup.attributes.protectedData.orderGroupId;
      // Find the standalone delivery transaction for this group (if any) so new
      // items can be attached to the SAME delivery rather than re-charging it.
      const deliveryTx = transactions.find(tx => {
        const pd = tx.attributes.protectedData || {};
        return pd.isDeliveryOrder === true && pd.orderGroupId === orderGroupId;
      });
      const deliveryTransactionId = deliveryTx?.id?.uuid || null;
      // Inherit the original order's delivery choice so the buyer doesn't have
      // to pick pickup vs. delivery again. Prefer the stored deliveryMethod;
      // otherwise infer from whether the group has a standalone delivery
      // transaction (shipping) or not (pickup).
      const deliveryMethod =
        withGroup.attributes.protectedData.deliveryMethod ||
        (deliveryTransactionId ? 'shipping' : 'pickup');
      return res
        .status(200)
        .json({ orderGroupId, deliveryTransactionId, deliveryMethod, canAddToOrder: true });
    }

    res.status(200).json({
      orderGroupId: null,
      deliveryTransactionId: null,
      deliveryMethod: null,
      canAddToOrder: false,
    });
  } catch (e) {
    handleError(res, e);
  }
};

module.exports = handler;
