# Lifecycle Hooks

Hooks allow you to intercept and modify payment operations.

## Configuration

```typescript
const client = new PaymentClient({
  moyasar: { secretKey: '...' },
  hooks: {
    // Logging
    onBefore: async (ctx) => {
      console.log(`[${ctx.gateway}] Starting ${ctx.operation}`);
      return { proceed: true };
    },

    // Fraud detection
    beforeCreatePayment: async (ctx) => {
      const isFraud = await fraudService.check(ctx.params);
      if (isFraud) {
        return { proceed: false, abortReason: 'Fraud detected' };
      }
      return { proceed: true };
    },

    // Analytics
    afterCreatePayment: async (ctx, result) => {
      await analytics.track('payment_created', {
        gateway: ctx.gateway,
        amount: ctx.params.amount,
        status: result.status,
      });
      return { proceed: true };
    },

    // Error tracking
    onError: async (ctx, error) => {
      await errorTracker.capture(error, { context: ctx });
    },

    // Webhook processing
    onWebhookVerified: async (event) => {
      await orderService.updatePaymentStatus(
        event.paymentId,
        event.status
      );
    },
  },
});
```

## Available Hooks

| Hook | Trigger | Can Abort? |
|------|---------|------------|
| `onBefore` | Before any operation | ✅ |
| `onAfter` | After any successful operation | ✅ |
| `onError` | When any operation throws | ❌ |
| `beforeCreatePayment` | Before creating payment | ✅ |
| `afterCreatePayment` | After payment created | ✅ |
| `beforeCapture` | Before capturing payment | ✅ |
| `afterCapture` | After payment captured | ✅ |
| `beforeRefund` | Before refunding | ✅ |
| `afterRefund` | After refund processed | ✅ |
| `onWebhookReceived` | When webhook payload received | ❌ |
| `onWebhookVerified` | After webhook verified | ❌ |
| `onWebhookFailed` | When webhook verification fails | ❌ |
