// file: packages/payments/src/gateways/moyasar.gateway.ts

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { BaseGateway } from "../base.gateway";
import type {
  CaptureParams,
  CreatePaymentParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  MoyasarConfirmStcPayOtpParams,
  MoyasarCreatePaymentParams,
  PaymentStatus,
  RefundParams,
  VoidParams,
} from "../../types/payment.types";
import type {
  MoyasarWebhookPayload,
  WebhookEvent,
} from "../../types/webhook.types";
import type { MoyasarConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import type { MoyasarPaymentSource } from "../../types/moyasar-source.types";
import {
  MoyasarCreatePaymentParamsSchema,
  MoyasarCaptureParamsSchema,
  MoyasarRefundParamsSchema,
  MoyasarVoidParamsSchema,
  MoyasarGetPaymentParamsSchema,
} from "../../types/validation";
import {
  GatewayApiError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
  InvalidWebhookError,
  ResourceNotFoundError,
} from "../../errors";
import { withRetry, parseRetryAfterSeconds } from "../../utils/retry";
import {
  type IdempotencyStore,
  fingerprintParams,
} from "../../utils/idempotency";
import type { Logger } from "../../utils/logger";

/**
 * Moyasar has no native idempotency for capture/refund/void, so transient
 * failures are only retried when an idempotency key (and dedupe store) make a
 * retry safe. Network errors and 5xx/429 responses are considered transient.
 */
function isMoyasarRetryableError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof GatewayApiError) {
    const status = (error.rawError as { status?: number } | undefined)?.status;
    return typeof status === "number" && (status >= 500 || status === 429);
  }
  return false;
}

const NEVER_RETRY = () => false;

// ═══════════════════════════════════════════════════════════════════════════════
// Moyasar API Types (matching official OpenAPI spec)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Moyasar payment status values from official API
 * @see https://docs.moyasar.com/api/payments/08-payment-status-reference
 */
type MoyasarPaymentStatus =
  | "initiated"
  | "paid"
  | "authorized"
  | "failed"
  | "abandoned"
  | "refunded"
  | "captured"
  | "voided"
  | "verified";

/**
 * Moyasar card company/scheme
 */
type MoyasarCardCompany = "mada" | "visa" | "master" | "amex";

/**
 * Moyasar payment source type
 */
type MoyasarSourceType =
  | "creditcard"
  | "applepay"
  | "samsungpay"
  | "stcpay"
  | "token";

const DEFAULT_TIMEOUT_MS = 30_000;
const MOYASAR_MAX_METADATA_VALUE_LENGTH = 500;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/**
 * Full Moyasar payment response matching official OpenAPI spec
 */
interface MoyasarPaymentResponse {
  /** Payment ID (UUID) */
  id: string;
  /** Payment status */
  status: MoyasarPaymentStatus;
  /** Amount in smallest currency unit (halalas/fils) */
  amount: number;
  /** Fee charged by Moyasar (in smallest unit, includes VAT) */
  fee: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Amount refunded so far (in smallest unit) */
  refunded: number;
  /** Amount captured so far (in smallest unit) */
  captured: number;
  /** Formatted amount with currency (e.g., "100 SAR") */
  amount_format: string;
  /** Formatted fee */
  fee_format: string;
  /** Formatted refunded amount */
  refunded_format: string;
  /** Formatted captured amount */
  captured_format: string;
  /** Customer IP address */
  ip: string | null;
  /** Payment creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Refund timestamp (null if not refunded) */
  refunded_at: string | null;
  /** Capture timestamp (null if not captured) */
  captured_at: string | null;
  /** Void timestamp (null if not voided) */
  voided_at: string | null;
  /** Payment description */
  description: string | null;
  /** Associated invoice ID */
  invoice_id: string | null;
  /** Callback URL for redirects */
  callback_url: string | null;
  /** User-provided metadata */
  metadata: Record<string, unknown>;
  /** Payment source details */
  source: {
    /** Source type */
    type: MoyasarSourceType;
    /** Card scheme (for card payments) */
    company?: MoyasarCardCompany;
    /** Cardholder name */
    name?: string | null;
    /** Masked card number */
    number?: string;
    /** Gateway reference ID */
    gateway_id?: string;
    /** Token for future payments */
    token?: string | null;
    /** Response message from processor */
    message?: string | null;
    /** 3DS challenge URL (for initiated payments) */
    transaction_url?: string | null;
    /** Retrieval Reference Number (RRN) */
    reference_number?: string | null;
    /** Authorization response code */
    response_code?: string | null;
    /** Authorization code from issuer */
    authorization_code?: string | null;
  };
}

