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
