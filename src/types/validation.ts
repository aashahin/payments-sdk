// file: packages/payments/src/types/validation.ts

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums & Literals
// ═══════════════════════════════════════════════════════════════════════════════

export const GatewayNameSchema = z.enum(["moyasar", "paypal", "paymob", "stripe", "tabby", "tamara"]);

export const PaymentStatusSchema = z.enum([
    "pending",
    "processing",
    "authorized",
    "paid",
    "failed",
    "cancelled",
    "refunded",
    "partially_refunded"
]);

export const RefundStatusSchema = z.enum(["pending", "completed", "failed"]);

// ═══════════════════════════════════════════════════════════════════════════════
// Moyasar Source Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const CreditCardSourceSchema = z.object({
    type: z.literal("creditcard"),
    name: z.string().min(2),
    number: z.string().regex(/^\d{13,19}$/, "Invalid card number format"),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000),
    cvc: z.string().regex(/^\d{3,4}$/, "Invalid CVC format"),
    statementDescriptor: z.string().optional(),
    _3ds: z.boolean().optional(),
    manualCapture: z.boolean().optional(),
    saveCard: z.boolean().optional(),
});

export const CardTokenSourceSchema = z.object({
    type: z.literal("token"),
    token: z.string().startsWith("token_"),
    cvc: z.string().regex(/^\d{3,4}$/).optional(),
    statementDescriptor: z.string().optional(),
    _3ds: z.boolean().optional(),
    manualCapture: z.boolean().optional(),
});

export const ApplePaySourceSchema = z.object({
    type: z.literal("applepay"),
    token: z.string(),
    manualCapture: z.boolean().optional(),
    saveCard: z.boolean().optional(),
    statementDescriptor: z.string().optional(),
});

export const SamsungPaySourceSchema = z.object({
    type: z.literal("samsungpay"),
    token: z.string(),
    manualCapture: z.boolean().optional(),
    saveCard: z.boolean().optional(),
    statementDescriptor: z.string().optional(),
});

export const StcPaySourceSchema = z.object({
    type: z.literal("stcpay"),
    mobile: z.string().regex(/^(?:05|\+9665|009665)\d{8}$/, "Invalid KSA mobile number"),
    cashier: z.string().optional(),
    branch: z.string().optional(),
});

export const MoyasarPaymentSourceSchema = z.discriminatedUnion("type", [
    CreditCardSourceSchema,
    CardTokenSourceSchema,
    ApplePaySourceSchema,
    SamsungPaySourceSchema,
    StcPaySourceSchema,
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Core Operation Params Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const CreatePaymentParamsSchema = z.object({
    amount: z.number().positive("Amount must be positive"),
    currency: z.string().length(3, "Currency must be 3-letter ISO code"),
    callbackUrl: z.string().url("Callback URL must be a valid URL"),
    orderId: z.string().optional(),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    capture: z.boolean().default(true),
    idempotencyKey: z.string().optional(),

    // Stripe specific
    stripePaymentMethodId: z.string().startsWith('pm_', 'Stripe Payment Method ID must start with pm_').optional(),
    stripeCustomerId: z.string().startsWith('cus_', 'Stripe Customer ID must start with cus_').optional(),
    stripeSetupFutureUsage: z.enum(['on_session', 'off_session']).optional(),

    // Moyasar specific
    moyasarSource: MoyasarPaymentSourceSchema.optional(),
    tokenId: z.string().optional(), // deprecated
    applyCoupon: z.boolean().optional(),

    // PayPal specific
    returnUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),

    // Paymob specific
    paymobIntegrationId: z.string().optional(),
}).passthrough(); // Allow gateway-specific fields not in base schema

/** Inferred type from CreatePaymentParamsSchema */
export type ValidatedCreatePaymentParams = z.infer<typeof CreatePaymentParamsSchema>;

export const CaptureParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
    amount: z.number().positive().optional(),
}).passthrough();

/** Inferred type from CaptureParamsSchema */
export type ValidatedCaptureParams = z.infer<typeof CaptureParamsSchema>;

export const RefundParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
    amount: z.number().positive().optional(),
    reason: z.string().optional(),
    currency: z.string().length(3).optional(),
}).passthrough();

/** Inferred type from RefundParamsSchema */
export type ValidatedRefundParams = z.infer<typeof RefundParamsSchema>;

export const VoidParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
}).passthrough();

/** Inferred type from VoidParamsSchema */
export type ValidatedVoidParams = z.infer<typeof VoidParamsSchema>;

export const GetPaymentParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1, "Gateway payment ID is required"),
}).passthrough();

