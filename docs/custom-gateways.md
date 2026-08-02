# Extending with Custom Gateways

You can implement the `PaymentGateway` interface or extend `BaseGateway` to
build gateway-shaped adapters. Treat this as an advanced / experimental path:
**the public client does not yet plug custom gateways in.**

## Honest limitations (current SDK)

1. **`GatewayName` is a closed union**  
   `"moyasar" | "paypal" | "paymob" | "stripe"`. There is no open string brand
   for third-party names. A custom class must either reuse one of those names
   (usually a bad idea) or cast/`as GatewayName` and live outside the type
   model.

2. **`PaymentClient` does not register custom gateways**  
   The constructor only constructs Moyasar / PayPal / Paymob / Stripe from
   config. There is **no** `registerGateway()`, no config slot for arbitrary
   adapters, and `client.gateway(name)` / `createPayment(..., name)` only
   resolve the built-in map.

3. **Until `registerGateway` (or similar) exists**, using a custom
   implementation in production means one of:
   - **Fork** the package and add your gateway next to the built-ins.
   - **Wrap** `PaymentClient` / call your gateway class directly (you lose
     unified `handleWebhook` routing and default-gateway convenience unless
     you reimplement them).
   - **Contribute** upstream when a registration API lands.

Hooks (`HooksManager`) and `BaseGateway.executeWithHooks` are still useful if
you construct the gateway yourself and pass a shared manager — but that is
manual wiring, not first-class multi-gateway support.

## Example adapter shape

Name your class something like `ExampleGateway` — do **not** copy a real
provider name unless you are actually implementing that provider.

```typescript
import {
  BaseGateway,
  HooksManager,
  type PaymentGateway,
  type GatewayName,
  type GatewayConfig,
  type CreatePaymentParams,
  type CaptureParams,
  type RefundParams,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type WebhookEvent,
} from '@abshahin/payments-sdk';

// GatewayName is closed; casting is required for a non-built-in name and is
// only safe if you never hand this instance to PaymentClient as-is.
class ExampleGateway extends BaseGateway implements PaymentGateway {
  readonly name = 'example' as unknown as GatewayName;

  constructor(config: GatewayConfig, hooks: HooksManager) {
    super(config, hooks);
  }

  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks('createPayment', params, async (_p) => {
      // Call your provider API; return a normalized GatewayPaymentResult
      throw new Error('Not implemented');
    });
  }

  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks('capturePayment', params, async (_p) => {
      throw new Error('Not implemented');
    });
  }

  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks('refundPayment', params, async (_p) => {
      throw new Error('Not implemented');
    });
  }

  verifyWebhook(
    _payload: unknown,
    _signature?: string,
    _headers?: Record<string, string>,
  ): boolean {
    // Validate signature / secret for your provider
    return false;
  }

  parseWebhookEvent(_payload: unknown): WebhookEvent {
    // Map provider payload → WebhookEvent
    throw new Error('Not implemented');
  }
}

// Direct use (not via PaymentClient) — there is no client.registerGateway yet:
const hooks = new HooksManager({
  afterCreatePayment: async (_ctx, result) => {
    console.log(result.status);
    return { proceed: true };
  },
});

const example = new ExampleGateway({ timeoutMs: 30000 }, hooks);
// await example.createPayment({ ... });
```

`executeWithHooks` is `protected` on `BaseGateway` — subclasses may call it;
callers outside the class should use the public gateway methods.

## Prefer built-ins when possible

For Moyasar, PayPal, Paymob, and Stripe, use `PaymentClient` config and the
existing gateway docs. Custom adapters are for providers the SDK does not ship
yet, with the registration gap above firmly in mind.
