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
    "approved",
    "paid",
    "partially_captured",
    "failed",
    "cancelled",
    "reversed",
    "refunded",
    "partially_refunded",
    "refund_completed",
    "refund_pending",
    "refund_failed",
    "setup_completed"
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

export const ApplePayDecryptedSourceSchema = z.object({
    type: z.literal("applepay"),
    dpan: z.string().regex(/^\d{16,19}$/, "Invalid Apple Pay DPAN format"),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000),
    cryptogram: z.string().min(1).max(64),
    deviceId: z.string().min(8).max(16),
    lastFour: z.string().regex(/^\d{4}$/).optional(),
    eci: z.string().regex(/^\d{2}$/).optional(),
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
    mobile: z.string().regex(/^(?:05|\+9665|009665|9665)\d{8}$/, "Invalid KSA mobile number"),
    cashier: z.string().optional(),
    branch: z.string().optional(),
});

export const MoyasarPaymentSourceSchema = z.union([
    CreditCardSourceSchema,
    CardTokenSourceSchema,
    ApplePaySourceSchema,
    ApplePayDecryptedSourceSchema,
    SamsungPaySourceSchema,
    StcPaySourceSchema,
]);

const MOYASAR_MAX_METADATA_KEYS = 30;
const MOYASAR_MAX_METADATA_KEY_LENGTH = 40;
const MOYASAR_MAX_METADATA_VALUE_LENGTH = 500;

const MoyasarPaymentSplitSchema = z.object({
    amount: z.number().int().refine((amount) => amount !== 0, {
        message: "Moyasar split amount cannot be zero",
    }),
    recipient_id: z.string().uuid("Moyasar split recipient_id must be a UUID"),
    reference: z.string().max(255).optional(),
    description: z.string().max(255).optional(),
    fee_source: z.boolean().optional(),
    refundable: z.boolean().optional(),
});

const MoyasarAftRecipientSchema = z.object({
    first_name: z.string().min(1).max(30),
    last_name: z.string().min(1).max(35),
    middle_name: z.string().max(35).optional(),
    address: z.string().min(1).max(50),
    street_name: z.string().max(50).optional(),
    postal_code: z.string().max(10).optional(),
    locality: z.string().max(25).optional(),
    country: z.string().length(2).optional(),
    building_number: z.string().max(19).optional(),
});

const MoyasarAftSenderSchema = z.object({
    account: z.object({
        funds_source: z.string().min(1).max(2),
        number: z.string().min(1),
    }),
    first_name: z.string().min(1).max(30),
    last_name: z.string().min(1).max(35),
    address: z.string().min(1).max(50),
    locality: z.string().max(25).optional(),
    postal_code: z.string().max(10).optional(),
    administrative_area: z.string().max(2).optional(),
    country_code: z.string().length(2),
    id_type: z.enum([
        "ARNB",
        "BTHD",
        "CPNY",
        "CUID",
        "DRLN",
        "EMAL",
        "LAWE",
        "MILI",
        "NTID",
        "PASN",
        "PHON",
        "PRXY",
        "SSNB",
        "TRVL",
    ]),
    id: z.string().min(1).max(50),
    phone_number: z.string().min(1).max(20),
});

