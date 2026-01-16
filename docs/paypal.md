# PayPal Gateway

PayPal uses OAuth 2.0 authentication and the Orders API v2 for processing payments.

## Configuration

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
  paypal: {
    // Required: API credentials
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,

    // Optional: Webhook verification (required for production)
    webhookId: process.env.PAYPAL_WEBHOOK_ID,

    // Optional: Environment (default: false = production)
    sandbox: process.env.NODE_ENV !== 'production',
  },
  defaultGateway: 'paypal',
});
```

## Create Payment

```typescript
const result = await client.createPayment({
  amount: 99.99,
  currency: 'USD',
  callbackUrl: 'https://example.com/callback',

  // PayPal-specific
  returnUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',

  // Idempotency (recommended)
  idempotencyKey: crypto.randomUUID(),

  // Your internal references
  orderId: 'order_123',
  description: 'Premium Subscription',
  metadata: { paymentId: 'pay_internal_001' },
});

// Redirect customer to PayPal for approval
if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

## Capture Payment (After Customer Approval)

PayPal uses a two-step flow: create order → capture after approval.

```typescript
// Customer returns from PayPal with order ID in query params
const orderId = req.query.token; // PayPal order ID

const captureResult = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: orderId,
});

// Extract capture ID for refunds
const captureId = (captureResult.rawResponse as any).captureId;

// Store captureId for future refunds
await db.payment.update({
  where: { orderId },
  data: { captureId },
});
```

## Refunds

> **Important**: PayPal refunds require the **Capture ID**, not the Order ID.

```typescript
// Full refund
await client.refundPayment({
  gatewayPaymentId: captureId, // Use capture ID!
});

// Partial refund (currency required)
await client.refundPayment({
  gatewayPaymentId: captureId,
  amount: 25.00,
  currency: 'USD', // Required for partial refunds
  reason: 'Customer request',
});
```

## Void Payment

Use this to void an authorized payment that hasn't been captured yet.

> **Note**: This only works for payments with `intent: 'AUTHORIZE'`. Once captured, you must use refund.

```typescript
const result = await client.voidPayment('paypal', {
  gatewayPaymentId: 'AUTHORIZATION-ID', // The authorization ID, NOT the order ID
});

if (result.success) {
  console.log('Authorization voided successfully');
}
```

## Get Payment Details

Retrieve the current status and details of a PayPal order.

```typescript
const payment = await client.getPayment('paypal', {
  gatewayPaymentId: 'ORDER-123',
});

console.log(payment.status); // 'pending', 'authorized', 'paid', etc.
console.log(payment.amount);
```

## Webhook Verification

PayPal requires **async verification** via their API. The gateway provides both sync (legacy) and async methods.

```typescript
// Recommended: Async verification
app.post('/webhooks/paypal', async (req) => {
  const gateway = client.gateway('paypal');

  // Verify signature with PayPal API
  const isValid = await gateway.verifyWebhookAsync(req.body, {
    'paypal-transmission-id': req.headers['paypal-transmission-id'],
    'paypal-transmission-time': req.headers['paypal-transmission-time'],
    'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
    'paypal-cert-url': req.headers['paypal-cert-url'],
    'paypal-auth-algo': req.headers['paypal-auth-algo'],
  });

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  // Parse normalized event
  const event = gateway.parseWebhookEvent(req.body);

  console.log(event.status);          // 'paid', 'refunded', etc.
  console.log(event.paymentId);       // Your custom_id
  console.log(event.gatewayPaymentId); // Capture ID

  return { received: true };
});
```

## Important Notes

| Topic | Note |
|-------|------|
| **Capture ID** | Store the capture ID from `capturePayment()` for refunds |
| **Currency** | Required for partial refunds, optional for full refunds |
| **Webhook ID** | Configure in PayPal Developer Dashboard → Webhooks |
| **Idempotency** | Use `idempotencyKey` for safe retries on network failures |
| **Token Caching** | Access tokens are cached and refreshed automatically |
| **Retry Logic** | Transient errors (5xx, rate limits) retry with exponential backoff |

## PayPal Webhook Events

| Event Type | Mapped Status |
|------------|---------------|
| `PAYMENT.CAPTURE.COMPLETED` | `paid` |
| `PAYMENT.CAPTURE.DENIED` | `failed` |
| `PAYMENT.CAPTURE.REFUNDED` | `refunded` |
| `CHECKOUT.ORDER.APPROVED` | `authorized` |
