// file: packages/payments/src/types/webhook.types.ts

import type { GatewayName, PaymentStatus } from './payment.types';

/**
 * Normalized webhook event from any gateway
 */
export interface WebhookEvent {
    /** Unique event ID from gateway */
    id: string;
    /** Event type (e.g., 'payment_paid', 'payment_failed') */
    type: string;
    /** Which gateway sent this webhook */
    gateway: GatewayName;
    /** Your internal payment ID (from metadata) - may be undefined if not provided */
    paymentId: string | undefined;
    /** Gateway's payment ID */
    gatewayPaymentId: string;
    /** Normalized payment status */
    status: PaymentStatus;
    /** Amount in base currency units */
    amount: number;
    /** Currency code */
    currency: string;
    /** When the event occurred */
    timestamp: Date;
    /** Original raw payload from gateway */
    rawPayload: unknown;
}

/**
 * Moyasar-specific webhook payload structure
 */
export interface MoyasarWebhookPayload {
    id: string;
    type: 'payment_paid' | 'payment_failed' | 'payment_authorized' | string;
    created_at: string;
    secret_token: string;
    account_name: string | null;
    live: boolean;
    data: {
        id: string;
        status: 'paid' | 'failed' | 'pending' | 'initiated' | 'authorized' | 'refunded' | string;
        amount: number;
        fee: number;
        currency: string;
        refunded: number;
        refunded_at: string | null;
        captured: number;
        captured_at: string | null;
        voided_at: string | null;
        description: string;
        amount_format: string;
        fee_format: string;
        refunded_format: string;
        captured_format: string;
        invoice_id: string | null;
        ip: string;
        callback_url: string;
        created_at: string;
        updated_at: string;
        metadata: Record<string, unknown> & {
            paymentId?: string;
        };
        source: {
            type: 'creditcard' | string;
            company: string;
            name: string;
            number: string;
            gateway_id: string;
            reference_number: string | number | null;
            token: string | null;
            message: string | null;
            transaction_url: string | null;
            response_code: string | null;
            authorization_code: string | null;
        };
    };
}

/**
 * PayPal webhook payload structure
 * @see https://developer.paypal.com/docs/api/webhooks/v1/#webhooks_event-types
 */
export interface PayPalWebhookPayload {
    id: string;
    event_type: string;
    create_time: string;
    resource_type: string;
    resource: {
        id: string;
        status: string;
        /** Amount (optional for non-payment events like disputes) */
        amount?: {
            currency_code: string;
            value: string;
        };
        custom_id?: string;
        /** Supplementary data containing related IDs */
        supplementary_data?: {
            related_ids?: {
                order_id?: string;
                authorization_id?: string;
                capture_id?: string;
            };
        };
        /** Purchase units (for order events) */
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
    };
}

/**
 * Paymob webhook payload structure (KSA API)
 * @see https://developers.paymob.com/ksa/manage-callback/hmac/hmac-processed-callback
 */
