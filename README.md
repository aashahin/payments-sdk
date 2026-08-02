# @abshahin/payments-sdk

Unified, framework-agnostic payment SDK for Bun & TypeScript. Seamlessly integrate Moyasar, PayPal, Paymob and Stripe payment gateways with type-safe lifecycle hooks and normalized webhooks.

## Features

- 🔌 **Multi-Gateway Support**: Moyasar, PayPal, Paymob, Stripe
- 🪝 **Lifecycle Hooks**: Before, after, and error hooks on hooked operations (global + per-op where supported — not every method has a dedicated hook; see [hooks matrix](./docs/hooks.md#which-operations-fire-which-hooks))
- 🔒 **Type-Safe**: Full TypeScript support with strict types
- 🌐 **Framework-Agnostic**: Works with Elysia, Express, Hono, or vanilla

## Documentation

- **Gateways**
  - [Moyasar](./docs/moyasar.md)
  - [PayPal](./docs/paypal.md)
  - [Paymob](./docs/paymob.md)
  - [Stripe](./docs/stripe.md)
- **Core Concepts**
  - [Lifecycle Hooks](./docs/hooks.md)
  - [Webhook Handling](./docs/webhooks.md)
  - [Logging & Redaction](./docs/logging.md)
  - [Custom Gateways](./docs/custom-gateways.md)

## Package Structure

```
payments-sdk/              # package root (@abshahin/payments-sdk)
├── src/
│   ├── index.ts           # Main exports
│   ├── client.ts          # PaymentClient orchestrator
│   ├── errors.ts          # Custom error classes
│   ├── types/             # Type definitions
│   ├── hooks/             # Lifecycle hooks
│   └── gateways/          # Gateway implementations (moyasar, paypal, paymob, stripe)
├── dist/                  # Built output
├── docs/                  # Documentation
├── resources/             # Resources
├── package.json
├── README.md
└── tsconfig.json
```

## Installation

```bash
bun add @abshahin/payments-sdk
# or
npm install @abshahin/payments-sdk
# or
pnpm add @abshahin/payments-sdk
```

This package is **ESM-only** (`"type": "module"`, `exports.import` only — no CommonJS `require` build). Use Node ≥ 18 or Bun ≥ 1.0 with ESM (`import` / `"type": "module"`).

## Quick Start

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
  moyasar: {
    secretKey: process.env.MOYASAR_SECRET_KEY!,
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
  },
  defaultGateway: 'moyasar',
});

// Create a payment
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  orderId: 'order_123',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'token',
    token: 'token_xxx',
  },
});

if (result.status === 'failed') {
  // Do not mark the order paid.
} else if (result.redirectUrl) {
  // Redirect customer for 3DS verification
}
```

## Multi-Gateway Usage

```typescript
const client = new PaymentClient({
  moyasar: { secretKey: '...' },
  paypal: { clientId: '...', clientSecret: '...' },
  paymob: {
    secretKey: '...',
    publicKey: '...',
    hmacSecret: '...',
    integrationId: 123456,
    authIntegrationId: 456789, // for capture: false auth/capture flows
    region: 'ksa',
    timeoutMs: 30000,
  },
  stripe: {
    secretKey: 'sk_...',           // required — this package is server-side only
    publishableKey: 'pk_...',      // optional here; browser Stripe.js / Elements only
    webhookSecret: 'whsec_...',
  },
  defaultGateway: 'moyasar',
});

// Use default gateway
await client.createPayment({ ... });

// Specify gateway explicitly
await client.createPayment({ ... }, 'paypal');

