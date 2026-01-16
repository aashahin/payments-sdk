# Extending with Custom Gateways

You can extend the SDK by implementing the `PaymentGateway` interface or extending `BaseGateway`.

```typescript
import { BaseGateway, PaymentGateway } from '@abshahin/payments-sdk';

class StripeGateway extends BaseGateway implements PaymentGateway {
  readonly name = 'stripe' as const;
  
  async createPayment(params) {
    return this.executeWithHooks('createPayment', params, async (p) => {
      // Your Stripe implementation
    });
  }
  
  // ... other methods
}
```