/**
 * Moyasar API error response
 */
interface MoyasarErrorResponse {
  /** Error type category */
  type:
  | "invalid_request"
  | "invalid_request_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "api_connection_error"
  | "account_inactive_error"
  | "api_error"
  | "record_not_found"
  | "3ds_auth_error";
  /** Error message */
  message: string;
  /** Detailed validation errors (field -> messages) */
  errors?: Record<string, string[]>;
}

/**
 * Moyasar payment gateway implementation
 * @see https://docs.moyasar.com/api/api-introduction
 */
export class MoyasarGateway extends BaseGateway {
  readonly name = "moyasar" as const;

  private readonly baseUrl = "https://api.moyasar.com/v1";
  private readonly moyasarConfig: MoyasarConfig;

  constructor(config: MoyasarConfig, hooks: HooksManager, logger?: Logger) {
    super(config, hooks, logger);
    this.moyasarConfig = config;
  }

  /**
   * Guard a non-idempotent mutation (refund/capture/void) with an injectable
   * dedupe store, keyed by idempotencyKey + operation + paymentId. Moyasar has
   * no native idempotency for these endpoints, so this prevents a retried
   * mutation from being applied twice (e.g. a double refund).
   *
   * Behavior:
   * - No idempotencyKey or no store configured: runs once, unguarded.
   * - Already completed for this key: returns the cached result (no API call).
   * - In progress / outcome unknown for this key: refuses, instead of risking
   *   a duplicate mutation.
   * - Definite failure (4xx, validation): clears the reservation so the caller
   *   can safely retry. Transient/indeterminate failures (network, 5xx) keep an
   *   "unknown" marker so the operation is never silently re-applied.
   */
  private async runIdempotentMutation<R>(
    operation: "capturePayment" | "refundPayment" | "voidPayment",
    paymentId: string,
    idempotencyKey: string | undefined,
    fingerprintInput: unknown,
    executor: () => Promise<R>,
  ): Promise<R> {
    const store: IdempotencyStore | undefined = this.moyasarConfig.idempotencyStore;
    if (!idempotencyKey || !store) {
      return executor();
    }

    const key = `moyasar:${operation}:${paymentId}:${idempotencyKey}`;
    const fingerprint = fingerprintParams(fingerprintInput);
    const createdAt = Date.now();

    const existing = store.reserve
      ? await store.reserve(key, { status: "in_progress", fingerprint, createdAt })
      : await this.reserveWithoutAtomicSupport(store, key, fingerprint, createdAt);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new InvalidRequestError(
          `Moyasar ${operation} idempotencyKey was reused with different parameters`,
          [{ path: ["idempotencyKey"] }],
        );
      }
      if (existing.status === "completed") {
        return existing.result as R;
      }
      throw new InvalidRequestError(
        `Moyasar ${operation} with this idempotencyKey is already in progress or its outcome is unknown; resolve it before retrying`,
        [{ path: ["idempotencyKey"] }],
      );
    }

    try {
      const result = await executor();
      await store.set(key, {
        status: "completed",
        fingerprint,
        createdAt: Date.now(),
        result,
      });
      return result;
    } catch (error) {
      if (isMoyasarRetryableError(error)) {
        // Outcome is indeterminate: the request may have mutated server-side.
        // Keep a marker so a later retry refuses rather than double-applying.
        await store.set(key, { status: "unknown", fingerprint, createdAt: Date.now() });
      } else {
        // Definite failure: clear the reservation so a retry is allowed.
        await store.delete(key);
      }
      throw error;
    }
  }

  private async reserveWithoutAtomicSupport(
    store: IdempotencyStore,
    key: string,
    fingerprint: string,
    createdAt: number,
  ) {
    const existing = await store.get(key);
    if (existing) {
      return existing;
    }
    await store.set(key, { status: "in_progress", fingerprint, createdAt });
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment using Moyasar's Payment API
   * Supports: creditcard, token, applepay, samsungpay, stcpay
   * @see https://docs.moyasar.com/api/payments/01-create-payment
   */
  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;
  async createPayment(params: MoyasarCreatePaymentParams): Promise<GatewayPaymentResult>;
  async createPayment(
    params: CreatePaymentParams | MoyasarCreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Build source payload from moyasarSource or legacy tokenId
      const sourcePayload = this.buildSourcePayload(p);
      const requiresCallback =
        sourcePayload.type === "creditcard" || sourcePayload.type === "token";

      if (requiresCallback && !p.callbackUrl) {
        throw new InvalidRequestError(
          "callbackUrl is required for Moyasar creditcard and token payments",
        );
      }

      const metadata = this.buildPaymentMetadata(p);
      const requestBody: Record<string, unknown> = {
        amount: this.toMinorUnits(p.amount, p.currency),
        currency: p.currency,
        description: p.description ?? "Payment",
        source: sourcePayload,
      };

      if (metadata !== undefined) {
        requestBody.metadata = metadata;
      }

      if (p.callbackUrl) {
        requestBody.callback_url = p.callbackUrl;
      }

      // Add idempotency key (becomes the payment ID)
      if (p.idempotencyKey) {
        requestBody.given_id = p.idempotencyKey;
      }

      // Add coupon flag if specified
      if (p.applyCoupon !== undefined) {
        requestBody.apply_coupon = p.applyCoupon;
      }

      if ("splits" in p && p.splits !== undefined) {
        requestBody.splits = p.splits;
      }

      if ("recipient" in p && p.recipient !== undefined) {
        requestBody.recipient = p.recipient;
      }

      if ("sender" in p && p.sender !== undefined) {
        requestBody.sender = p.sender;
      }

      // Only retry create on transient errors when given_id (idempotencyKey)
      // is present, so Moyasar deduplicates a re-sent request.
      const data = (await withRetry(
        () =>
          this.requestJson("/payments", {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(requestBody),
          }, "Failed to create payment"),
        { isRetryable: p.idempotencyKey ? isMoyasarRetryableError : NEVER_RETRY },
      )) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, MoyasarCreatePaymentParamsSchema);
  }

  /**
   * Build the source payload for Moyasar API from our typed source or legacy tokenId
   */
  private buildSourcePayload(
    params: MoyasarCreatePaymentParams | CreatePaymentParams,
  ): Record<string, unknown> {
    // Prefer new moyasarSource if provided
    if (params.moyasarSource) {
      return this.mapMoyasarSource(params.moyasarSource, params.capture);
    }

    // Fallback to legacy tokenId
    if (params.tokenId) {
      if (!params.tokenId.startsWith("token_")) {
        throw new InvalidRequestError(
          "Moyasar tokenId must start with token_",
        );
      }

      const sourcePayload: Record<string, unknown> = {
        type: "token",
        token: params.tokenId,
      };

      if (params.capture === false) {
        sourcePayload.manual = true;
      }

      return sourcePayload;
    }

    throw new InvalidRequestError(
      "Either moyasarSource or tokenId must be provided for Moyasar payments",
    );
  }

  private buildPaymentMetadata(
    params: MoyasarCreatePaymentParams | CreatePaymentParams,
  ): Record<string, string> | undefined {
    const metadata = {
      ...(params.metadata as Record<string, string> | undefined),
    };

    if (params.orderId) {
      if (params.orderId.length > MOYASAR_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Moyasar orderId must be ${MOYASAR_MAX_METADATA_VALUE_LENGTH} characters or fewer because it is stored in metadata`,
        );
      }
      metadata.orderId ??= params.orderId;
      metadata.paymentId ??= params.orderId;
    }

    return this.validatePaymentMetadata(metadata);
  }

  private validatePaymentMetadata(
    metadata: Record<string, string>,
  ): Record<string, string> | undefined {
    const entries = Object.entries(metadata);

    if (entries.length === 0) {
      return undefined;
    }

    if (entries.length > 30) {
      throw new InvalidRequestError(
        "Moyasar metadata can include at most 30 keys",
      );
    }

    for (const [key, value] of entries) {
      if (key.length > 40) {
        throw new InvalidRequestError(
          `Moyasar metadata key "${key}" must be 40 characters or fewer`,
        );
      }

      if (typeof value !== "string") {
        throw new InvalidRequestError(
          `Moyasar metadata value for "${key}" must be a string`,
        );
      }

      if (value.length > MOYASAR_MAX_METADATA_VALUE_LENGTH) {
        throw new InvalidRequestError(
          `Moyasar metadata value for "${key}" must be ${MOYASAR_MAX_METADATA_VALUE_LENGTH} characters or fewer`,
        );
      }
    }

    return metadata;
  }

  /**
   * Map our typed MoyasarPaymentSource to Moyasar API payload
   */
  private mapMoyasarSource(
    source: MoyasarPaymentSource,
    capture?: boolean,
  ): Record<string, unknown> {
    const manual =
      "manualCapture" in source && source.manualCapture !== undefined
        ? source.manualCapture
        : capture === false
          ? true
          : undefined;

    switch (source.type) {
      case "creditcard":
        throw new InvalidRequestError(
          "Moyasar raw creditcard source is not supported by this backend SDK. Use Moyasar.js tokenization, Apple Pay, Samsung Pay, or STC Pay so cardholder data is sent directly to Moyasar.",
        );

      case "token":
        return {
          type: "token",
          token: source.token,
          ...(source.cvc && { cvc: source.cvc }),
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
          ...(source._3ds !== undefined && { "3ds": source._3ds }),
          ...(manual !== undefined && { manual }),
        };

      case "applepay":
        // Check if this is an encrypted token or decrypted DPAN
        if ("token" in source && source.token) {
          return {
            type: "applepay",
            token: source.token,
            ...(manual !== undefined && { manual }),
            ...(source.saveCard !== undefined && {
              save_card: source.saveCard,
            }),
            ...(source.statementDescriptor && {
              statement_descriptor: source.statementDescriptor,
            }),
          };
        }
        // Decrypted Apple Pay token (DPAN)
        if ("dpan" in source) {
          return {
            type: "applepay",
            number: source.dpan,
            month: source.month,
            year: source.year,
            cryptogram: source.cryptogram,
            device_id: source.deviceId,
            ...(source.lastFour && { last_four: source.lastFour }),
            ...(source.eci && { eci: source.eci }),
          };
        }
        throw new GatewayApiError(
          "Invalid Apple Pay source: must have either token or dpan",
          "moyasar",
          { code: "INVALID_APPLEPAY_SOURCE" },
        );

      case "samsungpay":
        return {
          type: "samsungpay",
          token: source.token,
          ...(manual !== undefined && { manual }),
          ...(source.saveCard !== undefined && { save_card: source.saveCard }),
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
        };

      case "stcpay":
        return {
          type: "stcpay",
          mobile: source.mobile,
          ...(source.cashier && { cashier: source.cashier }),
          ...(source.branch && { branch: source.branch }),
        };

      default:
        // Exhaustive check - TypeScript will error if we miss a case
        const _exhaustiveCheck: never = source;
        throw new GatewayApiError(
          `Unknown payment source type: ${(source as Record<string, unknown>).type}`,
          "moyasar",
          { code: "UNKNOWN_SOURCE_TYPE" },
        );
    }
  }

  /**
   * Capture an authorized payment
   * @see https://docs.moyasar.com/api/payments/06-capture-payment
   * @note Moyasar auto-captures by default, so this is only needed for manual capture flows
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      const requestBody: Record<string, unknown> = {};

      // Only include amount for partial captures
      if (p.amount !== undefined) {
        if (!p.currency) {
          throw new InvalidRequestError(
            "currency is required for Moyasar partial captures so the amount can be converted to minor units correctly",
          );
        }
        requestBody.amount = this.toMinorUnits(p.amount, p.currency);
      }

      const init: RequestInit = {
        method: "POST",
        headers: this.getHeaders(),
      };
      if (Object.keys(requestBody).length > 0) {
        init.body = JSON.stringify(requestBody);
      }

      return this.runIdempotentMutation(
        "capturePayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        { amount: p.amount, currency: p.currency },
        async () => {
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "capture"),
            init,
            "Failed to capture payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          return this.mapPaymentResponse(data as MoyasarPaymentResponse);
        },
      );
    }, MoyasarCaptureParamsSchema);
  }

  /**
   * Refund a payment (full or partial)
   * @see https://docs.moyasar.com/api/payments/05-refund-payment
   * @note Moyasar returns the updated payment object, not a separate refund entity
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const requestBody: Record<string, unknown> = {};

      // Only include amount for partial refunds
      if (p.amount !== undefined) {
        if (!p.currency) {
          throw new InvalidRequestError(
            "currency is required for Moyasar partial refunds so the amount can be converted to minor units correctly",
          );
        }
        requestBody.amount = this.toMinorUnits(p.amount, p.currency);
      }

      const init: RequestInit = {
        method: "POST",
        headers: this.getHeaders(),
      };
      if (Object.keys(requestBody).length > 0) {
        init.body = JSON.stringify(requestBody);
      }

      return this.runIdempotentMutation(
        "refundPayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        { amount: p.amount, currency: p.currency },
        async () => {
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "refund"),
            init,
            "Failed to refund payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          const payment = data as MoyasarPaymentResponse;

          // Moyasar returns the payment object with updated refund info.
          // There's no separate refund ID - refund is tracked on the payment.
          return {
            success: true,
            gatewayRefundId: payment.id, // Payment ID (refund is tracked on payment)
            status: payment.status === "refunded" ? "completed" : "pending",
            totalRefunded: this.fromMinorUnits(payment.refunded, payment.currency),
            refundedAt: payment.refunded_at
              ? new Date(payment.refunded_at)
              : undefined,
            rawResponse: payment,
          } satisfies GatewayRefundResult;
        },
      );
    }, MoyasarRefundParamsSchema);
  }

  /**
   * Void an authorized payment
   * @see https://docs.moyasar.com/api/payments/07-void-payment
   * @note Only works for authorized (not yet captured) payments
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      return this.runIdempotentMutation(
        "voidPayment",
        p.gatewayPaymentId,
        p.idempotencyKey,
        {},
        async () => {
          const data = (await this.requestJson(
            this.paymentPath(p.gatewayPaymentId, "void"),
            {
              method: "POST",
              headers: this.getHeaders(),
            },
            "Failed to void payment",
          )) as MoyasarPaymentResponse | MoyasarErrorResponse;

          return this.mapPaymentResponse(data as MoyasarPaymentResponse);
        },
      );
    }, MoyasarVoidParamsSchema);
  }

  /**
   * Confirm an initiated STC Pay payment using the OTP sent to the customer.
   * @see https://docs.moyasar.com/guides/stc-pay/custom-ui/
   */
  async confirmStcPayOtp(
    params: MoyasarConfirmStcPayOtpParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("confirmStcPayOtp", params, async (p) => {
      return this.confirmStcPayOtpRequest(p);
    });
  }

  private async confirmStcPayOtpRequest(
    params: MoyasarConfirmStcPayOtpParams,
  ): Promise<GatewayPaymentResult> {
    if (!params.transactionUrl) {
      throw new InvalidRequestError(
        "transactionUrl is required for Moyasar STC Pay OTP confirmation",
      );
    }
    if (
      params.otpValue === "" ||
      params.otpValue === undefined ||
      params.otpValue === null
    ) {
      throw new InvalidRequestError(
        "otpValue is required for Moyasar STC Pay OTP confirmation",
      );
    }

    const transactionUrl = this.assertMoyasarStcTransactionUrl(
      params.transactionUrl,
    );
    const data = (await this.requestJson(transactionUrl, {
      method: "POST",
      headers: this.getHeaders({ auth: false }),
      body: JSON.stringify({ otp_value: params.otpValue }),
    }, "Failed to confirm STC Pay OTP")) as
      | MoyasarPaymentResponse
      | MoyasarErrorResponse;

    const payment = data as MoyasarPaymentResponse;
    return this.mapPaymentResponse(payment);
  }

  /**
   * Map Moyasar errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "moyasar") {
      const raw = error.rawError as { type?: string; message?: string; status?: number };
      const type = raw?.type;
      const message = raw?.message ?? error.message;
      const status = raw?.status;

      switch (type) {
        case "invalid_request":
        case "invalid_request_error":
          return new InvalidRequestError(message);
        case "authentication_error":
        case "authorization_error":
          return new AuthenticationError(message);
        case "rate_limit_error":
          return new RateLimitError("moyasar");
        case "api_connection_error":
          return new NetworkError(message);
        case "record_not_found":
          return new ResourceNotFoundError(message, raw);
        case "3ds_auth_error":
          return new AuthenticationError(message);
      }

      if (status === 400) {
        return new InvalidRequestError(message);
      }
      if (status === 401 || status === 403) {
        return new AuthenticationError(message);
      }
      if (status === 429) {
        return new RateLimitError("moyasar");
      }
      if (status === 404) {
        return new ResourceNotFoundError(message, raw);
      }
    }
    return super.mapError(error);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Moyasar webhook using secret_token in payload
   * @see https://docs.moyasar.com/guides/dashboard/webhooks
   */
  verifyWebhook(payload: unknown, _signature?: string): boolean {
    if (!this.moyasarConfig.webhookSecret) {
      this.logger.warn(
        "[Moyasar] No webhook secret configured, rejecting webhook",
      );
      return false;
    }

    if (!this.isRecord(payload) || typeof payload.secret_token !== "string") {
      return false;
    }

    return this.constantTimeEquals(
      payload.secret_token,
      this.moyasarConfig.webhookSecret,
    );
  }

  /**
   * Parse Moyasar webhook payload into normalized WebhookEvent
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = this.assertMoyasarWebhookPayload(payload);
    const paymentId = this.extractPaymentId(raw.data.metadata);

    return {
      id: raw.id,
      type: this.normalizeWebhookEventType(raw.type),
      gateway: "moyasar",
      paymentId,
      gatewayPaymentId: raw.data.id,
      status: this.mapStatus(raw.data.status),
      amount: this.fromMinorUnits(raw.data.amount, raw.data.currency),
      currency: raw.data.currency,
      timestamp: new Date(raw.created_at),
      rawPayload: raw,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get payment status from Moyasar
   * @see https://docs.moyasar.com/api/payments/02-fetch-payment
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const result = await this.getPayment({ gatewayPaymentId: gatewayId });
    return result.status;
  }

  /**
   * Get full payment details from Moyasar
   * @see https://docs.moyasar.com/api/payments/02-fetch-payment
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("getPayment", params, async (p) => {
      const { gatewayPaymentId } = p;

      // GET is safe to retry unconditionally.
      const data = (await withRetry(
        () =>
          this.requestJson(
            this.paymentPath(gatewayPaymentId),
            {
              method: "GET",
              headers: this.getHeaders(),
            },
            "Failed to get payment",
          ),
        { isRetryable: isMoyasarRetryableError },
      )) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, MoyasarGetPaymentParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get authorization headers for Moyasar API
   * Moyasar uses HTTP Basic Auth with secret key as username
   */
  private getHeaders(options: { auth?: boolean } = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (options.auth !== false) {
      const credentials = btoa(`${this.moyasarConfig.secretKey}:`);
      headers.Authorization = `Basic ${credentials}`;
    }

    return headers;
  }

  /**
   * Map Moyasar payment response to unified GatewayPaymentResult
   * Note: Card and STC Pay challenge URLs are returned in transaction_url
   */
  private mapPaymentResponse(
    payment: MoyasarPaymentResponse,
  ): GatewayPaymentResult {
    const transactionUrl = payment.source?.transaction_url ?? undefined;
    const redirectUrl = payment.source?.type === "stcpay"
      ? undefined
      : transactionUrl;
    const nextAction = this.mapNextAction(payment);

    return {
      success: payment.status !== "failed" && payment.status !== "abandoned",
      gatewayId: payment.id,
      status: this.mapStatus(payment.status),
      redirectUrl,
      ...(nextAction !== undefined ? { nextAction } : {}),
      amount: this.fromMinorUnits(payment.amount, payment.currency),
      fee: this.fromMinorUnits(payment.fee, payment.currency),
      capturedAmount: this.fromMinorUnits(payment.captured, payment.currency),
      refundedAmount: this.fromMinorUnits(payment.refunded, payment.currency),
      rawResponse: payment,
    };
  }

  private toMinorUnits(amount: number, currency: string): number {
    const exponent = this.getCurrencyExponent(currency);
    const minorAmount = amount * 10 ** exponent;
    const roundedMinorAmount = Math.round(minorAmount);

    if (!Number.isSafeInteger(roundedMinorAmount)) {
      throw new InvalidRequestError(
        `Moyasar amount for ${currency.toUpperCase()} is too large to represent safely in minor units`,
      );
    }

    if (roundedMinorAmount < 1) {
      throw new InvalidRequestError(
        `Moyasar amount for ${currency.toUpperCase()} must be at least one minor currency unit`,
      );
    }

    if (Math.abs(minorAmount - roundedMinorAmount) > 1e-8) {
      throw new InvalidRequestError(
        `Moyasar amount for ${currency.toUpperCase()} has more decimal places than the currency supports`,
      );
    }

    return roundedMinorAmount;
  }

  private fromMinorUnits(amount: number, currency: string): number {
    const exponent = this.getCurrencyExponent(currency);
    return amount / 10 ** exponent;
  }

  private getCurrencyExponent(currency: string): number {
    const normalizedCurrency = currency.toUpperCase();
    if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
      return 0;
    }
    if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
      return 3;
    }
    return 2;
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      const length = Math.max(leftBuffer.length, rightBuffer.length);
      const paddedLeft = Buffer.alloc(length);
      const paddedRight = Buffer.alloc(length);
      leftBuffer.copy(paddedLeft);
      rightBuffer.copy(paddedRight);
      timingSafeEqual(paddedLeft, paddedRight);
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private assertMoyasarWebhookPayload(payload: unknown): MoyasarWebhookPayload {
    if (!this.isRecord(payload)) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload");
    }

    const data = payload.data;
    if (!this.isRecord(data)) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload: missing data");
    }

    if (
      typeof payload.id !== "string" ||
      typeof payload.type !== "string" ||
      typeof payload.created_at !== "string" ||
      typeof data.id !== "string" ||
      typeof data.status !== "string" ||
      typeof data.amount !== "number" ||
      typeof data.currency !== "string"
    ) {
      throw new InvalidWebhookError("Invalid Moyasar webhook payload fields");
    }

    return payload as unknown as MoyasarWebhookPayload;
  }

  private extractPaymentId(metadata: unknown): string | undefined {
    if (!this.isRecord(metadata)) {
      return undefined;
    }

    if (typeof metadata.paymentId === "string") {
      return metadata.paymentId;
    }

    return typeof metadata.orderId === "string"
      ? metadata.orderId
      : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private paymentPath(
    paymentId: string,
    operation?: "capture" | "refund" | "void",
  ): string {
    const encodedPaymentId = encodeURIComponent(paymentId);
    return operation
      ? `/payments/${encodedPaymentId}/${operation}`
      : `/payments/${encodedPaymentId}`;
  }

  private normalizeWebhookEventType(type: string): string {
    return type === "payment_faild" ? "payment_failed" : type;
  }

  private async requestJson(
    urlOrPath: string,
    init: RequestInit,
    fallbackMessage: string,
  ): Promise<unknown> {
    const response = await this.request(urlOrPath, init);
    const data = (await this.parseJsonResponse(response)) as
      | MoyasarPaymentResponse
      | MoyasarErrorResponse;

    if (!response.ok) {
      throw this.createApiError(
        data as MoyasarErrorResponse,
        fallbackMessage,
        response.status,
        response.headers,
      );
    }

    return data;
  }

  private async request(urlOrPath: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.moyasarConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = urlOrPath.startsWith("http")
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath}`;

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (e) {
      const errorName = this.isRecord(e) && typeof e.name === "string"
        ? e.name
        : undefined;
      if (errorName === "AbortError") {
        throw new NetworkError("Moyasar API request timed out", e);
      }
      throw new NetworkError("Failed to connect to Moyasar API", e);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (e) {
      throw new GatewayApiError(
        "Moyasar API returned an invalid JSON response",
        "moyasar",
        { status: response.status, cause: e },
      );
    }
  }

  /**
   * Map Moyasar status to unified PaymentStatus
   */
  private mapStatus(moyasarStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      initiated: "pending",
      pending: "pending",
      authorized: "authorized",
      verified: "authorized", // Card verification (0-amount auth)
      captured: "paid",
      paid: "paid",
      abandoned: "failed",
      failed: "failed",
      refunded: "refunded",
      voided: "cancelled",
    };

    return statusMap[moyasarStatus] ?? "pending";
  }

  private mapNextAction(payment: MoyasarPaymentResponse): unknown {
    const transactionUrl = payment.source?.transaction_url;
    if (!transactionUrl || payment.status !== "initiated") {
      return undefined;
    }

    if (payment.source.type === "stcpay") {
      return {
        type: "stcpay_otp",
        transactionUrl,
        method: "POST",
        parameter: "otp_value",
      };
    }

    return {
      type: "redirect",
      url: transactionUrl,
    };
  }

  private assertMoyasarStcTransactionUrl(transactionUrl: string): string {
    let url: URL;
    try {
      url = new URL(transactionUrl);
    } catch {
      throw new InvalidRequestError(
        "Moyasar STC Pay transactionUrl must be a valid URL",
      );
    }

    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.moyasar.com" ||
      !url.pathname.startsWith("/v1/stc_pays/") ||
      !url.pathname.endsWith("/proceed")
    ) {
      throw new InvalidRequestError(
        "Moyasar STC Pay transactionUrl must be the transaction_url returned by Moyasar",
      );
    }

    return url.toString();
  }

  /**
   * Create a structured API error from Moyasar error response
   */
  private createApiError(
    errorData: MoyasarErrorResponse,
    fallbackMessage: string,
    status?: number,
    headers?: Headers,
  ): GatewayApiError {
    let message = errorData.message ?? fallbackMessage;

    // Append validation errors if present
    if (errorData.errors) {
      const errorDetails = Object.entries(errorData.errors)
        .map(([field, messages]) => {
          const detail = Array.isArray(messages)
            ? messages.join(", ")
            : String(messages);
          return `${field}: ${detail}`;
        })
        .join("; ");
      message = `${message} - ${errorDetails}`;
    }

    const error = new GatewayApiError(message, "moyasar", {
      type: errorData.type,
      message,
      errors: errorData.errors,
      status,
    });

    // Expose Retry-After (seconds) so the retry helper can honor it on 429s.
    const retryAfterSeconds = parseRetryAfterSeconds(headers);
    if (retryAfterSeconds !== undefined) {
      (error as GatewayApiError & { retryAfterSeconds?: number }).retryAfterSeconds =
        retryAfterSeconds;
    }

    return error;
  }
}
