const { getSdk } = require('../api-util/sdk');
const { isConfigured, createTask } = require('../api-util/onfleet');
const { describeError } = require('../api-util/describeError');

/**
 * POST /api/create-onfleet-task
 *
 * Called from the frontend after a successful shipping transaction.
 * Creates a delivery task in OnFleet using the authenticated user's SDK
 * session to fetch transaction details.
 *
 * Body: { transactionId: string }
 * Response: { taskId, trackingURL } or { skipped: true }
 */
module.exports = async (req, res) => {
  try {
    // Graceful no-op if OnFleet is not configured
    if (!isConfigured()) {
      return res.status(200).json({ skipped: true });
    }

    const { transactionId } = req.body;
    if (!transactionId) {
      return res.status(400).json({ error: 'transactionId is required' });
    }

    // Use the authenticated user's SDK session to fetch the transaction.
    // The current user is a participant so they can see protectedData.
    const sdk = getSdk(req, res);

    const txResponse = await sdk.transactions.show({
      id: transactionId,
      include: ['listing', 'customer'],
    });

    const transaction = txResponse.data.data;
    const included = txResponse.data.included || [];

    // Extract shipping address from protectedData
    const shippingAddress = transaction.attributes.protectedData?.shippingAddress;
    if (!shippingAddress) {
      return res.status(400).json({ error: 'Transaction has no shipping address' });
    }

    // Extract customer info from included resources
    const customerRef = transaction.relationships?.customer?.data;
    const customer = customerRef
      ? included.find(r => r.type === 'user' && r.id.uuid === customerRef.id.uuid)
      : null;
    const customerName = customer
      ? `${customer.attributes.profile.displayName}`
      : 'Customer';

    // Build OnFleet destination using unparsed address string.
    // OnFleet's geocoder works best with a single address string rather than
    // partially-filled parsed fields.
    const addrParts = [
      shippingAddress.line1 || shippingAddress.addressLine1,
      shippingAddress.city,
      shippingAddress.state,
      shippingAddress.postalCode,
      shippingAddress.country,
    ].filter(Boolean);

    const destination = {
      address: {
        unparsed: addrParts.join(', '),
      },
    };

    // Build recipients with phone from shipping address
    const phone = shippingAddress.phone || '';
    const recipients = [
      {
        name: customerName,
        phone,
        ...(phone ? {} : { skipPhoneNumberValidation: true }),
      },
    ];

    // Extract listing title for notes
    const listingRef = transaction.relationships?.listing?.data;
    const listing = listingRef
      ? included.find(r => r.type === 'listing' && r.id.uuid === listingRef.id.uuid)
      : null;
    const listingTitle = listing?.attributes?.title || 'FarmFed order';

    const notes = `FarmFed order: ${listingTitle} (Transaction: ${transactionId})`;

    // Metadata links the OnFleet task back to the Sharetribe transaction
    const metadata = [
      { name: 'transactionId', type: 'string', value: transactionId },
    ];

    // Create the OnFleet task
    const task = await createTask({ destination, recipients, notes, metadata });

    return res.status(200).json({
      taskId: task.id,
      trackingURL: task.trackingURL || null,
    });
  } catch (e) {
    console.error('create-onfleet-task error:', describeError(e));
    return res.status(500).json({ error: 'Failed to create OnFleet task' });
  }
};
