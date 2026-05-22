# Paymob Gateway

Paymob uses the Unified Intention API for hosted checkout. Amounts passed to the SDK are in base currency units, and the SDK converts them to Paymob's integer minor-unit amount. Currency codes are normalized to uppercase before they are sent to Paymob. For common 2-decimal currencies like SAR, EGP, AED, and PKR that means `amount * 100`; for OMR it means `amount * 1000`.

## Configuration

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
  paymob: {
    // Required for Unified Intention checkout
    secretKey: process.env.PAYMOB_SECRET_KEY!,
    publicKey: process.env.PAYMOB_PUBLIC_KEY!,

    // Required in production webhook handling
    hmacSecret: process.env.PAYMOB_HMAC_SECRET!,

    // Required payment method/integration ID or alias
    integrationId: 123456,

    // Required when using createPayment({ capture: false })
    // Paymob auth/capture behavior is controlled by the selected integration.
    authIntegrationId: 456789,

    // Required only for capture, refund, void, transaction inquiry,
    // or deprecated legacy iframe checkout
    apiKey: process.env.PAYMOB_API_KEY,

    // Required only for deprecated legacy iframe checkout
    iframeId: process.env.PAYMOB_IFRAME_ID,

    // Optional: Region (default: 'ksa')
    region: 'ksa', // 'ksa' | 'eg' | 'pk' | 'om' | 'ae'

    // Optional: Custom base URL override
    baseUrl: 'https://ksa.paymob.com',

    // Optional: Request timeout in milliseconds (default: 30000)
    timeoutMs: 30000,

    // Optional: shared idempotency store for multi-worker/serverless production
    // idempotencyStore: redisBackedPaymobIdempotencyStore,
  },
  defaultGateway: 'paymob',
});
```

For local-only webhook testing without an HMAC secret, set `allowUnverifiedWebhooks: true` and run with an explicit local/test environment such as `NODE_ENV=test`, `NODE_ENV=development`, or `APP_ENV=local`. The SDK refuses unverified webhooks when the environment is production or cannot be identified as local/test; do not rely on unverified webhooks outside local development.

## Create Payment

```typescript
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/webhooks/paymob', // Optional per-payment notification_url
  returnUrl: 'https://example.com/payment-result',
  orderId: 'order_123',
  metadata: {
    paymentId: 'payment_123',
    tenantId: 'tenant_123',
    email: 'customer@example.com',
    firstName: 'Mohammed',
    lastName: 'Ali',
    phone: '+966500000000',
  },
}, 'paymob');

if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

You can also pass billing details explicitly with `paymobBillingData`, and override payment methods per request with `paymobIntegrationId` or `paymobPaymentMethods`.

The create result `gatewayId` is the Paymob intention ID, and `nextAction` exposes the checkout URL, intention ID, client secret, and payment keys returned by Paymob. Capture, refund, void, and inquiry methods require the numeric Paymob transaction ID from the verified webhook or Paymob dashboard. Passing an intention ID such as `pi_...`, a legacy order ID, or any non-numeric value to these methods is rejected before the SDK calls Paymob.

For auth/capture flows, configure `authIntegrationId` or pass an auth/capture integration with `paymobIntegrationId`/`paymobPaymentMethods`. If `capture: false` is used without an auth integration, the SDK rejects the request instead of silently creating a normal payment.

`idempotencyKey` is used as a fallback Paymob `special_reference` during payment creation and deduplicates repeated SDK calls within the same `PaymentClient`/gateway instance. Reusing the same key with different parameters is rejected. For production with multiple workers, serverless invocations, or deploy restarts, configure `idempotencyStore` with Redis, a database, or another process-wide store so completed results can be replayed across gateway instances. Implement the store's optional `reserve` method atomically, such as Redis `SET NX` or a database unique constraint, for full cross-worker duplicate-call protection.

