// file: packages/payments/src/hooks/hooks.types.ts

import type {
    GatewayName,
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    VoidParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type { WebhookEvent } from '../types/webhook.types';

/**
 * Operation types that can have hooks attached
 */
export type OperationType =
    | 'createPayment'
    | 'authorizePayment'
    | 'capturePayment'
    | 'refundPayment'
    | 'voidPayment'
    | 'confirmStcPayOtp'
    | 'verifyWebhook'
    | 'getPayment'
    | 'createCheckoutSession';

/**
 * Context passed to all lifecycle hooks
 */
export interface HookContext<T = unknown> {
    /** Which gateway is executing */
    gateway: GatewayName;
    /** Which operation is being performed */
    operation: OperationType;
    /** Operation parameters */
    params: T;
    /** When the operation started */
    timestamp: Date;
    /** Mutable metadata bag for inter-hook communication */
    metadata: Record<string, unknown>;
}

/**
 * Result from a before hook
 */
export interface BeforeHookResult<T = unknown> {
    /** If false, the operation will be aborted */
    proceed: boolean;
    /** Modified params to use instead (optional) */
    params?: T;
    /** Reason for aborting if proceed=false */
    abortReason?: string;
}

/**
 * Result from an after hook
 */
export interface AfterHookResult<R = unknown> {
    /** If false, mark the operation as failed */
    proceed: boolean;
    /** Modified result to return instead (optional) */
    modifiedResult?: R;
}

/**
 * Before hook function signature
 */
export type BeforeHook<T = unknown> = (
    ctx: HookContext<T>
) => Promise<BeforeHookResult<T>> | BeforeHookResult<T>;

/**
 * After hook function signature
 */
export type AfterHook<T = unknown, R = unknown> = (
    ctx: HookContext<T>,
    result: R
) => Promise<AfterHookResult<R>> | AfterHookResult<R>;

/**
 * Error hook function signature
 */
export type ErrorHook = (
    ctx: HookContext,
    error: Error
) => Promise<void> | void;

/**
 * Webhook-specific hook signatures
 */

/**
 * Called the moment a webhook payload arrives, BEFORE signature verification.
 *
 * ⚠️ SECURITY: The payload here is UNVERIFIED and UNTRUSTED — anyone who can
 * reach your webhook endpoint can trigger this hook with arbitrary data. Use it
 * only for side-effect-free work such as request logging or metrics. Do NOT
 * mutate state, fulfill orders, or trust any field. Put side-effect-sensitive
 * logic in {@link WebhookVerifiedHook}, which only runs after verification
 * succeeds.
 */
export type WebhookReceivedHook = (
    gateway: GatewayName,
    payload: unknown
) => Promise<void> | void;

export type WebhookVerifiedHook = (
    event: WebhookEvent
) => Promise<void> | void;

export type WebhookFailedHook = (
    payload: unknown,
    error: Error
) => Promise<void> | void;

/**
 * Complete hooks configuration
 */
export interface PaymentHooks {
    // ═══════════════════════════════════════════════════════════════════════════
    // Global hooks (all gateways, all operations)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before any operation */
    onBefore?: BeforeHook;
    /** Called after any successful operation */
    onAfter?: AfterHook;
    /** Called when any operation throws an error */
    onError?: ErrorHook;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment creation hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before creating a payment */
    beforeCreatePayment?: BeforeHook<CreatePaymentParams>;
    /** Called after payment is created */
    afterCreatePayment?: AfterHook<CreatePaymentParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment authorization hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before authorizing an approved payment */
    beforeAuthorize?: BeforeHook<CaptureParams>;
    /** Called after payment is authorized */
    afterAuthorize?: AfterHook<CaptureParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Payment capture hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before capturing an authorized payment */
    beforeCapture?: BeforeHook<CaptureParams>;
    /** Called after payment is captured */
    afterCapture?: AfterHook<CaptureParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Refund hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before processing a refund */
    beforeRefund?: BeforeHook<RefundParams>;
    /** Called after refund is processed */
    afterRefund?: AfterHook<RefundParams, GatewayRefundResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Void hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /** Called before voiding a payment */
    beforeVoid?: BeforeHook<VoidParams>;
    /** Called after payment is voided */
    afterVoid?: AfterHook<VoidParams, GatewayPaymentResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook hooks
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Called when a webhook is received, BEFORE verification.
     * ⚠️ The payload is UNVERIFIED/UNTRUSTED — keep this side-effect-free
     * (logging/metrics only). Put trusted, state-changing logic in
     * {@link onWebhookVerified}.
     */
    onWebhookReceived?: WebhookReceivedHook;
    /** Called after webhook is verified and parsed (payload is trusted here) */
    onWebhookVerified?: WebhookVerifiedHook;
    /** Called when webhook verification fails */
    onWebhookFailed?: WebhookFailedHook;
}