/** Inferred type from GetPaymentParamsSchema */
export type ValidatedGetPaymentParams = z.infer<typeof GetPaymentParamsSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe Checkout Session Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const CreateCheckoutSessionParamsSchema = z.object({
    amount: z.number().positive("Amount must be positive"),
    currency: z.string().length(3, "Currency must be 3-letter ISO code"),
    successUrl: z.string().url("Success URL must be valid"),
    cancelUrl: z.string().url("Cancel URL must be valid"),
    mode: z.enum(['payment', 'subscription', 'setup']).default('payment'),
    lineItems: z.array(z.object({
        priceData: z.object({
            currency: z.string().length(3),
            productData: z.object({
                name: z.string().min(1),
                description: z.string().optional(),
                images: z.array(z.string().url()).optional(),
            }),
            unitAmount: z.number().int().positive(),
        }).optional(),
        price: z.string().startsWith('price_').optional(),
        quantity: z.number().int().positive(),
    })).optional(),
    customerId: z.string().startsWith('cus_').optional(),
    customerEmail: z.string().email().optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: z.string().optional(),
}).passthrough();

/** Input type for CreateCheckoutSession (allows optional default values) */
export type CreateCheckoutSessionParams = z.input<typeof CreateCheckoutSessionParamsSchema>;

/** Inferred output type from CreateCheckoutSessionParamsSchema (defaults applied) */
export type ValidatedCreateCheckoutSessionParams = z.infer<typeof CreateCheckoutSessionParamsSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Tabby Validation Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const TabbyBuyerSchema = z.object({
    name: z.string().min(1, "Buyer name is required"),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(5, "Phone number is required"),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DOB must be YYYY-MM-DD format").optional(),
});

export const TabbyAddressSchema = z.object({
    city: z.string().min(1, "City is required"),
    address: z.string().min(1, "Address is required"),
    zip: z.string().min(1, "ZIP code is required"),
});

export const TabbyOrderItemSchema = z.object({
    reference_id: z.string().min(1, "Item reference_id is required"),
    title: z.string().min(1, "Item title is required"),
    quantity: z.number().int().positive("Quantity must be positive integer"),
    unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Unit price must be valid decimal string"),
    description: z.string().optional(),
    discount_amount: z.string().optional(),
    image_url: z.string().url().optional(),
    product_url: z.string().url().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    gender: z.string().optional(),
    color: z.string().optional(),
    size: z.string().optional(),
    size_type: z.string().optional(),
    product_material: z.string().optional(),
    is_refundable: z.boolean().optional(),
    barcode: z.string().optional(),
    seller: z.string().optional(),
});

export const TabbyOrderSchema = z.object({
    reference_id: z.string().min(1, "Order reference_id is required"),
    items: z.array(TabbyOrderItemSchema).min(1, "At least one item is required"),
    tax_amount: z.string().optional(),
    shipping_amount: z.string().optional(),
    discount_amount: z.string().optional(),
    updated_at: z.string().optional(),
});

export const TabbyMerchantUrlsSchema = z.object({
    success: z.string().url("Success URL must be valid"),
    cancel: z.string().url("Cancel URL must be valid"),
    failure: z.string().url("Failure URL must be valid"),
});

export const TabbyCheckoutSessionParamsSchema = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be valid decimal string"),
    currency: z.string().length(3, "Currency must be 3-letter ISO code"),
    description: z.string().optional(),
    buyer: TabbyBuyerSchema,
    shippingAddress: TabbyAddressSchema.optional(),
    order: TabbyOrderSchema,
    merchantUrls: TabbyMerchantUrlsSchema,
    lang: z.enum(['en', 'ar']).optional(),
    meta: z.record(z.unknown()).optional(),
    idempotencyKey: z.string().optional(),
}).passthrough();

/** Inferred type from TabbyCheckoutSessionParamsSchema */
export type ValidatedTabbyCheckoutSessionParams = z.infer<typeof TabbyCheckoutSessionParamsSchema>;

export const TabbyCaptureParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1, "Payment ID is required"),
    amount: z.number().positive().optional(),
    referenceId: z.string().optional(),
    taxAmount: z.string().optional(),
    shippingAmount: z.string().optional(),
    discountAmount: z.string().optional(),
    items: z.array(TabbyOrderItemSchema).optional(),
}).passthrough();

/** Inferred type from TabbyCaptureParamsSchema */
export type ValidatedTabbyCaptureParams = z.infer<typeof TabbyCaptureParamsSchema>;

export const TabbyRefundParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1, "Payment ID is required"),
    amount: z.number().positive().optional(),
    reason: z.string().optional(),
    referenceId: z.string().optional(),
    items: z.array(TabbyOrderItemSchema).optional(),
}).passthrough();

/** Inferred type from TabbyRefundParamsSchema */
export type ValidatedTabbyRefundParams = z.infer<typeof TabbyRefundParamsSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Tamara Validation Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const TamaraAmountSchema = z.object({
    amount: z.number().nonnegative("Amount must be non-negative"),
    currency: z.enum(['SAR', 'AED', 'KWD', 'BHD', 'OMR'], {
        errorMap: () => ({ message: "Currency must be SAR, AED, KWD, BHD, or OMR" }),
    }),
});

export const TamaraConsumerSchema = z.object({
    email: z.string().email("Valid email is required"),
    first_name: z.string().min(1, "First name is required"),
    last_name: z.string().min(1, "Last name is required"),
    phone_number: z.string().min(5, "Phone number is required"),
});

