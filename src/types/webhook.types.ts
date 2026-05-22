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
    /** Gateway object ID that emitted the event when different from the payment ID */
    gatewayObjectId?: string | undefined;
    /** Gateway token emitted by setup/tokenization events, when applicable */
    gatewayToken?: string | undefined;
    /** Normalized payment status */
    status: PaymentStatus;
    /** Whether the gateway event came from live mode when the gateway exposes that flag. */
    livemode?: boolean | undefined;
    /** Gateway API version that shaped the webhook payload, when exposed. */
    apiVersion?: string | undefined;
    /** Amount in base currency units, when the gateway event includes money details */
    amount?: number | undefined;
    /** Currency code, when the gateway event includes money details */
    currency?: string | undefined;
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
    type: 'payment_paid' | 'payment_faild' | 'payment_failed' | 'payment_authorized' | string;
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
        id?: string;
        order_id?: string;
        status?: string;
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
        /** HATEOAS links, including refund -> capture links for refund webhooks */
        links?: Array<{
            href: string;
            rel: string;
            method?: string;
        }>;
        /** Purchase units (for order events) */
        purchase_units?: Array<{
            reference_id?: string;
            custom_id?: string;
            amount?: {
                currency_code: string;
                value: string;
            };
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
        id: number | string;
        /** Whether the transaction is pending */
        pending: boolean | string;
        /** Whether the transaction succeeded */
        success: boolean | string;
        /** Amount in cents */
        amount_cents: number | string;
        /** Currency code */
        currency: string;
        /** ISO timestamp of transaction creation */
        created_at: string;
        /** Whether this is an authorization transaction */
        is_auth: boolean | string;
        /** Whether this is a capture transaction */
        is_capture: boolean | string;
        /** Whether this is a void transaction */
        is_void: boolean | string;
        /** Whether this is a refund transaction */
        is_refund: boolean | string;
        /** Current Paymob field indicating the transaction has been voided */
        is_voided?: boolean | string;
        /** Current Paymob field indicating the transaction has been refunded */
        is_refunded?: boolean | string;
        /** Whether this is a standalone payment */
        is_standalone_payment: boolean | string;
        /** Whether this has a parent transaction */
        has_parent_transaction: boolean | string;
        /** Whether an error occurred */
        error_occured: boolean | string;
        /** Whether 3D Secure was used */
        is_3d_secure: boolean | string;
        /** Integration ID used */
        integration_id: number | string;
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
        /** Total refunded amount in cents, when included by Paymob */
        refunded_amount_cents?: number | string;
        /** Total captured amount in cents, when included by Paymob */
        captured_amount?: number | string;
        /** Whether the transaction has been captured */
        is_captured?: boolean | string;
        /** Error/status message from gateway */
        data_message?: string;
        /** Payment key claims - contains extras metadata from Intention API */
        payment_key_claims?: {
            /** Extras object (custom metadata passed during payment creation) */
            extra?: Record<string, unknown> & {
                creation_extras?: Record<string, unknown>;
            };
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
 * Paymob card-token callback payload.
 * Uses a different HMAC field list from transaction callbacks.
 * @see https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-for-card-tokens
 */
export interface PaymobCardTokenWebhookPayload {
    type: 'TOKEN' | string;
    obj: {
        id: number;
        token: string;
        masked_pan: string;
        merchant_id: number;
        card_subtype: string;
        created_at: string;
        email: string;
        order_id: string | number;
        user_added?: boolean;
        next_payment_intention?: string;
    };
    hmac?: string;
}

/**
 * Paymob transaction response/redirection callback payload.
 * Paymob sends this through the customer's browser as query parameters, so
 * values are usually strings even when they represent numbers or booleans.
 */
export interface PaymobRedirectWebhookPayload {
    type?: string;
    id: string | number;
    pending: string | boolean;
    success: string | boolean;
    amount_cents: string | number;
    currency: string;
    created_at?: string;
    merchant_order_id?: string;
    order?: string | number;
    owner?: string | number;
    integration_id?: string | number;
    is_3d_secure?: string | boolean;
    is_auth?: string | boolean;
    is_capture?: string | boolean;
    is_refund?: string | boolean;
    is_refunded?: string | boolean;
    is_standalone_payment?: string | boolean;
    is_void?: string | boolean;
    is_voided?: string | boolean;
    has_parent_transaction?: string | boolean;
    error_occured?: string | boolean;
    "order.id"?: string | number;
    "source_data.pan"?: string;
    "source_data.sub_type"?: string;
    "source_data.type"?: string;
    source_data_pan?: string;
    source_data_sub_type?: string;
    source_data_type?: string;
    hmac?: string;
    [key: string]: unknown;
}

/**
 * Stripe webhook payload structure
 */
export interface StripeWebhookPayload {
    id: string;
    type: string;
    api_version?: string | null;
    created: number;
    data: {
        object: {
            id: string;
            object: string;
            status: string;
            amount?: number;
            /** Total refunded amount in smallest currency unit (for charge.refunded) */
            amount_refunded?: number;
            /** Amount total in smallest currency unit (for checkout sessions) */
            amount_total?: number;
            currency?: string;
            /** Payment status (for checkout sessions: 'paid' | 'unpaid' | 'no_payment_required') */
            payment_status?: string;
            metadata?: Record<string, string>;
            payment_intent?: string | { id: string } | null;
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
