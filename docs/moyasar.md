# Moyasar Gateway

Moyasar is a Saudi payment gateway supporting credit cards, Apple Pay, Samsung Pay, and STC Pay.

## Configuration

```typescript
import { PaymentClient } from '@abshahin/payments-sdk';

const client = new PaymentClient({
  moyasar: {
    // Required: API secret key
    secretKey: process.env.MOYASAR_SECRET_KEY!,

    // Optional: Webhook verification
    webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
  },
  defaultGateway: 'moyasar',
});
```

## Payment Sources

Moyasar supports multiple payment source types via the `moyasarSource` field:

| Source Type | Use Case | Key Fields |
|-------------|----------|------------|
| `token` | Moyasar.js tokenized card | `token`, `cvc?`, `_3ds?`, `manualCapture?` |
| `stcpay` | STC Pay mobile wallet | `mobile`, `cashier?`, `branch?` |
| `applepay` | Apple Pay | `token`, `saveCard?`, `manualCapture?` |
| `samsungpay` | Samsung Pay | `token`, `saveCard?`, `manualCapture?` |
| `creditcard` | Raw card (PCI-DSS required) | `name`, `number`, `month`, `year`, `cvc` |

### Token Payment (Moyasar.js)

```typescript
import type { CardTokenSource } from '@abshahin/payments-sdk';

const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'token',
    token: 'token_abc123xyz', // From Moyasar.js
  } satisfies CardTokenSource,
  metadata: { orderId: 'order_123' },
});

// Redirect for 3DS if needed
if (result.redirectUrl) {
  redirect(result.redirectUrl);
}
```

### STC Pay Payment

STC Pay uses a mobile OTP verification flow.

```typescript
import type { StcPaySource } from '@abshahin/payments-sdk';

const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'stcpay',
    mobile: '0512345678', // Saudi mobile number
    cashier: 'POS-001',   // Optional: shown in dashboard
    branch: 'Riyadh',     // Optional: shown in dashboard
  } satisfies StcPaySource,
});

// Redirect to STC Pay OTP page
if (result.redirectUrl) {
  redirect(result.redirectUrl); // otp_url from Moyasar
}
```

> **Mobile Number Formats**: `05xxxxxxxx`, `+9665xxxxxxxx`, or `009665xxxxxxxx`

### Apple Pay / Samsung Pay

```typescript
import type { ApplePaySource, SamsungPaySource } from '@abshahin/payments-sdk';

// Apple Pay
const appleResult = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'applepay',
    token: 'encrypted_token_from_apple_pay_js',
    saveCard: true, // Optional: save for future use
  } satisfies ApplePaySource,
});

// Samsung Pay
const samsungResult = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  moyasarSource: {
    type: 'samsungpay',
    token: 'encrypted_token_from_samsung_pay',
  } satisfies SamsungPaySource,
});
```

### Legacy Token Compatibility

The `tokenId` field is still supported for backwards compatibility:

```typescript
// Legacy approach (still works)
const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  callbackUrl: 'https://example.com/callback',
  tokenId: 'token_abc123xyz', // Converted to moyasarSource internally
});
```

## Important Notes

| Topic | Note |
|-------|------|
| **3DS Flow** | Card payments may return `redirectUrl` for 3DS verification |
| **STC Pay OTP** | STC Pay returns `redirectUrl` (otp_url) for OTP verification |
| **Token Format** | Tokens must start with `token_` |
| **Amount** | Provide amount in base currency (SAR), SDK converts to halalas |
| **Idempotency** | Use `idempotencyKey` (UUID) to prevent duplicate charges |
| **Manual Capture** | Set `manualCapture: true` for auth-only (capture later) |

## Moyasar Status Mapping

| Moyasar Status | SDK Status |
|----------------|------------|
| `initiated` | `pending` |
| `paid` | `paid` |
| `authorized` | `authorized` |
| `verified` | `authorized` |
| `captured` | `paid` |
| `failed` | `failed` |
| `refunded` | `refunded` |
| `voided` | `cancelled` |

## Capture Payment

Moyasar payments are typically auto-captured by default (create payment with `capture: true`). However, if you perform an authorization-only transaction (`capture: false`), you can capture it later.

```typescript
const result = await client.capturePayment('moyasar', {
  gatewayPaymentId: 'pay_123456',
  amount: 100, // Optional: Capture partial amount if supported
});
```

## Refund Payment

Moyasar API does not have a separate refund object; the payment status changes to `refunded`.

```typescript
const result = await client.refundPayment('moyasar', {
  gatewayPaymentId: 'pay_123456',
  amount: 50, // Optional: Partial refund
  reason: 'Customer requested',
});
```

## Void Payment

You can void an authorized payment before it is captured.

```typescript
const result = await client.voidPayment('moyasar', {
  gatewayPaymentId: 'pay_123456',
});
```

## Get Payment Details

Retrieve the latest status of a payment.

```typescript
const payment = await client.getPayment('moyasar', {
  gatewayPaymentId: 'pay_123456',
});

console.log(payment.status); // 'paid', 'refunded', etc.
```

## Webhook Verification

```typescript
app.post('/webhooks/moyasar', async (req) => {
  const event = await client.handleWebhook('moyasar', req.body);

  console.log(event.status);          // 'paid', 'failed', etc.
  console.log(event.paymentId);       // Your metadata.paymentId
  console.log(event.gatewayPaymentId); // Moyasar payment ID

  return { received: true };
});
```
