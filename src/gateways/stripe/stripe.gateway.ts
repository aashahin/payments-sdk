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
} from "../../types/payment.types";
import type { StripeWebhookPayload, WebhookEvent } from "../../types/webhook.types";
import type { StripeConfig } from "../../types/config.types";
import type { HooksManager } from "../../hooks/hooks.manager";
import { GatewayApiError, CardDeclinedError, InsufficientFundsError, AuthenticationError, RateLimitError, InvalidRequestError, NetworkError } from "../../errors";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
    CreatePaymentParamsSchema,
    CaptureParamsSchema,
    RefundParamsSchema,
    VoidParamsSchema,
    CreateCheckoutSessionParamsSchema,
    CreateCheckoutSessionParams
} from "../../types/validation";

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe API Response Types (Partial)
// ═══════════════════════════════════════════════════════════════════════════════

interface StripePaymentIntent {
    id: string;
    object: 'payment_intent';
    amount: number;
    amount_received: number;
    currency: string;
    status: string;
    client_secret: string;
    receipt_email: string | null;
    metadata: Record<string, string>;
    latest_charge: string | null;
}

interface StripeRefund {
    id: string;
    object: 'refund';
    amount: number;
    currency: string;
    payment_intent: string;
    status: string;
    metadata: Record<string, string>;
}

interface StripeErrorResponse {
    error: {
        message: string;
        type: string;
        code?: string;
        param?: string;
    };

}

