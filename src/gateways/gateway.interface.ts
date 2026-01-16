// file: packages/payments/src/gateways/gateway.interface.ts

import type {
    GatewayName,
    PaymentStatus,
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    VoidParams,
    GetPaymentParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type { WebhookEvent } from '../types/webhook.types';
import type { ValidatedCreateCheckoutSessionParams } from '../types/validation';

/**
 * Payment gateway interface that all gateway implementations must follow
 */
export interface PaymentGateway {
    /** Gateway identifier */
    readonly name: GatewayName;

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Payment Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a new payment
     */
    createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;

    /**
     * Capture an authorized payment
     */
    capturePayment(params: CaptureParams): Promise<GatewayPaymentResult>;

    /**
     * Refund a payment (full or partial)
     */
    refundPayment(params: RefundParams): Promise<GatewayRefundResult>;

    /**
     * Void/cancel an authorized payment before capture.
     * Releases the hold on customer's funds.
     */
    voidPayment?(params: VoidParams): Promise<GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Handling
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Verify webhook signature/authenticity (synchronous)
     */
    verifyWebhook(payload: unknown, signature?: string): boolean;

    /**
     * Verify webhook signature/authenticity asynchronously.
     * Required for gateways like PayPal that need API calls for verification,
     * or Tamara that requires JWT cryptographic verification.
     * If not implemented, the SDK falls back to synchronous verifyWebhook.
     * 
     * @param payload - The raw webhook payload
     * @param signatureOrHeaders - Either a signature string, or headers object for gateways that need multiple headers
     * @param headers - Optional headers object when signature is passed separately
     */
    verifyWebhookAsync?(
        payload: unknown,
        signatureOrHeaders?: string | Record<string, string>,
        headers?: Record<string, string>,
    ): Promise<boolean>;

    /**
     * Parse gateway-specific webhook into normalized WebhookEvent
     */
    parseWebhookEvent(payload: unknown): WebhookEvent;

    // ═══════════════════════════════════════════════════════════════════════════
    // Optional Operations
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Retrieve full payment details by gateway ID
     * @param params - Parameters containing the gateway payment ID
     */
    getPayment?(params: GetPaymentParams): Promise<GatewayPaymentResult>;

    /**
     * Get current status of a payment
     */
    getPaymentStatus?(gatewayId: string): Promise<PaymentStatus>;

    /**
     * Create a hosted checkout session.
     * Implementation varies by gateway (Stripe, Tabby, Tamara, etc.)
     * Use gateway-specific methods for typed access.
     */
    createCheckoutSession?(params: unknown): Promise<unknown>;
}
