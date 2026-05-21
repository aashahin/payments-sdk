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

    // Optional: Request timeout in milliseconds (default: 30000)
    timeoutMs: 30000,
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

  // Idempotency (strongly recommended; required for safe retries after timeouts)
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

For one-time payments, PayPal uses a two-step flow: create order → capture after approval.

```typescript
// Customer returns from PayPal with order ID in query params
const orderId = req.query.token; // PayPal order ID

const captureResult = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: orderId,
});

// Store the capture ID for refunds. For successful PayPal captures,
// result.gatewayId and result.captureId both point to the capture ID.
const captureId = captureResult.captureId;
if (!captureId) throw new Error('PayPal capture ID missing');

// Store captureId for future refunds
await db.payment.update({
  where: { orderId },
  data: { captureId },
});
```

## Authorize Then Capture Later

Set `capture: false` to create an `AUTHORIZE` intent order. After the customer approves the order, authorize it to place the hold, then capture or void the authorization later.

```typescript
const order = await client.createPayment({
  amount: 99.99,
  currency: 'USD',
  callbackUrl: 'https://example.com/callback',
  capture: false,
});

// After PayPal redirects back with the order ID:
const orderId = req.query.token as string;

const authResult = await client.gateway('paypal').authorizePayment({
  gatewayPaymentId: orderId,
  idempotencyKey: crypto.randomUUID(),
});

const authorizationId = authResult.authorizationId;
if (!authorizationId) throw new Error('PayPal authorization ID missing');

const captureResult = await client.gateway('paypal').capturePayment({
  gatewayPaymentId: authorizationId,
  amount: 25.00,
  currency: 'USD',
  paypalCaptureType: 'authorization',
  paypalFinalCapture: false,
  idempotencyKey: crypto.randomUUID(),
});

const firstCaptureId = captureResult.captureId;
if (!firstCaptureId) throw new Error('PayPal capture ID missing');

// Final capture from the same authorization
await client.gateway('paypal').capturePayment({
  gatewayPaymentId: authorizationId,
  amount: 74.99,
  currency: 'USD',
  paypalCaptureType: 'authorization',
  paypalFinalCapture: true,
  idempotencyKey: crypto.randomUUID(),
});
```

## Refunds

> **Important**: PayPal refunds require the **Capture ID**, not the Order ID.

```typescript
// Full refund
await client.refundPayment({
  gatewayPaymentId: captureId, // Use capture ID!
  idempotencyKey: crypto.randomUUID(),
});

// Partial refund (currency required)
await client.refundPayment({
  gatewayPaymentId: captureId,
  amount: 25.00,
  currency: 'USD', // Required for partial refunds
  reason: 'Customer request',
  idempotencyKey: crypto.randomUUID(),
});
```

## Void Payment

Use this to void an authorized payment that hasn't been captured yet.

> **Note**: This only works for payments with `intent: 'AUTHORIZE'`. Once captured, you must use refund.

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: 'AUTHORIZATION-ID', // The authorization ID, NOT the order ID
  idempotencyKey: crypto.randomUUID(),
}, 'paypal');

if (result.success) {
  console.log('Authorization voided successfully');
}
```

## Get Payment Details

Retrieve the current status and details of a PayPal order.

```typescript
const payment = await client.getPayment({
  // PayPal order ID, capture ID, or authorization ID
  gatewayPaymentId: 'ORDER-123',
}, 'paypal');

