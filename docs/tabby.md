# Tabby Gateway Integration

Tabby is a Buy Now Pay Later (BNPL) provider for MENA markets. This gateway integration supports:

- Checkout session creation with itemized cart data
- Customer eligibility pre-scoring
- Payment capture (required for settlement)
- Full and partial refunds
- Webhook handling for payment status updates

## Configuration

```typescript
import { PaymentClient } from 'payments-sdk';

const client = new PaymentClient({
  tabby: {
    secretKey: 'sk_your_secret_key',
    merchantCode: 'your_merchant_code',
    sandbox: true, // false for production
    webhookAuthHeader: 'Bearer your_webhook_secret', // Optional
  },
});
```

## Creating a Checkout Session

Tabby requires itemized cart data for all checkout sessions:

```typescript
import type { TabbyCheckoutSessionParams } from 'payments-sdk/types/tabby.types';

const params: TabbyCheckoutSessionParams = {
  amount: '100.00',
  currency: 'SAR',
  buyer: {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '500000001',
  },
  order: {
    reference_id: 'order_123',
    items: [{
      reference_id: 'SKU001',
      title: 'Product Name',
      quantity: 2,
      unit_price: '50.00',
      category: 'Electronics',
    }],
    tax_amount: '0.00',
    shipping_amount: '10.00',
  },
  merchantUrls: {
    success: 'https://yoursite.com/success',
    cancel: 'https://yoursite.com/cancel',
    failure: 'https://yoursite.com/failure',
  },
};

const response = await tabbyGateway.createCheckoutSession(params);

// Redirect customer to Tabby payment page
const redirectUrl = response.configuration.available_products?.installments?.[0]?.web_url;
```

## Checking Customer Eligibility

Before showing Tabby as a payment option, check if the customer is eligible:

```typescript
const eligibility = await tabbyGateway.checkEligibility(params);

if (eligibility.eligible) {
  // Show Tabby payment option
} else {
  // Hide or disable Tabby with rejection message
  console.log(eligibility.rejectionReason);
}
```

## Capturing Payments

**Important**: Tabby payments must be captured after authorization. Uncaptured payments expire after 21 days.

```typescript
const result = await tabbyGateway.capturePayment({
  gatewayPaymentId: 'payment_id_from_session',
  amount: 100.00,
});

if (result.status === 'paid') {
  // Payment captured successfully
}
```

## Processing Refunds

Only `CLOSED` (captured) payments can be refunded:

```typescript
const refund = await tabbyGateway.refundPayment({
  gatewayPaymentId: 'payment_id',
  amount: 50.00, // Partial refund
  reason: 'Customer request',
});
```

## Void Payment

You can close (void) a payment before it is captured, or after partial capture.

```typescript
const result = await client.voidPayment('tabby', {
  gatewayPaymentId: 'payment_id',
});
```

## Get Payment Details

Retrieve the latest status of a payment.

```typescript
const payment = await client.getPayment('tabby', {
  gatewayPaymentId: 'payment_id',
});

console.log(payment.status); // 'authorized', 'paid', etc.
```

## Handling Webhooks

Tabby sends webhooks for payment status changes. Configure your webhook URL in the Tabby dashboard.

```typescript
// In your webhook handler
const event = tabbyGateway.parseWebhookEvent(requestBody);

switch (event.status) {
  case 'authorized':
    // Capture the payment
    await tabbyGateway.capturePayment({
      gatewayPaymentId: event.gatewayPaymentId,
    });
    break;
  case 'paid':
    // Payment captured and settled
    break;
  case 'failed':
    // Payment rejected
    break;
  case 'cancelled':
    // Payment expired
    break;
}
```

### Webhook Verification

Tabby uses IP whitelisting and optional auth headers (no HMAC). Whitelist these IPs:

```
34.166.36.90
34.166.35.211
34.166.34.222
34.166.37.207
34.93.76.191
```

## Status Mapping

| Tabby Status | SDK Status |
|-------------|------------|
| `CREATED` | `pending` |
| `AUTHORIZED` | `authorized` |
| `CLOSED` | `paid` |
| `REJECTED` | `failed` |
| `EXPIRED` | `cancelled` |

## Supported Currencies

- SAR (Saudi Riyal)
- AED (UAE Dirham)
- KWD (Kuwaiti Dinar)