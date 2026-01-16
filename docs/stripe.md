# Stripe Gateway

The Stripe gateway integration allows you to process payments, create checkout sessions, and handle webhooks using the Stripe API.

## Configuration

To use the Stripe gateway, add the following configuration to your `PaymentClient` initialization:

```typescript
const client = new PaymentClient({
    stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY!,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!, 
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        apiVersion: '2023-10-16', // Optional: Lock to a specific API version
    },
    // ... other gateways
});
```

## Basic Payments (Payment Intents)

Create a direct payment intent. This is typically used when you have a custom UI element (like Stripe Elements) that gives you a `payment_method_id`.

```typescript
const result = await client.gateway('stripe').createPayment({
    amount: 50.00, // $50.00
    currency: 'USD',
    description: 'Order #1234',
    stripePaymentMethodId: 'pm_card_visa', // Obtained from frontend
    stripeCustomerId: 'cus_123456789',     // Optional: Attach to customer
    capture: true,                         // Default: true (false = auth only)
});
```

## Checkout Sessions

Stripe Checkout is the easiest way to accept payments. It supports multiple modes:

### 1. One-time Payment

```typescript
const session = await client.gateway('stripe').createCheckoutSession({
    mode: 'payment',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    lineItems: [
        {
            priceData: {
                currency: 'USD',
                productData: {
                    name: 'Premium Plan',
                    description: 'Lifetime access',
                    images: ['https://example.com/img.png'],
                },
                unitAmount: 10000, // $100.00
            },
            quantity: 1,
        }
    ]
});

// Redirect user to session.url
```

### 2. Subscriptions

```typescript
const session = await client.gateway('stripe').createCheckoutSession({
    mode: 'subscription',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    lineItems: [
        {
            price: 'price_123456789', // ID of a recurring price in Stripe Dashboard
            quantity: 1,
        }
    ]
});
```

### 3. Setup Mode (Save Card)

Used to save a card for future use without immediate charge.

```typescript
const session = await client.gateway('stripe').createCheckoutSession({
    mode: 'setup',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    customerId: 'cus_123456789', // Required for setup mode
});
```

## Manual Capture

Authorize a payment now and capture it later.

```typescript
// 1. Authorize
const auth = await client.gateway('stripe').createPayment({
    amount: 100,
    currency: 'USD',
    stripePaymentMethodId: 'pm_card_visa',
    capture: false, // <--- key
});

// 2. Capture later
const capture = await client.gateway('stripe').capturePayment({
    gatewayPaymentId: auth.gatewayId, // e.g., pi_123...
    amount: 100, // Optional: Capture partial amount
});
```

## Refund

```typescript
const result = await client.gateway('stripe').refundPayment({
    gatewayPaymentId: 'pi_1234567890',
    amount: 50.00, // Optional: Partial refund
    reason: 'requested_by_customer',
});
```

## Void Payment (Cancel Payment Intent)

You can cancel a PaymentIntent if it has not been captured or canceled yet.

```typescript
const result = await client.voidPayment('stripe', {
  gatewayPaymentId: 'pi_1234567890',
});
```

## Get Payment Details

Retrieve the latest status of a PaymentIntent.

```typescript
const payment = await client.getPayment('stripe', {
  gatewayPaymentId: 'pi_1234567890',
});

console.log(payment.status); // 'paid', 'pending', etc.
```

## Get Payment Status

Quickly check the standardized status of a payment.

```typescript
const status = await client.getPaymentStatus('stripe', 'pi_1234567890');
console.log(status); // 'paid'
```

## Webhooks

The SDK normalizes Stripe webhooks into a standard `WebhookEvent` structure.

> [!CAUTION]
> **Important:** You must pass the **raw request body** (as a string or Buffer) to `verifyWebhook`. If you pass a parsed JSON object, signature verification will fail.

### Webhook Handler Example (Generic)

```typescript
async function handleStripeWebhook(headers: Headers, rawBody: string) {
    const signature = headers.get('stripe-signature');
    const gateway = client.gateway('stripe');

    // 1. Verify
    const isValid = gateway.verifyWebhook(rawBody, signature);
    if (!isValid) throw new Error('Invalid signature');

    // 2. Parse (can pass raw body or parsed JSON here)
    const event = gateway.parseWebhookEvent(rawBody);

    // 3. Handle Status
    switch (event.status) {
        case 'paid':
            console.log(`Payment ${event.paymentId} succeeded!`);
            break;
        case 'refunded':
            console.log(`Payment ${event.paymentId} was refunded.`);
            break;
    }
}
```