console.log(payment.status); // 'pending', 'authorized', 'paid', etc.
console.log(payment.amount);
```

## Webhook Verification

PayPal requires **async verification** via their API. The SDK's `handleWebhook()` automatically uses async verification for PayPal when you pass the webhook headers.

```typescript
app.post('/webhooks/paypal', async (req) => {
  let event;
  try {
    event = await client.handleWebhook('paypal', req.body, {
      'paypal-transmission-id': req.headers['paypal-transmission-id'],
      'paypal-transmission-time': req.headers['paypal-transmission-time'],
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
      'paypal-cert-url': req.headers['paypal-cert-url'],
      'paypal-auth-algo': req.headers['paypal-auth-algo'],
    });
  } catch (error) {
    // Return a 5xx for transient PayPal verification/API failures so PayPal retries.
    // Return 4xx only for genuinely invalid webhooks.
    throw error;
  }

  console.log(event.status);          // 'paid', 'refunded', 'refund_pending', etc.
  console.log(event.paymentId);       // Your custom_id, or purchase unit reference_id fallback
  console.log(event.gatewayPaymentId); // Capture ID when PayPal provides one; otherwise the emitted resource ID
  console.log(event.amount);          // Undefined for PayPal events that do not include amount data

  return { received: true };
});
```

## Important Notes

| Topic | Note |
|-------|------|
| **Capture ID** | Store the capture ID from `capturePayment()` for refunds |
| **Capture result ID** | After capture, `result.gatewayId` is the PayPal capture ID. The original PayPal order is available as `result.orderId`. |
| **Authorization ID** | Store the authorization ID from `authorizePayment()` for voids or delayed captures |
| **Status lookup IDs** | `getPayment()` and `getPaymentStatus()` accept PayPal order IDs, capture IDs, and authorization IDs, so the `gatewayId` returned from create, authorize, or capture can be checked later. |
| **Authorization captures** | `capturePayment()` only accepts `amount` with `paypalCaptureType: 'authorization'` |
| **Authorize params** | `authorizePayment()` only accepts `gatewayPaymentId` and `idempotencyKey`; capture-only fields are rejected. |
| **Final capture** | Authorization captures default to `paypalFinalCapture: true`; set `false` before the final capture only when you need multiple captures |
| **Payment preference** | Create-order requests set PayPal wallet `payment_method_preference` to `IMMEDIATE_PAYMENT_REQUIRED`, matching PayPal's current direct Orders API examples. |
| **Currency** | Required for partial refunds and partial authorization captures; optional for full refunds |
| **Zero-decimal currencies** | `JPY`, `HUF`, and `TWD` amounts must be whole numbers |
| **Webhook ID** | Configure in PayPal Developer Dashboard → Webhooks |
| **Webhook reference** | `event.paymentId` uses PayPal `custom_id` when available and falls back to the purchase unit `reference_id` that the SDK sends from `orderId`. |
| **Webhook scope** | The SDK normalizes current checkout/order, authorization, capture, and refund-pending/failed events. Refund lifecycle events use `refund_pending` / `refund_failed` so they are not confused with original payment state. Unsupported PayPal events are rejected instead of being guessed as `pending` with a fake amount. |
| **Webhook amounts** | `event.amount` and `event.currency` are present only when PayPal includes amount data. `CHECKOUT.PAYMENT-APPROVAL.REVERSED` does not include amount data in PayPal's documented payload, so those fields are undefined. |
| **Refund webhook IDs** | For refund lifecycle webhooks, `event.gatewayPaymentId` is the related capture ID when PayPal includes it in `supplementary_data.related_ids.capture_id` or a `rel: "up"` capture link; `event.gatewayObjectId` is the refund ID. Refund resource `custom_id` is not treated as the original payment ID. |
| **Reversals** | `PAYMENT.CAPTURE.REVERSED` maps to `reversed`, not `refunded`, because reversals can represent chargebacks or other non-merchant refund flows. |
| **Webhook retries** | If PayPal's verification API is unavailable, the SDK throws instead of treating the webhook as invalid. Return a retryable HTTP status from your webhook route. |
| **Idempotency** | Use a stable UUID `idempotencyKey` for every create, capture, refund, and void call. The SDK generates a request ID when omitted, but app-level retries after a crash or timeout need the same key. Orders API calls follow PayPal's 108-character request ID limit; Payments API calls follow the wider Payments v2 limit. |
| **Token Caching** | Access tokens are cached and refreshed automatically |
| **Retry Logic** | Transient errors (5xx, rate limits, network failures, and PayPal `PREVIOUS_REQUEST_IN_PROGRESS` 409 conflicts) retry with exponential backoff; `Retry-After` is honored when PayPal sends it. |
| **Response validation** | PayPal success responses must include the expected order ID, approval link, capture ID, authorization ID, or refund ID. Missing fields throw a gateway error. |

## PayPal Webhook Events

| Event Type | Mapped Status |
|------------|---------------|
| `PAYMENT.CAPTURE.COMPLETED` | `paid` |
| `PAYMENT.CAPTURE.DENIED` | `failed` |
| `PAYMENT.CAPTURE.DECLINED` | `failed` |
| `PAYMENT.CAPTURE.PENDING` | `pending` |
| `PAYMENT.CAPTURE.REFUNDED` | `refunded` or `partially_refunded` based on PayPal capture status |
| `PAYMENT.CAPTURE.REVERSED` | `reversed` |
| `CHECKOUT.ORDER.APPROVED` | `approved` |
| `CHECKOUT.ORDER.COMPLETED` | `paid` |
| `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | `cancelled` |
| `PAYMENT.AUTHORIZATION.CREATED` | `authorized` |
| `PAYMENT.AUTHORIZATION.CAPTURED` | `paid` |
| `PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED` | `partially_captured` |
| `PAYMENT.AUTHORIZATION.VOIDED` | `cancelled` |
| `PAYMENT.REFUND.PENDING` | `refund_pending` |
| `PAYMENT.REFUND.FAILED` | `refund_failed` |
