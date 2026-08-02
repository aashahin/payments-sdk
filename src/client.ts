// file: packages/payments/src/client.ts

import type { PaymentGateway } from "./gateways/gateway.interface";
import type {
  GatewayName,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  MoyasarCreatePaymentParams,
  PaymobCreatePaymentParams,
  PayPalCreatePaymentParams,
  PaymentStatus,
} from "./types/payment.types";
import type { WebhookEvent } from "./types/webhook.types";
import type { PaymentClientConfig } from "./types/config.types";
import type { StripeCreatePaymentParams } from "./types/validation";
import type { PaymentHooks } from "./hooks/hooks.types";
import { HooksManager } from "./hooks/hooks.manager";
import { MoyasarGateway } from "./gateways/moyasar/moyasar.gateway";
import { PayPalGateway } from "./gateways/paypal/paypal.gateway";
import { PaymobGateway } from "./gateways/paymob/paymob.gateway";
import { StripeGateway } from "./gateways/stripe/stripe.gateway";
import {
  GatewayNotConfiguredError,
  InvalidRequestError,
  InvalidWebhookError,
  OperationNotSupportedError,
} from "./errors";
import { createRedactingLogger, noopLogger, type Logger } from "./utils/logger";

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
 *       // inspect or mutate ctx.params here
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
  private readonly logger: Logger;

  constructor(config: PaymentClientConfig) {
    this.defaultGateway = config.defaultGateway;
    this.logger = config.logger
      ? createRedactingLogger(config.logger)
      : noopLogger;
    // Pass redacting logger so after-hook isolation (proceed:false / throws) is observable
    this.hooksManager = new HooksManager(config.hooks, this.logger);

    // Fail fast on empty required secrets before constructing gateways
    PaymentClient.assertGatewayCredentials(config);

    const logger = config.logger;

    // Initialize configured gateways
    if (config.moyasar) {
      this.gateways.set(
        "moyasar",
        new MoyasarGateway(config.moyasar, this.hooksManager, logger),
      );
    }

    if (config.paypal) {
      this.gateways.set(
        "paypal",
        new PayPalGateway(config.paypal, this.hooksManager, logger),
      );
    }

    if (config.paymob) {
      this.gateways.set(
        "paymob",
        new PaymobGateway(config.paymob, this.hooksManager, logger),
      );
    }

    if (config.stripe) {
      this.gateways.set(
        "stripe",
        new StripeGateway(config.stripe, this.hooksManager, logger),
      );
    }

    // Fail fast when defaultGateway is set but that gateway was never configured
    if (
      this.defaultGateway !== undefined &&
      !this.gateways.has(this.defaultGateway)
    ) {
      throw new InvalidRequestError(
        `defaultGateway '${this.defaultGateway}' is not configured`,
      );
    }
  }

  /**
   * Require non-empty secrets when a gateway config object is present.
   * Webhook secrets are optional and not checked here.
   */
  private static assertGatewayCredentials(config: PaymentClientConfig): void {
    const nonEmpty = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;

    if (config.moyasar !== undefined) {
      if (!nonEmpty(config.moyasar.secretKey)) {
        throw new InvalidRequestError(
          "moyasar.secretKey must be a non-empty string",
        );
      }
    }

    if (config.stripe !== undefined) {
      if (!nonEmpty(config.stripe.secretKey)) {
        throw new InvalidRequestError(
          "stripe.secretKey must be a non-empty string",
        );
      }
    }

    if (config.paypal !== undefined) {
      if (!nonEmpty(config.paypal.clientId)) {
        throw new InvalidRequestError(
          "paypal.clientId must be a non-empty string",
        );
      }
      if (!nonEmpty(config.paypal.clientSecret)) {
        throw new InvalidRequestError(
          "paypal.clientSecret must be a non-empty string",
        );
      }
    }

    if (config.paymob !== undefined) {
      const hasSecretKey = nonEmpty(config.paymob.secretKey);
      const hasApiKey = nonEmpty(config.paymob.apiKey);
      if (!hasSecretKey && !hasApiKey) {
        throw new InvalidRequestError(
          "paymob requires secretKey or apiKey as a non-empty string",
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gateway Access
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a specific gateway instance
   * @throws {GatewayNotConfiguredError} If gateway is not configured
   */
  gateway(name: "stripe"): StripeGateway;
  gateway(name: "moyasar"): MoyasarGateway;
  gateway(name: "paypal"): PayPalGateway;
  gateway(name: "paymob"): PaymobGateway;
  gateway(name: GatewayName): PaymentGateway;
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
   * Create a payment using the specified or default gateway.
   *
   * Single-arg calls use {@link CreatePaymentParams} (callbackUrl required at the
   * type level). Gateway-specific overloads relax fields where the provider allows
   * (e.g. Stripe callbackUrl optional when calling with gateway: "stripe").
   */
  async createPayment(params: StripeCreatePaymentParams, gateway: "stripe"): Promise<GatewayPaymentResult>;
  async createPayment(params: MoyasarCreatePaymentParams, gateway: "moyasar"): Promise<GatewayPaymentResult>;
  async createPayment(params: PayPalCreatePaymentParams, gateway: "paypal"): Promise<GatewayPaymentResult>;
  async createPayment(params: PaymobCreatePaymentParams, gateway: "paymob"): Promise<GatewayPaymentResult>;
  async createPayment(params: CreatePaymentParams, gateway?: GatewayName): Promise<GatewayPaymentResult>;
  async createPayment(
    params:
      | CreatePaymentParams
      | StripeCreatePaymentParams
      | MoyasarCreatePaymentParams
      | PayPalCreatePaymentParams
      | PaymobCreatePaymentParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    return gw.createPayment(params as CreatePaymentParams);
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
   * Void/cancel an authorized payment before capture
   * @throws {OperationNotSupportedError} If the gateway does not implement voidPayment
   */
  async voidPayment(
    params: VoidParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    if (!gw.voidPayment) {
      throw new OperationNotSupportedError(gw.name, "voidPayment");
    }
    return gw.voidPayment(params);
  }

  /**
   * Retrieve payment details from a gateway
   * @throws {OperationNotSupportedError} If the gateway does not implement getPayment
   */
  async getPayment(
    params: GetPaymentParams,
    gateway?: GatewayName,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    if (!gw.getPayment) {
      throw new OperationNotSupportedError(gw.name, "getPayment");
    }
    return gw.getPayment(params);
  }

  /**
   * Get current status of a payment from a gateway
   * @throws {OperationNotSupportedError} If the gateway does not implement getPaymentStatus
   */
  async getPaymentStatus(
    gatewayId: string,
    gateway?: GatewayName,
  ): Promise<PaymentStatus> {
    const gw = this.resolveGateway(gateway);
    if (!gw.getPaymentStatus) {
      throw new OperationNotSupportedError(gw.name, "getPaymentStatus");
    }
    return gw.getPaymentStatus(gatewayId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming webhook from a payment gateway
   *
   * Stages:
   * 1. `onWebhookReceived` (untrusted payload; failures logged, never block)
   * 2. Signature / authenticity verification — failures call `onWebhookFailed`
   * 3. Parse / normalize — failures throw without calling `onWebhookFailed`
   * 4. `onWebhookVerified` (trusted event; failures rethrown for provider retry)
   *
   * @param gateway - Which gateway sent the webhook
   * @param payload - Raw webhook payload
   * @param signatureOrHeaders - Optional signature, or headers for gateways like PayPal
   * @param headers - Optional headers when signature is passed separately
   * @returns Normalized WebhookEvent
   * @throws {InvalidWebhookError} If verification fails, or parse fails with an untyped error
   * @throws {InvalidRequestError} If a gateway parse path rejects the payload shape
   */
  async handleWebhook(
    gateway: GatewayName,
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<WebhookEvent> {
    const gw = this.gateway(gateway);

    // Notify hooks that a webhook was received.
    // ⚠️ This fires on the UNVERIFIED payload (verification happens below), so
    // onWebhookReceived must stay side-effect-free (logging/metrics only).
    // State-changing logic belongs in onWebhookVerified, which only runs after
    // verification succeeds. Failures here are logged and never block verify.
    try {
      await this.hooksManager.runWebhookReceived(gateway, payload);
    } catch (hookError) {
      this.logger.error("onWebhookReceived hook failed", {
        gateway,
        hookError:
          hookError instanceof Error ? hookError.message : String(hookError),
      });
    }

    // ── Stage: verify (onWebhookFailed only for verification failures) ──────
    try {
      const signature =
        typeof signatureOrHeaders === "string" ? signatureOrHeaders : undefined;
      const verificationHeaders =
        typeof signatureOrHeaders === "string" ? headers : signatureOrHeaders;
      const isVerified = gw.verifyWebhookAsync
        ? await gw.verifyWebhookAsync(payload, signatureOrHeaders, headers)
        : gw.verifyWebhook(payload, signature, verificationHeaders);

      if (!isVerified) {
        throw new InvalidWebhookError("Webhook verification failed");
      }
    } catch (error) {
      const primaryError =
        error instanceof Error ? error : new Error(String(error));

      // Secondary hook failures must not replace the primary verification error
      try {
        await this.hooksManager.runWebhookFailed(payload, primaryError);
      } catch (hookError) {
        this.logger.error("onWebhookFailed hook failed", {
          gateway,
          hookError:
            hookError instanceof Error ? hookError.message : String(hookError),
          originalError: primaryError.message,
        });
      }

      throw primaryError;
    }

    // ── Stage: parse (separate from verify; do not call onWebhookFailed) ────
    let event: WebhookEvent;
    try {
      event = gw.parseWebhookEvent(payload);
    } catch (error) {
      if (
        error instanceof InvalidWebhookError ||
        error instanceof InvalidRequestError
      ) {
        throw error;
      }
      throw new InvalidWebhookError(
        `Webhook parse failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Verified path: onWebhookVerified failures are rethrown so the HTTP
    // handler can return 5xx and the provider will retry. Log first so the
    // failure is visible even if the caller swallows the error. (Unlike
    // onWebhookFailed, we do not swallow — fulfillment must not silently skip.)
    try {
      await this.hooksManager.runWebhookVerified(event);
    } catch (hookError) {
      this.logger.error("onWebhookVerified hook failed", {
        gateway,
        hookError:
          hookError instanceof Error ? hookError.message : String(hookError),
      });
      throw hookError;
    }

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
   * @throws {InvalidRequestError} If neither an explicit nor a default gateway is available
   * @throws {GatewayNotConfiguredError} If the resolved gateway is not configured
   */
  private resolveGateway(gateway?: GatewayName): PaymentGateway {
    const name = gateway ?? this.defaultGateway;

    if (!name) {
      throw new InvalidRequestError(
        "No gateway specified and no default gateway configured",
      );
    }

    return this.gateway(name);
  }
}