// Stripe Checkout Example
const stripe = client.gateway('stripe');
const session = await stripe.createCheckoutSession({
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
  mode: 'payment',
  metadata: { paymentId: 'order_123' },
  lineItems: [
    {
      priceData: {
        currency: 'USD',
        productData: {
          name: 'T-Shirt',
        },
        amount: 20,
      },
      quantity: 10,
    }
  ]
});
```

### Multi-gateway: refund IDs and `capture: false`

The unified API hides provider differences, but **IDs and auth flows are not interchangeable** across gateways. Store the IDs each provider expects for later capture / refund / void:

| Topic | Moyasar | PayPal | Paymob | Stripe |
|-------|---------|--------|--------|--------|
| **Refund target ID** | Payment UUID from create / webhook | **Capture ID** (not order ID) from `capturePayment()` | **Numeric transaction ID** from webhook/dashboard (not intention `pi_...`) | PaymentIntent `pi_...` (or related charge, per Stripe docs) |
| **`capture: false`** | Auth-only payment; later `capturePayment` / `voidPayment` on that payment ID | `AUTHORIZE` intent order → customer approves → `authorizePayment` → `capturePayment` / void on **authorization ID** | Sends `is_auth: true` and uses `authIntegrationId` (or auth method override); capture/void use **transaction ID** | PaymentIntent with manual capture; later `capturePayment` / cancel (void) on `pi_...` |

Always use the gateway that created the payment for follow-up calls (`refundPayment(..., 'paypal')`, etc.). See each gateway doc for edge cases (partial refunds, currency, idempotency).

### Integrator caveats

- **After-hooks cannot undo money.** Hooks that run after a successful create/capture/refund/void (`onAfter`, `afterCapture`, …) may throw or return `{ proceed: false }`, but the provider side effect already happened — the SDK **logs and still returns success** (no `PaymentAbortedError`, no reverse of the charge). Use before-hooks to abort, and reconcile in your app if an after-hook fails. Details: [hooks](./docs/hooks.md#after-hooks-cannot-abort-money-operations).
- **Webhook handlers must be idempotent on `event.id`.** Providers retry deliveries. The SDK verifies and normalizes events; it does **not** dedupe by provider event id. Persist processed `event.id` (or equivalent) and no-op duplicates before fulfilling orders. Details: [webhooks](./docs/webhooks.md).
- **Amounts are major-unit decimals (float risk).** Public APIs take clean `number` amounts in major units (e.g. `10.5` SAR), converted to provider minor units inside the SDK. Pass well-formed decimals only — avoid float arithmetic like `0.1 + 0.2` as inputs; prefer integer minor units or a decimal type on your side until conversion.

## Production checklist

Use this before going live. Gateway-specific details live under [docs/](./docs/).

| Check | Why |
|-------|-----|
| **PayPal `webhookId`** | Required for `verifyWebhookAsync` / `handleWebhook`. Missing config throws `InvalidRequestError` (`paypal.webhookId is required…`). Set from the PayPal Developer Dashboard webhook. |
| **Moyasar / Paymob `idempotencyStore` (multi-worker)** | In-memory store is per process only. Multi-worker, serverless, or restart-safe capture/refund/void needs a shared store (Redis/DB) with atomic `reserve` where available. Configure `moyasar.idempotencyStore` / `paymob.idempotencyStore` and pass `idempotencyKey` on mutations. |
| **Raw body for webhooks** | Stripe and PayPal verification need the **unparsed** request body (string/Buffer). Do not `JSON.parse` first; prefer `client.handleWebhook(gateway, rawBody, signatureOrHeaders)`. |
| **Fulfill on `status`, not `success`** | `success: true` can mean non-terminal outcomes (`pending`, authorized holds, PayPal echeck). Ship/fulfill only when **`status === 'paid'`** (or `authorized` for auth-only holds you intentionally treat as reserved). Prefer verified webhooks over browser redirects. |
| **Float major-unit amounts** | Public `amount` is a JS `number` in major units. Avoid float math as inputs (`0.1 + 0.2`); pass clean decimals. Zero- and three-decimal currencies still convert at the SDK boundary. |
| **Idempotent webhook handlers** | Persist processed `event.id` (app-level — the SDK does not store it) before inventory/fulfillment. |
| **Secret keys server-side only** | Never put `secretKey` / `clientSecret` / `whsec_…` / HMAC secrets in browser code. |

## Keys: secret vs publishable

This package is **server-side only**. Configure **secret** keys (`secretKey`, PayPal `clientSecret`, Stripe `sk_…` / `whsec_…`, Moyasar `sk_…`, Paymob `secretKey` / `hmacSecret`) on the backend.

**Publishable / public keys** (`publishableKey`, Paymob `publicKey`) are for browser SDKs (Stripe.js, Elements, Paymob.js, etc.). They are optional on `PaymentClient` config and are **not** used for create/capture/refund/void or webhook verification in this package. Do not put secret keys in client-side code.

## Stripe Webhook Note

For Stripe webhooks, you **MUST** pass the raw request body to `handleWebhook` (or `verifyWebhook` if you verify manually). If your framework parses JSON automatically, access the raw body buffer or string before parsing; Buffer payloads are verified using their original bytes.
Prefer `client.handleWebhook('stripe', rawBody, signature)` — it verifies, parses, and runs webhook hooks. Stripe webhook verification fails closed when `webhookSecret` is not configured.
Stripe webhook parsing expects snapshot events with `data.object`; hydrate thin events before passing them to `parseWebhookEvent`. Checkout, invoice, and subscription webhooks normalize `gatewayPaymentId` to the related PaymentIntent, SetupIntent, or Subscription when Stripe includes one.

```typescript
// Example using Elysia / Fetch-style handlers
app.post('/webhook/stripe', async ({ request }) => {
    const signature = request.headers.get('stripe-signature') ?? undefined;
    const rawBody = await request.text(); // raw body — do not JSON.parse first

    const event = await client.handleWebhook('stripe', rawBody, signature);
    // fulfill from event.status / event.gatewayPaymentId — be idempotent on event.id
    return { received: true };
});
```

## Error Handling

```typescript
import {
  PaymentError,
  PaymentAbortedError,
  GatewayNotConfiguredError,
  InvalidWebhookError,
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  RateLimitError,
} from '@abshahin/payments-sdk';

try {
  await client.createPayment({ ... });
} catch (error) {
  if (error instanceof PaymentAbortedError) {
    // Aborted by a hook
    console.log('Aborted:', error.message);
  } else if (error instanceof GatewayApiError) {
    // Gateway API returned an error
    console.log('Gateway error:', error.rawError);
  } else if (error instanceof PaymentError) {
    // Other payment error
    console.log('Error code:', error.code);
  }
}
```

## License

MIT