export const TamaraAddressSchema = z.object({
    city: z.string().min(1, "City is required"),
    country_code: z.string().length(2, "Country code must be 2 letters"),
    first_name: z.string().min(1, "First name is required"),
    last_name: z.string().min(1, "Last name is required"),
    line1: z.string().min(1, "Address line 1 is required"),
    line2: z.string().optional(),
    phone_number: z.string().min(5, "Phone number is required"),
    region: z.string().min(1, "Region is required"),
});

export const TamaraOrderItemSchema = z.object({
    name: z.string().max(255, "Name must be ≤255 characters"),
    quantity: z.number().int().positive("Quantity must be positive integer"),
    reference_id: z.string().min(1, "Reference ID is required"),
    type: z.enum(['Physical', 'Digital']),
    sku: z.string().max(128, "SKU must be ≤128 characters"),
    item_url: z.string().url().max(1024).optional(),
    image_url: z.string().url().max(1024).optional(),
    unit_price: TamaraAmountSchema.optional(),
    tax_amount: TamaraAmountSchema.optional(),
    discount_amount: TamaraAmountSchema.optional(),
    total_amount: TamaraAmountSchema,
});

export const TamaraMerchantUrlsSchema = z.object({
    success: z.string().url("Success URL must be valid"),
    failure: z.string().url("Failure URL must be valid"),
    cancel: z.string().url("Cancel URL must be valid"),
    notification: z.string().url("Notification URL must be valid"),
});

export const TamaraCheckoutSessionParamsSchema = z.object({
    total_amount: TamaraAmountSchema,
    shipping_amount: TamaraAmountSchema,
    tax_amount: TamaraAmountSchema,
    order_reference_id: z.string().min(1, "Order reference ID is required"),
    order_number: z.string().optional(),
    discount: z.object({
        name: z.string(),
        amount: TamaraAmountSchema,
    }).optional(),
    items: z.array(TamaraOrderItemSchema).min(1, "At least one item is required"),
    consumer: TamaraConsumerSchema,
    country_code: z.enum(['SA', 'AE', 'BH', 'KW', 'OM']),
    description: z.string().max(256, "Description must be ≤256 characters"),
    merchant_url: TamaraMerchantUrlsSchema,
    billing_address: TamaraAddressSchema.optional(),
    shipping_address: TamaraAddressSchema,
    platform: z.string().optional(),
    is_mobile: z.boolean().optional(),
    locale: z.enum(['ar_SA', 'en_US']).optional(),
    payment_type: z.enum(['PAY_BY_INSTALMENTS', 'PAY_NOW']).optional(),
    instalments: z.number().int().min(2).max(6).optional(),
    expires_in_minutes: z.number().int().min(5).max(1440).optional(),
}).passthrough();

/** Inferred type from TamaraCheckoutSessionParamsSchema */
export type ValidatedTamaraCheckoutSessionParams = z.infer<typeof TamaraCheckoutSessionParamsSchema>;

export const TamaraShippingInfoSchema = z.object({
    shipped_at: z.string(),
    shipping_company: z.string().min(1, "Shipping company is required"),
    tracking_number: z.string().min(1, "Tracking number is required"),
    tracking_url: z.string().url().optional(),
});

export const TamaraCaptureParamsSchema = z.object({
    order_id: z.string().uuid("Order ID must be valid UUID"),
    total_amount: TamaraAmountSchema,
    shipping_info: TamaraShippingInfoSchema,
    items: z.array(TamaraOrderItemSchema).optional(),
    discount_amount: TamaraAmountSchema.optional(),
    shipping_amount: TamaraAmountSchema.optional(),
    tax_amount: TamaraAmountSchema.optional(),
}).passthrough();

/** Inferred type from TamaraCaptureParamsSchema */
export type ValidatedTamaraCaptureParams = z.infer<typeof TamaraCaptureParamsSchema>;

export const TamaraRefundParamsSchema = z.object({
    order_id: z.string().uuid("Order ID must be valid UUID"),
    total_amount: TamaraAmountSchema,
    comment: z.string().min(1, "Comment is required"),
    merchant_refund_id: z.string().optional(),
}).passthrough();

/** Inferred type from TamaraRefundParamsSchema */
export type ValidatedTamaraRefundParams = z.infer<typeof TamaraRefundParamsSchema>;

export const TamaraCancelParamsSchema = z.object({
    order_id: z.string().uuid("Order ID must be valid UUID"),
    total_amount: TamaraAmountSchema,
    shipping_amount: TamaraAmountSchema.optional(),
    tax_amount: TamaraAmountSchema.optional(),
    discount_amount: TamaraAmountSchema.optional(),
    items: z.array(TamaraOrderItemSchema).optional(),
}).passthrough();

/** Inferred type from TamaraCancelParamsSchema */
export type ValidatedTamaraCancelParams = z.infer<typeof TamaraCancelParamsSchema>;
