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

    // Optional: API timeout in milliseconds (default: 30000)
    timeoutMs: 30000,
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
| `creditcard` | Not supported by this backend SDK | Use Moyasar.js tokenization instead |

> **Card data safety**: Moyasar prohibits sending cardholder data to the merchant backend. This SDK rejects raw `creditcard` sources before making an API request. Use Moyasar.js tokenization, Apple Pay, Samsung Pay, or STC Pay.

### Token Payment (Moyasar.js)

```typescript
import type { CardTokenSource } from '@abshahin/payments-sdk';

const result = await client.createPayment({
  amount: 100,
  currency: 'SAR',
  orderId: 'order_123',
  callbackUrl: 'https://example.com/callback', // Required for token/card sources
  moyasarSource: {
    type: 'token',
    token: 'token_abc123xyz', // From Moyasar.js
  } satisfies CardTokenSource,
  metadata: { customerId: 'customer_456' },
});

if (result.status === 'failed') {
  // Do not mark the order paid.
} else if (result.redirectUrl) {
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

// STC Pay requires collecting the SMS OTP and posting it to Moyasar.
if (result.nextAction?.type === 'stcpay_otp') {
  showOtpForm(result.nextAction.transactionUrl);
}
```

> **Mobile Number Formats**: `05xxxxxxxx`, `+9665xxxxxxxx`, `009665xxxxxxxx`, or `9665xxxxxxxx`
>
> **Important**: STC Pay's `transactionUrl` is an OTP submission endpoint, not a browser redirect URL. The SDK exposes it only through `nextAction`.

### Confirm STC Pay OTP

```typescript
const moyasar = client.gateway('moyasar');

const confirmed = await moyasar.confirmStcPayOtp({
  transactionUrl: stcTransactionUrl, // result.nextAction.transactionUrl
  otpValue: '123456',
});

if (confirmed.status === 'paid') {
  // Mark the order paid after verifying amount/currency against your order.
}
```

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
| **STC Pay OTP** | STC Pay returns `nextAction.type === 'stcpay_otp'` with the OTP confirmation URL |
| **Token Format** | Tokens must start with `token_` |
| **Amount** | Provide amount in base currency, SDK converts to the currency's smallest unit |
| **Metadata** | Moyasar metadata supports up to 30 string key/value pairs; keys are limited to 40 characters and values to 500 characters |
| **Order Correlation** | `orderId` is copied into `metadata.orderId` and `metadata.paymentId` unless you set those metadata keys yourself |
| **Idempotency** | Use `idempotencyKey` as a UUID; Moyasar uses it as the created payment ID |
| **Payment IDs** | Moyasar payment operation IDs are UUIDs; `getPayment`, `capturePayment`, `refundPayment`, and `voidPayment` reject non-UUID IDs before calling Moyasar |
| **Failed Attempts** | Moyasar can return HTTP 201 with `status: 'failed'`; this SDK returns `success: false` for those payment objects |
| **Manual Capture** | Set `capture: false` or `manualCapture: true` for auth-only (capture later) |
| **Callback URL** | Moyasar requires it for card/token sources; the SDK client type includes it for all payments |
| **STC Pay Confirmation** | Do not browser-redirect to `source.transaction_url`; `redirectUrl` is undefined for STC Pay, so collect the OTP and call `confirmStcPayOtp` |

## Moyasar Status Mapping

| Moyasar Status | SDK Status |
|----------------|------------|
| `initiated` | `pending` |
| `paid` | `paid` |
| `authorized` | `authorized` |
| `verified` | `authorized` |
| `captured` | `paid` |
| `failed` | `failed` |
| `abandoned` | `failed` |
| `refunded` | `refunded` |
| `voided` | `cancelled` |

## Capture Payment

Moyasar payments are typically auto-captured by default. Set `capture: false` on `createPayment` to send Moyasar `source.manual: true`, then capture the authorized payment later.

```typescript
const result = await client.capturePayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
  amount: 100, // Optional: Capture partial amount if supported
  currency: 'SAR', // Required whenever amount is provided
}, 'moyasar');
```

Omit `amount` for a full capture; the SDK sends no request body in that case.

## Refund Payment

Moyasar API does not have a separate refund object; the payment status changes to `refunded`.

```typescript
const result = await client.refundPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
  amount: 50, // Optional: Partial refund
  currency: 'SAR', // Required whenever amount is provided
  reason: 'Customer requested',
}, 'moyasar');
```

Omit `amount` for a full refund; the SDK sends no request body in that case.

## Void Payment

You can void a payment while Moyasar still allows reversal.

```typescript
const result = await client.voidPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
}, 'moyasar');
```

## Get Payment Details

Retrieve the latest status of a payment.

```typescript
const payment = await client.getPayment({
  gatewayPaymentId: '760878ec-d1d3-5f72-9056-191683f55872',
}, 'moyasar');

console.log(payment.status); // 'paid', 'refunded', etc.
```

## Webhook Verification

```typescript
app.post('/webhooks/moyasar', async (req) => {
  const event = await client.handleWebhook('moyasar', req.body);

  console.log(event.status);          // 'paid', 'failed', etc.
  console.log(event.type);            // 'payment_paid', 'payment_failed', etc.
  console.log(event.paymentId);       // metadata.paymentId, or metadata.orderId fallback
  console.log(event.gatewayPaymentId); // Moyasar payment ID

  return { received: true };
});
```

Moyasar currently documents failed payment webhooks as `payment_faild`; the SDK normalizes that typo to `payment_failed` in the returned event while keeping the original payload in `event.rawPayload`.
