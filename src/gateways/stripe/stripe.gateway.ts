// file: packages/payments/src/gateways/stripe/stripe.gateway.ts

import { BaseGateway } from "../base.gateway";
import type {
  CaptureParams,
  CreatePaymentParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentStatus,
  RefundParams,
  VoidParams,
} from "../../types/payment.types";
import type {
  StripeWebhookPayload,
  WebhookEvent,
} from "../../types/webhook.types";
import type { StripeConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import {
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
} from "../../errors";
import { withRetry } from "../../utils/retry";
import type { Logger } from "../../utils/logger";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe maps transient failures to NetworkError (timeouts, connection errors,
 * 5xx) and RateLimitError (429). Both are safe to retry.
 */
function isStripeRetryableError(error: unknown): boolean {
  return error instanceof NetworkError || error instanceof RateLimitError;
}
import {
  CreatePaymentParamsSchema,
  CaptureParamsSchema,
  GetPaymentParamsSchema,
  RefundParamsSchema,
  VoidParamsSchema,
  CreateCheckoutSessionParamsSchema,
  StripeCreatePaymentParamsSchema,
} from "../../types/validation";
import type {
  CreateCheckoutSessionParams,
  StripeCreatePaymentParams,
} from "../../types/validation";

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe API Response Types (Partial)
// ═══════════════════════════════════════════════════════════════════════════════

interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  amount_received: number;
  currency: string;
  status: string;
  client_secret: string | null;
  receipt_email: string | null;
  metadata: Record<string, string>;
  latest_charge:
    | string
    | {
        id?: string;
        amount_refunded?: number;
        currency?: string;
      }
    | null;
  next_action?: unknown;
}

interface StripeRefund {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  payment_intent: string | { id?: string } | null;
  charge?:
    | string
    | {
        id?: string;
        amount?: number;
        amount_refunded?: number;
        currency?: string;
      }
    | null;
  status: string;
  metadata: Record<string, string>;
}

interface StripeListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

interface StripeErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    decline_code?: string;
    param?: string;
  };
  statusCode?: number;
}

interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  url: string | null;
  payment_status: string;
  status: string;
  customer: string | null;
  metadata: Record<string, string>;
  payment_intent?: string | { id: string } | null;
  setup_intent?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  amount_total?: number | null;
  currency?: string | null;
}

const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]);
const STRIPE_TWO_DECIMAL_SPECIAL_CASES = new Set(["isk", "ugx"]);
const STRIPE_WHOLE_UNIT_ONLY_CURRENCIES = new Set([
  ...STRIPE_ZERO_DECIMAL_CURRENCIES,
  ...STRIPE_TWO_DECIMAL_SPECIAL_CASES,
]);
const STRIPE_REFUND_REASONS = new Set([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);
const DEFAULT_STRIPE_API_VERSION = "2026-02-25.clover";
const DEFAULT_STRIPE_TIMEOUT_MS = 30_000;
const STRIPE_DEFAULT_MAX_AMOUNT = 99_999_999;
const STRIPE_MAX_AMOUNTS: Record<string, number> = {
  cop: 9_999_999_999_999,
  huf: 9_999_999_999_999,
  idr: 999_999_999_999,
  inr: 999_999_999,
  jpy: 9_999_999_999_999,
  lbp: 999_999_999_999,
};
const STRIPE_MAX_METADATA_KEYS = 50;
const STRIPE_MAX_METADATA_KEY_LENGTH = 40;
const STRIPE_MAX_METADATA_VALUE_LENGTH = 500;
const STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const STRIPE_PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_CHECKOUT_SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]+$/;

function stripeCurrencyExponent(currency: string): number {
  const normalized = currency.toLowerCase();

  if (STRIPE_TWO_DECIMAL_SPECIAL_CASES.has(normalized)) {
    return 2;
  }

  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(normalized)) {
    return 3;
  }

  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(normalized) ? 0 : 2;
}

function stripeMaximumAmount(currency: string): number {
  return (
    STRIPE_MAX_AMOUNTS[currency.toLowerCase()] ?? STRIPE_DEFAULT_MAX_AMOUNT
  );
}