interface StripeCheckoutSession {
    id: string;
    object: 'checkout.session';
    url: string | null;
    payment_status: string;
    status: string;
    customer: string | null;
    metadata: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: URL Encoded Serializer
// ═══════════════════════════════════════════════════════════════════════════════

function toUrlEncoded(obj: Record<string, any>, prefix?: string): URLSearchParams {
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
                    if (typeof item === 'object' && item !== null) {
                        const nestedParams = toUrlEncoded(item, arrayKey);
                        nestedParams.forEach((nestedValue, nestedKey) => {
                            params.append(nestedKey, nestedValue);
                        });
                    } else {
                        params.append(arrayKey, String(item));
                    }
                });
            } else if (typeof value === 'object') {
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

    constructor(config: StripeConfig, hooks: HooksManager) {
        super(config, hooks);
        this.stripeConfig = config;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a Stripe PaymentIntent
     */
    async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("createPayment", params, async (p) => {
            // Convert main amount to smallest currency unit (cents/halalas)
            // Stripe expects integer amounts
            const amountSmallestUnit = Math.round(p.amount * 100);

            const body: Record<string, any> = {
                amount: amountSmallestUnit,
                currency: p.currency.toLowerCase(),
                automatic_payment_methods: { enabled: true },
                description: p.description,
                metadata: p.metadata,
                capture_method: p.capture === false ? 'manual' : 'automatic',
            };

            // Support for manual capture/hold
            // In a real generic SDK, we might want a flag for "authorize only"
            // For now, consistent with others which mostly do pay immediately unless specified

            if (p.stripeCustomerId) {
                body.customer = p.stripeCustomerId;
            }

            if (p.stripePaymentMethodId) {
                body.payment_method = p.stripePaymentMethodId;
                body.confirm = true; // Confirm immediately if method provided
                if (p.callbackUrl) {
                    body.return_url = p.callbackUrl;
                }
            }

            if (p.stripeSetupFutureUsage) {
                body.setup_future_usage = p.stripeSetupFutureUsage;
            }

            const response = await this.stripeRequest<StripePaymentIntent>('POST', '/payment_intents', body, p.idempotencyKey);

            return {
                success: true,
                gatewayId: response.id,
                status: this.mapStatus(response.status),
                redirectUrl: undefined, // Stripe usually handles this via client-side SDK with client_secret
                amount: response.amount / 100, // Convert back to base unit
                rawResponse: response,
            };
        }, CreatePaymentParamsSchema);
    }

    /**
     * Capture a localized/authorized PaymentIntent
     */
    async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("capturePayment", params, async (p) => {
            const body: Record<string, any> = {};
            if (p.amount) {
                body.amount_to_capture = Math.round(p.amount * 100);
            }

            const response = await this.stripeRequest<StripePaymentIntent>(
                'POST',
                `/payment_intents/${p.gatewayPaymentId}/capture`,
                body
            );

            return {
                success: true,
                gatewayId: response.id,
                status: this.mapStatus(response.status),
                redirectUrl: undefined,
                amount: response.amount_received / 100,
                rawResponse: response,
            };
        }, CaptureParamsSchema);
    }

    /**
     * Refund a PaymentIntent (via Refunds API)
     */
    async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
        return this.executeWithHooks("refundPayment", params, async (p) => {
            const body: Record<string, any> = {
                payment_intent: p.gatewayPaymentId,
            };

            if (p.amount) {
                body.amount = Math.round(p.amount * 100);
            }

            if (p.reason) {
                // Stripe supports: duplicate, fraudulent, requested_by_customer
                // We map general string reason to metadata if not standard
                body.metadata = { reason: p.reason };
            }

            const response = await this.stripeRequest<StripeRefund>('POST', '/refunds', body);

            return {
                success: true,
                gatewayRefundId: response.id,
                status: response.status === 'succeeded' ? 'completed' : 'pending',
                totalRefunded: response.amount / 100,
                rawResponse: response,
            };
        }, RefundParamsSchema);
    }

    /**
     * Void/Cancel a payment (before it is captured)
     */
    async voidPayment(params: { gatewayPaymentId: string }): Promise<GatewayPaymentResult> {
        return this.executeWithHooks("voidPayment", params, async (p) => {
            const response = await this.stripeRequest<StripePaymentIntent>(
                'POST',
                `/payment_intents/${p.gatewayPaymentId}/cancel`
            );

            return {
                success: true,
                gatewayId: response.id,
                status: this.mapStatus(response.status),
                redirectUrl: undefined,
                amount: response.amount / 100,
                rawResponse: response,
            };
        }, VoidParamsSchema);
    }

    /**
     * Retrieve PaymentIntent details
     * @see https://stripe.com/docs/api/payment_intents/retrieve
     */
    async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
        const { gatewayPaymentId } = params;

        const paymentIntent = await this.stripeRequest<StripePaymentIntent>(
            'GET',
            `/payment_intents/${gatewayPaymentId}`
        );

        return {
            success: true,
            gatewayId: paymentIntent.id,
            status: this.mapStatus(paymentIntent.status),
            redirectUrl: undefined,
            amount: paymentIntent.amount / 100, // Stripe uses cents
            rawResponse: paymentIntent,
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
     * Create a Stripe Checkout Session for hosted payment page
     * @see https://stripe.com/docs/api/checkout/sessions/create
     */
    async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<{
        success: boolean;
        sessionId: string;
        url: string | null;
        rawResponse: unknown;
    }> {
        return this.executeWithHooks("createCheckoutSession", params, async (p) => {
            const body: Record<string, any> = {
                mode: p.mode ?? 'payment',
                success_url: p.successUrl,
                cancel_url: p.cancelUrl,
                metadata: p.metadata,
            };

            // Build line items
            if (p.lineItems) {
                body.line_items = p.lineItems.map(item => ({
                    price: item.price,
                    price_data: item.priceData ? {
                        currency: item.priceData.currency,
                        product_data: {
                            name: item.priceData.productData.name,
                            description: item.priceData.productData.description,
                            images: item.priceData.productData.images,
                        },
                        unit_amount: item.priceData.unitAmount,
                    } : undefined,
                    quantity: item.quantity,
                }));
            } else if (p.mode !== 'setup') {
                // Simple amount-based session
                body.line_items = [{
                    price_data: {
                        currency: p.currency.toLowerCase(),
                        product_data: { name: 'Payment' },
                        unit_amount: Math.round(p.amount * 100),
                    },
                    quantity: 1,
                }];
            }

            if (p.customerId) {
                body.customer = p.customerId;
            }
            if (p.customerEmail) {
                body.customer_email = p.customerEmail;
            }

            const response = await this.stripeRequest<StripeCheckoutSession>(
                'POST',
                '/checkout/sessions',
                body,
                p.idempotencyKey
            );

            return {
                success: true,
                sessionId: response.id,
                url: response.url,
                rawResponse: response,
            };
        }, CreateCheckoutSessionParamsSchema);
    }

    /**
     * Map Stripe errors to standardized SDK errors
     */
    protected mapError(error: unknown): Error {
        if (error instanceof GatewayApiError && error.gatewayName === 'stripe') {
            const raw = error.rawError as any;
            const code = raw?.error?.code;
            const declineCode = raw?.error?.decline_code;
            const message = raw?.error?.message ?? error.message;

            switch (code) {
                case 'card_declined':
                    if (declineCode === 'insufficient_funds') {
                        return new InsufficientFundsError(message, raw);
                    }
                    return new CardDeclinedError(message, raw);
                case 'incorrect_cvc':
                case 'incorrect_number':
                case 'expired_card':
                    return new CardDeclinedError(message, raw);
                case 'authentication_required':
                    return new AuthenticationError(message, raw);
                case 'rate_limit':
                    return new RateLimitError('stripe');
                case 'parameter_invalid_integer':
                case 'parameter_missing':
                    return new InvalidRequestError(message, [raw]);
            }
        }
        return super.mapError(error);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Handling
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Verify Stripe webhook signature
     * @see https://stripe.com/docs/webhooks/signatures
     */
    verifyWebhook(payload: unknown, signature?: string, headers?: Record<string, string>): boolean {
        if (!this.stripeConfig.webhookSecret) {
            console.warn("[Stripe] Webhook verification skipped: webhookSecret not configured");
            return true;
        }

        const sigHeader = signature || headers?.['stripe-signature'];
        if (!sigHeader) {
            console.warn("[Stripe] Missing stripe-signature header");
            return false;
        }

        // Parse signature header: t=TIMESTAMP,v1=SIGNATURE,...
        const parts = sigHeader.split(',').reduce((acc, part) => {
            const [key, value] = part.split('=');
            if (key && value) acc[key.trim()] = value.trim();
            return acc;
        }, {} as Record<string, string>);

        const timestamp = parts['t'];
        const v1Signature = parts['v1'];

        if (!timestamp || !v1Signature) {
            console.warn("[Stripe] Invalid signature header format");
            return false;
        }

        // Prevent replay attacks (5 minute tolerance)
        const eventTime = parseInt(timestamp, 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - eventTime > 300) {
            console.warn("[Stripe] Webhook signature timestamp too old");
            return false;
        }

        // Compute HMAC
        // Note: Payload here must be the raw string body. 
        // If the framework parsed it to JSON already, verification will fail.
        // The SDK usually assumes `payload` is the body. 
        // If it is an object, we assume it was JSON.stringified before or we can't verify.
        // For accurate verification, the raw string body is required.
        let rawBody: string;
        if (typeof payload === 'string') {
            rawBody = payload;
        } else if (Buffer.isBuffer(payload)) {
            rawBody = payload.toString('utf8');
        } else {
            // If payload is already an object, we cannot reconstruct the exact original formatting
            // (whitespace, key ordering) used for signature.
            // This is a known limitation when using frameworks that auto-parse JSON.
            console.warn("[Stripe] Warning: Verifying webhook with JSON object instead of raw body. Verification may fail if formatting differs.");
            rawBody = JSON.stringify(payload);
        }

        const signedPayload = `${timestamp}.${rawBody}`;
        const hmac = createHmac('sha256', this.stripeConfig.webhookSecret);
        hmac.update(signedPayload);
        const expectedSignature = hmac.digest('hex');

        try {
            return timingSafeEqual(
                Buffer.from(expectedSignature),
                Buffer.from(v1Signature)
            );
        } catch (e) {
            return false;
        }
    }

    /**
     * Parse Stripe webhook event
     */
    parseWebhookEvent(payload: unknown): WebhookEvent {
        // Stripe payload structure is { id: ..., type: ..., data: { object: ... } }
        // If payload is raw string, parse it
        let raw: StripeWebhookPayload;
        if (typeof payload === 'string') {
            raw = JSON.parse(payload) as StripeWebhookPayload;
        } else {
            raw = payload as StripeWebhookPayload;
        }

        const object = raw.data.object;

        // Extract payment ID
        const paymentId = object.metadata?.paymentId;
        const gatewayPaymentId = object.id;

        // Determine status/type
        let status: PaymentStatus = 'pending';
        let amount = 0;
        let currency = 'usd';

        if (object.amount) {
            amount = object.amount / 100;
        }
        // Checkout sessions use amount_total instead of amount
        if (object.amount_total) {
            amount = object.amount_total / 100;
        }
        if (object.currency) {
            currency = object.currency;
        }

        // Map status based on event type
        switch (raw.type) {
            case 'payment_intent.succeeded':
                status = 'paid';
                break;
            case 'payment_intent.payment_failed':
                status = 'failed';
                break;
            case 'payment_intent.canceled':
                status = 'cancelled';
                break;
            case 'payment_intent.created':
                status = 'pending';
                break;
            case 'checkout.session.completed':
                // Checkout sessions have a specific payment_status field
                const session = object as unknown as StripeCheckoutSession;
                if (session.payment_status === 'paid') {
                    status = 'paid';
                } else {
                    status = 'pending';
                }
                break;
            case 'charge.refunded':
                status = 'refunded';
                break;
            case 'charge.refund.updated':
                // Partial refund update - check refund status
                status = object.status === 'succeeded' ? 'partially_refunded' : 'pending';
                break;
            // Subscription schedule events (for future subscription management)
            case 'subscription_schedule.created':
            case 'subscription_schedule.updated':
            case 'subscription_schedule.released':
            case 'subscription_schedule.canceled':
            case 'subscription_schedule.completed':
            case 'subscription_schedule.expiring':
            case 'subscription_schedule.aborted':
                // Pass through with pending status - consumers should handle these specifically
                status = 'pending';
                break;
            default:
                // Fallback to object status mapping
                status = this.mapStatus(object.status);
        }

        return {
            id: raw.id,
            type: raw.type,
            gateway: 'stripe',
            paymentId,
            gatewayPaymentId,
            status,
            amount,
            currency,
            timestamp: new Date(raw.created * 1000),
            rawPayload: raw,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Private Methods
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Make request to Stripe API
     */
    private async stripeRequest<T>(method: string, endpoint: string, body?: Record<string, any>, idempotencyKey?: string): Promise<T> {
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.stripeConfig.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        };

        if (this.stripeConfig.apiVersion) {
            headers['Stripe-Version'] = this.stripeConfig.apiVersion;
        }

        if (idempotencyKey) {
            headers['Idempotency-Key'] = idempotencyKey;
        }

        const options: RequestInit = {
            method,
            headers,
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            options.body = toUrlEncoded(body);
        }

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}${endpoint}`, options);
        } catch (e) {
            throw new NetworkError('Failed to reach Stripe API', e);
        }

        const data = await response.json() as any;

        if (!response.ok) {
            throw new GatewayApiError(
                data.error?.message ?? "Stripe API error",
                "stripe",
                data
            );
        }

        return data as T;
    }

    /**
     * Map Stripe status to Unified Status
     */
    private mapStatus(stripeStatus: string): PaymentStatus {
        const map: Record<string, PaymentStatus> = {
            'requires_payment_method': 'pending',
            'requires_confirmation': 'pending',
            'requires_action': 'pending',
            'processing': 'processing',
            'requires_capture': 'authorized',
            'succeeded': 'paid',
            'canceled': 'cancelled',
        };
        return map[stripeStatus] ?? 'pending';
    }
}
