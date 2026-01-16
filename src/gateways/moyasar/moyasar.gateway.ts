// file: packages/payments/src/gateways/moyasar.gateway.ts

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
  MoyasarWebhookPayload,
  WebhookEvent,
} from "../../types/webhook.types";
import type { MoyasarConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import type { MoyasarPaymentSource } from "../../types/moyasar-source.types";
import {
  CreatePaymentParamsSchema,
  CaptureParamsSchema,
  RefundParamsSchema,
  VoidParamsSchema,
} from "../../types/validation";
import {
  GatewayApiError,
  CardDeclinedError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NetworkError,
} from "../../errors";

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
    /** STC Pay OTP URL (for stcpay initiated payments) */
    otp_url?: string | null;
  };
}

/**
 * Moyasar API error response
 */
interface MoyasarErrorResponse {
  /** Error type category */
  type:
  | "invalid_request_error"
  | "authentication_error"
  | "rate_limit_error"
  | "api_connection_error"
  | "account_inactive_error"
  | "api_error"
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

  constructor(config: MoyasarConfig, hooks: HooksManager) {
    super(config, hooks);
    this.moyasarConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment using Moyasar's Payment API
   * Supports: creditcard, token, applepay, samsungpay, stcpay
   * @see https://docs.moyasar.com/api/payments/01-create-payment
   */
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Build source payload from moyasarSource or legacy tokenId
      const sourcePayload = this.buildSourcePayload(p);

      const requestBody: Record<string, unknown> = {
        amount: Math.round(p.amount * 100), // Convert to halalas/cents
        currency: p.currency,
        callback_url: p.callbackUrl,
        description: p.description ?? "Payment",
        source: sourcePayload,
        metadata: p.metadata,
      };

      // Add idempotency key (becomes the payment ID)
      if (p.idempotencyKey) {
        requestBody.given_id = p.idempotencyKey;
      }

      // Add coupon flag if specified
      if (p.applyCoupon !== undefined) {
        requestBody.apply_coupon = p.applyCoupon;
      }

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/payments`, {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify(requestBody),
        });
      } catch (e) {
        throw new NetworkError("Failed to connect to Moyasar API", e);
      }

      const data = (await response.json()) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      if (!response.ok) {
        throw this.createApiError(
          data as MoyasarErrorResponse,
          "Failed to create payment",
        );
      }

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, CreatePaymentParamsSchema);
  }

  /**
   * Build the source payload for Moyasar API from our typed source or legacy tokenId
   */
  private buildSourcePayload(
    params: CreatePaymentParams,
  ): Record<string, unknown> {
    // Prefer new moyasarSource if provided
    if (params.moyasarSource) {
      return this.mapMoyasarSource(params.moyasarSource);
    }

    // Fallback to legacy tokenId
    if (params.tokenId) {
      return {
        type: "token",
        token: params.tokenId,
      };
    }

    throw new GatewayApiError(
      "Either moyasarSource or tokenId must be provided for Moyasar payments",
      "moyasar",
      { code: "MISSING_PAYMENT_SOURCE" },
    );
  }

  /**
   * Map our typed MoyasarPaymentSource to Moyasar API payload
   */
  private mapMoyasarSource(
    source: MoyasarPaymentSource,
  ): Record<string, unknown> {
    switch (source.type) {
      case "creditcard":
        return {
          type: "creditcard",
          name: source.name,
          number: source.number,
          month: source.month,
          year: source.year,
          cvc: source.cvc,
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
          ...(source._3ds !== undefined && { "3ds": source._3ds }),
          ...(source.manualCapture !== undefined && {
            manual: source.manualCapture,
          }),
          ...(source.saveCard !== undefined && { save_card: source.saveCard }),
        };

      case "token":
        return {
          type: "token",
          token: source.token,
          ...(source.cvc && { cvc: source.cvc }),
          ...(source.statementDescriptor && {
            statement_descriptor: source.statementDescriptor,
          }),
          ...(source._3ds !== undefined && { "3ds": source._3ds }),
          ...(source.manualCapture !== undefined && {
            manual: source.manualCapture,
          }),
        };

      case "applepay":
        // Check if this is an encrypted token or decrypted DPAN
        if ("token" in source && source.token) {
          return {
            type: "applepay",
            token: source.token,
            ...(source.manualCapture !== undefined && {
              manual: source.manualCapture,
            }),
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
            dpan: source.dpan,
            month: source.month,
            year: source.year,
            cryptogram: source.cryptogram,
            device_id: source.deviceId,
            ...(source.maskedNumber && { masked_number: source.maskedNumber }),
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
          ...(source.manualCapture !== undefined && {
            manual: source.manualCapture,
          }),
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
        requestBody.amount = Math.round(p.amount * 100);
      }

      let response: Response;
      try {
        response = await fetch(
          `${this.baseUrl}/payments/${p.gatewayPaymentId}/capture`,
          {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(requestBody),
          },
        );
      } catch (e) {
        throw new NetworkError("Failed to connect to Moyasar API", e);
      }

      const data = (await response.json()) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      if (!response.ok) {
        throw this.createApiError(
          data as MoyasarErrorResponse,
          "Failed to capture payment",
        );
      }

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, CaptureParamsSchema);
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
        requestBody.amount = Math.round(p.amount * 100);
      }

      let response: Response;
      try {
        response = await fetch(
          `${this.baseUrl}/payments/${p.gatewayPaymentId}/refund`,
          {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(requestBody),
          },
        );
      } catch (e) {
        throw new NetworkError("Failed to connect to Moyasar API", e);
      }

      const data = (await response.json()) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      if (!response.ok) {
        throw this.createApiError(
          data as MoyasarErrorResponse,
          "Failed to refund payment",
        );
      }

      const payment = data as MoyasarPaymentResponse;

      // Moyasar returns the payment object with updated refund info
      // There's no separate refund ID - refund is tracked on the payment
      return {
        success: true,
        gatewayRefundId: payment.id, // Payment ID (refund is tracked on payment)
        status: payment.status === "refunded" ? "completed" : "pending",
        totalRefunded: payment.refunded / 100, // Convert from halalas to base currency
        refundedAt: payment.refunded_at
          ? new Date(payment.refunded_at)
          : undefined,
        rawResponse: payment,
      };
    }, RefundParamsSchema);
  }

  /**
   * Void an authorized payment
   * @see https://docs.moyasar.com/api/payments/07-void-payment
   * @note Only works for authorized (not yet captured) payments
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      let response: Response;
      try {
        response = await fetch(
          `${this.baseUrl}/payments/${p.gatewayPaymentId}/void`,
          {
            method: "POST",
            headers: this.getHeaders(),
          },
        );
      } catch (e) {
        throw new NetworkError("Failed to connect to Moyasar API", e);
      }

      const data = (await response.json()) as
        | MoyasarPaymentResponse
        | MoyasarErrorResponse;

      if (!response.ok) {
        throw this.createApiError(
          data as MoyasarErrorResponse,
          "Failed to void payment",
        );
      }

      const payment = data as MoyasarPaymentResponse;
      return this.mapPaymentResponse(payment);
    }, VoidParamsSchema);
  }

  /**
   * Map Moyasar errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "moyasar") {
      const raw = error.rawError as { type?: string; message?: string };
      const type = raw?.type;
      const message = raw?.message ?? error.message;

      switch (type) {
        case "invalid_request_error":
          return new InvalidRequestError(message);
        case "authentication_error":
          return new AuthenticationError(message);
        case "rate_limit_error":
          return new RateLimitError("moyasar");
        case "3ds_auth_error":
          return new AuthenticationError(message);
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
    const event = payload as { secret_token?: string };

    if (!this.moyasarConfig.webhookSecret) {
      console.warn(
        "[Moyasar] No webhook secret configured, skipping verification",
      );
      return true;
    }

    return event.secret_token === this.moyasarConfig.webhookSecret;
  }

  /**
   * Parse Moyasar webhook payload into normalized WebhookEvent
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = payload as MoyasarWebhookPayload;

    return {
      id: raw.id,
      type: raw.type,
      gateway: "moyasar",
      paymentId: raw.data.metadata?.paymentId as string | undefined,
      gatewayPaymentId: raw.data.id,
      status: this.mapStatus(raw.data.status),
      amount: raw.data.amount / 100, // Convert from halalas/cents
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
    const { gatewayPaymentId } = params;

    const response = await fetch(`${this.baseUrl}/payments/${gatewayPaymentId}`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    const data = (await response.json()) as
      | MoyasarPaymentResponse
      | MoyasarErrorResponse;

    if (!response.ok) {
      throw this.createApiError(
        data as MoyasarErrorResponse,
        "Failed to get payment",
      );
    }

    const payment = data as MoyasarPaymentResponse;
    return this.mapPaymentResponse(payment);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get authorization headers for Moyasar API
   * Moyasar uses HTTP Basic Auth with secret key as username
   */
  private getHeaders(): Record<string, string> {
    const credentials = btoa(`${this.moyasarConfig.secretKey}:`);

    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
    };
  }

  /**
   * Map Moyasar payment response to unified GatewayPaymentResult
   * Note: For STC Pay, otp_url is used instead of transaction_url
   */
  private mapPaymentResponse(
    payment: MoyasarPaymentResponse,
  ): GatewayPaymentResult {
    // STC Pay uses otp_url, card payments use transaction_url
    // Handle cases where source might not be present (e.g., error responses)
    const redirectUrl =
      payment.source?.transaction_url ?? payment.source?.otp_url ?? undefined;

    return {
      success: true,
      gatewayId: payment.id,
      status: this.mapStatus(payment.status),
      redirectUrl,
      amount: payment.amount / 100, // Convert to base currency
      fee: payment.fee / 100,
      capturedAmount: payment.captured / 100,
      refundedAmount: payment.refunded / 100,
      rawResponse: payment,
    };
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
      failed: "failed",
      refunded: "refunded",
      voided: "cancelled",
    };

    return statusMap[moyasarStatus] ?? "pending";
  }

  /**
   * Create a structured API error from Moyasar error response
   */
  private createApiError(
    errorData: MoyasarErrorResponse,
    fallbackMessage: string,
  ): GatewayApiError {
    let message = errorData.message ?? fallbackMessage;

    // Append validation errors if present
    if (errorData.errors) {
      const errorDetails = Object.entries(errorData.errors)
        .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
        .join("; ");
      message = `${message} - ${errorDetails}`;
    }

    return new GatewayApiError(message, "moyasar", {
      type: errorData.type,
      errors: errorData.errors,
    });
  }
}
