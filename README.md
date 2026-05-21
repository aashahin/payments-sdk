# @abshahin/payments-sdk

Unified, framework-agnostic payment SDK for Bun & TypeScript. Seamlessly integrate Moyasar, PayPal, Paymob, Stripe, Tabby, Tamara and other payment gateways with type-safe lifecycle hooks and normalized webhooks.

## Features

- 🔌 **Multi-Gateway Support**: Moyasar, PayPal, Paymob, Stripe, Tabby, Tamara
- 🪝 **Lifecycle Hooks**: Before, after, and error hooks for all operations
- 🔒 **Type-Safe**: Full TypeScript support with strict types
- 🌐 **Framework-Agnostic**: Works with Elysia, Express, Hono, or vanilla

## Documentation

- **Gateways**
  - [Moyasar](./docs/moyasar.md)
  - [PayPal](./docs/paypal.md)
  - [Paymob](./docs/paymob.md)
  - [Stripe](./docs/stripe.md)
  - [Tabby](./docs/tabby.md)
  - [Tamara](./docs/tamara.md)
- **Core Concepts**
  - [Lifecycle Hooks](./docs/hooks.md)
  - [Webhook Handling](./docs/webhooks.md)
  - [Custom Gateways](./docs/custom-gateways.md)

## Package Structure

```
packages/payments/
├── src/
│   ├── index.ts           # Main exports
│   ├── client.ts          # PaymentClient orchestrator
│   ├── errors.ts          # Custom error classes
│   ├── types/             # Type definitions
│   ├── hooks/             # Lifecycle hooks
│   └── gateways/          # Gateway implementations
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
```

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
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
      type: 'token',
      token: 'tok_xxx'
  },
  metadata: { orderId: 'order_123' },
});

if (result.redirectUrl) {
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
    region: 'ksa',
  },
  stripe: {
    secretKey: 'sk_...',
    publishableKey: 'pk_...',
    webhookSecret: 'whsec_...',
  },
  tabby: {
    secretKey: 'sk_...',
    merchantCode: 'your_merchant_code',
    sandbox: true,
  },
  tamara: {
    apiToken: 'your_api_token',
    notificationToken: 'your_notification_token',
    sandbox: true,
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

## Stripe Webhook Note

For Stripe webhooks, you **MUST** pass the raw request body to `verifyWebhook`. If your framework parses JSON automatically, you need to access the raw body buffer or string before parsing; Buffer payloads are verified using their original bytes.
Stripe webhook verification fails closed when `webhookSecret` is not configured.
Stripe webhook parsing expects snapshot events with `data.object`; hydrate thin events before passing them to `parseWebhookEvent`. Checkout, invoice, and subscription webhooks normalize `gatewayPaymentId` to the related PaymentIntent, SetupIntent, or Subscription when Stripe includes one.

```typescript
// Example using Elysia
app.post('/webhook/stripe', async ({ request }) => {
    const signature = request.headers.get('stripe-signature');
    const rawBody = await Bun.readableStreamToText(request.body); // Get raw body
    
    const isValid = client.gateway('stripe').verifyWebhook(
        rawBody, 
        signature
    );
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
