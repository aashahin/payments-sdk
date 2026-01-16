// file: packages/payments/src/gateways/tamara/tamara.gateway.ts

import * as jose from "jose";
import { BaseGateway } from "../base.gateway";
import type {
  CaptureParams,
  CreatePaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  PaymentStatus,
  RefundParams,
  VoidParams
} from "../../types/payment.types";
import type { TamaraWebhookPayload, WebhookEvent } from "../../types/webhook.types";
import type { TamaraConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import type {
  TamaraAuthoriseResponse,
  TamaraCancelParams,
  TamaraCancelResponse,
  TamaraCaptureParams,
  TamaraCaptureResponse,
  TamaraCheckoutSessionParams,
  TamaraCheckoutSessionResponse,
  TamaraErrorResponse,
  TamaraOrderDetails,
  TamaraOrderStatus,
  TamaraRefundParams,
  TamaraRefundResponse
} from "../../types/tamara.types";
import { AuthenticationError, GatewayApiError, InvalidRequestError, NetworkError } from "../../errors";
import {
  CaptureParamsSchema,
  CreatePaymentParamsSchema,
  RefundParamsSchema,
  TamaraCheckoutSessionParamsSchema,
  VoidParamsSchema
} from "../../types/validation";

// ═══════════════════════════════════════════════════════════════════════════════
// Tamara Gateway Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tamara BNPL (Buy Now Pay Later) gateway implementation
 * Supports SA, AE, BH, KW, OM markets with installment payments
 * @see https://developers.tamara.co
 */
export class TamaraGateway extends BaseGateway {
  readonly name = "tamara" as const;

  private readonly tamaraConfig: TamaraConfig;

  private get baseUrl(): string {
    return this.tamaraConfig.sandbox
      ? "https://api-sandbox.tamara.co"
      : "https://api.tamara.co";
  }

  constructor(config: TamaraConfig, hooks: HooksManager) {
    super(config, hooks);
    this.tamaraConfig = config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Core Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment via Tamara checkout session.
   * Tamara is redirect-based, so this creates a checkout session.
   * For full control, use createCheckoutSession() directly.
   */
  async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Build checkout params from generic CreatePaymentParams
      const checkoutParams: TamaraCheckoutSessionParams = {
        total_amount: {
          amount: p.amount,
          currency: p.currency
        },
        shipping_amount: {
          amount: 0,
          currency: p.currency
        },
        tax_amount: {
          amount: 0,
          currency: p.currency
        },
        order_reference_id: p.orderId ?? p.idempotencyKey ?? `order_${Date.now()}`,
        items: [{
          name: p.description ?? "Payment",
          quantity: 1,
          reference_id: "item_1",
          type: "Digital",
          sku: "payment_item",
          total_amount: {
            amount: p.amount,
            currency: p.currency
          }
        }],
        consumer: {
          email: (p.metadata?.buyerEmail as string) ?? "customer@example.com",
          first_name: (p.metadata?.buyerFirstName as string) ?? "Customer",
          last_name: (p.metadata?.buyerLastName as string) ?? "User",
          phone_number: (p.metadata?.buyerPhone as string) ?? "500000000"
        },
        country_code: ((p.metadata?.countryCode as string) ?? "SA") as "SA" | "AE" | "BH" | "KW" | "OM",
        description: p.description ?? "Payment",
        merchant_url: {
          success: p.callbackUrl,
          failure: p.callbackUrl,
          cancel: p.cancelUrl ?? p.callbackUrl,
          notification: (p.metadata?.webhookUrl as string) ?? p.callbackUrl
        },
        shipping_address: {
          city: (p.metadata?.shippingCity as string) ?? "Riyadh",
          country_code: ((p.metadata?.countryCode as string) ?? "SA"),
          first_name: (p.metadata?.buyerFirstName as string) ?? "Customer",
          last_name: (p.metadata?.buyerLastName as string) ?? "User",
          line1: (p.metadata?.shippingLine1 as string) ?? "Address",
          phone_number: (p.metadata?.buyerPhone as string) ?? "500000000",
          region: (p.metadata?.shippingRegion as string) ?? "Region"
        }
      };

      const response = await this.createCheckoutSession(checkoutParams);

      return {
        success: response.status === "new",
        gatewayId: response.order_id,
        status: "pending" as PaymentStatus,
        redirectUrl: response.checkout_url,
        amount: p.amount,
        rawResponse: response
      };
    }, CreatePaymentParamsSchema);
  }

  /**
   * Create a Tamara checkout session with full BNPL cart data
   * @see https://developers.tamara.co/reference/createcheckoutsession
   */
  async createCheckoutSession(params: TamaraCheckoutSessionParams): Promise<TamaraCheckoutSessionResponse> {
    // Validate checkout params
    const validationResult = TamaraCheckoutSessionParamsSchema.safeParse(params);
    if (!validationResult.success) {
      throw new InvalidRequestError(
        "Invalid checkout session params",
        validationResult.error.errors
      );
    }

    return this.tamaraRequest<TamaraCheckoutSessionResponse>(
      "POST",
      "/checkout",
      params
    );
  }

  /**
   * Authorise an order after customer approval.
   * REQUIRED: Must be called after receiving 'order_approved' webhook.
   * @see https://developers.tamara.co/reference/authoriseorder
   */
  async authoriseOrder(orderId: string): Promise<TamaraAuthoriseResponse> {
    return this.tamaraRequest<TamaraAuthoriseResponse>(
      "POST",
      `/orders/${orderId}/authorise`
    );
  }

  /**
   * Capture an authorized payment (after shipping/fulfillment).
   * Note: Tamara uses order_id, not a generic gatewayPaymentId.
   * @see https://developers.tamara.co/reference/captureorder
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      // Build Tamara-specific capture params
      const captureParams: TamaraCaptureParams = {
        order_id: p.gatewayPaymentId,
        total_amount: {
          amount: p.amount ?? 0,
          currency: (p as unknown as { currency?: string }).currency ?? "SAR"
        },
        shipping_info: {
          shipped_at: new Date().toISOString(),
          shipping_company: (p as unknown as { shippingCompany?: string }).shippingCompany ?? "Carrier",
          tracking_number: (p as unknown as { trackingNumber?: string }).trackingNumber ?? "N/A"
        }
      };

      const response = await this.tamaraRequest<TamaraCaptureResponse>(
        "POST",
        "/payments/capture",
        captureParams
      );

      // Handle captured_amount as array or single object (API returns array)
      const capturedAmount = Array.isArray(response.captured_amount)
        ? response.captured_amount[0]
        : response.captured_amount;

      return {
        success: true,
        gatewayId: response.order_id,
        status: this.mapTamaraStatus(response.status),
        redirectUrl: undefined,
        amount: capturedAmount?.amount ?? 0,
        capturedAmount: capturedAmount?.amount ?? 0,
        rawResponse: response
      };
    }, CaptureParamsSchema);
  }

  /**
   * Capture with full Tamara-specific parameters
   */
  async captureTamara(params: TamaraCaptureParams): Promise<TamaraCaptureResponse> {
    return this.tamaraRequest<TamaraCaptureResponse>(
      "POST",
      "/payments/capture",
      params
    );
  }

  /**
   * Refund a payment (full or partial) using simplified refund.
   * @see https://developers.tamara.co/reference/simplifiedrefund
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const refundParams: TamaraRefundParams = {
        order_id: p.gatewayPaymentId,
        total_amount: {
          amount: p.amount ?? 0,
          currency: p.currency ?? "SAR"
        },
        comment: p.reason ?? "Refund requested"
      };

      const response = await this.tamaraRequest<TamaraRefundResponse>(
        "POST",
        `/payments/simplified-refund/${p.gatewayPaymentId}`,
        {
          total_amount: refundParams.total_amount,
          comment: refundParams.comment
        }
      );

      // Handle refunded_amount as array or single object (API returns array)
      const refundedAmount = Array.isArray(response.refunded_amount)
        ? response.refunded_amount[0]
        : response.refunded_amount;

      return {
        success: true,
        gatewayRefundId: response.refund_id,
        status: "completed",
        totalRefunded: refundedAmount?.amount ?? 0,
        rawResponse: response
      };
    }, RefundParamsSchema);
  }

  /**
   * Refund with full Tamara-specific parameters
   */
  async refundTamara(params: TamaraRefundParams): Promise<TamaraRefundResponse> {
    return this.tamaraRequest<TamaraRefundResponse>(
      "POST",
      `/payments/simplified-refund/${params.order_id}`,
      {
        total_amount: params.total_amount,
        comment: params.comment,
        merchant_refund_id: params.merchant_refund_id
      }
    );
  }

  /**
   * Cancel/void an authorized order before capture.
   * @see https://developers.tamara.co/reference/cancelorder
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      // For void, we need to get order details first to know the amount
      const order = await this.getOrderDetails(p.gatewayPaymentId);

      const cancelParams: TamaraCancelParams = {
        order_id: p.gatewayPaymentId,
        total_amount: order.total_amount
      };

      const response = await this.tamaraRequest<TamaraCancelResponse>(
        "POST",
        `/orders/${p.gatewayPaymentId}/cancel`,
        cancelParams
      );

      return {
        success: true,
        gatewayId: response.order_id,
        status: response.status === "canceled" ? "cancelled" : "pending",
        redirectUrl: undefined,
        amount: response.canceled_amount.amount,
        rawResponse: response
      };
    }, VoidParamsSchema);
  }

  /**
   * Cancel with full Tamara-specific parameters
   */
  async cancelTamara(params: TamaraCancelParams): Promise<TamaraCancelResponse> {
    return this.tamaraRequest<TamaraCancelResponse>(
      "POST",
      `/orders/${params.order_id}/cancel`,
      params
    );
  }

  /**
   * Get order details
   * @see https://developers.tamara.co/reference/getorderdetails
   */
  async getOrderDetails(orderId: string): Promise<TamaraOrderDetails> {
    return this.tamaraRequest<TamaraOrderDetails>(
      "GET",
      `/orders/${orderId}`
    );
  }

  /**
   * Get payment status by order ID
   */
  async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
    const order = await this.getOrderDetails(gatewayId);
    return this.mapTamaraStatus(order.status);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Error Mapping
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Map Tamara errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "tamara") {
      const raw = error.rawError as TamaraErrorResponse | undefined;
      const message = raw?.message ?? raw?.error ?? error.message;

      // Check for auth errors (401)
      if (error.message.includes("401") || error.message.includes("Unauthorized")) {
        return new AuthenticationError(message, raw);
      }

      // Check for validation errors (400)
      if (raw?.errors && raw.errors.length > 0) {
        return new InvalidRequestError(message, raw.errors);
      }
    }
    return super.mapError(error);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Tamara webhook authenticity.
   * Tamara sends a JWT token (tamaraToken) for verification.
   * The token can be in query params or Authorization header.
   *
   * For synchronous verification, use verifyWebhookSync.
   * This method always returns true and logs a warning - use verifyWebhookAsync for production.
   */
  verifyWebhook(payload: unknown, signature?: string, headers?: Record<string, string>): boolean {
    // If notification token is configured, we need async verification
    if (this.tamaraConfig.notificationToken) {
      const token = signature ?? headers?.["authorization"]?.replace("Bearer ", "") ?? "";

      if (!token) {
        console.warn("[Tamara] Webhook verification failed: missing tamaraToken");
        return false;
      }

      // Basic JWT structure check (sync)
      const parts = token.split(".");
      if (parts.length !== 3) {
        console.warn("[Tamara] Webhook verification failed: invalid JWT structure");
        return false;
      }

      // For full cryptographic verification, use verifyWebhookAsync
      console.warn("[Tamara] Using sync verification - for production, use verifyWebhookAsync for full JWT signature verification");

      // Do basic payload check synchronously
      try {
        const payloadBase64 = parts[1];
        if (!payloadBase64) {
          return false;
        }
        const decodedPayload = JSON.parse(atob(payloadBase64));
        const webhookPayload = payload as TamaraWebhookPayload;
        return decodedPayload.order_id === webhookPayload.order_id;
      } catch {
        return false;
      }
    }

    // If no notification token configured, accept all webhooks (development mode)
    console.warn("[Tamara] No notification token configured, accepting webhook without verification");
    return true;
  }

  /**
   * Verify Tamara webhook authenticity with full JWT cryptographic verification.
   * Uses HS256 algorithm to verify the signature against notificationToken.
   *
   * @param payload - The webhook payload body
   * @param signature - The tamaraToken (JWT) from query param or Authorization header
   * @param headers - Optional headers to extract token from
   * @returns Promise<boolean> - true if signature is valid
   */
  async verifyWebhookAsync(payload: unknown, signature?: string, headers?: Record<string, string>): Promise<boolean> {
    // If no notification token configured, accept all webhooks (development mode)
    if (!this.tamaraConfig.notificationToken) {
      console.warn("[Tamara] No notification token configured, accepting webhook without verification");
      return true;
    }

    const token = signature ?? headers?.["authorization"]?.replace("Bearer ", "") ?? "";

    if (!token) {
      console.warn("[Tamara] Webhook verification failed: missing tamaraToken");
      return false;
    }

    try {
      // Create secret key from notification token
      const secret = new TextEncoder().encode(this.tamaraConfig.notificationToken);

      // Verify JWT signature using HS256
      const { payload: jwtPayload } = await jose.jwtVerify(token, secret, {
        algorithms: ["HS256"]
      });

      // Parse webhook payload if it's a string
      let webhookPayload: TamaraWebhookPayload;
      if (typeof payload === "string") {
        webhookPayload = JSON.parse(payload) as TamaraWebhookPayload;
      } else {
        webhookPayload = payload as TamaraWebhookPayload;
      }

      // Verify order_id matches webhook payload (if present in JWT)
      // Some Tamara JWT tokens may not include order_id for certain event types
      if (jwtPayload.order_id && jwtPayload.order_id !== webhookPayload.order_id) {
        console.warn(`[Tamara] Webhook verification: order_id mismatch - JWT: ${jwtPayload.order_id}, Webhook: ${webhookPayload.order_id}`);
        // Return false for strict verification
        return false;
      }

      return true;
    } catch (e) {
      if (e instanceof jose.errors.JWTExpired) {
        console.warn("[Tamara] Webhook verification failed: JWT expired");
      } else if (e instanceof jose.errors.JWSSignatureVerificationFailed) {
        console.warn("[Tamara] Webhook verification failed: invalid signature");
      } else {
        console.warn("[Tamara] Webhook verification failed:", e);
      }
      return false;
    }
  }

  /**
   * Parse Tamara webhook event into normalized format
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    let raw: TamaraWebhookPayload;
    if (typeof payload === "string") {
      raw = JSON.parse(payload) as TamaraWebhookPayload;
    } else {
      raw = payload as TamaraWebhookPayload;
    }

    // Map event type to status
    let status: PaymentStatus;
    switch (raw.event_type) {
      case "order_approved":
        status = "pending"; // Needs authorisation
        break;
      case "order_authorised":
        status = "authorized";
        break;
      case "order_captured":
        status = "paid";
        break;
      case "order_refunded":
        status = this.isFullyRefunded(raw) ? "refunded" : "partially_refunded";
        break;
      case "order_canceled":
        status = "cancelled";
        break;
      case "order_declined":
      case "order_expired":
        status = "failed";
        break;
      default:
        status = "pending";
    }

    // Extract amount from event data if available
    let amount = 0;
    let currency = "SAR";
    const data = raw.data;
    if (data && !Array.isArray(data)) {
      if (data.captured_amount) {
        amount = data.captured_amount.amount;
        currency = data.captured_amount.currency;
      } else if (data.refunded_amount) {
        amount = data.refunded_amount.amount;
        currency = data.refunded_amount.currency;
      } else if (data.canceled_amount) {
        amount = data.canceled_amount.amount;
        currency = data.canceled_amount.currency;
      }
    }

    return {
      id: raw.order_id,
      type: raw.event_type,
      gateway: "tamara",
      paymentId: raw.order_reference_id,
      gatewayPaymentId: raw.order_id,
      status,
      amount,
      currency,
      timestamp: new Date(),
      rawPayload: raw
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Make request to Tamara API
   */
  private async tamaraRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.tamaraConfig.apiToken}`,
      "Accept": "application/json",
      "Content-Type": "application/json"
    };

    const options: RequestInit = {
      method,
      headers
    };

    if (body && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, options);
    } catch (e) {
      throw new NetworkError("Failed to reach Tamara API", e);
    }

    const data = await response.json() as T | TamaraErrorResponse;

    if (!response.ok) {
      const errorData = data as TamaraErrorResponse;
      throw new GatewayApiError(
        errorData.message ?? errorData.error ?? `Tamara API error (${response.status})`,
        "tamara",
        errorData
      );
    }

    return data as T;
  }

  /**
   * Map Tamara order status to unified payment status
   */
  private mapTamaraStatus(tamaraStatus: TamaraOrderStatus): PaymentStatus {
    const map: Record<TamaraOrderStatus, PaymentStatus> = {
      "new": "pending",
      "declined": "failed",
      "expired": "failed",
      "approved": "approved", // Ready to be authorized/captured
      "authorised": "authorized",
      "fully_captured": "paid",
      "partially_captured": "paid",
      "fully_refunded": "refunded",
      "partially_refunded": "partially_refunded",
      "canceled": "cancelled",
      "updated": "pending" // Partial cancel
    };
    return map[tamaraStatus] ?? "pending";
  }

  /**
   * Check if refund event represents full refund.
   *
   * Note: Tamara webhooks don't include explicit partial/full status.
   * We check if data is an empty array (typically used for full operations)
   * or if refunded_amount exists (indicates a refund occurred).
   * For accurate determination, fetch order details via getOrderDetails().
   */
  private isFullyRefunded(payload: TamaraWebhookPayload): boolean {
    const data = payload.data;

    // Empty array typically means full operation (order_refunded with no partial info)
    if (Array.isArray(data)) {
      return true;
    }

    // If we have refund data, we can't determine partial vs full from webhook alone
    // Default to full refund - consumers should verify via getOrderDetails if needed
    return true;
  }
}
