// file: packages/payments/src/types/payment.types.ts

import type { MoyasarPaymentSource } from "./moyasar-source.types";

/**
 * Supported payment gateway names
 */
export type GatewayName = "moyasar" | "paypal" | "paymob" | "stripe" | "tabby" | "tamara";

/**
 * Unified payment status across all gateways
 */
export type PaymentStatus =
    | "pending"
    | "processing"
    | "authorized"
    | "approved"
    | "paid"
    | "failed"
    | "cancelled"
    | "refunded"
    | "partially_refunded";

/**
 * Refund processing status
 */
export type RefundStatus = "pending" | "completed" | "failed";

/**
 * Parameters for creating a new payment
 */
export interface CreatePaymentParams {
    /** Amount in base currency units (e.g., SAR, not halalas) */
    amount: number;
    /** ISO 4217 currency code */
    currency: string;
    /** URL to redirect after payment completion */
    callbackUrl: string;
    /** Optional order/transaction ID for your system */
    orderId?: string;
    /** Payment description shown to customer */
    description?: string;
    /** Custom metadata to attach to payment */
    metadata?: Record<string, unknown>;

    /**
     * Whether to capture the payment immediately.
     * Default: true
     * Set to false to only authorize the amount (requires manual capture later).
     */
    capture?: boolean;

    /**
     * Idempotency key for safe retries (UUIDv4 recommended).
     * Moyasar: Maps to `given_id` - becomes the payment ID.
     * Prevents duplicate charges on network failures.
     */
    idempotencyKey?: string;

    // ═══════════════════════════════════════════════════════════════════════════
    // Stripe-specific fields
    // ═══════════════════════════════════════════════════════════════════════════

    /** Stripe: Payment Method ID (from Stripe.js) */
    stripePaymentMethodId?: string;
    /** Stripe: Customer ID for saved payment methods */
    stripeCustomerId?: string;
    /** Stripe: Setup for future usage */
    stripeSetupFutureUsage?: 'on_session' | 'off_session';

    // ═══════════════════════════════════════════════════════════════════════════
    // Moyasar-specific fields
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Moyasar payment source.
     * Supports: creditcard, token, applepay, samsungpay, stcpay.
     * Takes precedence over `tokenId` if both are provided.
     */
    moyasarSource?: MoyasarPaymentSource;

    /**
     * @deprecated Use `moyasarSource` with type 'token' instead.
     * Kept for backwards compatibility.
     * Moyasar: Card token from Moyasar.js
     */
    tokenId?: string;

    /** Moyasar: Whether to apply merchant coupon */
    applyCoupon?: boolean;

    // ═══════════════════════════════════════════════════════════════════════════
    // PayPal-specific fields
    // ═══════════════════════════════════════════════════════════════════════════

    /** PayPal: Return URL after approval */
    returnUrl?: string;
    /** PayPal: Cancel URL if customer cancels */
    cancelUrl?: string;
}

/**
 * Parameters for capturing an authorized payment
 */
export interface CaptureParams {
    /** Gateway's payment ID */
    gatewayPaymentId: string;
    /** Amount to capture (optional, defaults to full amount) */
    amount?: number;
}

/**
 * Parameters for refunding a payment
 */
export interface RefundParams {
    /** Gateway's payment ID to refund */
    gatewayPaymentId: string;
    /** Amount to refund (optional, undefined = full refund) */
    amount?: number;
    /** Reason for refund */
    reason?: string;
    /** ISO 4217 currency code (required for PayPal partial refunds) */
    currency?: string;
}

/**
 * Parameters for voiding a payment
 */
export interface VoidParams {
    /** Gateway's payment ID to void */
    gatewayPaymentId: string;
}

/**
 * Parameters for retrieving a payment
 */
export interface GetPaymentParams {
    /** Gateway's payment ID to retrieve */
    gatewayPaymentId: string;
}

/**
 * Result from gateway payment operations
 */
export interface GatewayPaymentResult {
    /** Whether the API call succeeded */
    success: boolean;
    /** Gateway's unique payment ID */
    gatewayId: string;
    /** Normalized payment status */
    status: PaymentStatus;
    /** Redirect URL for 3DS/PayPal approval (if applicable) - may be undefined */
    redirectUrl: string | undefined;
    /** Amount in base currency units (e.g., SAR) */
    amount?: number | undefined;
    /** Fee charged by gateway in base currency units */
    fee?: number | undefined;
    /** Amount captured so far (for partial captures) in base currency units */
    capturedAmount?: number | undefined;
    /** Amount refunded so far (for partial refunds) in base currency units */
    refundedAmount?: number | undefined;
    /** Raw response from the gateway API */
    rawResponse: unknown;
}

/**
 * Result from gateway refund operations.
 * Note: Some gateways (like Moyasar) don't have separate refund entities.
 * The refund is tracked on the payment object itself.
 */
export interface GatewayRefundResult {
    /** Whether the API call succeeded */
    success: boolean;
    /**
     * Gateway's refund identifier.
     * For Moyasar: This is the payment ID (refunds are tracked on payment).
     * For PayPal: This is the actual refund ID.
     */
    gatewayRefundId: string;
    /** Refund processing status */
    status: RefundStatus;
    /** Total amount refunded on this payment (in base currency units) */
    totalRefunded?: number | undefined;
    /** Timestamp when refund was processed */
    refundedAt?: Date | undefined;
    /** Raw response from the gateway API */
    rawResponse: unknown;
}
