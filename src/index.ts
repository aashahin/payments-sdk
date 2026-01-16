// file: packages/payments/src/index.ts

/**
 * @abshahin/payments-sdk
 *
 * Framework-agnostic multi-gateway payment SDK with lifecycle hooks.
 * Supports Moyasar, PayPal, and Paymob.
 *
 * @example
 * ```typescript
 * import { PaymentClient } from '@abshahin/payments-sdk';
 *
 * const client = new PaymentClient({
 *   moyasar: {
 *     secretKey: process.env.MOYASAR_SECRET_KEY!,
 *     webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
 *   },
 *   defaultGateway: 'moyasar',
 *   hooks: {
 *     beforeCreatePayment: async (ctx) => {
 *       console.log('Creating payment:', ctx.params.amount);
 *       return { proceed: true };
 *     },
 *     afterCreatePayment: async (ctx, result) => {
 *       await analytics.track('payment_created', { status: result.status });
 *       return { proceed: true };
 *     },
 *     onWebhookVerified: async (event) => {
 *       await orderService.updatePaymentStatus(event.paymentId, event.status);
 *     },
 *   },
 * });
 *
 * // Create a payment
 * const result = await client.createPayment({
 *   amount: 100,
 *   currency: 'SAR',
 *   callbackUrl: 'https://example.com/callback',
 *   tokenId: 'tok_xxx',
 *   metadata: { orderId: 'order_123' },
 * });
 *
 * // Handle webhook
 * const event = await client.handleWebhook('moyasar', webhookPayload);
 * ```
 */

// Main client
export { PaymentClient } from "./client";

// Types
export type {
  GatewayName,
  PaymentStatus,
  RefundStatus,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "./types/payment.types";

// Moyasar-specific source types
export type {
  MoyasarPaymentSource,
  CreditCardSource,
  CardTokenSource,
  ApplePaySource,
  ApplePayDecryptedSource,
  SamsungPaySource,
  StcPaySource,
} from "./types/moyasar-source.types";

export {
  isCreditCardSource,
  isCardTokenSource,
  isApplePaySource,
  isSamsungPaySource,
  isStcPaySource,
} from "./types/moyasar-source.types";

export type {
  WebhookEvent,
  MoyasarWebhookPayload,
  PayPalWebhookPayload,
  PaymobWebhookPayload,
  StripeWebhookPayload,
} from "./types/webhook.types";

export type {
  PaymentClientConfig,
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  StripeConfig,
  TamaraConfig,
  TabbyConfig,
  GatewayConfig,
} from "./types/config.types";

// Hooks
export type {
  PaymentHooks,
  HookContext,
  BeforeHookResult,
  AfterHookResult,
  BeforeHook,
  AfterHook,
  ErrorHook,
  OperationType,
  WebhookReceivedHook,
  WebhookVerifiedHook,
  WebhookFailedHook,
} from "./hooks/hooks.types";

export { HooksManager } from "./hooks/hooks.manager";

// Gateways (for advanced usage / extension)
export type { PaymentGateway } from "./gateways/gateway.interface";
export { BaseGateway } from "./gateways/base.gateway";
export { MoyasarGateway } from "./gateways/moyasar/moyasar.gateway";
export { PayPalGateway } from "./gateways/paypal/paypal.gateway";
export { PaymobGateway } from "./gateways/paymob/paymob.gateway";
export { StripeGateway } from "./gateways/stripe/stripe.gateway";
export { TamaraGateway } from "./gateways/tamara/tamara.gateway";
export { TabbyGateway } from "./gateways/tabby/tabby.gateway";

// Tamara-specific types
export type {
  TamaraCheckoutSessionParams,
  TamaraCheckoutSessionResponse,
  TamaraConsumer,
  TamaraAddress,
  TamaraOrderItem,
  TamaraAmount,
} from "./types/tamara.types";

// Errors
export {
  PaymentError,
  PaymentAbortedError,
  GatewayNotConfiguredError,
  InvalidWebhookError,
  GatewayApiError,
} from "./errors";

// Tabby-specific types
export type {
  TabbyCheckoutSessionParams,
  TabbyCheckoutSessionResponse,
  TabbyBuyer,
  TabbyAddress,
  TabbyOrder,
  TabbyOrderItem,
  TabbyMerchantUrls,
} from "./types/tabby.types";