function toStripeAmount(
  amount: number,
  currency: string,
  options?: { enforceChargeLimits?: boolean; allowZero?: boolean },
): number {
  const normalized = currency.toLowerCase();
  if (
    !Number.isFinite(amount) ||
    (options?.allowZero ? amount < 0 : amount <= 0)
  ) {
    throw new InvalidRequestError(
      options?.allowZero
        ? "Stripe amount must be a non-negative finite number"
        : "Stripe amount must be a positive finite number",
    );
  }

  if (
    STRIPE_WHOLE_UNIT_ONLY_CURRENCIES.has(normalized) &&
    !Number.isInteger(amount)
  ) {
    throw new InvalidRequestError(
      `Stripe ${normalized.toUpperCase()} amounts must be whole currency units`,
    );
  }

  const factor = 10 ** stripeCurrencyExponent(normalized);
  const stripeAmount = Math.round((amount + Number.EPSILON) * factor);
  const normalizedBack = stripeAmount / factor;

  if (
    Math.abs(normalizedBack - amount) >
    Number.EPSILON * Math.max(1, amount)
  ) {
    throw new InvalidRequestError(
      `Stripe ${normalized.toUpperCase()} amounts cannot have more decimal places than the currency supports`,
    );
  }

  const maxAmount = stripeMaximumAmount(normalized);
  if (options?.enforceChargeLimits && stripeAmount > maxAmount) {
    throw new InvalidRequestError(
      `Stripe ${normalized.toUpperCase()} amount must be at most ${maxAmount} in the currency's minor unit`,
    );
  }

  return stripeAmount;
}

function fromStripeAmount(
  amount: number | undefined | null,
  currency: string,
): number {
  if (amount === undefined || amount === null) {
    return 0;
  }
  return amount / 10 ** stripeCurrencyExponent(currency);
}

function expandableId(
  value: string | { id?: string } | null | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return value?.id;
}

function stripeSubscriptionStatus(status: string): PaymentStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "paid";
    case "past_due":
    case "incomplete":
    case "paused":
      return "pending";
    case "incomplete_expired":
    case "canceled":
    case "unpaid":
      return "cancelled";
    default:
      return "pending";
  }
}

function stripeInvoiceStatus(eventType: string, status: string): PaymentStatus {
  switch (eventType) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return "paid";
    case "invoice.payment_failed":
      return "failed";
    case "invoice.voided":
      return "cancelled";
    case "invoice.marked_uncollectible":
      return "failed";
    default:
      if (status === "paid") {
        return "paid";
      }
      if (status === "void" || status === "uncollectible") {
        return status === "void" ? "cancelled" : "failed";
      }
      return "pending";
  }
}

function stripeInvoiceAmount(
  eventType: string,
  invoice: Record<string, any>,
): number | undefined {
  const firstNumber = (...values: unknown[]): number | undefined => {
    return values.find((value): value is number => typeof value === "number");
  };

  switch (eventType) {
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return firstNumber(
        invoice.amount_paid,
        invoice.total,
        invoice.amount_due,
      );
    case "invoice.payment_failed":
      return firstNumber(
        invoice.amount_due,
        invoice.amount_remaining,
        invoice.total,
        invoice.amount_paid,
      );
    default:
      return firstNumber(
        invoice.total,
        invoice.amount_due,
        invoice.amount_remaining,
        invoice.amount_paid,
      );
  }
}

function stripeWebhookPaymentId(
  object: StripeWebhookPayload["data"]["object"],
): string {
  if (object.object === "checkout.session") {
    return (
      expandableId((object as any).payment_intent) ??
      expandableId((object as any).setup_intent) ??
      expandableId((object as any).subscription) ??
      object.id
    );
  }

  if (object.object === "invoice") {
    return (
      expandableId((object as any).payment_intent) ??
      expandableId((object as any).subscription) ??
      expandableId(
        (object as any).parent?.subscription_details?.subscription,
      ) ??
      object.id
    );
  }

  if (object.object === "charge" || object.object === "refund") {
    return expandableId((object as any).payment_intent) ?? object.id;
  }

  return object.id;
}

function stripeWebhookMetadataPaymentId(
  object: StripeWebhookPayload["data"]["object"],
): string | undefined {
  return (
    object.metadata?.paymentId ??
    (object as any).parent?.subscription_details?.metadata?.paymentId ??
    (object as any).subscription_details?.metadata?.paymentId
  );
}

function stripeNextActionRedirectUrl(nextAction: unknown): string | undefined {
  if (!nextAction || typeof nextAction !== "object") {
    return undefined;
  }

  const action = nextAction as Record<string, any>;
  return (
    action.redirect_to_url?.url ??
    action.alipay_handle_redirect?.url ??
    action.alipay_handle_redirect?.native_url ??
    action.wechat_pay_redirect_to_ios_app?.native_url ??
    action.cashapp_handle_redirect_or_display_qr_code
      ?.hosted_instructions_url ??
    action.swish_handle_redirect_or_display_qr_code?.hosted_instructions_url
  );
}

function sanitizedStripeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key.length > STRIPE_MAX_METADATA_KEY_LENGTH) {
      throw new InvalidRequestError(
        `Stripe metadata key "${key}" must be ${STRIPE_MAX_METADATA_KEY_LENGTH} characters or fewer`,
      );
    }
    if (key.includes("[") || key.includes("]")) {
      throw new InvalidRequestError(
        `Stripe metadata key "${key}" cannot contain square brackets`,
      );
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const stringValue = String(value);
      if (stringValue.length > STRIPE_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Stripe metadata value for "${key}" must be ${STRIPE_MAX_METADATA_VALUE_LENGTH} characters or fewer`,
        );
      }
      sanitized[key] = stringValue;
      continue;
    }
    throw new InvalidRequestError(
      `Stripe metadata value for "${key}" must be a string, number, or boolean`,
    );
  }

  if (Object.keys(sanitized).length > STRIPE_MAX_METADATA_KEYS) {
    throw new InvalidRequestError(
      `Stripe metadata can include at most ${STRIPE_MAX_METADATA_KEYS} keys`,
    );
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function requireCurrencyForPartialAmount(
  operation: string,
  currency: string | undefined,
): string {
  if (!currency) {
    throw new InvalidRequestError(
      `Stripe ${operation} requires currency when amount is provided`,
    );
  }
  return currency.toLowerCase();
}

function mapStripeRefundStatus(
  status: string,
): "pending" | "completed" | "failed" {
  if (status === "succeeded") {
    return "completed";
  }
  if (status === "failed" || status === "canceled") {
    return "failed";
  }
  return "pending";
}

function mapStripeRefundWebhookStatus(
  status: string,
  object: StripeWebhookPayload["data"]["object"],
): PaymentStatus {
  if (status === "succeeded") {
    const charge = (object as any).charge;
    const chargeAmount =
      typeof charge === "object" && charge !== null ? charge.amount : undefined;
    const chargeAmountRefunded =
      typeof charge === "object" && charge !== null
        ? charge.amount_refunded
        : undefined;

    if (
      typeof chargeAmount === "number" &&
      typeof chargeAmountRefunded === "number"
    ) {
      return chargeAmountRefunded >= chargeAmount
        ? "refunded"
        : "partially_refunded";
    }

    return "refund_completed";
  }
  if (status === "failed" || status === "canceled") {
    return "failed";
  }
  return "pending";
}

function stripeHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) {
      return value;
    }
  }

  return undefined;
}

function validateStripeIdempotencyKey(idempotencyKey?: string): void {
  if (
    idempotencyKey &&
    idempotencyKey.length > STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new InvalidRequestError(
      `Stripe idempotency keys must be ${STRIPE_MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer`,
    );
  }
}

function stripePaymentIntentPathId(paymentIntentId: string): string {
  if (!STRIPE_PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId)) {
    throw new InvalidRequestError(
      "Stripe PaymentIntent ID must start with pi_ and contain only letters, numbers, or underscores",
    );
  }

  return encodeURIComponent(paymentIntentId);
}

function stripeCheckoutSessionPathId(sessionId: string): string {
  if (!STRIPE_CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidRequestError(
      "Stripe Checkout Session ID must start with cs_ and contain only letters, numbers, or underscores",
    );
  }

  return encodeURIComponent(sessionId);
}

function stripeExpectedWebhookApiVersion(
  config: StripeConfig,
): string | undefined {
  return config.webhookApiVersion?.trim() || undefined;
}

function assertStripeSnapshotEvent(payload: StripeWebhookPayload): void {
  if (
    typeof payload?.id !== "string" ||
    typeof payload?.type !== "string" ||
    typeof payload?.created !== "number" ||
    typeof payload?.data?.object?.id !== "string" ||
    typeof payload?.data?.object?.object !== "string"
  ) {
    throw new InvalidRequestError(
      "Invalid Stripe webhook payload: expected a snapshot event with data.object",
    );
  }
}

function assertStripeEventObjectDetails(payload: StripeWebhookPayload): void {
  const object = payload.data.object;
  const invalid = (message: string) => {
    throw new InvalidRequestError(`Invalid Stripe webhook payload: ${message}`);
  };

  if (payload.type.startsWith("payment_intent.")) {
    if (
      object.object !== "payment_intent" ||
      typeof object.status !== "string" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot payment_intent object");
    }
    return;
  }

  if (payload.type.startsWith("checkout.session.")) {
    if (
      object.object !== "checkout.session" ||
      typeof object.status !== "string" ||
      typeof object.payment_status !== "string"
    ) {
      invalid("expected a snapshot checkout.session object");
    }
    return;
  }

  if (payload.type.startsWith("invoice.")) {
    if (object.object !== "invoice" || typeof object.status !== "string") {
      invalid("expected a snapshot invoice object");
    }
    return;
  }

  if (payload.type.startsWith("customer.subscription.")) {
    if (object.object !== "subscription" || typeof object.status !== "string") {
      invalid("expected a snapshot subscription object");
    }
    return;
  }

  if (payload.type === "charge.refunded") {
    if (
      object.object !== "charge" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot charge object");
    }
    return;
  }

  if (
    payload.type.startsWith("refund.") ||
    payload.type === "charge.refund.updated"
  ) {
    if (
      object.object !== "refund" ||
      typeof object.status !== "string" ||
      typeof object.amount !== "number" ||
      typeof object.currency !== "string"
    ) {
      invalid("expected a snapshot refund object");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: URL Encoded Serializer
// ═══════════════════════════════════════════════════════════════════════════════

function toUrlEncoded(
  obj: Record<string, any>,
  prefix?: string,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const paramKey = prefix ? `${prefix}[${key}]` : key;

      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const arrayKey = `${paramKey}[${index}]`;
          if (typeof item === "object" && item !== null) {
            const nestedParams = toUrlEncoded(item, arrayKey);
            nestedParams.forEach((nestedValue, nestedKey) => {
              params.append(nestedKey, nestedValue);
            });
          } else {
            params.append(arrayKey, String(item));
          }
        });
      } else if (typeof value === "object") {
        const nestedParams = toUrlEncoded(value, paramKey);
        nestedParams.forEach((nestedValue, nestedKey) => {
          params.append(nestedKey, nestedValue);
        });
      } else {
        params.append(paramKey, String(value));
      }
    }
  }
  return params;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe Gateway Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stripe payment gateway implementation
 * Uses Stripe API directly via fetch
 * @see https://stripe.com/docs/api
 */
export class StripeGateway extends BaseGateway {
  readonly name = "stripe" as const;

  private readonly stripeConfig: StripeConfig;

  private get baseUrl(): string {
    return "https://api.stripe.com/v1";
  }

  constructor(config: StripeConfig, hooks: HooksManager, logger?: Logger) {
    super(config, hooks, logger);
    this.stripeConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a Stripe PaymentIntent
   */
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: StripeCreatePaymentParams,
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: CreatePaymentParams | StripeCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "createPayment",
      params,
      async (p) => {
        const currency = p.currency.toLowerCase();
        const metadataInput = { ...(p.metadata ?? {}) };
        if (p.orderId) {
          metadataInput.orderId ??= p.orderId;
          metadataInput.paymentId ??= p.orderId;
        }
        const metadata = sanitizedStripeMetadata(metadataInput);

        const body: Record<string, any> = {
          amount: toStripeAmount(p.amount, currency, {
            enforceChargeLimits: true,
          }),
          currency,
          automatic_payment_methods: { enabled: true },
          description: p.description,
          metadata,
        };

        if (p.capture === false) {
          body.capture_method = "manual";
        }

        if (p.stripeCustomerId) {
          body.customer = p.stripeCustomerId;
        }

        if (p.stripePaymentMethodId) {
          body.payment_method = p.stripePaymentMethodId;
          body.confirm = true; // Confirm immediately if method provided
          if (p.callbackUrl) {
            body.return_url = p.callbackUrl;
          } else {
            body.automatic_payment_methods.allow_redirects = "never";
          }
        }

        if (p.stripeSetupFutureUsage) {
          body.setup_future_usage = p.stripeSetupFutureUsage;
        }

        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          "/payment_intents",
          body,
          p.idempotencyKey,
        );

        return {
          success: true,
          gatewayId: response.id,
          status: this.mapStatus(response.status),
          redirectUrl: stripeNextActionRedirectUrl(response.next_action),
          amount: fromStripeAmount(
            response.amount,
            response.currency ?? currency,
          ),
          clientSecret: response.client_secret ?? undefined,
          nextAction: response.next_action,
          rawResponse: response,
        };
      },
      StripeCreatePaymentParamsSchema,
    );
  }

  /**
   * Capture a localized/authorized PaymentIntent
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "capturePayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const body: Record<string, any> = {};
        if (p.amount !== undefined) {
          const currency = requireCurrencyForPartialAmount(
            "capturePayment",
            p.currency,
          );
          body.amount_to_capture = toStripeAmount(p.amount, currency);
        }

        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          `/payment_intents/${paymentIntentPathId}/capture`,
          body,
          p.idempotencyKey,
        );

        return {
          success: true,
          gatewayId: response.id,
          status: this.mapStatus(response.status),
          redirectUrl: undefined,
          amount: fromStripeAmount(
            response.amount_received,
            response.currency ?? p.currency ?? "usd",
          ),
          clientSecret: response.client_secret ?? undefined,
          nextAction: response.next_action,
          rawResponse: response,
        };
      },
      CaptureParamsSchema,
    );
  }

  /**
   * Refund a PaymentIntent (via Refunds API)
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks(
      "refundPayment",
      params,
      async (p) => {
        stripePaymentIntentPathId(p.gatewayPaymentId);
        const body: Record<string, any> = {
          payment_intent: p.gatewayPaymentId,
        };

        if (p.amount !== undefined) {
          const currency = requireCurrencyForPartialAmount(
            "refundPayment",
            p.currency,
          );
          body.amount = toStripeAmount(p.amount, currency);
        }

        if (p.reason) {
          if (STRIPE_REFUND_REASONS.has(p.reason)) {
            body.reason = p.reason;
          } else {
            body.metadata = { reason: p.reason };
          }
        }

        const refundMetadata = sanitizedStripeMetadata({
          ...(body.metadata ?? {}),
          ...(p.metadata ?? {}),
        });
        if (refundMetadata) {
          body.metadata = refundMetadata;
        }

        const response = await this.stripeRequest<StripeRefund>(
          "POST",
          "/refunds",
          body,
          p.idempotencyKey,
        );
        let totalRefunded: number | undefined;
        try {
          totalRefunded = await this.getTotalRefundedForPaymentIntent(
            p.gatewayPaymentId,
            response.currency ?? p.currency ?? "usd",
          );
        } catch {
          totalRefunded = undefined;
        }

        return {
          success: true,
          gatewayRefundId: response.id,
          status: mapStripeRefundStatus(response.status),
          totalRefunded,
          rawResponse: response,
        };
      },
      RefundParamsSchema,
    );
  }

  /**
   * Void/Cancel a payment (before it is captured)
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "voidPayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const response = await this.stripeRequest<StripePaymentIntent>(
          "POST",
          `/payment_intents/${paymentIntentPathId}/cancel`,
          undefined,
          p.idempotencyKey,
        );

        return {
          success: true,
          gatewayId: response.id,
          status: this.mapStatus(response.status),
          redirectUrl: undefined,
          amount: fromStripeAmount(response.amount, response.currency ?? "usd"),
          clientSecret: response.client_secret ?? undefined,
          nextAction: response.next_action,
          rawResponse: response,
        };
      },
      VoidParamsSchema,
    );
  }

  /**
   * Retrieve PaymentIntent details
   * @see https://stripe.com/docs/api/payment_intents/retrieve
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks(
      "getPayment",
      params,
      async (p) => {
        const paymentIntentPathId = stripePaymentIntentPathId(
          p.gatewayPaymentId,
        );
        const paymentIntent = await this.stripeRequest<StripePaymentIntent>(
          "GET",
          `/payment_intents/${paymentIntentPathId}?expand[]=latest_charge`,
        );
        const latestCharge =
          typeof paymentIntent.latest_charge === "object" &&
          paymentIntent.latest_charge !== null
            ? paymentIntent.latest_charge
            : undefined;

        return {
          success: true,
          gatewayId: paymentIntent.id,
          status: this.mapStatus(paymentIntent.status),
          redirectUrl: undefined,
          amount: fromStripeAmount(
            paymentIntent.amount,
            paymentIntent.currency ?? "usd",
          ),
          refundedAmount:
            latestCharge?.amount_refunded !== undefined
              ? fromStripeAmount(
                  latestCharge.amount_refunded,
                  latestCharge.currency ?? paymentIntent.currency ?? "usd",
                )
              : undefined,
          clientSecret: paymentIntent.client_secret ?? undefined,
          nextAction: paymentIntent.next_action,
          rawResponse: paymentIntent,
        };
      },
      GetPaymentParamsSchema,
    );
  }

  /**
   * Retrieve Checkout Session details and expose the related PaymentIntent ID
   * for legacy rows that stored cs_* before normalizing to pi_*.
   */
  async getCheckoutSession(params: { sessionId: string }): Promise<{
    success: boolean;
    sessionId: string;
    paymentIntentId: string | undefined;
    url: string | null;
    status: string;
    paymentStatus: string;
    amount?: number | undefined;
    currency?: string | undefined;
    rawResponse: unknown;
  }> {
    return this.executeWithHooks(
      "getPayment",
      params,
      async (p) => {
        const sessionPathId = stripeCheckoutSessionPathId(p.sessionId);
        const session = await this.stripeRequest<StripeCheckoutSession>(
          "GET",
          `/checkout/sessions/${sessionPathId}?expand[]=payment_intent`,
        );
        const currency = session.currency?.toLowerCase();

        return {
          success: true,
          sessionId: session.id,
          paymentIntentId: expandableId(session.payment_intent),
          url: session.url,
          status: session.status,
          paymentStatus: session.payment_status,
          amount:
            session.amount_total !== undefined && session.amount_total !== null && currency
              ? fromStripeAmount(session.amount_total, currency)
              : undefined,
          currency,
          rawResponse: session,
        };
      },
    );
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const result = await this.getPayment({ gatewayPaymentId: gatewayId });
    return result.status;
  }

  /**
   * Create a Stripe Checkout Session for hosted payment page
   * @see https://stripe.com/docs/api/checkout/sessions/create
   */
  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<{
    success: boolean;
    sessionId: string;
    url: string | null;
    rawResponse: unknown;
  }> {
    return this.executeWithHooks(
      "createCheckoutSession",
      params,
      async (p) => {
        const mode = p.mode ?? "payment";
        const metadata = sanitizedStripeMetadata(p.metadata);
        const body: Record<string, any> = {
          mode,
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata,
        };

        if (p.paymentMethodTypes) {
          body.payment_method_types = p.paymentMethodTypes;
        }

        // Build line items
        if (p.lineItems?.length) {
          body.line_items = p.lineItems.map((item) => ({
            price: item.price,
            price_data: item.priceData
              ? {
                  currency: item.priceData.currency.toLowerCase(),
                  product_data: {
                    name: item.priceData.productData.name,
                    description: item.priceData.productData.description,
                    images: item.priceData.productData.images,
                  },
                  unit_amount:
                    item.priceData.unitAmount ??
                    toStripeAmount(
                      item.priceData.amount!,
                      item.priceData.currency,
                      { allowZero: true },
                    ),
                  recurring: item.priceData.recurring
                    ? {
                        interval: item.priceData.recurring.interval,
                        interval_count: item.priceData.recurring.intervalCount,
                      }
                    : undefined,
                }
              : undefined,
            quantity: item.quantity,
          }));
        } else if (mode !== "setup") {
          const currency = p.currency?.toLowerCase();
          // Simple amount-based session
          body.line_items = [
            {
              price_data: {
                currency,
                product_data: { name: "Payment" },
                unit_amount: toStripeAmount(p.amount!, currency!, {
                  enforceChargeLimits: true,
                }),
              },
              quantity: 1,
            },
          ];
        }

        if (mode === "setup" && p.currency) {
          body.currency = p.currency.toLowerCase();
        }

        if (metadata) {
          if (mode === "payment") {
            body.payment_intent_data = { metadata };
          } else if (mode === "setup") {
            body.setup_intent_data = { metadata };
          } else if (mode === "subscription") {
            body.subscription_data = { metadata };
          }
        }

        if (p.customerId) {
          body.customer = p.customerId;
        }
        if (p.customerEmail) {
          body.customer_email = p.customerEmail;
        }

        const response = await this.stripeRequest<StripeCheckoutSession>(
          "POST",
          "/checkout/sessions",
          body,
          p.idempotencyKey,
        );

        return {
          success: true,
          sessionId: response.id,
          url: response.url,
          rawResponse: response,
        };
      },
      CreateCheckoutSessionParamsSchema,
    );
  }

  /**
   * Map Stripe errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "stripe") {
      const raw = error.rawError as StripeErrorResponse;
      const code = raw?.error?.code;
      const declineCode = raw?.error?.decline_code;
      const errorType = raw?.error?.type;
      const statusCode = raw?.statusCode;
      const message = raw?.error?.message ?? error.message;

      if (
        statusCode === 429 ||
        code === "rate_limit" ||
        code === "lock_timeout"
      ) {
        return new RateLimitError("stripe");
      }

      if (statusCode === 401) {
        return new AuthenticationError(message, raw);
      }

      switch (code) {
        case "card_declined":
          if (declineCode === "insufficient_funds") {
            return new InsufficientFundsError(message, raw);
          }
          return new CardDeclinedError(message, raw);
        case "incorrect_cvc":
        case "incorrect_number":
        case "incorrect_zip":
        case "expired_card":
        case "invalid_cvc":
        case "invalid_number":
        case "invalid_expiry_month":
        case "invalid_expiry_year":
          return new CardDeclinedError(message, raw);
        case "authentication_required":
          return new AuthenticationError(message, raw);
        case "parameter_invalid_integer":
        case "parameter_missing":
          return new InvalidRequestError(message, [raw]);
      }

      if (errorType === "invalid_request_error" || statusCode === 400) {
        return new InvalidRequestError(message, [raw]);
      }
    }
    return super.mapError(error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Stripe webhook signature.
   *
   * ⚠️ The `payload` MUST be the raw request body as a string or Buffer — the
   * exact bytes Stripe sent. Stripe's signature is computed over the raw body,
   * so a parsed/re-serialized JSON object will NOT verify. If you pass a parsed
   * object this method returns false (and logs a warning via the configured
   * logger) rather than throwing. In frameworks that auto-parse JSON, configure
   * a raw-body parser for the webhook route (e.g. express.raw()).
   *
   * @see https://stripe.com/docs/webhooks/signatures
   */
  verifyWebhook(
    payload: unknown,
    signature?: string,
    headers?: Record<string, string>,
  ): boolean {
    if (!this.stripeConfig.webhookSecret) {
      this.logger.warn(
        "[Stripe] Webhook verification failed: webhookSecret not configured",
      );
      return false;
    }

    const sigHeader = signature || stripeHeader(headers, "stripe-signature");
    if (!sigHeader) {
      this.logger.warn("[Stripe] Missing stripe-signature header");
      return false;
    }

    const signatures: string[] = [];
    let timestamp: string | undefined;
    for (const part of sigHeader.split(",")) {
      const [key, value] = part.split("=");
      if (!key || !value) continue;
      const normalizedKey = key.trim();
      if (normalizedKey === "t") {
        timestamp = value.trim();
      } else if (normalizedKey === "v1") {
        signatures.push(value.trim());
      }
    }

    if (!timestamp || signatures.length === 0) {
      this.logger.warn("[Stripe] Invalid signature header format");
      return false;
    }

    // Prevent replay attacks (5 minute tolerance)
    const eventTime = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > 300) {
      this.logger.warn("[Stripe] Webhook signature timestamp too old");
      return false;
    }

    let signedPayload: string | Buffer;
    if (typeof payload === "string") {
      signedPayload = `${timestamp}.${payload}`;
    } else if (Buffer.isBuffer(payload)) {
      signedPayload = Buffer.concat([
        Buffer.from(`${timestamp}.`, "utf8"),
        payload,
      ]);
    } else {
      this.logger.warn(
        "[Stripe] Webhook verification requires the raw request body",
      );
      return false;
    }

    const hmac = createHmac("sha256", this.stripeConfig.webhookSecret);
    hmac.update(signedPayload);
    const expectedSignature = hmac.digest("hex");

    return signatures.some((v1Signature) => {
      try {
        return timingSafeEqual(
          Buffer.from(expectedSignature),
          Buffer.from(v1Signature),
        );
      } catch (e) {
        return false;
      }
    });
  }

  /**
   * Parse Stripe webhook event
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    // Stripe payload structure is { id: ..., type: ..., data: { object: ... } }
    // If payload is raw string, parse it
    let raw: StripeWebhookPayload;
    if (typeof payload === "string") {
      raw = JSON.parse(payload) as StripeWebhookPayload;
    } else if (Buffer.isBuffer(payload)) {
      raw = JSON.parse(payload.toString("utf8")) as StripeWebhookPayload;
    } else {
      raw = payload as StripeWebhookPayload;
    }

    assertStripeSnapshotEvent(raw);
    assertStripeEventObjectDetails(raw);

    const expectedApiVersion = stripeExpectedWebhookApiVersion(
      this.stripeConfig,
    );
    if (
      expectedApiVersion &&
      raw.api_version &&
      raw.api_version !== expectedApiVersion
    ) {
      throw new InvalidRequestError(
        `Stripe webhook API version ${raw.api_version} does not match expected ${expectedApiVersion}`,
      );
    }

    const object = raw.data.object;

    // Extract payment ID
    const paymentId = stripeWebhookMetadataPaymentId(object);
    const gatewayPaymentId = stripeWebhookPaymentId(object);
    const gatewayObjectId =
      gatewayPaymentId === object.id ? undefined : object.id;

    // Determine status/type
    let status: PaymentStatus = "pending";
    let amount = 0;
    let currency = object.currency?.toLowerCase() ?? "usd";

    if (object.amount !== undefined) {
      amount = fromStripeAmount(object.amount, currency);
    }
    // Checkout sessions use amount_total instead of amount
    if (object.amount_total !== undefined) {
      amount = fromStripeAmount(object.amount_total, currency);
    }
    if (object.object === "invoice") {
      const invoice = object as any;
      const invoiceAmount = stripeInvoiceAmount(raw.type, invoice);
      if (invoiceAmount !== undefined) {
        amount = fromStripeAmount(invoiceAmount, currency);
      }
    }

    // Map status based on event type
    switch (raw.type) {
      case "payment_intent.succeeded":
        status = "paid";
        break;
      case "payment_intent.payment_failed":
        status = "failed";
        break;
      case "payment_intent.canceled":
        status = "cancelled";
        break;
      case "payment_intent.created":
        status = "pending";
        break;
      case "checkout.session.completed":
        // Checkout sessions have a specific payment_status field
        const session = object as unknown as StripeCheckoutSession;
        if (session.payment_status === "paid") {
          status = "paid";
        } else if (
          session.payment_status === "no_payment_required" &&
          session.status === "complete"
        ) {
          status = "setup_completed";
        } else {
          status = "pending";
        }
        break;
      case "checkout.session.async_payment_succeeded":
        status = "paid";
        break;
      case "checkout.session.async_payment_failed":
        status = "failed";
        break;
      case "checkout.session.expired":
        status = "cancelled";
        break;
      case "charge.refunded":
        if (object.amount_refunded !== undefined) {
          amount = fromStripeAmount(object.amount_refunded, currency);
          status =
            object.amount !== undefined &&
            object.amount_refunded < object.amount
              ? "partially_refunded"
              : "refunded";
        } else {
          status = "refunded";
        }
        break;
      case "refund.created":
      case "refund.updated":
      case "charge.refund.updated":
        status = mapStripeRefundWebhookStatus(object.status, object);
        break;
      case "refund.failed":
        status = "failed";
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.updated":
        status = stripeInvoiceStatus(raw.type, object.status);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "customer.subscription.trial_will_end":
        status =
          raw.type === "customer.subscription.deleted"
            ? "cancelled"
            : stripeSubscriptionStatus(object.status);
        break;
      // Subscription schedule events (for future subscription management)
      case "subscription_schedule.created":
      case "subscription_schedule.updated":
      case "subscription_schedule.released":
      case "subscription_schedule.canceled":
      case "subscription_schedule.completed":
      case "subscription_schedule.expiring":
      case "subscription_schedule.aborted":
        // Pass through with pending status - consumers should handle these specifically
        status = "pending";
        break;
      default:
        // Fallback to object status mapping
        status = this.mapStatus(object.status);
    }

    return {
      id: raw.id,
      type: raw.type,
      gateway: "stripe",
      paymentId,
      gatewayPaymentId,
      gatewayObjectId,
      status,
      livemode: raw.livemode === true,
      apiVersion: raw.api_version ?? undefined,
      amount,
      // Normalize to uppercase ISO 4217 for cross-gateway consistency
      // (Stripe reports currency in lowercase).
      currency: currency.toUpperCase(),
      timestamp: new Date(raw.created * 1000),
      rawPayload: raw,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════

  private async getTotalRefundedForPaymentIntent(
    paymentIntentId: string,
    fallbackCurrency: string,
  ): Promise<number> {
    let totalMinorAmount = 0;
    let currency = fallbackCurrency;
    let startingAfter: string | undefined;

    do {
      const query = new URLSearchParams({
        payment_intent: paymentIntentId,
        limit: "100",
      });
      if (startingAfter) {
        query.set("starting_after", startingAfter);
      }

      const page = await this.stripeRequest<StripeListResponse<StripeRefund>>(
        "GET",
        `/refunds?${query.toString()}`,
      );

      for (const refund of page.data) {
        if (refund.status !== "succeeded") {
          continue;
        }
        currency = refund.currency ?? currency;
        totalMinorAmount += refund.amount;
      }

      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    return fromStripeAmount(totalMinorAmount, currency);
  }

  /**
   * Make request to Stripe API
   */
  private async stripeRequest<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<T> {
    validateStripeIdempotencyKey(idempotencyKey);

    // Safe to retry GET/HEAD always; retry mutations only when an idempotency
    // key is present so Stripe deduplicates a re-sent request.
    const retryableRequest =
      method === "GET" || method === "HEAD" || idempotencyKey !== undefined;

    return withRetry(
      () => this.stripeRequestOnce<T>(method, endpoint, body, idempotencyKey),
      { isRetryable: retryableRequest ? isStripeRetryableError : () => false },
    );
  }

  private async stripeRequestOnce<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.stripeConfig.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version":
        this.stripeConfig.apiVersion ?? DEFAULT_STRIPE_API_VERSION,
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT")) {
      options.body = toUrlEncoded(body);
    }

    const timeoutMs = this.stripeConfig.timeoutMs ?? DEFAULT_STRIPE_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    options.signal = controller.signal;

    let response: Response;
    let responseText = "";
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, options);
      responseText = await response.text();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new NetworkError(
          `Stripe API request timed out after ${timeoutMs}ms`,
          e,
        );
      }
      throw new NetworkError("Failed to reach Stripe API", e);
    } finally {
      clearTimeout(timeout);
    }

    let data: any = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        data = { error: { message: responseText, type: "api_error" } };
      }
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      if (response.status === 429) {
        throw new RateLimitError(
          "stripe",
          retryAfter ? Number(retryAfter) : undefined,
        );
      }

      if (response.status === 401) {
        throw new AuthenticationError(
          data.error?.message ?? "Stripe authentication failed",
          data,
        );
      }

      if (response.status >= 500) {
        throw new NetworkError(
          data.error?.message ?? "Stripe API unavailable",
          data,
        );
      }

      throw new GatewayApiError(
        data.error?.message ?? "Stripe API error",
        "stripe",
        { ...data, statusCode: response.status },
      );
    }

    return data as T;
  }

  /**
   * Map Stripe status to Unified Status
   */
  private mapStatus(stripeStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      requires_payment_method: "pending",
      requires_confirmation: "pending",
      requires_action: "pending",
      processing: "processing",
      requires_capture: "authorized",
      succeeded: "paid",
      canceled: "cancelled",
    };
    return map[stripeStatus] ?? "pending";
  }
}
