// file: packages/payments/src/types/tamara.types.ts

/**
 * Tamara money/amount object
 */
export interface TamaraAmount {
    /** Amount value */
    amount: number;
    /** ISO 4217 currency code (SAR, AED, KWD, BHD, OMR) */
    currency: string;
}

/**
 * Tamara consumer/customer information
 */
export interface TamaraConsumer {
    /** Customer email */
    email: string;
    /** Customer first name */
    first_name: string;
    /** Customer last name */
    last_name: string;
    /** Phone number (without country code) */
    phone_number: string;
}

/**
 * Tamara shipping/billing address
 */
export interface TamaraAddress {
    /** City name */
    city: string;
    /** ISO 3166-1 alpha-2 country code */
    country_code: string;
    /** First name */
    first_name: string;
    /** Last name */
    last_name: string;
    /** Address line 1 */
    line1: string;
    /** Address line 2 */
    line2?: string;
    /** Phone number */
    phone_number: string;
    /** Region/state */
    region: string;
}

/**
 * Tamara order line item
 */
export interface TamaraOrderItem {
    /** Product name (max 255 chars) */
    name: string;
    /** Quantity */
    quantity: number;
    /** Merchant's item reference ID */
    reference_id: string;
    /** Item type (Physical, Digital) */
    type: 'Physical' | 'Digital';
    /** Product SKU (max 128 chars) */
    sku: string;
    /** Item URL */
    item_url?: string;
    /** Image URL */
    image_url?: string;
    /** Unit price */
    unit_price?: TamaraAmount;
    /** Tax amount */
    tax_amount?: TamaraAmount;
    /** Discount amount */
    discount_amount?: TamaraAmount;
    /** Total amount for this line (required) */
    total_amount: TamaraAmount;
}

/**
 * Tamara discount object
 */
export interface TamaraDiscount {
    /** Discount/voucher name */
    name: string;
    /** Discount amount */
    amount: TamaraAmount;
}

/**
 * Tamara merchant redirect URLs
 */
export interface TamaraMerchantUrls {
    /** Success redirect URL */
    success: string;
    /** Failure redirect URL */
    failure: string;
    /** Cancel redirect URL */
    cancel: string;
    /** Webhook notification URL */
    notification: string;
}

/**
 * Risk assessment data for Tamara
 */
export interface TamaraRiskAssessment {
    customer_age?: number;
    customer_dob?: string;
    customer_gender?: 'Male' | 'Female';
    customer_nationality?: string;
    is_premium_customer?: boolean;
    is_existing_customer?: boolean;
    is_guest_user?: boolean;
    account_creation_date?: string;
    date_of_first_transaction?: string;
    is_card_on_file?: boolean;
    is_COD_customer?: boolean;
    has_delivered_order?: boolean;
    is_phone_verified?: boolean;
    is_fraudulent_customer?: boolean;
    total_ltv?: number;
    total_order_count?: number;
    order_amount_last3months?: number;
    order_count_last3months?: number;
    last_order_date?: string;
    last_order_amount?: number;
}

/**
 * Parameters for creating a Tamara checkout session
 */
export interface TamaraCheckoutSessionParams {
    /** Total order amount */
    total_amount: TamaraAmount;
    /** Shipping amount */
    shipping_amount: TamaraAmount;
    /** Tax amount */
    tax_amount: TamaraAmount;
    /** Merchant's unique order reference ID */
    order_reference_id: string;
    /** Order number for customer communication (defaults to order_reference_id) */
    order_number?: string;
    /** Discount information */
    discount?: TamaraDiscount;
    /** Order line items */
    items: TamaraOrderItem[];
    /** Customer information */
    consumer: TamaraConsumer;
    /** Two-letter country code (SA, AE, BH, KW, OM) */
    country_code: 'SA' | 'AE' | 'BH' | 'KW' | 'OM';
    /** Order description (max 256 chars) */
    description: string;
    /** Redirect URLs */
    merchant_url: TamaraMerchantUrls;
    /** Billing address */
    billing_address?: TamaraAddress;
    /** Shipping address */
    shipping_address: TamaraAddress;
    /** Platform name */
    platform?: string;
    /** Is mobile device */
    is_mobile?: boolean;
    /** Locale (ar_SA, en_US) */
    locale?: 'ar_SA' | 'en_US';
    /** Payment type */
    payment_type?: 'PAY_BY_INSTALMENTS' | 'PAY_NOW';
    /** Number of instalments */
    instalments?: number;
    /** Risk assessment data */
    risk_assessment?: TamaraRiskAssessment;
    /** Additional custom data */
    additional_data?: Record<string, unknown>;
    /** Order expiry time in minutes (5-1440) */
    expires_in_minutes?: number;
}

/**
 * Tamara checkout session response
 */