export const MoyasarMetadataSchema = z.record(
    z.string()
).superRefine((metadata, ctx) => {
    const entries = Object.entries(metadata);

    if (entries.length > MOYASAR_MAX_METADATA_KEYS) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Moyasar metadata can include at most ${MOYASAR_MAX_METADATA_KEYS} keys`,
        });
    }

    for (const [key, value] of entries) {
        if (key.length > MOYASAR_MAX_METADATA_KEY_LENGTH) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Moyasar metadata key "${key}" must be ${MOYASAR_MAX_METADATA_KEY_LENGTH} characters or fewer`,
                path: [key],
            });
        }

        if (String(value).length > MOYASAR_MAX_METADATA_VALUE_LENGTH) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Moyasar metadata value for "${key}" must be ${MOYASAR_MAX_METADATA_VALUE_LENGTH} characters or fewer`,
                path: [key],
            });
        }
    }
});

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
    paymobIntegrationId: z.union([z.string().trim().min(1), z.number().int().positive()]).optional(),
    paymobPaymentMethods: z.array(z.union([z.string().trim().min(1), z.number().int().positive()])).min(1).optional(),
    paymobIframeId: z.union([z.string().trim().min(1), z.number().int().positive()]).optional(),
    paymobBillingData: z.object({
        email: z.string().email(),
        firstName: z.string().min(1).max(50),
        lastName: z.string().min(1).max(50),
        phone: z.string().min(5),
        country: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        building: z.string().optional(),
        apartment: z.string().optional(),
        floor: z.string().optional(),
        postalCode: z.string().optional(),
        state: z.string().optional(),
    }).optional(),
}).passthrough(); // Allow gateway-specific fields not in base schema

/** Inferred type from CreatePaymentParamsSchema */
export type ValidatedCreatePaymentParams = z.infer<typeof CreatePaymentParamsSchema>;

export const MoyasarCreatePaymentParamsSchema = CreatePaymentParamsSchema.extend({
    callbackUrl: z.string().url("Callback URL must be a valid URL").optional(),
    metadata: MoyasarMetadataSchema.optional(),
    idempotencyKey: z.string().uuid("Moyasar idempotencyKey must be a UUID because it becomes the payment ID").optional(),
    splits: z.array(MoyasarPaymentSplitSchema).optional(),
    recipient: MoyasarAftRecipientSchema.optional(),
    sender: MoyasarAftSenderSchema.optional(),
});

export const PaymobCreatePaymentParamsSchema = CreatePaymentParamsSchema.extend({
    callbackUrl: z.string().url("Callback URL must be a valid URL").optional(),
});

export const StripeCreatePaymentParamsSchema = CreatePaymentParamsSchema.extend({
    callbackUrl: z.string().url("Callback URL must be a valid URL").optional(),
});

/** Input type for Stripe PaymentIntent creation. Unconfirmed Stripe Elements flows do not need callbackUrl. */
export type StripeCreatePaymentParams = z.input<typeof StripeCreatePaymentParamsSchema>;

export const CaptureParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    idempotencyKey: z.string().optional(),
    paypalCaptureType: z.enum(["order", "authorization"]).optional(),
    paypalFinalCapture: z.boolean().optional(),
}).passthrough();

/** Inferred type from CaptureParamsSchema */
export type ValidatedCaptureParams = z.infer<typeof CaptureParamsSchema>;

export const RefundParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
    amount: z.number().positive().optional(),
    reason: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    currency: z.string().length(3).optional(),
    idempotencyKey: z.string().optional(),
}).passthrough();

/** Inferred type from RefundParamsSchema */
export type ValidatedRefundParams = z.infer<typeof RefundParamsSchema>;

export const VoidParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1),
    idempotencyKey: z.string().optional(),
}).passthrough();

/** Inferred type from VoidParamsSchema */
export type ValidatedVoidParams = z.infer<typeof VoidParamsSchema>;

export const GetPaymentParamsSchema = z.object({
    gatewayPaymentId: z.string().min(1, "Gateway payment ID is required"),
}).passthrough();

/** Inferred type from GetPaymentParamsSchema */
export type ValidatedGetPaymentParams = z.infer<typeof GetPaymentParamsSchema>;

const MoyasarGatewayPaymentIdSchema = z.string().uuid(
    "Moyasar gatewayPaymentId must be a UUID",
);

export const MoyasarCaptureParamsSchema = CaptureParamsSchema.extend({
    gatewayPaymentId: MoyasarGatewayPaymentIdSchema,
});

export const MoyasarRefundParamsSchema = RefundParamsSchema.extend({
    gatewayPaymentId: MoyasarGatewayPaymentIdSchema,
});

export const MoyasarVoidParamsSchema = VoidParamsSchema.extend({
    gatewayPaymentId: MoyasarGatewayPaymentIdSchema,
});

export const MoyasarGetPaymentParamsSchema = GetPaymentParamsSchema.extend({
    gatewayPaymentId: MoyasarGatewayPaymentIdSchema,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stripe Checkout Session Schemas
// ═══════════════════════════════════════════════════════════════════════════════

const STRIPE_CHECKOUT_PAYMENT_LINE_ITEM_LIMIT = 100;
const STRIPE_CHECKOUT_SUBSCRIPTION_TOTAL_LINE_ITEM_LIMIT = 40;
const STRIPE_CHECKOUT_SUBSCRIPTION_RECURRING_LINE_ITEM_LIMIT = 20;

const StripeCheckoutLineItemSchema = z.object({
    priceData: z.object({
        currency: z.string().length(3),
        productData: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            images: z.array(z.string().url()).optional(),
        }),
        /** Amount in base currency units; converted to Stripe minor units. */
        amount: z.number().nonnegative().optional(),
        /** Stripe minor-unit amount. Kept for callers that already store Stripe price data. */
        unitAmount: z.number().int().nonnegative().optional(),
        /** Recurring price settings required for inline subscription prices. */
        recurring: z.object({
            interval: z.enum(['day', 'week', 'month', 'year']),
            intervalCount: z.number().int().positive().optional(),
        }).optional(),
    }).superRefine((priceData, ctx) => {
        const hasAmount = priceData.amount !== undefined;
        const hasUnitAmount = priceData.unitAmount !== undefined;

        if (hasAmount === hasUnitAmount) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Price data must include exactly one of amount or unitAmount",
                path: ["amount"],
            });
        }
    }).optional(),
    price: z.string().startsWith('price_').optional(),
    quantity: z.number().int().positive(),
}).superRefine((item, ctx) => {
    const hasPrice = Boolean(item.price);
    const hasPriceData = Boolean(item.priceData);

    if (hasPrice === hasPriceData) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Line item must include exactly one of price or priceData",
            path: ["price"],
        });
    }
});

export const CreateCheckoutSessionParamsSchema = z.object({
    amount: z.number().positive("Amount must be positive").optional(),
    currency: z.string().length(3, "Currency must be 3-letter ISO code").optional(),
    successUrl: z.string().url("Success URL must be valid"),
    cancelUrl: z.string().url("Cancel URL must be valid").optional(),
    mode: z.enum(['payment', 'subscription', 'setup']).default('payment'),
    lineItems: z.array(StripeCheckoutLineItemSchema).min(1).optional(),
    customerId: z.string().startsWith('cus_').optional(),
    customerEmail: z.string().email().optional(),
    metadata: z.record(z.unknown()).optional(),
    paymentMethodTypes: z.array(z.string().min(1)).optional(),
    idempotencyKey: z.string().optional(),
}).strict().superRefine((params, ctx) => {
    const mode = params.mode ?? 'payment';
    const hasLineItems = Boolean(params.lineItems?.length);
    const hasAmount = params.amount !== undefined;
    const hasCurrency = params.currency !== undefined;
    const hasSimpleAmount = hasAmount && hasCurrency;
    const hasPaymentMethodTypes = Boolean(params.paymentMethodTypes?.length);

    if (hasLineItems && (hasAmount || hasCurrency)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Checkout sessions must use either lineItems or amount and currency, not both",
            path: ["lineItems"],
        });
    }

    if (mode === 'payment' && !hasLineItems && !hasSimpleAmount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Payment mode requires lineItems or amount and currency",
            path: ["lineItems"],
        });
    }

    if ((mode === 'payment' || mode === 'subscription') && (hasAmount !== hasCurrency) && !hasLineItems) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Amount-based Checkout Sessions require both amount and currency",
            path: hasAmount ? ["currency"] : ["amount"],
        });
    }

    if (mode === 'subscription' && !hasLineItems) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Subscription mode requires lineItems",
            path: ["lineItems"],
        });
    }

    if (mode === 'payment' && hasLineItems && params.lineItems!.length > STRIPE_CHECKOUT_PAYMENT_LINE_ITEM_LIMIT) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Payment mode supports at most ${STRIPE_CHECKOUT_PAYMENT_LINE_ITEM_LIMIT} lineItems`,
            path: ["lineItems"],
        });
    }

    if (mode === 'subscription' && hasLineItems) {
        const lineItems = params.lineItems!;
        const inlineRecurringCount = lineItems.filter((item) => Boolean(item.priceData?.recurring)).length;

        if (lineItems.length > STRIPE_CHECKOUT_SUBSCRIPTION_TOTAL_LINE_ITEM_LIMIT) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Subscription mode supports at most 40 lineItems (20 recurring and 20 one-time)",
                path: ["lineItems"],
            });
        }

        if (inlineRecurringCount > STRIPE_CHECKOUT_SUBSCRIPTION_RECURRING_LINE_ITEM_LIMIT) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Subscription mode supports at most ${STRIPE_CHECKOUT_SUBSCRIPTION_RECURRING_LINE_ITEM_LIMIT} recurring lineItems`,
                path: ["lineItems"],
            });
        }
    }

    if (mode === 'setup' && (hasLineItems || hasAmount)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Setup mode does not accept lineItems or amount",
            path: hasLineItems ? ["lineItems"] : ["amount"],
        });
    }

    if (mode === 'subscription') {
        params.lineItems?.forEach((item, index) => {
            if (item.priceData && !item.priceData.recurring) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Subscription mode inline priceData requires recurring settings",
                    path: ["lineItems", index, "priceData", "recurring"],
                });
            }
        });
    }

    if (mode === 'setup' && !params.currency && !hasPaymentMethodTypes) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Setup mode requires currency or paymentMethodTypes",
            path: ["currency"],
        });
    }
});

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
