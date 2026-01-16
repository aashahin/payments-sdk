// file: packages/payments/src/gateways/paymob.gateway.ts

import { createHmac } from "node:crypto";
import { BaseGateway } from "../base.gateway";
import type {
  PaymentStatus,
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
} from "../../types/payment.types";
import type {
  WebhookEvent,
  PaymobWebhookPayload,
} from "../../types/webhook.types";
import type { PaymobConfig, PaymobRegion } from "../../types/config.types";
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
  AuthenticationError,
  NetworkError,
} from "../../errors";

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Base URLs for each Paymob region */
const PAYMOB_BASE_URLS: Record<PaymobRegion, string> = {
  ksa: "https://ksa.paymob.com",
  eg: "https://accept.paymob.com",
  pk: "https://pakistan.paymob.com",
  om: "https://oman.paymob.com",
  ae: "https://ae.paymob.com",
};

/**
 * HMAC fields order per Paymob KSA docs.
 * Note: Paymob uses is_refunded/is_voided in callbacks (not is_refund/is_void).
 * @see https://developers.paymob.com/ksa/manage-callback/hmac/hmac-processed-callback
 */
const HMAC_FIELDS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Response Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Paymob Intention API response */
interface PaymobIntentionResponse {
  id: string;
  client_secret: string;
  payment_keys?: Array<{
    key: string;
    integration: number;
  }>;
  redirect_url?: string;
  checkout_url?: string;
  status?: string;
  message?: string;
  detail?: string;
}

/** Paymob legacy order response */
interface PaymobOrderResponse {
  id: number;
  message?: string;
}

/** Paymob legacy payment key response */
interface PaymobPaymentKeyResponse {
  token: string;
  message?: string;
}

/** Paymob refund response */
interface PaymobRefundResponse {
  id?: number;
  success: boolean;
  message?: string;
  pending?: boolean;
}

/** Paymob legacy auth response */
interface PaymobAuthResponse {
  token: string;
  message?: string;
}

/** Paymob capture response */
interface PaymobCaptureResponse {
  id?: number;
  success: boolean;
  message?: string;
  amount_cents?: number;
}

/** Paymob void response */
interface PaymobVoidResponse {
  id?: number;
  success: boolean;
  message?: string;
}

/**
 * Paymob (Accept) payment gateway implementation
 * Supports KSA Unified Intention API and legacy Egypt API
 * @see https://developers.paymob.com/ksa/getting-started-ksa
 */
export class PaymobGateway extends BaseGateway {
  readonly name = "paymob" as const;

  private readonly paymobConfig: PaymobConfig;
  private readonly baseUrl: string;

  /** Legacy auth token (for Egypt API backward compat) */
  private legacyAuthToken: string | null = null;
  private legacyAuthTokenExpiry: number = 0;

  constructor(config: PaymobConfig, hooks: HooksManager) {
    super(config, hooks);
    this.paymobConfig = config;
    this.baseUrl = this.resolveBaseUrl(config);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Creation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a Paymob payment using Unified Intention API (KSA)
   * Falls back to legacy flow for Egypt if apiKey is provided
   */
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("createPayment", params, async (p) => {
      // Use Intention API for KSA (when secretKey/publicKey are available)
      if (this.paymobConfig.secretKey && this.paymobConfig.publicKey) {
        return this.createPaymentViaIntention(p);
      }

      // Fallback to legacy API for backward compatibility
      if (this.paymobConfig.apiKey) {
        return this.createPaymentViaLegacy(p);
      }

      throw new GatewayApiError(
        "Paymob requires either secretKey/publicKey (KSA) or apiKey (legacy)",
        "paymob",
        { config: "missing_credentials" },
      );
    }, CreatePaymentParamsSchema);
  }

