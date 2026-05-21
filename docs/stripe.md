# Stripe Gateway

The Stripe gateway supports PaymentIntents, hosted Checkout Sessions, manual capture, refunds, void/cancel, payment lookup, and signed webhooks.

## Configuration

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY!,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
        // Optional. Defaults to the SDK's pinned Stripe API version.
        apiVersion: '2026-02-25.clover',
        // Optional. Defaults to 30000.
        timeoutMs: 30000,
    },
    defaultGateway: 'stripe',
});
```

Stripe webhook verification fails closed when `webhookSecret` is missing.

## PaymentIntents

Use PaymentIntents when you have a custom Stripe Elements flow. The SDK returns `clientSecret` so the frontend can complete confirmation or required customer actions.

```typescript
const stripe = client.gateway('stripe');

const result = await stripe.createPayment({
    amount: 50,
    currency: 'USD',
    callbackUrl: 'https://example.com/stripe/return',
    description: 'Order #1234',
    orderId: 'order_1234',
    metadata: { paymentId: 'order_1234' },
    stripePaymentMethodId: 'pm_card_visa',
    stripeCustomerId: 'cus_123456789',
    capture: true,
});

console.log(result.gatewayId, result.status, result.clientSecret);
```

Amounts are passed to SDK methods in base currency units. The Stripe gateway converts them to Stripe minor units using Stripe currency rules, including zero-decimal currencies such as JPY and special whole-unit currencies such as ISK and UGX.
For charge creation, the gateway validates currency precision and Stripe's published maximum amount limits before sending the request. Minimum charge amounts can depend on settlement currency and conversion context, so Stripe remains the source of truth for minimum enforcement at request time.

For unconfirmed Stripe Elements flows, `callbackUrl` can be omitted. When `stripePaymentMethodId` is provided, the SDK confirms the PaymentIntent immediately and sends `callbackUrl` as Stripe's `return_url` when present.
If `stripePaymentMethodId` is provided without `callbackUrl`, the SDK sets `automatic_payment_methods.allow_redirects` to `never` so Stripe does not require a `return_url` for redirect-based payment methods during server-side confirmation.

Stripe metadata values must be scalar strings, numbers, or booleans. Nested metadata objects and arrays are rejected before the API request is sent. Stripe metadata limits are enforced before the API request: at most 50 keys, key names up to 40 characters without square brackets, and values up to 500 characters after string conversion.

## Checkout Sessions

### One-Time Payment

```typescript
const stripe = client.gateway('stripe');

const session = await stripe.createCheckoutSession({
    mode: 'payment',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    metadata: { paymentId: 'order_1234' },
    lineItems: [
        {
            priceData: {
                currency: 'USD',
                productData: {
                    name: 'Premium Plan',
                    description: 'Lifetime access',
                    images: ['https://example.com/img.png'],
                },
                amount: 100,
            },
            quantity: 1,
        },
    ],
});

// Redirect the customer to session.url
```

For a simple one-item payment, you can provide `amount` and `currency` instead of `lineItems`.

```typescript
const session = await stripe.createCheckoutSession({
    amount: 100,
    currency: 'USD',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
});
```

If you already store Stripe minor-unit amounts, `priceData.unitAmount` is also supported and is sent directly to Stripe as `unit_amount`.
Checkout line-item `priceData.amount` and `priceData.unitAmount` can be zero when Stripe accepts a zero-priced item, such as free trials or fully discounted subscription setup.

### Subscriptions

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    lineItems: [
        {
            price: 'price_123456789',
            quantity: 1,
        },
    ],
});
```

Inline `priceData` in subscription mode must include Stripe recurring price settings.

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    lineItems: [
        {
            priceData: {
                currency: 'USD',
                productData: { name: 'Pro Plan' },
                amount: 20,
                recurring: { interval: 'month' },
            },
            quantity: 1,
        },
    ],
});
```

### Setup Mode

Use setup mode to save a payment method without an immediate charge.

```typescript
const session = await stripe.createCheckoutSession({
    mode: 'setup',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    currency: 'USD',
    customerId: 'cus_123456789',
});
```

`cancelUrl` is optional because Stripe's `cancel_url` parameter is optional. Provide it when you want Stripe-hosted cancellation to return customers to a specific page.
Setup mode requires either `currency` or `paymentMethodTypes`, and does not accept `lineItems` or `amount`. Payment and subscription Checkout Sessions must use either `lineItems` or the simple `amount`/`currency` form, not both.
The SDK validates Stripe's Checkout line item caps: payment mode accepts up to 100 line items, and subscription mode accepts up to 40 total line items with at most 20 known recurring inline price items. Existing `price_...` IDs are accepted but their recurring/one-time type is ultimately validated by Stripe.
Unsupported Checkout fields are rejected instead of silently ignored. Add SDK support before relying on additional Stripe Checkout Session create parameters.

## Manual Capture

```typescript
const auth = await stripe.createPayment({
    amount: 100,
    currency: 'USD',
    callbackUrl: 'https://example.com/stripe/return',
    stripePaymentMethodId: 'pm_card_visa',
    capture: false,
    idempotencyKey: crypto.randomUUID(),
});

