// file: packages/payments/src/types/tabby.types.ts

/**
 * Tabby buyer information (required for all checkout sessions)
 */
export interface TabbyBuyer {
    /** Full name */
    name: string;
    /** Email address */
    email: string;
    /** Phone number (digits only, no country code prefix) */
    phone: string;
    /** Date of birth (YYYY-MM-DD format) */
    dob?: string;
}

/**
 * Tabby shipping/billing address
 */
export interface TabbyAddress {
    /** City name */
    city: string;
    /** Street address */
    address: string;
    /** Postal/ZIP code */
    zip: string;
}

/**
 * Tabby order line item
 */
export interface TabbyOrderItem {
    /** SKU or product reference ID */
    reference_id: string;
    /** Product title */
    title: string;
    /** Product description */
    description?: string;
    /** Quantity ordered */
    quantity: number;
    /** Unit price as string (e.g., "100.00") */
    unit_price: string;
    /** Discount amount as string */
    discount_amount?: string;
    /** Product image URL */
    image_url?: string;
    /** Product page URL */
    product_url?: string;
    /** Product category */
    category?: string;
    /** Brand name */
    brand?: string;
    /** Gender target (e.g., "Men", "Women", "Kids") */
    gender?: string;
    /** Color */
    color?: string;
    /** Size */
    size?: string;
    /** Size type (e.g., "EU", "US") */
    size_type?: string;
    /** Product material */
    product_material?: string;
    /** Whether item is refundable */
    is_refundable?: boolean;
    /** Barcode */
    barcode?: string;
    /** Seller name (for marketplace) */
    seller?: string;
}

/**
 * Tabby order container
 */
export interface TabbyOrder {
    /** Your internal order reference ID */
    reference_id: string;
    /** Line items */
    items: TabbyOrderItem[];
    /** Tax amount as string */
    tax_amount?: string;
    /** Shipping amount as string */
    shipping_amount?: string;
    /** Discount amount as string */
    discount_amount?: string;
    /** Last update timestamp (ISO 8601) */
    updated_at?: string;
}

/**
 * Tabby merchant redirect URLs
 */
export interface TabbyMerchantUrls {
    /** Success redirect URL */
    success: string;
    /** Cancel redirect URL */
    cancel: string;
    /** Failure redirect URL */
    failure: string;
}

/**
 * Parameters for creating a Tabby checkout session
 */
export interface TabbyCheckoutSessionParams {
    /** Total payment amount as string (e.g., "100.00") */
    amount: string;
    /** ISO 4217 currency code (AED, SAR, KWD, BHD, QAR) */
    currency: string;
    /** Payment description */
    description?: string;
    /** Buyer information */
    buyer: TabbyBuyer;
    /** Shipping address */
    shippingAddress?: TabbyAddress;
    /** Order details with line items */
    order: TabbyOrder;
    /** Redirect URLs */
    merchantUrls: TabbyMerchantUrls;
    /** Language code (en, ar) */
    lang?: 'en' | 'ar';
    /** Custom metadata */
    meta?: Record<string, unknown>;
    /** Idempotency key */
    idempotencyKey?: string;
}

/**
 * Parameters for capturing a Tabby payment
 */
export interface TabbyCaptureParams {
    /** Tabby payment ID */
    paymentId: string;
    /** Amount to capture as string */
    amount: string;
    /** Idempotency key for capture */
    referenceId?: string;
    /** Tax amount */
    taxAmount?: string;
    /** Shipping amount */
    shippingAmount?: string;
    /** Discount amount */
    discountAmount?: string;
    /** Optional itemized breakdown */
    items?: TabbyOrderItem[];
}

/**
 * Parameters for refunding a Tabby payment
 */
export interface TabbyRefundParams {
    /** Tabby payment ID */
    paymentId: string;
    /** Refund amount as string */
    amount: string;
    /** Idempotency key for refund */
    referenceId?: string;
    /** Reason for refund */
    reason?: string;
    /** Optional itemized breakdown */
    items?: TabbyOrderItem[];
}

/**
 * Tabby payment status (API returns uppercase)
 */
export type TabbyPaymentStatus =
    | 'CREATED'
    | 'AUTHORIZED'
    | 'CLOSED'
    | 'REJECTED'
    | 'EXPIRED';

/**
 * Tabby session status (API returns lowercase)
 */
export type TabbySessionStatus =
    | 'created'
    | 'rejected'
    | 'expired'
    | 'approved';

/**
 * Tabby checkout session response
 */
export interface TabbyCheckoutSessionResponse {
    /** Session ID */
    id: string;
    /** Session status */
    status: TabbySessionStatus;
    /** Configuration with available products */
    configuration: {
        available_products?: {
            installments?: Array<{
                web_url: string;
                qr_code?: string;
            }>;
        };
        products?: {
            installments?: {
                type: string;
                is_available: boolean;
                rejection_reason: string | null;
            };
        };
    };
    /** Payment object */
    payment: {
        id: string;
        status: TabbyPaymentStatus;
        amount: string;
        currency: string;
        created_at: string;
        is_test: boolean;
    };
    /** Merchant URLs echoed back */
    merchant_urls: TabbyMerchantUrls;
}

/**
 * Tabby payment response (from retrieve/capture/refund)
 */
export interface TabbyPaymentResponse {
    id: string;
    status: TabbyPaymentStatus;
    amount: string;
    currency: string;
    created_at: string;
    expires_at?: string;
    closed_at?: string;
    is_test: boolean;
    buyer?: TabbyBuyer;
    shipping_address?: TabbyAddress;
    order?: TabbyOrder;
    captures: Array<{
        id: string;
        amount: string;
        created_at: string;
        reference_id?: string;
    }>;
    refunds: Array<{
        id: string;
        amount: string;
        created_at: string;
        reference_id?: string;
        reason?: string;
    }>;
    meta?: Record<string, unknown>;
}
