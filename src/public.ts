export { PaymentClient } from "./client";

export type {
  GatewayName,
  PaymentStatus,
  RefundStatus,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  MoyasarBackendPaymentSource,
  MoyasarPaymentSplit,
  MoyasarAftRecipient,
  MoyasarAftSender,
  MoyasarCreatePaymentParams,
  MoyasarConfirmStcPayOtpParams,
  PaymobCreatePaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "./types/payment.types";

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
  PaymobCardTokenWebhookPayload,
  PaymobRedirectWebhookPayload,
  StripeWebhookPayload,
} from "./types/webhook.types";

export type {
  PaymentClientConfig,
  MoyasarConfig,
  PayPalConfig,
  PaymobConfig,
  PaymobIdempotencyRecord,
  PaymobIdempotencyStore,
  StripeConfig,
  GatewayConfig,
} from "./types/config.types";

export type {
  StripeCreatePaymentParams,
  CreateCheckoutSessionParams,
} from "./types/validation";

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

export type { Logger, LogLevel } from "./utils/logger";
export { noopLogger, redact, createRedactingLogger } from "./utils/logger";
export type {
  IdempotencyStore,
  IdempotencyRecord,
  IdempotencyStatus,
} from "./utils/idempotency";
export { InMemoryIdempotencyStore, fingerprintParams } from "./utils/idempotency";
export type { RetryConfig, WithRetryOptions } from "./utils/retry";
export {
  withRetry,
  parseRetryAfterSeconds,
  DEFAULT_RETRY_CONFIG,
} from "./utils/retry";

export type { PaymentGateway } from "./gateways/gateway.interface";
export { BaseGateway } from "./gateways/base.gateway";
export { MoyasarGateway } from "./gateways/moyasar/moyasar.gateway";
export { PayPalGateway } from "./gateways/paypal/paypal.gateway";
export { PaymobGateway } from "./gateways/paymob/paymob.gateway";
export { StripeGateway } from "./gateways/stripe/stripe.gateway";

export {
  PaymentError,
  PaymentAbortedError,
  GatewayNotConfiguredError,
  InvalidWebhookError,
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  RateLimitError,
  ResourceNotFoundError,
  InvalidRequestError,
  NetworkError,
} from "./errors";