const capture = await stripe.capturePayment({
    gatewayPaymentId: auth.gatewayId,
    amount: 100,
    currency: 'USD',
    idempotencyKey: crypto.randomUUID(),
});
```

When passing a partial capture `amount`, `currency` is required so the gateway can apply Stripe's minor-unit rules correctly. Omit `amount` to capture the full authorized amount.

## Refunds

```typescript
const refund = await stripe.refundPayment({
    gatewayPaymentId: 'pi_1234567890',
    amount: 50,
    currency: 'USD',
    reason: 'requested_by_customer',
    idempotencyKey: crypto.randomUUID(),
});
```

Stripe-supported reasons (`duplicate`, `fraudulent`, `requested_by_customer`) are sent to Stripe as `reason`. Other custom reason strings are attached as `metadata.reason`.

When passing a partial refund `amount`, `currency` is required. Omit `amount` for a full refund. After creating the refund, the gateway asks Stripe for refunds on the PaymentIntent so `totalRefunded` reflects cumulative succeeded refunds. Pending or action-required refunds are not counted until Stripe marks them succeeded. If that follow-up lookup fails after Stripe has already accepted the refund, `totalRefunded` is left undefined rather than reporting the single refund amount as a false cumulative total.

## Void And Lookup

```typescript
const cancelled = await client.voidPayment({
    gatewayPaymentId: 'pi_1234567890',
    idempotencyKey: crypto.randomUUID(),
}, 'stripe');

const payment = await client.getPayment({
    gatewayPaymentId: 'pi_1234567890',
}, 'stripe');

const status = await client.getPaymentStatus('pi_1234567890', 'stripe');
```

## Webhooks

Pass the exact raw request body string or `Buffer` to `verifyWebhook`. Do not pass a parsed JSON object; Stripe signs the original byte stream and verification will fail if the body is changed. Buffer payloads are verified from their original bytes.
`parseWebhookEvent` expects Stripe snapshot event payloads that include `data.object`. If you configure Stripe thin events, retrieve or hydrate the related Stripe object first, then pass a snapshot-shaped payload to the parser.
Keep the Stripe webhook endpoint API version aligned with this gateway's configured `apiVersion` when possible; Stripe webhook endpoints can use a different API version than direct REST requests.

```typescript
async function handleStripeWebhook(headers: Headers, rawBody: string) {
    const signature = headers.get('stripe-signature') ?? undefined;
    const stripe = client.gateway('stripe');

    if (!stripe.verifyWebhook(rawBody, signature)) {
        throw new Error('Invalid Stripe webhook signature');
    }

    const event = stripe.parseWebhookEvent(rawBody);

    switch (event.status) {
        case 'paid':
            console.log(`Payment ${event.paymentId ?? event.gatewayPaymentId} succeeded`);
            break;
        case 'refunded':
        case 'partially_refunded':
        case 'refund_completed':
            console.log(`Payment ${event.gatewayPaymentId} was refunded`);
            break;
        case 'setup_completed':
            console.log(`Setup Session ${event.gatewayPaymentId} completed`);
            break;
    }
}
```

For Checkout, Charge, Refund, Invoice, and Subscription webhook events, `gatewayPaymentId` is normalized to the most useful related Stripe object ID when Stripe includes it: PaymentIntent, SetupIntent, Subscription, then the emitting object as a fallback. `gatewayObjectId` preserves the original object ID, such as `cs_...`, `ch_...`, `re_...`, or `in_...`.

Subscription-related webhooks are normalized for common billing flows. `checkout.session.completed` in subscription mode prefers the `sub_...` ID, invoice payment success/failure events map to `paid` or `failed`, and subscription deletion maps to `cancelled`. Invoice metadata can also use `parent.subscription_details.metadata.paymentId` when the invoice itself does not carry `metadata.paymentId`.

Refund webhooks handle both modern `refund.created` / `refund.updated` / `refund.failed` events and legacy `charge.refund.updated`. `charge.refunded` can represent either a full or partial refund, so the gateway checks Stripe's refunded amount when it is present. Refund object events do not always include the original charge total; when Stripe includes expanded charge totals, the gateway can distinguish `refunded` from `partially_refunded`, otherwise successful refund object events are normalized as `refund_completed` to avoid guessing the aggregate payment refund state.

Setup-mode `checkout.session.completed` events with `payment_status: 'no_payment_required'` are normalized as `setup_completed`.
