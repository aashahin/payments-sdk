# Paymob Gateway (KSA)

Paymob uses the Unified Intention API for KSA region with HMAC signature authentication.

## Configuration

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
  paymob: {
    // Required: KSA API credentials
    secretKey: process.env.PAYMOB_SECRET_KEY!,
    publicKey: process.env.PAYMOB_PUBLIC_KEY!,

    // Optional: Webhook HMAC verification
    hmacSecret: process.env.PAYMOB_HMAC_SECRET,

    // Optional: Region (default: 'ksa')
    region: 'ksa', // 'ksa' | 'eg' | 'pk' | 'om' | 'ae'

    // Optional: Integration ID for specific payment methods
    integrationId: '123456',

    // Optional: Custom base URL override
    baseUrl: 'https://ksa.paymob.com',
  },
  defaultGateway: 'paymob',
});
```

## Create Payment

```typescript
const result = await client.createPayment('paymob', {
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/webhook',
  returnUrl: 'https://example.com/success',
  orderId: 'order_123',
  metadata: {
    email: 'customer@example.com',
    firstName: 'Mohammed',
    lastName: 'Ali',
    phone: '+966500000000',
  },
});

// Redirect customer to payment page
if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

## Capture Payment

Use this to capture an authorized payment.

```typescript
const result = await client.capturePayment('paymob', {
  gatewayPaymentId: '123456789', // Paymob transaction ID
  amount: 100, // Optional: Capture specific amount
});
```

## Void Payment

Use this to void a transaction on the **same day** it was created.

```typescript
const result = await client.voidPayment('paymob', {
  gatewayPaymentId: '123456789', // Paymob transaction ID
});
```

## Refund Payment

Use this to refund a captured transaction.

```typescript
const result = await client.refundPayment('paymob', {
  gatewayPaymentId: '123456789', // Paymob transaction ID
  amount: 50, // Optional: Partial refund
  reason: 'Customer returned item',
});
```

## Get Payment Details

Retrieve the latest status of a payment.

```typescript
const payment = await client.getPayment('paymob', {
  gatewayPaymentId: '123456789',
});

console.log(payment.status); // 'paid', 'pending', etc.
```

## Webhook Verification

```typescript
app.post('/webhooks/paymob', async (req) => {
  // HMAC signature from query params or 'hmac' field in body
  const hmac = req.query.hmac ?? req.body.hmac;

  const event = await client.handleWebhook('paymob', req.body, hmac);

  console.log(event.status);    // 'paid', 'failed', 'pending'
  console.log(event.paymentId); // merchant_order_id
  console.log(event.amount);    // Amount in SAR (not halalas)

  return { received: true };
});
```

## Supported Regions

| Region | Base URL |
|--------|----------|
| `ksa` (default) | `https://ksa.paymob.com` |
| `eg` | `https://accept.paymob.com` |
| `pk` | `https://pakistan.paymob.com` |
| `om` | `https://oman.paymob.com` |
| `ae` | `https://ae.paymob.com` |