export interface PaymobWebhookPayload {
    type: string;
    obj: {
        /** Transaction ID */
        id: number;
        /** Whether the transaction is pending */
        pending: boolean;
        /** Whether the transaction succeeded */
        success: boolean;
        /** Amount in cents */
        amount_cents: number;
        /** Currency code */
        currency: string;
        /** ISO timestamp of transaction creation */
        created_at: string;
        /** Whether this is an authorization transaction */
        is_auth: boolean;
        /** Whether this is a capture transaction */
        is_capture: boolean;
        /** Whether this is a void transaction */
        is_void: boolean;
        /** Whether this is a refund transaction */
        is_refund: boolean;
        /** Whether this is a standalone payment */
        is_standalone_payment: boolean;
        /** Whether this has a parent transaction */
        has_parent_transaction: boolean;
        /** Whether an error occurred */
        error_occured: boolean;
        /** Whether 3D Secure was used */
        is_3d_secure: boolean;
        /** Integration ID used */
        integration_id: number;
        /** Profile ID */
        profile_id: number;
        /** Owner ID (merchant user ID) */
        owner?: number;
        /** Source data for the payment */
        source_data: {
            /** Payment source type */
            type: string;
            /** Masked card PAN */
            pan: string;
            /** Card sub-type (e.g., 'MADA', 'VISA') */
            sub_type: string;
        };
        /** Order information */
        order: {
            id: number;
            merchant_order_id?: string;
        };
        /** Gateway transaction ID */
        transaction_id?: string;
        /** Error/status message from gateway */
        data_message?: string;
        /** Payment key claims - contains extras metadata from Intention API */
        payment_key_claims?: {
            /** Extras object (custom metadata passed during payment creation) */
            extra?: Record<string, unknown>;
            /** Amount in cents */
            amount_cents?: number;
            /** Currency code */
            currency?: string;
            /** Order ID (Paymob internal) */
            order_id?: number;
            /** Integration ID used */
            integration_id?: number;
        };
    };
    /** HMAC signature (sent in query params or body) */
    hmac?: string;
}

/**
 * Stripe webhook payload structure
 */
export interface StripeWebhookPayload {
    id: string;
    type: string;
    created: number;
    data: {
        object: {
            id: string;
            object: string;
            status: string;
            amount?: number;
            /** Amount total in smallest currency unit (for checkout sessions) */
            amount_total?: number;
            currency?: string;
            /** Payment status (for checkout sessions: 'paid' | 'unpaid' | 'no_payment_required') */
            payment_status?: string;
            metadata?: Record<string, string>;
            payment_intent?: string;
            latest_charge?: string;
        };
    };
    livemode: boolean;
}

/**
 * Tabby webhook payload structure
 * @see https://docs.tabby.ai/api-reference/webhooks
 */
export interface TabbyWebhookPayload {
    /** Payment ID */
    id: string;
    /** Payment status (lowercase in webhooks) */
    status: 'authorized' | 'closed' | 'rejected' | 'expired';
    /** Creation timestamp (ISO 8601) */
    created_at: string;
    /** Expiration timestamp */
    expires_at?: string;
    /** Closure timestamp */
    closed_at?: string;
    /** Whether payment is expired */
    is_expired?: boolean;
    /** Whether this is a test payment */
    is_test: boolean;
    /** Payment amount as string */
    amount: string;
    /** ISO 4217 currency code */
    currency: string;
    /** Order reference */
    order: {
        reference_id: string;
    };
    /** Capture records */
    captures: Array<{
        id: string;
        amount: string;
        created_at: string;
        reference_id?: string;
    }>;
    /** Refund records */
    refunds: Array<{
        id: string;
        amount: string;
        created_at: string;
        reference_id?: string;
        reason?: string;
    }>;
    /** Custom metadata */
    meta?: Record<string, unknown>;
    /** Token (if tokenized) */
    token?: string;
}

/**
 * Tamara webhook payload structure
 * @see https://developers.tamara.co/docs/getting-started-with-webhooks
 */
export interface TamaraWebhookPayload {
    /** Tamara order ID */
    order_id: string;
    /** Merchant's order reference ID */
    order_reference_id: string;
    /** Order number (for customer display) */
    order_number?: string;
    /** Event type */
    event_type:
    | 'order_approved'
    | 'order_declined'
    | 'order_authorised'
    | 'order_canceled'
    | 'order_captured'
    | 'order_refunded'
    | 'order_expired';
    /** Event data (varies by event type) */
    data:
    | {
        capture_id?: string;
        captured_amount?: { amount: number; currency: string };
        cancel_id?: string;
        canceled_amount?: { amount: number; currency: string };
        refund_id?: string;
        refunded_amount?: { amount: number; currency: string };
        declined_reason?: string;
        declined_code?: string;
        decline_type?: string;
        comment?: string;
    }
    | [];
}

