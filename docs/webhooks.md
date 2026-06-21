# Webhook Handling

```typescript
// In your Elysia/Express/Hono route handler
app.post('/webhooks/:gateway', async (req) => {
  const event = await client.handleWebhook(
    req.params.gateway,
    req.body,
    req.headers['x-signature']
  );
  
  // Event is normalized across all gateways
  console.log(event.status);      // 'paid', 'failed', etc.
  console.log(event.paymentId);   // Your internal payment ID
  console.log(event.amount);      // Amount in base currency
  
  return { received: true };
});
```

For gateway-specific verification details, please refer to the respective gateway documentation:

- [Moyasar Webhooks](./moyasar.md#webhook-verification)
- [PayPal Webhooks](./paypal.md#webhook-verification)
- [Paymob Webhooks](./paymob.md#webhook-verification)

## Raw body required (Stripe & HMAC gateways)

Signature verification is computed over the **raw request body bytes**. Pass the
unparsed body (string or `Buffer`) to `handleWebhook` — not a parsed/
re-serialized JSON object. For Stripe specifically, `verifyWebhook` returns
`false` (and logs a warning via the configured logger) if it receives a parsed
object, because a re-serialized body will never match the signature. In
frameworks that auto-parse JSON, register a raw-body parser for the webhook route
(e.g. `express.raw({ type: 'application/json' })`).

## Hook ordering and verification

`handleWebhook` runs hooks in this order:

1. `onWebhookReceived(gateway, payload)` — fires **before** verification.
2. signature verification (`onWebhookFailed` runs and an `InvalidWebhookError`
   is thrown if it fails).
3. `onWebhookVerified(event)` — fires **after** verification succeeds.

> ⚠️ The payload given to `onWebhookReceived` is **unverified and untrusted** —
> anyone who can reach your endpoint can trigger it with arbitrary data. Use it
> only for side-effect-free work (logging, metrics). Put all trusted,
> state-changing logic (fulfilling orders, updating payment status) in
> `onWebhookVerified`.