  /**
   * Create payment via KSA Unified Intention API
   * @see https://developers.paymob.com/ksa/api-reference-guide/create-intention-payment-api-copy
   */
  private async createPaymentViaIntention(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    // Validate required integrationId for Intention API
    if (!this.paymobConfig.integrationId) {
      throw new GatewayApiError(
        "Paymob Intention API requires 'integrationId' to be configured. " +
        "Please add the integration ID from your Paymob dashboard.",
        "paymob",
        { config: "missing_integration_id" },
      );
    }

    const endpoint = "/v1/intention/";

    const billingData = {
      email: (params.metadata?.email as string) ?? "customer@example.com",
      first_name: (params.metadata?.firstName as string) ?? "Customer",
      last_name: (params.metadata?.lastName as string) ?? "Name",
      phone_number: (params.metadata?.phone as string) ?? "+966500000000",
      country: (params.metadata?.country as string) ?? "SA",
      city: (params.metadata?.city as string) ?? "Riyadh",
      street: (params.metadata?.street as string) ?? "NA",
      building: (params.metadata?.building as string) ?? "NA",
      apartment: (params.metadata?.apartment as string) ?? "NA",
      floor: (params.metadata?.floor as string) ?? "NA",
      postal_code: (params.metadata?.postalCode as string) ?? "00000",
      state: (params.metadata?.state as string) ?? "NA",
    };

    const requestBody = {
      amount: Math.round(params.amount * 100),
      currency: params.currency,
      payment_methods: this.paymobConfig.integrationId
        ? [parseInt(this.paymobConfig.integrationId, 10)]
        : undefined,
      billing_data: billingData,
      // Use paymentId as special_reference so it appears as merchant_order_id in webhooks
      special_reference: (params.metadata?.paymentId as string) ?? params.orderId,
      notification_url: params.callbackUrl,
      // Normalize redirect URL to prevent Paymob adding trailing slash before query params
      redirection_url: this.normalizeRedirectUrl(params.returnUrl ?? params.callbackUrl),
      // Include paymentId and tenantId in extras - these appear in payment_key_claims.extra
      extras: {
        ...params.metadata,
        paymentId: params.metadata?.paymentId,
        tenantId: params.metadata?.tenantId,
        orderId: (params.metadata?.orderId as string) ?? params.orderId,
      },
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Intention API uses simple Token authentication, not HMAC
        Authorization: `Token ${this.paymobConfig.secretKey}`,
      },
      body: JSON.stringify(requestBody),
    }).catch(e => {
      throw new NetworkError("Failed to connect to Paymob Intention API", e);
    });

    const data = (await response.json()) as PaymobIntentionResponse;

    if (!response.ok) {
      console.error("[Paymob] Intention API error:", {
        status: response.status,
        statusText: response.statusText,
        response: data,
        requestBody,
        baseUrl: this.baseUrl,
      });
      throw new GatewayApiError(
        data.message ?? data.detail ?? "Failed to create Paymob intention",
        "paymob",
        data,
      );
    }

    // Build redirect URL from response
    const redirectUrl =
      data.redirect_url ??
      data.checkout_url ??
      (data.client_secret
        ? `${this.baseUrl}/unifiedcheckout/?publicKey=${this.paymobConfig.publicKey}&clientSecret=${data.client_secret}`
        : undefined);

    return {
      success: true,
      gatewayId: data.id,
      status: "pending",
      redirectUrl,
      rawResponse: data,
    };
  }

  /**
   * Create payment via legacy Egypt API (backward compatibility)
   * @deprecated Use Intention API for new integrations
   */
  private async createPaymentViaLegacy(
    params: CreatePaymentParams,
  ): Promise<GatewayPaymentResult> {
    // Step 1: Get auth token
    const token = await this.authenticateLegacy();

    // Step 2: Create order
    const orderResponse = await fetch(`${this.baseUrl}/api/ecommerce/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: false,
        amount_cents: Math.round(params.amount * 100),
        currency: params.currency,
        merchant_order_id: params.orderId,
        items: [],
      }),
    }).catch(e => {
      throw new NetworkError("Failed to connect to Paymob Orders API", e);
    });

    const orderData = (await orderResponse.json()) as PaymobOrderResponse;

    if (!orderResponse.ok) {
      throw new GatewayApiError(
        orderData.message ?? "Failed to create Paymob order",
        "paymob",
        orderData,
      );
    }

    // Step 3: Generate payment key
    const paymentKeyResponse = await fetch(
      `${this.baseUrl}/api/acceptance/payment_keys`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_token: token,
          amount_cents: Math.round(params.amount * 100),
          expiration: 3600,
          order_id: orderData.id,
          billing_data: {
            apartment: "NA",
            email: (params.metadata?.email as string) ?? "customer@example.com",
            floor: "NA",
            first_name: (params.metadata?.firstName as string) ?? "Customer",
            street: "NA",
            building: "NA",
            phone_number: (params.metadata?.phone as string) ?? "01000000000",
            shipping_method: "NA",
            postal_code: "NA",
            city: "NA",
            country: "NA",
            last_name: (params.metadata?.lastName as string) ?? "Name",
            state: "NA",
          },
          currency: params.currency,
          integration_id: this.paymobConfig.integrationId,
        }),
      },
    ).catch(e => {
      throw new NetworkError("Failed to connect to Paymob Payment Keys API", e);
    });

    const paymentKeyData =
      (await paymentKeyResponse.json()) as PaymobPaymentKeyResponse;

    if (!paymentKeyResponse.ok) {
      throw new GatewayApiError(
        paymentKeyData.message ?? "Failed to generate Paymob payment key",
        "paymob",
        paymentKeyData,
      );
    }

    // Generate iframe URL
    const iframeUrl = `${this.baseUrl}/api/acceptance/iframes/${this.paymobConfig.integrationId}?payment_token=${paymentKeyData.token}`;

    return {
      success: true,
      gatewayId: String(orderData.id),
      status: "pending",
      redirectUrl: iframeUrl,
      rawResponse: {
        order: orderData,
        paymentKey: paymentKeyData,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Capture
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Capture an authorized payment
   * @see https://developers.paymob.com/ksa/payment-actions/api-level/auth-capture-payments-copy
   */
  async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("capturePayment", params, async (p) => {
      const token = await this.getAuthToken();

      const response = await fetch(`${this.baseUrl}/api/acceptance/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_token: token,
          transaction_id: p.gatewayPaymentId,
          amount_cents: p.amount ? Math.round(p.amount * 100) : undefined,
        }),
      }).catch((e) => {
        throw new NetworkError("Failed to connect to Paymob Capture API", e);
      });

      const data = (await response.json()) as PaymobCaptureResponse;

      if (!response.ok) {
        throw new GatewayApiError(
          data.message ?? "Failed to capture Paymob payment",
          "paymob",
          data,
        );
      }

      return {
        success: true,
        gatewayId: String(data.id ?? p.gatewayPaymentId),
        status: data.success
          ? ("paid" as PaymentStatus)
          : ("pending" as PaymentStatus),
        redirectUrl: undefined,
        capturedAmount: data.amount_cents ? data.amount_cents / 100 : undefined,
        rawResponse: data,
      };
    }, CaptureParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Void
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Void a same-day transaction
   * @see https://developers.paymob.com/ksa/payment-actions/api-level/void-transaction-copy
   */
  async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
    return this.executeWithHooks("voidPayment", params, async (p) => {
      const token = await this.getAuthToken();

      const response = await fetch(
        `${this.baseUrl}/api/acceptance/void_refund/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: token,
            transaction_id: p.gatewayPaymentId,
          }),
        },
      ).catch((e) => {
        throw new NetworkError("Failed to connect to Paymob Void API", e);
      });

      const data = (await response.json()) as PaymobVoidResponse;

      if (!response.ok) {
        throw new GatewayApiError(
          data.message ?? "Failed to void Paymob transaction",
          "paymob",
          data,
        );
      }

      return {
        success: data.success,
        gatewayId: String(data.id ?? p.gatewayPaymentId),
        status: data.success
          ? ("cancelled" as PaymentStatus)
          : ("failed" as PaymentStatus),
        redirectUrl: undefined,
        rawResponse: data,
      };
    }, VoidParamsSchema);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Refund
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Refund a Paymob payment
   * @see https://developers.paymob.com/ksa/payment-actions/api-level/refund-transaction-copy
   */
  async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
    return this.executeWithHooks("refundPayment", params, async (p) => {
      const token = await this.getAuthToken();

      const response = await fetch(
        `${this.baseUrl}/api/acceptance/void_refund/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: token,
            transaction_id: p.gatewayPaymentId,
            amount_cents:
              p.amount !== undefined ? Math.round(p.amount * 100) : undefined,
          }),
        },
      );

      const data = (await response.json()) as PaymobRefundResponse;

      if (!response.ok) {
        throw new GatewayApiError(
          data.message ?? "Failed to refund Paymob payment",
          "paymob",
          data,
        );
      }

      return {
        success: true,
        gatewayRefundId: String(data.id ?? p.gatewayPaymentId),
        status: data.success
          ? "completed"
          : data.pending
            ? "pending"
            : "pending",
        rawResponse: data,
      };
    }, RefundParamsSchema);
  }

  /**
   * Map Paymob errors to standardized SDK errors
   */
  protected mapError(error: unknown): Error {
    if (error instanceof GatewayApiError && error.gatewayName === "paymob") {
      const raw = error.rawError as { message?: string };
      const message = raw?.message ?? error.message;

      if (message.toLowerCase().includes('declined')) {
        return new CardDeclinedError(message, raw);
      }
      if (message.toLowerCase().includes('authentication')) {
        return new AuthenticationError(message, raw);
      }
    }
    return super.mapError(error);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verify Paymob webhook using HMAC
   * @see https://developers.paymob.com/ksa/manage-callback/hmac/hmac-processed-callback
   */
  verifyWebhook(payload: unknown, signature?: string): boolean {
    if (!this.paymobConfig.hmacSecret) {
      console.warn("[Paymob] No HMAC secret configured, skipping verification");
      return true;
    }

    const raw = payload as PaymobWebhookPayload;

    // Get signature from payload or parameter
    const hmac = signature ?? raw.hmac;
    if (!hmac) {
      console.warn("[Paymob] No HMAC signature provided");
      return false;
    }

    // Build the concatenated string for HMAC calculation
    const obj = raw.obj;
    const dataString = this.buildHmacString(obj);

    // Calculate expected HMAC
    const calculatedHmac = createHmac("sha512", this.paymobConfig.hmacSecret)
      .update(dataString)
      .digest("hex");

    return hmac === calculatedHmac;
  }

  /**
   * Build the data string for HMAC calculation per Paymob docs.
   * Uses HMAC_FIELDS order with correct field names (is_refunded, is_voided).
   * @see https://developers.paymob.com/ksa/manage-callback/hmac/hmac-processed-callback
   */
  private buildHmacString(obj: PaymobWebhookPayload["obj"] & {
    is_refunded?: boolean;
    is_voided?: boolean;
    owner?: number | string;
  }): string {
    // Map fields in lexicographical order per Paymob docs
    // Note: Paymob sends is_refunded/is_voided in callbacks, not is_refund/is_void
    const values: string[] = [
      String(obj.amount_cents),
      obj.created_at ?? "",
      obj.currency,
      String(obj.error_occured ?? false),
      String(obj.has_parent_transaction ?? false),
      String(obj.id),
      String(obj.integration_id ?? ""),
      String(obj.is_3d_secure ?? false),
      String(obj.is_auth ?? false),
      String(obj.is_capture ?? false),
      // Use is_refunded (callback field) with fallback to is_refund (interface)
      String(obj.is_refunded ?? obj.is_refund ?? false),
      String(obj.is_standalone_payment ?? true),
      // Use is_voided (callback field) with fallback to is_void (interface)
      String(obj.is_voided ?? obj.is_void ?? false),
      String(obj.order?.id ?? ""),
      String(obj.owner ?? ""),
      String(obj.pending),
      obj.source_data?.pan ?? "",
      obj.source_data?.sub_type ?? "",
      obj.source_data?.type ?? "",
      String(obj.success),
    ];

    return values.join("");
  }

  /**
   * Parse Paymob webhook payload into normalized WebhookEvent
   */
  parseWebhookEvent(payload: unknown): WebhookEvent {
    const raw = payload as PaymobWebhookPayload;

    // Extract paymentId from extras (payment_key_claims.extra) or fallback to merchant_order_id
    const objWithClaims = raw.obj as {
      payment_key_claims?: { extra?: { paymentId?: string } };
    };
    const paymentId =
      objWithClaims.payment_key_claims?.extra?.paymentId ??
      raw.obj.order?.merchant_order_id;

    let status: PaymentStatus = "pending";
    if (raw.obj.success) {
      status = "paid";
    } else if (raw.obj.is_refund) {
      status = "refunded";
    } else if (raw.obj.is_void) {
      status = "cancelled";
    } else if (!raw.obj.pending) {
      status = "failed";
    }

    return {
      id: String(raw.obj.id),
      type: raw.type,
      gateway: "paymob",
      paymentId,
      gatewayPaymentId: String(raw.obj.id),
      status,
      amount: raw.obj.amount_cents / 100,
      currency: raw.obj.currency,
      timestamp: raw.obj.created_at ? new Date(raw.obj.created_at) : new Date(),
      rawPayload: raw,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retrieve transaction details from Paymob
   * @see https://developers.paymob.com/ksa/guides/retrieve-a-transaction-inquiry-with-order-id-copy-1
   */
  async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
    const { gatewayPaymentId } = params;
    const token = await this.getAuthToken();

    const response = await fetch(
      `${this.baseUrl}/api/acceptance/transactions/${gatewayPaymentId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    ).catch((e) => {
      throw new NetworkError("Failed to connect to Paymob Transaction Inquiry API", e);
    });

    const data = await response.json() as {
      id?: number;
      success?: boolean;
      pending?: boolean;
      amount_cents?: number;
      currency?: string;
      message?: string;
      is_void?: boolean;
      is_refund?: boolean;
    };

    if (!response.ok) {
      throw new GatewayApiError(
        data.message ?? "Failed to retrieve Paymob transaction",
        "paymob",
        data
      );
    }

    return {
      success: data.success ?? true,
      gatewayId: String(data.id ?? gatewayPaymentId),
      status: this.mapTransactionStatus(data),
      redirectUrl: undefined,
      amount: data.amount_cents ? data.amount_cents / 100 : undefined,
      rawResponse: data,
    };
  }

  /**
   * Map Paymob transaction response to unified PaymentStatus
   */
  private mapTransactionStatus(data: {
    success?: boolean;
    pending?: boolean;
    is_void?: boolean;
    is_refund?: boolean;
  }): PaymentStatus {
    if (data.is_void) return "cancelled";
    if (data.is_refund) return "refunded";
    if (data.pending) return "pending";
    if (data.success) return "paid";
    return "failed";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Authentication
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate Authorization header for KSA API
   * Uses HMAC signature with publicKey, timestamp, and nonce
   */
  private generateAuthHeader(
    method: string,
    endpoint: string,
    nonce: string,
  ): string {
    const timestamp = this.generateTimestamp();
    const serviceId = this.paymobConfig.serviceId ?? "";

    // Concatenate: method + endpoint + publicKey + timestamp + serviceId + nonce
    const stringToSign = `${method}${endpoint}${this.paymobConfig.publicKey}${timestamp}${serviceId}${nonce}`;

    // Generate HMAC-SHA256 signature
    const signature = createHmac("sha256", this.paymobConfig.secretKey)
      .update(stringToSign)
      .digest("hex");

    // Combine: publicKey.timestamp.signature.nonce
    const combined = `${this.paymobConfig.publicKey}.${timestamp}.${signature}.${nonce}`;

    // Base64 encode
    return Buffer.from(combined).toString("base64");
  }

  /**
   * Generate timestamp in YYYYMMDDTHHmm format
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");

    return `${year}${month}${day}T${hours}${minutes}`;
  }

  /**
   * Get auth token (KSA uses Authorization header, legacy uses token)
   */
  private async getAuthToken(): Promise<string> {
    // For KSA API, we still need legacy token for refund/capture endpoints
    return this.authenticateLegacy();
  }

  /**
   * Authenticate with legacy Paymob API (for refund/capture endpoints)
   */
  private async authenticateLegacy(): Promise<string> {
    // Check if we have a valid cached token
    if (this.legacyAuthToken && Date.now() < this.legacyAuthTokenExpiry) {
      return this.legacyAuthToken;
    }

    // Determine which key to use
    const apiKey = this.paymobConfig.apiKey ?? this.paymobConfig.secretKey;
    if (!apiKey) {
      throw new GatewayApiError(
        "Paymob requires apiKey or secretKey for legacy authentication",
        "paymob",
        { config: "missing_api_key" },
      );
    }

    const response = await fetch(`${this.baseUrl}/api/auth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });

    const data = (await response.json()) as PaymobAuthResponse;

    if (!response.ok) {
      throw new GatewayApiError(
        "Failed to authenticate with Paymob",
        "paymob",
        data,
      );
    }

    // Cache token for 50 minutes (token expires in 1 hour)
    this.legacyAuthToken = data.token;
    this.legacyAuthTokenExpiry = Date.now() + 50 * 60 * 1000;

    return this.legacyAuthToken;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve base URL from config
   */
  private resolveBaseUrl(config: PaymobConfig): string {
    // Explicit override takes precedence
    if (config.baseUrl) {
      return config.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    }

    // Use region (default to KSA)
    const region = config.region ?? "ksa";
    return PAYMOB_BASE_URLS[region];
  }

  /**
   * Normalize URL to ensure it has a path component.
   * Paymob adds a trailing slash before query params if no path exists,
   * which can cause 404s on some frontends.
   *
   * @example
   * - `https://domain.com?no=123` → `https://domain.com/?no=123`
   * - `https://domain.com/page?no=123` → unchanged
   */
  private normalizeRedirectUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;

    try {
      const parsed = new URL(url);
      // If pathname is empty or just "/", and there are query params,
      // ensure we have an explicit "/" to prevent Paymob normalization issues
      if (parsed.pathname === "" || parsed.pathname === "/") {
        parsed.pathname = "/";
      }
      return parsed.toString();
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }
}