export interface TamaraCheckoutSessionResponse {
    /** Tamara order ID */
    order_id: string;
    /** Checkout session ID */
    checkout_id: string;
    /** URL to redirect customer to */
    checkout_url: string;
    /** Session status */
    status: 'new';
}

/**
 * Tamara order status values
 */
export type TamaraOrderStatus =
    | 'new'
    | 'declined'
    | 'expired'
    | 'approved'
    | 'authorised'
    | 'fully_captured'
    | 'partially_captured'
    | 'fully_refunded'
    | 'partially_refunded'
    | 'canceled'
    | 'updated';

/**
 * Tamara authorise response
 */
export interface TamaraAuthoriseResponse {
    /** Tamara order ID */
    order_id: string;
    /** Order status */
    status: TamaraOrderStatus;
    /** Order expiry time (ISO 8601) */
    order_expiry_time: string;
    /** Payment type */
    payment_type: 'PAY_BY_INSTALMENTS' | 'PAY_NOW';
    /** Whether auto-captured */
    auto_captured: boolean;
    /** Capture ID (if auto-captured) */
    capture_id?: string;
    /** Authorized amount */
    authorized_amount: TamaraAmount;
}

/**
 * Shipping info for capture
 */
export interface TamaraShippingInfo {
    /** Shipped timestamp (ISO 8601) */
    shipped_at: string;
    /** Shipping company name */
    shipping_company: string;
    /** Tracking number */
    tracking_number: string;
    /** Tracking URL */
    tracking_url?: string;
}

/**
 * Parameters for capturing a Tamara order
 */
export interface TamaraCaptureParams {
    /** Tamara order ID */
    order_id: string;
    /** Amount to capture */
    total_amount: TamaraAmount;
    /** Shipping info (required) */
    shipping_info: TamaraShippingInfo;
    /** Items being shipped */
    items?: TamaraOrderItem[];
    /** Discount amount */
    discount_amount?: TamaraAmount;
    /** Shipping amount */
    shipping_amount?: TamaraAmount;
    /** Tax amount */
    tax_amount?: TamaraAmount;
}

/**
 * Tamara capture response
 */
export interface TamaraCaptureResponse {
    /** Capture ID */
    capture_id: string;
    /** Tamara order ID */
    order_id: string;
    /** Capture status */
    status: 'fully_captured' | 'partially_captured';
    /** Captured amount (API may return array or single object) */
    captured_amount: TamaraAmount | TamaraAmount[];
}

/**
 * Parameters for simplified refund
 */
export interface TamaraRefundParams {
    /** Tamara order ID */
    order_id: string;
    /** Amount to refund */
    total_amount: TamaraAmount;
    /** Refund comment/reason */
    comment: string;
    /** Merchant's refund ID */
    merchant_refund_id?: string;
}

/**
 * Tamara refund response
 */
export interface TamaraRefundResponse {
    /** Tamara order ID */
    order_id: string;
    /** Refund comment */
    comment: string;
    /** Refund ID */
    refund_id: string;
    /** Capture ID */
    capture_id: string;
    /** Refund status */
    status: 'fully_refunded' | 'partially_refunded';
    /** Refunded amount (API may return array or single object) */
    refunded_amount: TamaraAmount | TamaraAmount[];
}

/**
 * Parameters for canceling a Tamara order
 */
export interface TamaraCancelParams {
    /** Tamara order ID */
    order_id: string;
    /** Amount to cancel */
    total_amount: TamaraAmount;
    /** Shipping amount */
    shipping_amount?: TamaraAmount;
    /** Tax amount */
    tax_amount?: TamaraAmount;
    /** Discount amount */
    discount_amount?: TamaraAmount;
    /** Items being canceled */
    items?: TamaraOrderItem[];
}

/**
 * Tamara cancel response
 */
export interface TamaraCancelResponse {
    /** Cancel ID */
    cancel_id: string;
    /** Tamara order ID */
    order_id: string;
    /** Cancel status (canceled = full, updated = partial) */
    status: 'canceled' | 'updated';
    /** Canceled amount */
    canceled_amount: TamaraAmount;
}

/**
 * Tamara order details response
 */
export interface TamaraOrderDetails {
    order_id: string;
    order_reference_id: string;
    order_number?: string;
    status: TamaraOrderStatus;
    total_amount: TamaraAmount;
    items: TamaraOrderItem[];
    consumer: TamaraConsumer;
    shipping_address: TamaraAddress;
    billing_address?: TamaraAddress;
    created_at: string;
    captured_amount?: TamaraAmount;
    refunded_amount?: TamaraAmount;
    canceled_amount?: TamaraAmount;
}

/**
 * Tamara API error response
 */
export interface TamaraErrorResponse {
    message?: string;
    error?: string;
    errors?: Array<{
        field?: string;
        error_code?: string;
        message?: string;
    }>;
}
