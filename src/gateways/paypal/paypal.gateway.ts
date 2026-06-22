// file: packages/payments/src/gateways/paypal.gateway.ts

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
import type { PayPalWebhookPayload, WebhookEvent, } from "../../types/webhook.types";
import type { PayPalConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import {
  CreatePaymentParamsSchema,
  CaptureParamsSchema,
  GetPaymentParamsSchema,
  RefundParamsSchema,
  VoidParamsSchema,
} from "../../types/validation";
import {
  GatewayApiError,
  CardDeclinedError,
  InsufficientFundsError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
  ResourceNotFoundError,
} from "../../errors";
import { withRetry as withRetryShared } from "../../utils/retry";
import type { Logger } from "../../utils/logger";

type PayPalRefundStatus = "pending" | "completed" | "failed";

class PayPalApiError extends GatewayApiError {
  constructor(
    message: string,
    rawError: unknown,
    public readonly paypalStatusCode: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message, "paypal", rawError);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PayPal API Response Types
// ═══════════════════════════════════════════════════════════════════════════════

interface PayPalOrderResponse {
  id: string;
  status: string;
  intent?: "CAPTURE" | "AUTHORIZE";
  amount?: {
    currency_code: string;
    value: string;
  };
  message?: string;
  name?: string;
  details?: Array<{
    issue?: string;
    description?: string;
    field?: string;
    value?: string;
  }>;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: {
      currency_code: string;
      value: string;
    };
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
      }>;
      authorizations?: Array<{
        id: string;
        status: string;
        amount: {
          currency_code: string;
          value: string;
        };
      }>;
    };
  }>;
}

interface PayPalRefundResponse {
  id: string;
  status: string;
  message?: string;
  name?: string;
  details?: Array<{
    issue?: string;
    description?: string;
  }>;
}

type PayPalMoney = {
  currency_code: string;
  value: string;
};

type PayPalPaymentResource = {
  id: string;
  status: string;
  amount: PayPalMoney;
  supplementary_data?: {
    related_ids?: {
      order_id?: string;
      authorization_id?: string;
      capture_id?: string;
    };
  };
  links?: Array<{ rel: string; href: string }>;
};

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
  message?: string;
}

interface PayPalWebhookVerifyRequest {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
  webhook_id: string;
  webhook_event: unknown;
}

interface PayPalWebhookVerifyResponse {
  verification_status: "SUCCESS" | "FAILURE";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Retry Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const PAYPAL_ZERO_DECIMAL_CURRENCIES = new Set(["HUF", "JPY", "TWD"]);
const MONEY_EPSILON = 1e-9;
const PAYPAL_ORDER_REQUEST_ID_MAX_LENGTH = 108;
const PAYPAL_PAYMENTS_REQUEST_ID_MAX_LENGTH = 10_000;
const PAYPAL_CUSTOM_ID_MAX_LENGTH = 127;
const PAYPAL_WEBHOOK_ID_MAX_LENGTH = 50;
const PAYPAL_WEBHOOK_HEADER_LIMITS = {
  authAlgo: 100,
  certUrl: 500,
  transmissionId: 50,
  transmissionSig: 500,
  transmissionTime: 100,
} as const;
const PAYPAL_WEBHOOK_ID_PATTERN = /^[A-Za-z0-9]+$/;
const PAYPAL_WEBHOOK_EVENTS_WITHOUT_AMOUNT = new Set([
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
]);
const PAYPAL_WEBHOOK_EVENTS_WITHOUT_RESOURCE_ID = new Set([
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
]);
const PAYPAL_WEBHOOK_EVENTS_WITHOUT_RESOURCE_STATUS = new Set([
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
]);

/**
 * Retry with exponential backoff.
 *
 * Thin adapter over the shared {@link withRetryShared} helper, preserving
 * PayPal's original call signature. The shared helper's default backoff already
 * honors `retryAfterSeconds` on the error (PayPalApiError exposes it), so 429
 * Retry-After values are respected.
 */
function withRetry<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean = () => false,
): Promise<T> {
  return withRetryShared(operation, { isRetryable });
}

/**
 * Check if error is retryable (5xx or network errors)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof PayPalApiError) {
    const status = error.paypalStatusCode;
    if (status >= 500 || status === 429) {
      return true;
    }

    const raw = error.rawError as {
      name?: string;
      details?: Array<{ issue?: string }>;
    };
    return status === 409 &&
      raw?.name === "RESOURCE_CONFLICT" &&
      raw.details?.some((detail) => detail.issue === "PREVIOUS_REQUEST_IN_PROGRESS") === true;
  }
  // Network errors
  return error instanceof NetworkError ||
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PayPal Gateway Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PayPal payment gateway implementation
 * Uses PayPal REST API v2
 * @see https://developer.paypal.com/docs/api/orders/v2/
 */
export class PayPalGateway extends BaseGateway {
  readonly name = "paypal" as const;

  private readonly paypalConfig: PayPalConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  /** Promise for in-flight token fetch (prevents race conditions) */
  private tokenFetchPromise: Promise<string> | null = null;

  private get baseUrl(): string {
    return this.paypalConfig.sandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";
  }