Paymob does not expose native idempotency keys for capture, refund, void, or Intention creation. If a network failure or Paymob 5xx response happens after the SDK sends one of those mutating requests, the SDK marks that `idempotencyKey` outcome as unknown and blocks automatic replay. Reconcile via a verified Paymob callback, transaction inquiry, or the Paymob dashboard before issuing a new mutation.

`callbackUrl` maps to Paymob's optional `notification_url`, which receives transaction processed callbacks for card integrations. You can omit it and use dashboard-configured processed callbacks instead; saved-card token callbacks are not sent to that per-payment URL, so configure the processed callback URL on the relevant Paymob dashboard integration if you use saved cards.

## Capture Payment

```typescript
const result = await client.capturePayment({
  gatewayPaymentId: '123456789', // Paymob transaction ID
  amount: 100,
  currency: 'SAR',
}, 'paymob');
```

If `amount` is omitted, the SDK first retrieves the Paymob transaction and sends the remaining capturable amount as Paymob's integer amount field. If you pass `amount` without `currency`, the SDK retrieves the transaction first and uses Paymob's transaction currency for minor-unit conversion.

When an explicit `amount` is provided, the SDK still retrieves the transaction first to verify the requested currency matches Paymob's transaction currency and that the requested amount does not exceed the remaining capturable balance.

## Void Payment

Use this to void a card transaction before settlement, usually on the same business day.

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: '123456789',
}, 'paymob');
```

## Refund Payment

```typescript
const result = await client.refundPayment({
  gatewayPaymentId: '123456789',
  amount: 50,
  currency: 'SAR',
  reason: 'Customer returned item',
}, 'paymob');
```

If `amount` is omitted, the SDK first retrieves the Paymob transaction and sends the remaining refundable amount. For auth/capture payments, the SDK uses `captured_amount` when Paymob includes it, so partially captured payments are not refunded above the captured total. If you pass `amount` without `currency`, the SDK retrieves the transaction first and uses Paymob's transaction currency for minor-unit conversion.

When an explicit `amount` is provided, the SDK validates it against Paymob's remaining refundable balance before calling the refund endpoint.

## Legacy Iframe Checkout

The deprecated legacy iframe flow returns Paymob's order ID as `gatewayId`, `gatewayObjectId`, and `orderId` because no transaction exists until the customer pays. Capture, refund, void, and inquiry methods still require the numeric Paymob transaction ID from the processed callback or dashboard.

## Get Payment Details

```typescript
const payment = await client.getPayment({
  gatewayPaymentId: '123456789',
}, 'paymob');

console.log(payment.status);

const status = await client.getPaymentStatus('123456789', 'paymob');
```

## Webhook Verification

```typescript
app.post('/webhooks/paymob', async (req) => {
  const hmac = req.query.hmac ?? req.body.hmac;
  const event = await client.handleWebhook('paymob', req.body, hmac);

  console.log(event.status);
  console.log(event.paymentId);
  console.log(event.amount);

  return { received: true };
});
```

The SDK verifies transaction processed callbacks, saved-card token callbacks, and query-style transaction response callbacks with their separate Paymob HMAC field shapes. Use processed backend callbacks as the source of truth for fulfillment; response callbacks are useful for customer-facing result pages.

Saved-card token callbacks normalize to `status: 'setup_completed'`. Their `paymentId` is `undefined` because Paymob's `order_id` is a gateway reference, not your internal payment ID; use `gatewayToken`, `gatewayPaymentId`, `gatewayObjectId`, and the raw payload to associate tokens in your own card-vault flow. Transaction callbacks can normalize to `partially_refunded` or `partially_captured` when Paymob includes partial amount fields, including callbacks that send numeric or boolean fields as strings.

## Supported Regions

| Region | Base URL |
|--------|----------|
| `ksa` (default) | `https://ksa.paymob.com` |
| `eg` | `https://accept.paymob.com` |
| `pk` | `https://pakistan.paymob.com` |
| `om` | `https://oman.paymob.com` |
| `ae` | `https://uae.paymob.com` |
