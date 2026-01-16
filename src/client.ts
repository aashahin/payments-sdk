// file: packages/payments/src/client.ts

import type { PaymentGateway } from "./gateways/gateway.interface";
import type {
  GatewayName,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "./types/payment.types";
import type { WebhookEvent } from "./types/webhook.types";
import type { PaymentClientConfig } from "./types/config.types";
import type { PaymentHooks } from "./hooks/hooks.types";
import { HooksManager } from "./hooks/hooks.manager";
import { MoyasarGateway } from "./gateways/moyasar/moyasar.gateway";
import { PayPalGateway } from "./gateways/paypal/paypal.gateway";
import { PaymobGateway } from "./gateways/paymob/paymob.gateway";
import { StripeGateway } from "./gateways/stripe/stripe.gateway";
import { TabbyGateway } from "./gateways/tabby/tabby.gateway";
import { TamaraGateway } from "./gateways/tamara/tamara.gateway";
import { GatewayNotConfiguredError, InvalidWebhookError } from "./errors";

/**
 * Main payment client that orchestrates gateway operations with lifecycle hooks
 *
 * @example
 * ```typescript
 * const client = new PaymentClient({
 *   moyasar: { secretKey: 'sk_...' },
 *   defaultGateway: 'moyasar',
 *   hooks: {
 *     beforeCreatePayment: async (ctx) => {
 *       console.log('Creating payment:', ctx.params);
 *       return { proceed: true };
 *     },
 *   },
 * });
 *
 * const result = await client.createPayment({
 *   amount: 100,
 *   currency: 'SAR',
 *   callbackUrl: 'https://example.com/callback',
 *   tokenId: 'tok_xxx',
 * });
 * ```
 */
export class PaymentClient {
  private readonly gateways = new Map<GatewayName, PaymentGateway>();
  private readonly hooksManager: HooksManager;
  private readonly defaultGateway: GatewayName | undefined;

  constructor(config: PaymentClientConfig) {
    this.hooksManager = new HooksManager(config.hooks);
    this.defaultGateway = config.defaultGateway;

    // Initialize configured gateways
    if (config.moyasar) {
      this.gateways.set(
        "moyasar",
        new MoyasarGateway(config.moyasar, this.hooksManager),
      );
    }

    if (config.paypal) {
      this.gateways.set(
        "paypal",
        new PayPalGateway(config.paypal, this.hooksManager),
      );
    }

    if (config.paymob) {
      this.gateways.set(
        "paymob",
        new PaymobGateway(config.paymob, this.hooksManager),
      );
    }

    if (config.stripe) {
      this.gateways.set(
        "stripe",
        new StripeGateway(config.stripe, this.hooksManager),
      );
    }

    if (config.tabby) {
      this.gateways.set(
        "tabby",
        new TabbyGateway(config.tabby, this.hooksManager),
      );
    }

    if (config.tamara) {
      this.gateways.set(
        "tamara",
        new TamaraGateway(config.tamara, this.hooksManager),
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gateway Access
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a specific gateway instance
   * @throws {GatewayNotConfiguredError} If gateway is not configured
   */
  gateway(name: GatewayName): PaymentGateway {
    const gw = this.gateways.get(name);
    if (!gw) {
      throw new GatewayNotConfiguredError(name);
    }
    return gw;
  }

  /**
   * Get list of configured gateway names
   */
  configuredGateways(): GatewayName[] {
    return Array.from(this.gateways.keys());
  }

  /**
   * Check if a gateway is configured
   */
  hasGateway(name: GatewayName): boolean {
    return this.gateways.has(name);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Operations (Convenience Methods)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment using the specified or default gateway
   */
  async createPayment(
    params: CreatePaymentParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    return gw.createPayment(params);
  }

  /**
   * Capture an authorized payment
   */
  async capturePayment(
    params: CaptureParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    return gw.capturePayment(params);
  }

  /**
   * Refund a payment (full or partial)
   */
  async refundPayment(
    params: RefundParams,
    gateway?: GatewayName,
  ): Promise<GatewayRefundResult> {
    const gw = this.resolveGateway(gateway);
    return gw.refundPayment(params);
  }

  /**
   * Retrieve payment details from a gateway
   * @throws {GatewayNotConfiguredError} If gateway doesn't support getPayment
   */
  async getPayment(
    params: GetPaymentParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    if (!gw.getPayment) {
      throw new GatewayNotConfiguredError(
        `${gw.name} does not support getPayment`
      );
    }
    return gw.getPayment(params);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming webhook from a payment gateway
   *
   * @param gateway - Which gateway sent the webhook
   * @param payload - Raw webhook payload
   * @param signature - Optional signature for verification
   * @returns Normalized WebhookEvent
   * @throws {InvalidWebhookError} If verification fails
   */
  async handleWebhook(
    gateway: GatewayName,
    payload: unknown,
    signature?: string,
  ): Promise<WebhookEvent> {
    const gw = this.gateway(gateway);

    // Notify hooks that webhook was received
    await this.hooksManager.runWebhookReceived(gateway, payload);

    // Verify webhook authenticity
    if (!gw.verifyWebhook(payload, signature)) {
      const error = new InvalidWebhookError("Webhook verification failed");
      await this.hooksManager.runWebhookFailed(payload, error);
      throw error;
    }

    // Parse and normalize the webhook event
    const event = gw.parseWebhookEvent(payload);

    // Notify hooks that webhook was verified
    await this.hooksManager.runWebhookVerified(event);

    return event;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Runtime Hook Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a hook at runtime
   */
  addHook<K extends keyof PaymentHooks>(
    name: K,
    handler: PaymentHooks[K],
  ): void {
    this.hooksManager.register(name, handler);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve which gateway to use
   */
  private resolveGateway(gateway?: GatewayName): PaymentGateway {
    const name = gateway ?? this.defaultGateway;

    if (!name) {
      throw new Error("No gateway specified and no default gateway configured");
    }

    return this.gateway(name);
  }
}