  constructor(config: PayPalConfig, hooks: HooksManager, logger?: Logger) {
    super(config, hooks, logger);
    if (
      config.webhookId !== undefined &&
      !PayPalGateway.isValidWebhookId(config.webhookId)
    ) {
      throw new InvalidRequestError(
        `PayPal webhookId must be ${PAYPAL_WEBHOOK_ID_MAX_LENGTH} or fewer alphanumeric characters`,
      );
    }
    this.paypalConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retrieve order details by ID
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const { gatewayPaymentId } = p;

      return withRetry(async () => {
        const response = await this.fetchWithAccessToken(
          `${this.baseUrl}/v2/checkout/orders/${gatewayPaymentId}`,
          (token) => ({
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            signal: this.createAbortSignal(),
          }),
        );

        const data = await this.parseJsonResponse<PayPalOrderResponse>(response);

        if (!response.ok) {
          if (response.status === 404) {
            return this.getPaymentResource(gatewayPaymentId);
          }

          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertOrderResponse(data, "get payment");

        const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
        const authorization = data.purchase_units?.[0]?.payments?.authorizations?.[0];
        const purchaseUnitAmount = data.purchase_units?.[0]?.amount;
        const amount = capture?.amount ?? authorization?.amount ?? purchaseUnitAmount;

        return {
          success: true,
          gatewayId: data.id,
          orderId: data.id,
          captureId: capture?.id,
          authorizationId: authorization?.id,
          status: this.mapPaymentResultStatus(data, capture, authorization),
          redirectUrl: undefined,
          amount: amount ? this.parseAmount(amount, "get payment") : undefined,
          rawResponse: data,
        };
      }, isRetryableError);
    }, GetPaymentParamsSchema);
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const result = await this.getPayment({ gatewayPaymentId: gatewayId });
    return result.status;
  }

  /**
   * Create a PayPal order
   */
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      const requestId = this.getRequestId(p.idempotencyKey, PAYPAL_ORDER_REQUEST_ID_MAX_LENGTH);
      return withRetry(async () => {
        const customId = this.getCustomId(p.metadata);
        const body = JSON.stringify({
          intent: p.capture === false ? "AUTHORIZE" : "CAPTURE",
          purchase_units: [
            {
              reference_id: p.orderId,
              description: p.description,
              custom_id: customId,
              amount: {
                currency_code: this.normalizeCurrencyCode(p.currency),
                value: this.formatAmount(p.amount, p.currency),
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                return_url: p.returnUrl ?? p.callbackUrl,
                cancel_url: p.cancelUrl ?? p.callbackUrl,
                shipping_preference: p.paypalShippingPreference ?? "NO_SHIPPING",
                user_action: "PAY_NOW",
              },
            },
          },
        });

        const response = await this.fetchWithAccessToken(`${this.baseUrl}/v2/checkout/orders`, (token) => ({
          method: "POST",
          headers: this.createJsonHeaders(token, requestId),
          signal: this.createAbortSignal(),
          body,
        }));

        const data = await this.parseJsonResponse<PayPalOrderResponse>(response);

        if (!response.ok) {
          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertOrderResponse(data, "create payment");

        // Find approval URL
        const approvalLink = data.links?.find(
          (link) => link.rel === "payer-action" || link.rel === "approve",
        );
        if (!approvalLink?.href) {
          throw this.createMalformedResponseError(
            "Invalid PayPal create payment response: missing approval link",
            data,
          );
        }

        return {
          success: true,
          gatewayId: data.id,
          orderId: data.id,
          status: this.mapStatus(data.status),
          redirectUrl: approvalLink?.href,
          rawResponse: data,
        };
      }, isRetryableError);
    }, CreatePaymentParamsSchema);
  }

  /**
   * Capture a PayPal order after customer approval
   * @returns Result including capture ID in rawResponse for use in refunds
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      const isAuthorizationCapture = p.paypalCaptureType === "authorization";
      const requestId = this.getRequestId(
        p.idempotencyKey,
        isAuthorizationCapture
          ? PAYPAL_PAYMENTS_REQUEST_ID_MAX_LENGTH
          : PAYPAL_ORDER_REQUEST_ID_MAX_LENGTH,
      );
      return withRetry(async () => {
        if (!isAuthorizationCapture && p.amount !== undefined) {
          throw new InvalidRequestError(
            "PayPal order captures do not support amount. Create an AUTHORIZE-intent order and capture the authorization for partial captures.",
          );
        }

        const url = isAuthorizationCapture
          ? `${this.baseUrl}/v2/payments/authorizations/${p.gatewayPaymentId}/capture`
          : `${this.baseUrl}/v2/checkout/orders/${p.gatewayPaymentId}/capture`;

        const body: Record<string, unknown> = {};
        if (isAuthorizationCapture && p.amount !== undefined) {
          if (!p.currency) {
            throw new InvalidRequestError(
              "Currency is required for partial PayPal authorization captures",
            );
          }
          body.amount = {
            value: this.formatAmount(p.amount, p.currency),
            currency_code: this.normalizeCurrencyCode(p.currency),
          };
        }

        if (isAuthorizationCapture) {
          body.final_capture = p.paypalFinalCapture ?? true;
        }

        const response = await this.fetchWithAccessToken(url, (token) => ({
          method: "POST",
          headers: this.createJsonHeaders(token, requestId, "return=representation"),
          signal: this.createAbortSignal(),
          body: JSON.stringify(body),
        }));

        const data = await this.parseJsonResponse<PayPalOrderResponse>(response);

        if (!response.ok) {
          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertOrderResponse(data, "capture payment");

        // Extract capture details
        const capture = isAuthorizationCapture
          ? {
            id: data.id,
            status: data.status,
            amount: data.amount,
          }
          : data.purchase_units?.[0]?.payments?.captures?.[0];

        this.assertPaymentResource(capture, "capture payment");

        return {
          success: true,
          gatewayId: capture.id,
          orderId: isAuthorizationCapture ? undefined : data.id,
          captureId: capture.id,
          authorizationId: isAuthorizationCapture ? p.gatewayPaymentId : undefined,
          status: capture ? this.mapResourceStatus(capture.status) : this.mapStatus(data.status),
          redirectUrl: undefined,
          amount: this.parseAmount(capture.amount, "capture payment"),
          // Include capture ID for downstream refund use
          rawResponse: {
            ...data,
            captureId: capture?.id,
            orderId: isAuthorizationCapture ? undefined : data.id,
            authorizationId: isAuthorizationCapture ? p.gatewayPaymentId : undefined,
          },
        };
      }, isRetryableError);
    }, CaptureParamsSchema);
  }

  /**
   * Refund a captured PayPal payment
   * Note: gatewayPaymentId should be the CAPTURE ID, not order ID
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const requestId = this.getRequestId(p.idempotencyKey, PAYPAL_PAYMENTS_REQUEST_ID_MAX_LENGTH);
      return withRetry(async () => {
        // Build refund body
        const body: Record<string, unknown> = {};

        if (p.amount !== undefined) {
          if (!p.currency) {
            throw new InvalidRequestError(
              "Currency is required for partial PayPal refunds",
            );
          }
          body.amount = {
            value: this.formatAmount(p.amount, p.currency),
            currency_code: this.normalizeCurrencyCode(p.currency),
          };
        }

        if (p.reason) {
          body.note_to_payer = p.reason;
        }

        const response = await this.fetchWithAccessToken(
          `${this.baseUrl}/v2/payments/captures/${p.gatewayPaymentId}/refund`,
          (token) => ({
            method: "POST",
            headers: this.createJsonHeaders(token, requestId, "return=representation"),
            signal: this.createAbortSignal(),
            body: JSON.stringify(body),
          }),
        );

        const data = await this.parseJsonResponse<PayPalRefundResponse>(response);

        if (!response.ok) {
          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertRefundResponse(data);

        return {
          success: true,
          gatewayRefundId: data.id,
          status: this.mapRefundStatus(data.status),
          rawResponse: data,
        };
      }, isRetryableError);
    }, RefundParamsSchema);
  }

  /**
   * Void an authorized PayPal payment
   * Note: This only works for orders created with intent: AUTHORIZE
   * gatewayPaymentId should be the AUTHORIZATION ID, not order ID
   * @see https://developer.paypal.com/docs/api/payments/v2/#authorizations_void
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      const requestId = this.getRequestId(p.idempotencyKey, PAYPAL_PAYMENTS_REQUEST_ID_MAX_LENGTH);
      return withRetry(async () => {
        const response = await this.fetchWithAccessToken(
          `${this.baseUrl}/v2/payments/authorizations/${p.gatewayPaymentId}/void`,
          (token) => ({
            method: "POST",
            headers: this.createJsonHeaders(token, requestId),
            signal: this.createAbortSignal(),
          }),
        );

        // PayPal returns 204 No Content on successful void
        if (response.status === 204) {
        return {
          success: true,
          gatewayId: p.gatewayPaymentId,
          authorizationId: p.gatewayPaymentId,
          status: "cancelled" as PaymentStatus,
          redirectUrl: undefined,
          rawResponse: null,
          };
        }

        // If not 204, try to parse the response for error details
        const data = await this.parseJsonResponse<PayPalOrderResponse>(response);

        if (!response.ok) {
          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertOrderResponse(data, "void payment");

        return {
          success: true,
          gatewayId: data.id ?? p.gatewayPaymentId,
          authorizationId: data.id ?? p.gatewayPaymentId,
          status: this.mapStatus(data.status ?? "VOIDED"),
          redirectUrl: undefined,
          rawResponse: data,
        };
      }, isRetryableError);
    }, VoidParamsSchema);
  }

  /**
   * Authorize an approved PayPal AUTHORIZE-intent order.
   * Use the returned authorizationId to capture or void the hold later.
   */
  async authorizePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("authorizePayment", params, async (p) => {
      this.assertAuthorizeParams(p);
      const requestId = this.getRequestId(p.idempotencyKey, PAYPAL_ORDER_REQUEST_ID_MAX_LENGTH);
      return withRetry(async () => {
        const response = await this.fetchWithAccessToken(
          `${this.baseUrl}/v2/checkout/orders/${p.gatewayPaymentId}/authorize`,
          (token) => ({
            method: "POST",
            headers: this.createJsonHeaders(token, requestId, "return=representation"),
            signal: this.createAbortSignal(),
            body: "{}",
          }),
        );

        const data = await this.parseJsonResponse<PayPalOrderResponse>(response);

        if (!response.ok) {
          throw this.createApiError(data, response.status, response.headers);
        }

        this.assertOrderResponse(data, "authorize payment");
        const authorization = data.purchase_units?.[0]?.payments?.authorizations?.[0];
        this.assertPaymentResource(authorization, "authorize payment");

        return {
          success: true,
          gatewayId: authorization.id,
          orderId: data.id,
          authorizationId: authorization.id,
          status: this.mapResourceStatus(authorization.status),
          redirectUrl: undefined,
          amount: this.parseAmount(authorization.amount, "authorize payment"),
          rawResponse: {
            ...data,
            authorizationId: authorization.id,
          },
        };
      }, isRetryableError);
    }, CaptureParamsSchema);
  }

  /**
   * Map PayPal errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof PayPalApiError) {
      const raw = error.rawError as {
        name?: string;
        details?: Array<{ issue?: string }>;
      };
      const name = raw?.name;
      const issues = raw?.details
        ?.map((detail) => detail.issue)
        .filter((issue): issue is string => Boolean(issue)) ?? [];
      const hasIssue = (patterns: string[]): boolean =>
        issues.some((issue) => patterns.some((pattern) => issue.includes(pattern)));

      if (error.paypalStatusCode === 401 || name === "AUTHENTICATION_FAILURE") {
        return new AuthenticationError(error.message, raw);
      }
      if (error.paypalStatusCode === 404 || name === "RESOURCE_NOT_FOUND") {
        return new ResourceNotFoundError(error.message, raw);
      }
      if (error.paypalStatusCode === 429 || name === "RATE_LIMIT_REACHED") {
        return new RateLimitError("paypal", error.retryAfterSeconds);
      }
      if (hasIssue(["INSUFFICIENT_FUNDS"])) {
        return new InsufficientFundsError(error.message, raw);
      }
      if (hasIssue(["CARD_EXPIRED"])) {
        return new AuthenticationError(error.message, raw);
      }
      if (hasIssue([
        "INSTRUMENT_DECLINED",
        "CARD_BRAND_NOT_SUPPORTED",
        "CARD_COUNTRY_NOT_SUPPORTED",
        "CARD_TYPE_NOT_SUPPORTED",
        "COMPLIANCE_VIOLATION",
        "DECLINED_DUE_TO_RELATED_TXN",
        "PAYEE_BLOCKED_TRANSACTION",
      ])) {
        return new CardDeclinedError(error.message, raw);
      }
      if (
        error.paypalStatusCode === 400 ||
        error.paypalStatusCode === 422 ||
        name === "INVALID_REQUEST" ||
        name === "MALFORMED_REQUEST" ||
        name === "VALIDATION_ERROR" ||
        name === "UNPROCESSABLE_ENTITY"
      ) {
        return new InvalidRequestError(error.message, [raw]);
      }
    }
    return super.mapError(error);
  }


  /**
   * Verify PayPal webhook signature
   * @see https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
   */
  verifyWebhook(
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): boolean {
    if (!this.paypalConfig.webhookId) {
      this.logger.warn(
        "[PayPal] Webhook verification failed: webhookId not configured",
      );
      return false;
    }

    // Required headers for verification
    const normalizedHeaders = this.normalizeHeaders(
      typeof signatureOrHeaders === "string" ? headers : signatureOrHeaders,
    );
    const transmissionId = normalizedHeaders["paypal-transmission-id"];
    const transmissionTime = normalizedHeaders["paypal-transmission-time"];
    const transmissionSig =
      typeof signatureOrHeaders === "string"
        ? signatureOrHeaders
        : normalizedHeaders["paypal-transmission-sig"];
    const certUrl = normalizedHeaders["paypal-cert-url"];
    const authAlgo = normalizedHeaders["paypal-auth-algo"];

    if (
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      this.logger.warn(
        "[PayPal] Webhook verification failed: missing required headers",
      );
      return false;
    }

    if (!this.isValidWebhookHeaders({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
    })) {
      this.logger.warn(
        "[PayPal] Webhook verification failed: invalid webhook header values",
      );
      return false;
    }

    this.logger.warn(
      "[PayPal] Synchronous verification not supported. Use verifyWebhookAsync for proper verification.",
    );
    return false;
  }

  /**
   * Verify PayPal webhook signature asynchronously
   * This is the recommended method for webhook verification
   */
  async verifyWebhookAsync(
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    if (!this.paypalConfig.webhookId) {
      this.logger.warn(
        "[PayPal] Webhook verification failed: webhookId not configured",
      );
      return false;
    }

    const normalizedHeaders = this.normalizeHeaders(
      typeof signatureOrHeaders === "string" ? headers : signatureOrHeaders,
    );
    const transmissionId = normalizedHeaders["paypal-transmission-id"];
    const transmissionTime = normalizedHeaders["paypal-transmission-time"];
    const transmissionSig =
      typeof signatureOrHeaders === "string"
        ? signatureOrHeaders
        : normalizedHeaders["paypal-transmission-sig"];
    const certUrl = normalizedHeaders["paypal-cert-url"];
    const authAlgo = normalizedHeaders["paypal-auth-algo"];

    if (
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      this.logger.warn("[PayPal] Missing required webhook headers");
      return false;
    }

    if (!this.isValidWebhookHeaders({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
    })) {
      this.logger.warn("[PayPal] Invalid webhook header values");
      return false;
    }

    const verifyRequest: PayPalWebhookVerifyRequest = {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: this.paypalConfig.webhookId,
      webhook_event: payload,
    };

    const response = await withRetry(async () => {
      const verificationResponse = await this.fetchWithAccessToken(
        `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
        (token) => ({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          signal: this.createAbortSignal(),
          body: JSON.stringify(verifyRequest),
        }),
      );

      if (!verificationResponse.ok) {
        const errorData = await this.parseJsonResponse<PayPalOrderResponse>(verificationResponse);
        throw this.createApiError(errorData, verificationResponse.status, verificationResponse.headers);
      }

      return verificationResponse;
    }, isRetryableError);

    const data = await this.parseJsonResponse<PayPalWebhookVerifyResponse>(response);
    if (
      data.verification_status !== "SUCCESS" &&
      data.verification_status !== "FAILURE"
    ) {
      throw this.createMalformedResponseError(
        "Invalid PayPal webhook verification response: missing verification_status",
        data,
      );
    }

    return data.verification_status === "SUCCESS";
  }

  /**
   * Parse PayPal webhook payload into normalized WebhookEvent
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = this.validateWebhookPayload(payload);
    const status = this.mapWebhookStatus(raw.event_type, raw.resource.status);
    if (!status) {
      throw new InvalidRequestError(
        `Unsupported PayPal webhook event: ${raw.event_type}`,
      );
    }

    const webhookAmount = this.extractWebhookAmount(raw);
    if (!webhookAmount && this.webhookEventRequiresAmount(raw.event_type)) {
      throw new InvalidRequestError(
        `PayPal webhook event ${raw.event_type} is missing amount information`,
      );
    }
    const amount = webhookAmount
      ? this.parseAmount(webhookAmount, "webhook")
      : undefined;
    const eventTimestamp = new Date(raw.create_time);
    if (!Number.isFinite(eventTimestamp.getTime())) {
      throw new GatewayApiError(
        "Invalid webhook payload: invalid create_time",
        "paypal",
        raw,
      );
    }

    const paymentId = this.extractWebhookPaymentId(raw);

    // Extract capture ID if available. Refund webhooks identify the refund as
    // resource.id and link back to the affected capture with rel="up".
    const captureId = this.extractWebhookCaptureId(raw);
    const gatewayPaymentId = captureId ?? raw.resource.id ?? raw.resource.order_id;
    if (!gatewayPaymentId) {
      throw new GatewayApiError(
        "Invalid webhook payload: missing gateway payment identifier",
        "paypal",
        raw,
      );
    }
    const gatewayObjectId = raw.resource.id && captureId && captureId !== raw.resource.id
      ? raw.resource.id
      : undefined;

    const event: WebhookEvent = {
      id: raw.id,
      type: raw.event_type,
      gateway: "paypal",
      paymentId,
      gatewayPaymentId,
      gatewayObjectId,
      status,
      timestamp: eventTimestamp,
      rawPayload: raw,
    };

    if (webhookAmount) {
      event.amount = amount;
      // Normalize to uppercase ISO 4217 for cross-gateway consistency.
      event.currency = webhookAmount.currency_code.toUpperCase();
    }

    return event;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate webhook payload structure
   */
  private validateWebhookPayload(payload: unknown): PayPalWebhookPayload {
    if (!payload || typeof payload !== "object") {
      throw new GatewayApiError(
        "Invalid webhook payload: not an object",
        "paypal",
        payload,
      );
    }

    const p = payload as Record<string, unknown>;

    if (typeof p.id !== "string") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing id",
        "paypal",
        payload,
      );
    }

    if (typeof p.event_type !== "string") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing event_type",
        "paypal",
        payload,
      );
    }

    if (typeof p.create_time !== "string") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing create_time",
        "paypal",
        payload,
      );
    }

    if (!p.resource || typeof p.resource !== "object") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing resource",
        "paypal",
        payload,
      );
    }

    const resource = p.resource as Record<string, unknown>;

    if (
      typeof resource.id !== "string" &&
      !PAYPAL_WEBHOOK_EVENTS_WITHOUT_RESOURCE_ID.has(p.event_type)
    ) {
      throw new GatewayApiError(
        "Invalid webhook payload: missing resource.id",
        "paypal",
        payload,
      );
    }

    if (
      typeof resource.status !== "string" &&
      !PAYPAL_WEBHOOK_EVENTS_WITHOUT_RESOURCE_STATUS.has(p.event_type)
    ) {
      throw new GatewayApiError(
        "Invalid webhook payload: missing resource.status",
        "paypal",
        payload,
      );
    }

    return payload as PayPalWebhookPayload;
  }

  private async getPaymentResource(
    gatewayPaymentId: string,
  ): Promise<GatewayPaymentResult> {
    const captureResult = await this.tryGetPaymentResource(
      gatewayPaymentId,
      "capture",
    );

    if (captureResult) {
      return captureResult;
    }

    return this.getAuthorizationResource(gatewayPaymentId);
  }

  private async tryGetPaymentResource(
    gatewayPaymentId: string,
    resourceType: "capture",
  ): Promise<GatewayPaymentResult | undefined> {
    const response = await this.fetchWithAccessToken(
      `${this.baseUrl}/v2/payments/captures/${gatewayPaymentId}`,
      (token) => ({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: this.createAbortSignal(),
      }),
    );

    const data = await this.parseJsonResponse<PayPalPaymentResource>(response);

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw this.createApiError(data, response.status, response.headers);
    }

    this.assertPaymentResource(data, `get ${resourceType}`);

    const relatedIds = data.supplementary_data?.related_ids;
    return {
      success: true,
      gatewayId: data.id,
      orderId: relatedIds?.order_id,
      captureId: data.id,
      authorizationId: relatedIds?.authorization_id,
      status: this.mapResourceStatus(data.status),
      redirectUrl: undefined,
      amount: this.parseAmount(data.amount, `get ${resourceType}`),
      rawResponse: data,
    };
  }

  private async getAuthorizationResource(
    gatewayPaymentId: string,
  ): Promise<GatewayPaymentResult> {
    const response = await this.fetchWithAccessToken(
      `${this.baseUrl}/v2/payments/authorizations/${gatewayPaymentId}`,
      (token) => ({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: this.createAbortSignal(),
      }),
    );

    const data = await this.parseJsonResponse<PayPalPaymentResource>(response);

    if (!response.ok) {
      throw this.createApiError(data, response.status, response.headers);
    }

    this.assertPaymentResource(data, "get authorization");
    const relatedIds = data.supplementary_data?.related_ids;

    return {
      success: true,
      gatewayId: data.id,
      orderId: relatedIds?.order_id,
      captureId: relatedIds?.capture_id,
      authorizationId: data.id,
      status: this.mapResourceStatus(data.status),
      redirectUrl: undefined,
      amount: this.parseAmount(data.amount, "get authorization"),
      rawResponse: data,
    };
  }

  private assertAuthorizeParams(params: CaptureParams): void {
    if (
      params.amount !== undefined ||
      params.currency !== undefined ||
      params.paypalCaptureType !== undefined ||
      params.paypalFinalCapture !== undefined
    ) {
      throw new InvalidRequestError(
        "PayPal authorizePayment only accepts gatewayPaymentId and idempotencyKey",
      );
    }
  }

  /**
   * Get OAuth access token for PayPal API
   * Uses promise-based singleton to prevent race conditions
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    // If there's already a token fetch in progress, wait for it
    if (this.tokenFetchPromise) {
      return this.tokenFetchPromise;
    }

    // Start new token fetch
    this.tokenFetchPromise = this.fetchAccessToken();

    try {
      return await this.tokenFetchPromise;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  private invalidateAccessToken(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  private async fetchWithAccessToken(
    url: string,
    initFactory: (token: string) => RequestInit,
  ): Promise<Response> {
    let token = await this.getAccessToken();
    let response = await this.performFetch(url, initFactory(token));

    if (response.status !== 401) {
      return response;
    }

    this.invalidateAccessToken();
    token = await this.getAccessToken();
    response = await this.performFetch(url, initFactory(token));
    return response;
  }

  /**
   * Fetch new access token from PayPal
   */
  private async fetchAccessToken(): Promise<string> {
    const credentials = btoa(
      `${this.paypalConfig.clientId}:${this.paypalConfig.clientSecret}`,
    );

    const response = await this.performFetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      signal: this.createAbortSignal(),
      body: "grant_type=client_credentials",
    });

    const data = await this.parseJsonResponse<PayPalTokenResponse>(response);

    if (!response.ok) {
      throw new PayPalApiError(
        "Failed to get PayPal access token",
        data,
        response.status,
        this.parseRetryAfterSeconds(response.headers),
      );
    }

    if (typeof data.access_token !== "string" || data.access_token.length === 0) {
      throw this.createMalformedResponseError(
        "Invalid PayPal token response: missing access_token",
        data,
      );
    }

    if (
      typeof data.expires_in !== "number" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    ) {
      throw this.createMalformedResponseError(
        "Invalid PayPal token response: missing expires_in",
        data,
      );
    }

    this.accessToken = data.access_token;
    // Refresh early to avoid using a token that expires mid-request: up to 5
    // minutes early, or half the lifetime for short-lived tokens.
    const refreshSkewSeconds = Math.min(300, Math.floor(data.expires_in / 2));
    this.tokenExpiry = new Date(
      Date.now() + (data.expires_in - refreshSkewSeconds) * 1000,
    );

    return this.accessToken;
  }

  /**
   * Create a structured API error from PayPal response
   */
  private createApiError(
    data: PayPalOrderResponse | PayPalRefundResponse,
    statusCode: number,
    headers?: Headers,
  ): GatewayApiError {
    // Build detailed error message from details array
    let message = data.message ?? data.name ?? "PayPal API error";

    if (data.details && data.details.length > 0) {
      const detailMessages = data.details
        .map((d) => d.description ?? d.issue ?? "Unknown issue")
        .join("; ");
      message = `${message}: ${detailMessages}`;
    }

    return new PayPalApiError(
      message,
      data,
      statusCode,
      headers ? this.parseRetryAfterSeconds(headers) : undefined,
    );
  }

  private createMalformedResponseError(
    message: string,
    rawResponse: unknown,
  ): PayPalApiError {
    return new PayPalApiError(message, rawResponse, 0);
  }

  private async performFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new NetworkError("PayPal network request failed", error);
    }
  }

  private parseRetryAfterSeconds(headers: Headers): number | undefined {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) {
      return undefined;
    }

    const numericRetryAfter = Number(retryAfter);
    if (Number.isFinite(numericRetryAfter) && numericRetryAfter >= 0) {
      return numericRetryAfter;
    }

    const retryDate = new Date(retryAfter);
    const retryAfterSeconds = Math.ceil((retryDate.getTime() - Date.now()) / 1000);
    return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds
      : undefined;
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!text.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return {
        name: response.statusText || "PayPal API error",
        message: text,
      } as T;
    }
  }

  private createJsonHeaders(
    token: string,
    requestId?: string,
    prefer?: "return=minimal" | "return=representation",
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    if (requestId) {
      headers["PayPal-Request-Id"] = requestId;
    }

    if (prefer) {
      headers.Prefer = prefer;
    }

    return headers;
  }

  private getRequestId(
    idempotencyKey: string | undefined,
    maxLength: number,
  ): string {
    const requestId = idempotencyKey ?? crypto.randomUUID();

    if (requestId.length > maxLength) {
      throw new InvalidRequestError(
        `PayPal idempotencyKey must be ${maxLength} characters or fewer for this operation`,
      );
    }

    return requestId;
  }

  private static isValidWebhookId(webhookId: string): boolean {
    return webhookId.length > 0 &&
      webhookId.length <= PAYPAL_WEBHOOK_ID_MAX_LENGTH &&
      PAYPAL_WEBHOOK_ID_PATTERN.test(webhookId);
  }

  private isValidWebhookHeaders(fields: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
  }): boolean {
    if (
      fields.authAlgo.length > PAYPAL_WEBHOOK_HEADER_LIMITS.authAlgo ||
      fields.certUrl.length > PAYPAL_WEBHOOK_HEADER_LIMITS.certUrl ||
      fields.transmissionId.length > PAYPAL_WEBHOOK_HEADER_LIMITS.transmissionId ||
      fields.transmissionSig.length > PAYPAL_WEBHOOK_HEADER_LIMITS.transmissionSig ||
      fields.transmissionTime.length > PAYPAL_WEBHOOK_HEADER_LIMITS.transmissionTime
    ) {
      return false;
    }

    if (!/^[A-Za-z0-9]+$/.test(fields.authAlgo)) {
      return false;
    }

    try {
      new URL(fields.certUrl);
    } catch {
      return false;
    }

    return Number.isFinite(new Date(fields.transmissionTime).getTime());
  }

  private createAbortSignal(): AbortSignal {
    return AbortSignal.timeout(this.paypalConfig.timeoutMs ?? 30_000);
  }

  private normalizeHeaders(
    headers?: Record<string, string>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};

    if (!headers) {
      return normalized;
    }

    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }

    return normalized;
  }

  private assertOrderResponse(
    data: PayPalOrderResponse,
    operation: string,
  ): asserts data is PayPalOrderResponse {
    if (typeof data.id !== "string" || data.id.length === 0) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing id`,
        data,
      );
    }

    if (typeof data.status !== "string" || data.status.length === 0) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing status`,
        data,
      );
    }
  }

  private assertRefundResponse(
    data: PayPalRefundResponse,
  ): asserts data is PayPalRefundResponse {
    if (typeof data.id !== "string" || data.id.length === 0) {
      throw this.createMalformedResponseError(
        "Invalid PayPal refund response: missing id",
        data,
      );
    }

    if (typeof data.status !== "string" || data.status.length === 0) {
      throw this.createMalformedResponseError(
        "Invalid PayPal refund response: missing status",
        data,
      );
    }
  }

  private assertPaymentResource(
    resource: unknown,
    operation: string,
  ): asserts resource is PayPalPaymentResource {
    if (!resource || typeof resource !== "object") {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing payment resource`,
        resource,
      );
    }

    const paymentResource = resource as Partial<PayPalPaymentResource>;
    if (typeof paymentResource.id !== "string" || paymentResource.id.length === 0) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing payment resource id`,
        resource,
      );
    }

    if (typeof paymentResource.status !== "string" || paymentResource.status.length === 0) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing payment resource status`,
        resource,
      );
    }

    this.parseAmount(paymentResource.amount, operation);
  }

  private normalizeCurrencyCode(currency: string): string {
    return currency.toUpperCase();
  }

  private getCustomId(metadata?: Record<string, unknown>): string | undefined {
    const customId = metadata?.paymentId;

    if (customId === undefined) {
      return undefined;
    }

    if (typeof customId !== "string" || customId.length === 0) {
      throw new InvalidRequestError("PayPal metadata.paymentId must be a non-empty string");
    }

    if (customId.length > PAYPAL_CUSTOM_ID_MAX_LENGTH) {
      throw new InvalidRequestError(
        `PayPal metadata.paymentId must be ${PAYPAL_CUSTOM_ID_MAX_LENGTH} characters or fewer`,
      );
    }

    return customId;
  }

  private getCurrencyScale(currency: string): number {
    return PAYPAL_ZERO_DECIMAL_CURRENCIES.has(this.normalizeCurrencyCode(currency))
      ? 0
      : 2;
  }

  private formatAmount(amount: number, currency: string): string {
    const normalizedCurrency = this.normalizeCurrencyCode(currency);
    const scale = this.getCurrencyScale(normalizedCurrency);
    const factor = 10 ** scale;
    const rounded = Math.round(amount * factor) / factor;

    if (Math.abs(amount - rounded) > MONEY_EPSILON) {
      throw new InvalidRequestError(
        `PayPal ${normalizedCurrency} amounts support at most ${scale} decimal place${scale === 1 ? "" : "s"}`,
      );
    }

    return rounded.toFixed(scale);
  }

  private parseAmount(amount: unknown, operation: string): number {
    if (!amount || typeof amount !== "object") {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing amount`,
        amount,
      );
    }

    const money = amount as Partial<PayPalMoney>;
    if (typeof money.currency_code !== "string" || money.currency_code.length !== 3) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing amount currency`,
        amount,
      );
    }

    if (typeof money.value !== "string" || money.value.length === 0) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: missing amount value`,
        amount,
      );
    }

    const parsedAmount = Number(money.value);
    if (!Number.isFinite(parsedAmount)) {
      throw this.createMalformedResponseError(
        `Invalid PayPal ${operation} response: invalid amount value`,
        amount,
      );
    }

    return parsedAmount;
  }

  private extractWebhookAmount(raw: PayPalWebhookPayload): {
    currency_code: string;
    value: string;
  } | undefined {
    return raw.resource.amount ??
      raw.resource.purchase_units?.[0]?.payments?.captures?.[0]?.amount ??
      raw.resource.purchase_units?.[0]?.amount;
  }

  private extractWebhookPaymentId(raw: PayPalWebhookPayload): string | undefined {
    if (raw.resource_type === "refund" || raw.event_type.startsWith("PAYMENT.REFUND.")) {
      return raw.resource.purchase_units?.[0]?.custom_id ??
        raw.resource.purchase_units?.[0]?.reference_id;
    }

    return raw.resource.custom_id ??
      raw.resource.purchase_units?.[0]?.custom_id ??
      raw.resource.purchase_units?.[0]?.reference_id;
  }

  private webhookEventRequiresAmount(eventType: string): boolean {
    return !PAYPAL_WEBHOOK_EVENTS_WITHOUT_AMOUNT.has(eventType);
  }

  private extractWebhookCaptureId(raw: PayPalWebhookPayload): string | undefined {
    return raw.resource.supplementary_data?.related_ids?.capture_id ??
      raw.resource.purchase_units?.[0]?.payments?.captures?.[0]?.id ??
      this.extractLinkedCaptureId(raw.resource.links);
  }

  private extractLinkedCaptureId(
    links?: Array<{ href: string; rel: string }>,
  ): string | undefined {
    const upLink = links?.find((link) => link.rel === "up");
    if (!upLink) {
      return undefined;
    }

    try {
      const url = new URL(upLink.href);
      const match = url.pathname.match(/\/v2\/payments\/captures\/([^/]+)$/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  /**
   * Map PayPal order status to unified PaymentStatus
   */
  private mapStatus(paypalStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      CREATED: "pending",
      SAVED: "pending",
      APPROVED: "approved",
      VOIDED: "cancelled",
      COMPLETED: "paid",
      PAYER_ACTION_REQUIRED: "pending",
    };

    return statusMap[paypalStatus] ?? "pending";
  }

  /**
   * Map PayPal resource status to unified PaymentStatus
   */
  private mapResourceStatus(status: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      CREATED: "authorized",
      APPROVED: "authorized",
      COMPLETED: "paid",
      CAPTURED: "paid",
      PARTIALLY_CAPTURED: "partially_captured",
      DENIED: "failed",
      DECLINED: "failed",
      PARTIALLY_REFUNDED: "partially_refunded",
      PENDING: "pending",
      REFUNDED: "refunded",
      REVERSED: "reversed",
      FAILED: "failed",
      VOIDED: "cancelled",
      EXPIRED: "cancelled",
    };

    return statusMap[status] ?? "pending";
  }

  private mapRefundStatus(status: string): PayPalRefundStatus {
    const statusMap: Record<string, PayPalRefundStatus> = {
      COMPLETED: "completed",
      PENDING: "pending",
      FAILED: "failed",
      CANCELLED: "failed",
    };

    return statusMap[status] ?? "pending";
  }

  private mapWebhookStatus(
    eventType: string,
    resourceStatus?: string,
  ): PaymentStatus | undefined {
    if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
      const resourceMappedStatus = resourceStatus
        ? this.mapResourceStatus(resourceStatus)
        : undefined;

      return resourceMappedStatus === "partially_refunded" ||
        resourceMappedStatus === "refunded"
        ? resourceMappedStatus
        : "refunded";
    }

    const eventStatusMap: Record<string, PaymentStatus> = {
      "CHECKOUT.ORDER.APPROVED": "approved",
      "CHECKOUT.ORDER.COMPLETED": "paid",
      "CHECKOUT.PAYMENT-APPROVAL.REVERSED": "cancelled",
      "PAYMENT.AUTHORIZATION.CREATED": "authorized",
      "PAYMENT.AUTHORIZATION.CAPTURED": "paid",
      "PAYMENT.AUTHORIZATION.PARTIALLY_CAPTURED": "partially_captured",
      "PAYMENT.AUTHORIZATION.VOIDED": "cancelled",
      "PAYMENT.CAPTURE.COMPLETED": "paid",
      "PAYMENT.CAPTURE.DENIED": "failed",
      "PAYMENT.CAPTURE.DECLINED": "failed",
      "PAYMENT.CAPTURE.PENDING": "pending",
      "PAYMENT.CAPTURE.REVERSED": "reversed",
      "PAYMENT.REFUND.PENDING": "refund_pending",
      "PAYMENT.REFUND.FAILED": "refund_failed",
    };

    return eventStatusMap[eventType] ?? undefined;
  }

  private mapPaymentResultStatus(
    order: PayPalOrderResponse,
    capture?: { status: string },
    authorization?: { status: string },
  ): PaymentStatus {
    if (capture) {
      return this.mapResourceStatus(capture.status);
    }

    if (authorization) {
      return this.mapResourceStatus(authorization.status);
    }

    return this.mapStatus(order.status);
  }
}
