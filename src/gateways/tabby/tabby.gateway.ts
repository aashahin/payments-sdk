// file: packages/payments/src/gateways/tabby/tabby.gateway.ts

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
import type { TabbyWebhookPayload, WebhookEvent } from "../../types/webhook.types";
import type { TabbyConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import type {
    TabbyCheckoutSessionParams,
    TabbyCheckoutSessionResponse,
    TabbyPaymentResponse,
    TabbyCaptureParams,
    TabbyRefundParams,
    TabbyPaymentStatus,
} from "../../types/tabby.types";
import {
    GatewayApiError,
    AuthenticationError,
    InvalidRequestError,
    NetworkError,
} from "../../errors";
import {
    CreatePaymentParamsSchema,
    CaptureParamsSchema,
    RefundParamsSchema,
    VoidParamsSchema,
    TabbyCheckoutSessionParamsSchema,
} from "../../types/validation";

// ═══════════════════════════════════════════════════════════════════════════════
// Tabby Error Response Type
// ═══════════════════════════════════════════════════════════════════════════════

interface TabbyErrorResponse {
    status: 'error';
    errorType: string;
    error: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tabby Gateway Implementation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tabby payment gateway implementation (BNPL - Buy Now Pay Later)
 * Uses Tabby API v2 directly via fetch
 * @see https://docs.tabby.ai
 */
export class TabbyGateway extends BaseGateway {
    readonly name = "tabby" as const;

    private readonly tabbyConfig: TabbyConfig;

    private get baseUrl(): string {
        return this.tabbyConfig.sandbox
            ? "https://api.tabby.ai"
            : "https://api.tabby.ai";
    }

    constructor(config: TabbyConfig, hooks: HooksManager) {
        super(config, hooks);
        this.tabbyConfig = config;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a payment via Tabby checkout session.
     * Tabby is redirect-based only, so this creates a checkout session.
     * For full control, use createCheckoutSession() directly.
     */
    async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("createPayment", params, async (p) => {
            // Tabby requires itemized cart data. If not provided, we create a minimal order.
            // In production, callers should use createCheckoutSession() with full cart data.
            const checkoutParams: TabbyCheckoutSessionParams = {
                amount: p.amount.toFixed(2),
                currency: p.currency,
                buyer: {
                    name: (p.metadata?.buyerName as string) ?? 'Customer',
                    email: (p.metadata?.buyerEmail as string) ?? 'customer@example.com',
                    phone: (p.metadata?.buyerPhone as string) ?? '500000000',
                },
                order: {
                    reference_id: p.orderId ?? p.idempotencyKey ?? `order_${Date.now()}`,
                    items: [{
                        reference_id: 'item_1',
                        title: p.description ?? 'Payment',
                        quantity: 1,
                        unit_price: p.amount.toFixed(2),
                    }],
                },
                merchantUrls: {
                    success: p.callbackUrl,
                    cancel: p.cancelUrl ?? p.callbackUrl,
                    failure: p.callbackUrl,
                },
                lang: 'en',
            };

            // Add optional fields only if they have values
            if (p.description) {
                checkoutParams.description = p.description;
            }
            if (p.idempotencyKey) {
                checkoutParams.idempotencyKey = p.idempotencyKey;
            }
            if (p.metadata) {
                checkoutParams.meta = p.metadata;
            }

            const response = await this.createCheckoutSession(checkoutParams);

            return {
                success: response.status === 'created',
                gatewayId: response.payment.id,
                status: this.mapTabbyStatus(response.payment.status),
                redirectUrl: response.configuration.available_products?.installments?.[0]?.web_url,
                amount: parseFloat(response.payment.amount),
                rawResponse: response,
            };
        }, CreatePaymentParamsSchema);
    }

    /**
     * Create a Tabby checkout session with full BNPL cart data
     * @see https://docs.tabby.ai/api-reference/checkout/create-a-session
     */
    async createCheckoutSession(params: TabbyCheckoutSessionParams): Promise<TabbyCheckoutSessionResponse> {
        // Validate checkout session params
        const validationResult = TabbyCheckoutSessionParamsSchema.safeParse(params);
        if (!validationResult.success) {
            throw new InvalidRequestError(
                'Invalid checkout session params',
                validationResult.error.errors
            );
        }

        const body = {
            payment: {
                amount: params.amount,
                currency: params.currency,
                description: params.description,
                buyer: params.buyer,
                shipping_address: params.shippingAddress,
                order: params.order,
                meta: params.meta,
            },
            lang: params.lang ?? 'en',
            merchant_code: this.tabbyConfig.merchantCode,
            merchant_urls: params.merchantUrls,
        };

        return this.tabbyRequest<TabbyCheckoutSessionResponse>(
            'POST',
            '/api/v2/checkout',
            body
        );
    }

    /**
     * Check customer eligibility (pre-scoring) before showing Tabby option.
     * Uses the same checkout endpoint with lighter payload.
     */
    async checkEligibility(params: TabbyCheckoutSessionParams): Promise<{
        eligible: boolean;
        rejectionReason?: string | undefined;
        sessionId?: string | undefined;
    }> {
        try {
            const response = await this.createCheckoutSession(params);
            const isEligible = response.status === 'created';

            if (isEligible) {
                return {
                    eligible: true,
                    sessionId: response.id,
                };
            }

            return {
                eligible: false,
                rejectionReason: response.configuration.products?.installments?.rejection_reason ?? 'not_available',
                sessionId: response.id,
            };
        } catch (error) {
            return {
                eligible: false,
                rejectionReason: error instanceof Error ? error.message : 'unknown_error',
            };
        }
    }

    /**
     * Capture an authorized payment.
     * REQUIRED: Tabby payments must be captured after authorization.
     * @see https://docs.tabby.ai/api-reference/payments/capture-a-payment
     */
    async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("capturePayment", params, async (p) => {
            const body: Record<string, unknown> = {
                amount: p.amount?.toFixed(2) ?? undefined,
            };

            // If we have extended tabby params (from TabbyCaptureParams), use them
            const extParams = p as unknown as TabbyCaptureParams;
            if (extParams.referenceId) body.reference_id = extParams.referenceId;
            if (extParams.taxAmount) body.tax_amount = extParams.taxAmount;
            if (extParams.shippingAmount) body.shipping_amount = extParams.shippingAmount;
            if (extParams.discountAmount) body.discount_amount = extParams.discountAmount;
            if (extParams.items) body.items = extParams.items;

            const response = await this.tabbyRequest<TabbyPaymentResponse>(
                'POST',
                `/api/v2/payments/${p.gatewayPaymentId}/captures`,
                body
            );

            return {
                success: true,
                gatewayId: response.id,
                status: this.mapTabbyStatus(response.status),
                redirectUrl: undefined,
                amount: parseFloat(response.amount),
                capturedAmount: this.sumCaptures(response.captures),
                rawResponse: response,
            };
        }, CaptureParamsSchema);
    }

    /**
     * Refund a payment (full or partial).
     * Only CLOSED payments can be refunded.
     * @see https://docs.tabby.ai/api-reference/payments/refund-a-payment
     */
    async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
        return this.executeWithHooks("refundPayment", params, async (p) => {
            const body: Record<string, unknown> = {};

            if (p.amount) {
                body.amount = p.amount.toFixed(2);
            }
            if (p.reason) {
                body.reason = p.reason;
            }

            // Extended params
            const extParams = p as unknown as TabbyRefundParams;
            if (extParams.referenceId) body.reference_id = extParams.referenceId;
            if (extParams.items) body.items = extParams.items;

            const response = await this.tabbyRequest<TabbyPaymentResponse>(
                'POST',
                `/api/v2/payments/${p.gatewayPaymentId}/refunds`,
                body
            );

            const latestRefund = response.refunds[response.refunds.length - 1];

            return {
                success: true,
                gatewayRefundId: latestRefund?.id ?? response.id,
                status: 'completed',
                totalRefunded: this.sumRefunds(response.refunds),
                rawResponse: response,
            };
        }, RefundParamsSchema);
    }

    /**
     * Close/void a payment.
     * Use this to cancel a payment before capture or after partial capture.
     * @see https://docs.tabby.ai/api-reference/payments/close-a-payment
     */
    async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("voidPayment", params, async (p) => {
            const response = await this.tabbyRequest<TabbyPaymentResponse>(
                'POST',
                `/api/v2/payments/${p.gatewayPaymentId}/close`
            );

            return {
                success: true,
                gatewayId: response.id,
                status: this.mapTabbyStatus(response.status),
                redirectUrl: undefined,
                amount: parseFloat(response.amount),
                rawResponse: response,
            };
        }, VoidParamsSchema);
    }

    /**
     * Get payment status
     * @see https://docs.tabby.ai/api-reference/payments/retrieve-a-payment
     */
    async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
        const result = await this.getPayment({ gatewayPaymentId: gatewayId });
        return result.status;
    }

    /**
     * Retrieve payment details (standard interface)
     * @see https://docs.tabby.ai/api-reference/payments/retrieve-a-payment
     */
    async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
        const response = await this.getTabbyPaymentDetails(params.gatewayPaymentId);

        return {
            success: true,
            gatewayId: response.id,
            status: this.mapTabbyStatus(response.status),
            redirectUrl: undefined,
            amount: parseFloat(response.amount),
            capturedAmount: this.sumCaptures(response.captures),
            refundedAmount: this.sumRefunds(response.refunds),
            rawResponse: response,
        };
    }

    /**
     * Retrieve full Tabby payment details (Tabby-specific response type)
     */
    async getTabbyPaymentDetails(paymentId: string): Promise<TabbyPaymentResponse> {
        return this.tabbyRequest<TabbyPaymentResponse>(
            'GET',
            `/api/v2/payments/${paymentId}`
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Error Mapping
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Map Tabby errors to standardized SDK errors
     */
    protected mapError(error: unknown): Error {
        if (error instanceof GatewayApiError && error.gatewayName === 'tabby') {
            const raw = error.rawError as TabbyErrorResponse | undefined;
            const errorType = raw?.errorType;
            const message = raw?.error ?? error.message;

            switch (errorType) {
                case 'unauthorized':
                    return new AuthenticationError(message, raw);
                case 'invalid_request_error':
                case 'bad_data':
                    return new InvalidRequestError(message, [raw]);
            }
        }
        return super.mapError(error);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Handling
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Verify Tabby webhook authenticity.
     * Tabby uses optional auth header verification (no HMAC).
     * Also logs IP for whitelist verification.
     */
    verifyWebhook(payload: unknown, signature?: string, headers?: Record<string, string>): boolean {
        // If webhook auth header is configured, verify it
        if (this.tabbyConfig.webhookAuthHeader) {
            const authHeader = signature ?? headers?.['authorization'] ?? headers?.['x-tabby-auth'];
            if (!authHeader) {
                console.warn("[Tabby] Webhook verification failed: missing auth header");
                return false;
            }
            if (authHeader !== this.tabbyConfig.webhookAuthHeader) {
                console.warn("[Tabby] Webhook verification failed: auth header mismatch");
                return false;
            }
        }

        // Log source IP for manual whitelist verification if needed
        const sourceIp = headers?.['x-forwarded-for'] ?? headers?.['x-real-ip'];
        if (sourceIp) {
            console.log(`[Tabby] Webhook received from IP: ${sourceIp}`);
        }

        return true;
    }

    /**
     * Parse Tabby webhook event into normalized format
     */
    parseWebhookEvent(payload: unknown): WebhookEvent {
        let raw: TabbyWebhookPayload;
        if (typeof payload === 'string') {
            raw = JSON.parse(payload) as TabbyWebhookPayload;
        } else {
            raw = payload as TabbyWebhookPayload;
        }

        // Extract internal payment ID from meta
        const paymentId = raw.meta?.paymentId as string | undefined;

        // Map webhook status (lowercase) to unified status
        let status: PaymentStatus;
        switch (raw.status) {
            case 'authorized':
                status = 'authorized';
                break;
            case 'closed':
                // Check if refunded
                if (raw.refunds && raw.refunds.length > 0) {
                    const totalCaptured = this.sumCaptures(raw.captures);
                    const totalRefunded = this.sumRefunds(raw.refunds);
                    status = totalRefunded >= totalCaptured ? 'refunded' : 'partially_refunded';
                } else {
                    status = 'paid'; // Closed = fully captured/paid
                }
                break;
            case 'rejected':
                status = 'failed';
                break;
            case 'expired':
                status = 'cancelled';
                break;
            default:
                status = 'pending';
        }

        // Determine event type based on status and captures/refunds
        let eventType = `payment.${raw.status}`;
        if (raw.captures.length > 0 && raw.status === 'authorized') {
            eventType = 'payment.captured';
        }
        if (raw.refunds.length > 0) {
            eventType = 'payment.refunded';
        }

        return {
            id: raw.id,
            type: eventType,
            gateway: 'tabby',
            paymentId,
            gatewayPaymentId: raw.id,
            status,
            amount: parseFloat(raw.amount),
            currency: raw.currency,
            timestamp: new Date(raw.created_at),
            rawPayload: raw,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Private Methods
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Make request to Tabby API
     */
    private async tabbyRequest<T>(
        method: string,
        endpoint: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.tabbyConfig.secretKey}`,
            'Content-Type': 'application/json',
        };

        const options: RequestInit = {
            method,
            headers,
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(body);
        }

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${endpoint}`, options);
        } catch (e) {
            throw new NetworkError('Failed to reach Tabby API', e);
        }

        const data = await response.json() as T | TabbyErrorResponse;

        if (!response.ok) {
            const errorData = data as TabbyErrorResponse;
            throw new GatewayApiError(
                errorData.error ?? "Tabby API error",
                "tabby",
                errorData
            );
        }

        return data as T;
    }

    /**
     * Map Tabby status to unified status
     */
    private mapTabbyStatus(tabbyStatus: TabbyPaymentStatus): PaymentStatus {
        const map: Record<TabbyPaymentStatus, PaymentStatus> = {
            'CREATED': 'pending',
            'AUTHORIZED': 'authorized',
            'CLOSED': 'paid',
            'REJECTED': 'failed',
            'EXPIRED': 'cancelled',
        };
        return map[tabbyStatus] ?? 'pending';
    }

    /**
     * Sum capture amounts
     */
    private sumCaptures(captures: Array<{ amount: string }>): number {
        return captures.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    }

    /**
     * Sum refund amounts
     */
    private sumRefunds(refunds: Array<{ amount: string }>): number {
        return refunds.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    }
}
