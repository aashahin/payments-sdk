// file: packages/payments/src/types/payment.types.ts

import type {
    CreditCardSource,
    MoyasarPaymentSource,
} from "./moyasar-source.types";

/**
 * Supported payment gateway names
 */
export type GatewayName = "moyasar" | "paypal" | "paymob" | "stripe";

/**
 * Unified payment status across all gateways
 */
export type PaymentStatus =
    | "pending"
    | "processing"
    | "authorized"
    | "approved"
    | "paid"
    | "partially_captured"
    | "failed"
    | "cancelled"
    | "reversed"
    | "refunded"
    | "partially_refunded"
    | "refund_completed"
    | "refund_pending"
    | "refund_failed"
    | "setup_completed";

/**
 * Refund processing status
 */
export type RefundStatus = "pending" | "completed" | "failed";

/**
 * Parameters for creating a new payment
 */
export interface CreatePaymentParams {
    /**
     * Amount in base currency units (e.g., SAR, not halalas).
     *
     * ⚠️ This is a JavaScript floating-point `number`. Pass clean decimals with
     * at most the precision your currency supports (e.g. `10.5`, `99.99`), not
     * the result of float arithmetic like `0.1 + 0.2`. The SDK converts to the
     * gateway's minor units, but float artifacts in the input can still cause
     * rounding surprises. Store and compute money as integer minor units or a
     * decimal type on your side, and only convert to a clean decimal here. A
     * dedicated minor-units/decimal money type may be introduced in a future
     * major version.
     */
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
    /** PayPal: Shipping collection behavior for the approval flow */
    paypalShippingPreference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";

    // ═══════════════════════════════════════════════════════════════════════════
    // Paymob-specific fields
    // ═══════════════════════════════════════════════════════════════════════════

    /** Paymob: Override configured Integration ID/payment method alias for this payment */
    paymobIntegrationId?: string | number;
    /** Paymob: Explicit payment methods array for Intention API */
    paymobPaymentMethods?: Array<string | number>;
    /** Paymob: Legacy iframe ID override */
    paymobIframeId?: string | number;
    /** Paymob: Billing data sent to the Intention/payment key APIs */
    paymobBillingData?: {
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        country?: string;
        city?: string;
        street?: string;
        building?: string;
        apartment?: string;
        floor?: string;
        postalCode?: string;
        state?: string;
    };
}

/**
 * Moyasar payment source types that are safe to use from a merchant backend.
 * Raw credit card details must be sent directly from the customer device to Moyasar
 * or tokenized with Moyasar.js before reaching backend code.
 */
export type MoyasarBackendPaymentSource = Exclude<
    MoyasarPaymentSource,
    CreditCardSource
>;

/**
 * Moyasar split recipient for marketplace/platform payments.
 * Field names (except unit of `amount`) match Moyasar's API payload so callers
 * can copy examples from Moyasar docs without the SDK silently dropping them.
 *
 * **Amount units**: `amount` is in **major** currency units — the same unit as
 * top-level `createPayment` `amount` (e.g. `50` for 50.00 SAR). The SDK converts
 * each split to Moyasar's minor units (halalas/fils) before calling the API.
 * Moyasar requires a non-zero split amount; negative values are allowed by the
 * API where reverse splits are supported.
 */
export interface MoyasarPaymentSplit {
    /**
     * Split amount in major currency units (e.g. `50` for 50.00 SAR).
     * Converted to minor units for the Moyasar API. Must be non-zero.
     */
    amount: number;
    recipient_id: string;
    reference?: string;
    description?: string;
    fee_source?: boolean;
    refundable?: boolean;
}

/**
 * Moyasar AFT recipient payload.
 * Required only for Account Funding Transaction payment creation.
 */
export interface MoyasarAftRecipient {
    first_name: string;
    last_name: string;
    middle_name?: string;
    address: string;
    street_name?: string;
    postal_code?: string;
    locality?: string;
    country?: string;
    building_number?: string;
}

/**
 * Moyasar AFT sender payload.
 * Required only for Account Funding Transaction payment creation.
 */
export interface MoyasarAftSender {
    account: {
        funds_source: string;
        number: string;
    };
    first_name: string;
    last_name: string;
    address: string;
    locality?: string;
    postal_code?: string;
    administrative_area?: string;
    country_code: string;
    id_type:
    | "ARNB"
    | "BTHD"
    | "CPNY"
    | "CUID"
    | "DRLN"
    | "EMAL"
    | "LAWE"
    | "MILI"
    | "NTID"
    | "PASN"
    | "PHON"
    | "PRXY"
    | "SSNB"
    | "TRVL";
    id: string;
    phone_number: string;
}

/**
 * Moyasar-specific create params. Moyasar only requires callbackUrl for card
 * token flows; STC Pay, Apple Pay, and Samsung Pay can omit it.
 */
export interface MoyasarCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl" | "moyasarSource"> {
    callbackUrl?: string;
    moyasarSource?: MoyasarBackendPaymentSource;
    /** Moyasar marketplace/platform split instructions. */
    splits?: MoyasarPaymentSplit[];
    /** Moyasar AFT recipient information. */
    recipient?: MoyasarAftRecipient;
    /** Moyasar AFT sender information. */
    sender?: MoyasarAftSender;
}

/**
 * Paymob-specific create params. Paymob Intention API treats callback and
 * redirection URLs as optional per-payment overrides; dashboard callbacks can
 * be used instead, especially for non-card payment methods.
 */
