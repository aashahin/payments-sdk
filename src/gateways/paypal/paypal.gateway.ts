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
} from "../../errors";

// ═══════════════════════════════════════════════════════════════════════════════
// PayPal API Response Types
// ═══════════════════════════════════════════════════════════════════════════════

interface PayPalOrderResponse {
  id: string;
  status: string;
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
    payments?: {
      captures?: Array<{
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

const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
} as const;

/**
 * Retry with exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean = () => false,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === RETRY_CONFIG.maxAttempts - 1) {
        throw error;
      }

      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Check if error is retryable (5xx or network errors)
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof GatewayApiError) {
    // Retry on 5xx errors or rate limiting
    const status = error.statusCode;
    return status >= 500 || status === 429;
  }
  // Network errors
  return error instanceof TypeError && error.message.includes("fetch") || error instanceof NetworkError;
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

  constructor(config: PayPalConfig, hooks: HooksManager) {
    super(config, hooks);
    this.paypalConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retrieve order details by ID
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    const { gatewayPaymentId } = params;
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.baseUrl}/v2/checkout/orders/${gatewayPaymentId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const data = (await response.json()) as PayPalOrderResponse;

    if (!response.ok) {
      throw this.createApiError(data);
    }

    // Extract capture info if available
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

    return {
      success: true,
      gatewayId: data.id,
      status: this.mapStatus(data.status),
      redirectUrl: undefined,
      amount: capture ? parseFloat(capture.amount.value) : undefined,
      rawResponse: data,
    };
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
      return withRetry(async () => {
        const token = await this.getAccessToken();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        // Add idempotency key if provided
        if (p.idempotencyKey) {
          headers["PayPal-Request-Id"] = p.idempotencyKey;
        }

        const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: p.orderId,
                description: p.description,
                custom_id: p.metadata?.paymentId as string | undefined,
                amount: {
                  currency_code: p.currency,
                  value: p.amount.toFixed(2),
                },
              },
            ],
            application_context: {
              return_url: p.returnUrl ?? p.callbackUrl,
              cancel_url: p.cancelUrl ?? p.callbackUrl,
              user_action: "PAY_NOW",
            },
          }),
        });

        const data = (await response.json()) as PayPalOrderResponse;

        if (!response.ok) {
          throw this.createApiError(data);
        }

        // Find approval URL
        const approvalLink = data.links?.find((link) => link.rel === "approve");

        return {
          success: true,
          gatewayId: data.id,
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
      return withRetry(async () => {
        const token = await this.getAccessToken();

        const response = await fetch(
          `${this.baseUrl}/v2/checkout/orders/${p.gatewayPaymentId}/capture`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const data = (await response.json()) as PayPalOrderResponse;

        if (!response.ok) {
          throw this.createApiError(data);
        }

        // Extract capture details
        const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

        return {
          success: true,
          gatewayId: data.id,
          status: this.mapStatus(data.status),
          redirectUrl: undefined,
          amount: capture ? parseFloat(capture.amount.value) : undefined,
          // Include capture ID for downstream refund use
          rawResponse: {
            ...data,
            captureId: capture?.id,
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
      return withRetry(async () => {
        const token = await this.getAccessToken();

        // Build refund body
        const body: Record<string, unknown> = {};

        if (p.amount !== undefined) {
          if (!p.currency) {
            throw new GatewayApiError(
              "Currency is required for partial PayPal refunds",
              "paypal",
              { hint: "Provide currency in RefundParams" },
            );
          }
          body.amount = {
            value: p.amount.toFixed(2),
            currency_code: p.currency,
          };
        }

        if (p.reason) {
          body.note_to_payer = p.reason;
        }

        const response = await fetch(
          `${this.baseUrl}/v2/payments/captures/${p.gatewayPaymentId}/refund`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: Object.keys(body).length > 0 ? JSON.stringify(body) : null,
          },
        );

        const data = (await response.json()) as PayPalRefundResponse;

        if (!response.ok) {
          throw this.createApiError(data);
        }

        return {
          success: true,
          gatewayRefundId: data.id,
          status: data.status === "COMPLETED" ? "completed" : "pending",
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
      return withRetry(async () => {
        const token = await this.getAccessToken();

        const response = await fetch(
          `${this.baseUrl}/v2/payments/authorizations/${p.gatewayPaymentId}/void`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
        );

        // PayPal returns 204 No Content on successful void
        if (response.status === 204) {
          return {
            success: true,
            gatewayId: p.gatewayPaymentId,
            status: "cancelled" as PaymentStatus,
            redirectUrl: undefined,
            rawResponse: null,
          };
        }

        // If not 204, try to parse the response for error details
        const data = (await response.json()) as PayPalOrderResponse;

        if (!response.ok) {
          throw this.createApiError(data);
        }

        return {
          success: true,
          gatewayId: data.id ?? p.gatewayPaymentId,
          status: this.mapStatus(data.status ?? "VOIDED"),
          redirectUrl: undefined,
          rawResponse: data,
        };
      }, isRetryableError);
    }, VoidParamsSchema);
  }

  /**
   * Map PayPal errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "paypal") {
      const raw = error.rawError as {
        name?: string;
        details?: Array<{ issue?: string }>;
      };
      const name = raw?.name;
      const issue = raw?.details?.[0]?.issue;

      if (name === "UNPROCESSABLE_ENTITY") {
        if (issue?.includes("INSTRUMENT_DECLINED")) {
          return new CardDeclinedError(error.message, raw);
        }
        if (issue?.includes("INSUFFICIENT_FUNDS")) {
          return new InsufficientFundsError(error.message, raw);
        }
      }
      if (name === "RATE_LIMIT_REACHED") {
        return new RateLimitError("paypal");
      }
      if (name === "INVALID_REQUEST") {
        return new InvalidRequestError(error.message, [raw]);
      }
      if (name === "AUTHENTICATION_FAILURE") {
        return new AuthenticationError(error.message, raw);
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
    signature?: string,
    headers?: Record<string, string>,
  ): boolean {
    // If no webhookId configured, warn and skip verification
    if (!this.paypalConfig.webhookId) {
      console.warn(
        "[PayPal] Webhook verification skipped: webhookId not configured",
      );
      return true;
    }

    // Required headers for verification
    const transmissionId = headers?.["paypal-transmission-id"];
    const transmissionTime = headers?.["paypal-transmission-time"];
    const transmissionSig = signature ?? headers?.["paypal-transmission-sig"];
    const certUrl = headers?.["paypal-cert-url"];
    const authAlgo = headers?.["paypal-auth-algo"];

    if (
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      console.warn(
        "[PayPal] Webhook verification failed: missing required headers",
      );
      return false;
    }

    // Synchronous verification is not possible with PayPal's API
    // Return true here and verify asynchronously in webhook handler
    // The caller should use verifyWebhookAsync for actual verification
    console.warn(
      "[PayPal] Synchronous verification not supported. Use verifyWebhookAsync for proper verification.",
    );
    return true;
  }

  /**
   * Verify PayPal webhook signature asynchronously
   * This is the recommended method for webhook verification
   */
  async verifyWebhookAsync(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<boolean> {
    if (!this.paypalConfig.webhookId) {
      console.warn(
        "[PayPal] Webhook verification skipped: webhookId not configured",
      );
      return true;
    }

    const transmissionId = headers["paypal-transmission-id"];
    const transmissionTime = headers["paypal-transmission-time"];
    const transmissionSig = headers["paypal-transmission-sig"];
    const certUrl = headers["paypal-cert-url"];
    const authAlgo = headers["paypal-auth-algo"];

    if (
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      console.warn("[PayPal] Missing required webhook headers");
      return false;
    }

    try {
      const token = await this.getAccessToken();

      const verifyRequest: PayPalWebhookVerifyRequest = {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: this.paypalConfig.webhookId,
        webhook_event: payload,
      };

      const response = await fetch(
        `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(verifyRequest),
        },
      );

      if (!response.ok) {
        console.error(
          "[PayPal] Webhook verification API error:",
          response.status,
        );
        return false;
      }

      const data = (await response.json()) as PayPalWebhookVerifyResponse;
      return data.verification_status === "SUCCESS";
    } catch (error) {
      console.error("[PayPal] Webhook verification failed:", error);
      return false;
    }
  }

  /**
   * Parse PayPal webhook payload into normalized WebhookEvent
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = this.validateWebhookPayload(payload);

    // Safely extract amount with fallback
    const amount = raw.resource.amount
      ? parseFloat(raw.resource.amount.value)
      : 0;

    const currency = raw.resource.amount?.currency_code ?? "USD";

    // Extract payment ID from multiple possible locations
    const paymentId =
      raw.resource.custom_id ?? raw.resource.purchase_units?.[0]?.custom_id;

    // Extract capture ID if available
    const captureId =
      raw.resource.supplementary_data?.related_ids?.capture_id ??
      raw.resource.purchase_units?.[0]?.payments?.captures?.[0]?.id;

    return {
      id: raw.id,
      type: raw.event_type,
      gateway: "paypal",
      paymentId,
      gatewayPaymentId: captureId ?? raw.resource.id,
      status: this.mapResourceStatus(raw.resource.status),
      amount,
      currency,
      timestamp: new Date(raw.create_time),
      rawPayload: raw,
    };
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

    if (!p.resource || typeof p.resource !== "object") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing resource",
        "paypal",
        payload,
      );
    }

    const resource = p.resource as Record<string, unknown>;

    if (typeof resource.id !== "string") {
      throw new GatewayApiError(
        "Invalid webhook payload: missing resource.id",
        "paypal",
        payload,
      );
    }

    return payload as PayPalWebhookPayload;
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

  /**
   * Fetch new access token from PayPal
   */
  private async fetchAccessToken(): Promise<string> {
    const credentials = btoa(
      `${this.paypalConfig.clientId}:${this.paypalConfig.clientSecret}`,
    );

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials",
    });

    const data = (await response.json()) as PayPalTokenResponse;

    if (!response.ok) {
      throw new GatewayApiError(
        "Failed to get PayPal access token",
        "paypal",
        data,
      );
    }

    this.accessToken = data.access_token;
    // Token expires in `expires_in` seconds, refresh 5 minutes early
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);

    return this.accessToken;
  }

  /**
   * Create a structured API error from PayPal response
   */
  private createApiError(
    data: PayPalOrderResponse | PayPalRefundResponse,
  ): GatewayApiError {
    // Build detailed error message from details array
    let message = data.message ?? data.name ?? "PayPal API error";

    if (data.details && data.details.length > 0) {
      const detailMessages = data.details
        .map((d) => d.description ?? d.issue ?? "Unknown issue")
        .join("; ");
      message = `${message}: ${detailMessages}`;
    }

    // Note: GatewayApiError uses fixed 502 statusCode from base class
    return new GatewayApiError(message, "paypal", data);
  }

  /**
   * Map PayPal order status to unified PaymentStatus
   */
  private mapStatus(paypalStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      CREATED: "pending",
      SAVED: "pending",
      APPROVED: "authorized",
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
      COMPLETED: "paid",
      DECLINED: "failed",
      PARTIALLY_REFUNDED: "partially_refunded",
      PENDING: "pending",
      REFUNDED: "refunded",
      FAILED: "failed",
    };

    return statusMap[status] ?? "pending";
  }
}