export interface PaymobCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl"> {
    callbackUrl?: string;
}

/**
 * PayPal-specific create params. PayPal prefers `returnUrl` / `cancelUrl`;
 * `callbackUrl` is optional when `returnUrl` is provided. Runtime validation
 * requires at least one of `callbackUrl` | `returnUrl` for success return, and
 * at least one of `cancelUrl` | `callbackUrl` | `returnUrl` for cancel fallback.
 */
export interface PayPalCreatePaymentParams
    extends Omit<CreatePaymentParams, "callbackUrl"> {
    callbackUrl?: string;
}

/**
 * Parameters for confirming an initiated Moyasar STC Pay payment with the OTP
 * sent to the customer's phone.
 */
export interface MoyasarConfirmStcPayOtpParams {
    /** The `source.transaction_url` returned from the initiated STC Pay payment. */
    transactionUrl: string;
    /** OTP value sent to the customer by SMS. */
    otpValue: string | number;
}

/**
 * Parameters for capturing an authorized payment
 */
export interface CaptureParams {
    /** Gateway's payment ID */
    gatewayPaymentId: string;
    /** Amount to capture (optional, defaults to full amount) */
    amount?: number;
    /**
     * ISO 4217 currency code. Required when providing a partial capture
     * `amount` for Moyasar, PayPal, or Stripe (and similar gateways that need
     * currency to convert major units to minor units). Optional for full
     * captures that rely on the original payment currency at the gateway.
     */
    currency?: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
    /**
     * PayPal: which capture endpoint to call.
     * Default 'order' captures an approved CAPTURE-intent order.
     * Use 'authorization' with an authorization ID returned by PayPalGateway.authorizePayment().
     */
    paypalCaptureType?: "order" | "authorization";
    /**
     * PayPal authorization captures only: whether this is the final capture
     * for the authorization. Amount-dependent SDK defaults (PayPal API default
     * is `false`): omit `amount` (full remaining capture) → `true`; set
     * `amount` (partial) → `false` unless `paypalFinalCapture === true`.
     */
    paypalFinalCapture?: boolean;
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
    /** Custom metadata to attach to the refund when the gateway supports it */
    metadata?: Record<string, unknown>;
    /** ISO 4217 currency code (required for PayPal partial refunds) */
    currency?: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
}

/**
 * Parameters for voiding a payment
 */
export interface VoidParams {
    /** Gateway's payment ID to void */
    gatewayPaymentId: string;
    /** Idempotency key for safe retries */
    idempotencyKey?: string;
}

/**
 * Parameters for retrieving a payment
 */
export interface GetPaymentParams {
    /** Gateway's payment ID to retrieve */
    gatewayPaymentId: string;
}

/**
 * Moyasar STC Pay OTP next step. `transactionUrl` is the OTP submission
 * endpoint (not a browser redirect) — pass it to `confirmStcPayOtp`.
 */
export type MoyasarStcPayOtpNextAction = {
    type: "stcpay_otp";
    transactionUrl: string;
    method: "POST";
    parameter: "otp_value";
};

/**
 * SDK-normalized browser/checkout redirect next step (Moyasar 3DS, Paymob
 * unified checkout, etc.).
 */
export type RedirectPaymentNextAction = {
    type: "redirect";
    /** Browser redirect URL (e.g. Moyasar 3DS `transaction_url`) */
    url?: string;
    /** Paymob unified checkout URL */
    checkoutUrl?: string;
    intentionId?: string;
    clientSecret?: string;
    paymentKeys?: unknown;
};

/**
 * Customer next-step after create/capture. Narrow on `type` for Moyasar STC Pay
 * OTP (`stcpay_otp`) and SDK-normalized redirects (`redirect`). Other providers
 * (e.g. Stripe `PaymentIntent.next_action`) may pass through provider-native
 * shapes under a free-form object.
 */
export type PaymentNextAction =
    | MoyasarStcPayOtpNextAction
    | RedirectPaymentNextAction
    | { type?: string; [key: string]: unknown };

/** @deprecated Prefer {@link PaymentNextAction}; alias kept for Moyasar-focused call sites. */
export type MoyasarNextAction = MoyasarStcPayOtpNextAction | { type: "redirect"; url: string };

/**
 * Result from gateway payment operations.
 *
 * **After-hook freeze**: money / identity fields (`success`, `status`, `amount`,
 * `gatewayId`, capture/order/authorization/refund IDs, `fee`, `capturedAmount`,
 * `refundedAmount`, `clientSecret`, …) are restored from the original gateway
 * result after after-hooks run. After-hooks may only attach additive fields
 * (and cannot flip outcomes via in-place mutation of the hook argument either).
 */
export interface GatewayPaymentResult {
    /** Whether the API call succeeded */
    success: boolean;
    /** Gateway's primary payment object ID for this operation */
    gatewayId: string;
    /** Gateway object ID when it is useful to expose separately from the primary ID */
    gatewayObjectId?: string | undefined;
    /** PayPal order ID, when the operation involves a PayPal order */
    orderId?: string | undefined;
    /** PayPal capture ID, required for PayPal refunds */
    captureId?: string | undefined;
    /** PayPal authorization ID, required for PayPal authorization captures and voids */
    authorizationId?: string | undefined;
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
    /** Client secret for frontend confirmation flows (Stripe PaymentIntents) */
    clientSecret?: string | undefined;
    /** Gateway-specific next action payload for customer authentication or redirects */
    nextAction?: PaymentNextAction | undefined;
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
