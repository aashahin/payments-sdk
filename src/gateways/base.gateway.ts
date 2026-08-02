// file: packages/payments/src/gateways/base.gateway.ts

import type { PaymentGateway } from './gateway.interface';
import type {
    GatewayName,
    CreatePaymentParams,
    CaptureParams,
    RefundParams,
    GatewayPaymentResult,
    GatewayRefundResult,
} from '../types/payment.types';
import type { WebhookEvent } from '../types/webhook.types';
import type { GatewayConfig } from '../types/config.types';
import type { HookContext, OperationType } from '../hooks/hooks.types';
import type { HooksManager } from '../hooks/hooks.manager';
import { z } from 'zod';
import { PaymentAbortedError, InvalidRequestError, PaymentError } from '../errors';
import { createRedactingLogger, noopLogger, type Logger } from '../utils/logger';

/**
 * Money / payment-identity fields that after-hooks must not alter.
 * After-hooks may still add/merge non-critical fields (metadata, rawResponse,
 * redirectUrl, etc.); these keys are restored from the original gateway result
 * whenever they were present on that original object.
 *
 * Includes fee / capturedAmount / refundedAmount / clientSecret so after-hooks
 * cannot forge settlement totals or client secrets.
 */
const MONEY_IDENTITY_KEYS = [
    'success',
    'status',
    'amount',
    'gatewayId',
    'captureId',
    'authorizationId',
    'orderId',
    'totalRefunded',
    'refundId',
    'gatewayRefundId',
    'fee',
    'capturedAmount',
    'refundedAmount',
    'clientSecret',
] as const;

/**
 * Restore critical money/identity fields from the original gateway result onto
 * an after-hook `modifiedResult`. Hooks cannot flip paid status or amounts.
 *
 * If `modified` is not a non-null object (null / undefined / primitive), it is
 * ignored and the original gateway result is returned unchanged.
 */
function restoreMoneyIdentityFields<R>(original: R, modified: R): R {
    // Non-object modifiedResult cannot carry additive fields safely — ignore it.
    // (Caller may log a warn when a logger is available.)
    if (modified === null || typeof modified !== 'object') {
        return original;
    }

    if (original === null || typeof original !== 'object') {
        return modified;
    }

    const orig = original as Record<string, unknown>;
    const out: Record<string, unknown> = {
        ...(modified as Record<string, unknown>),
    };
    let touched = false;

    for (const key of MONEY_IDENTITY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(orig, key)) {
            if (out[key] !== orig[key]) {
                out[key] = orig[key];
                touched = true;
            }
        }
    }

    return (touched ? out : modified) as R;
}

/**
 * Shallow-clone a gateway result so after-hooks that mutate the argument
 * in-place cannot poison the freeze snapshot used by restoreMoneyIdentityFields.
 */
function shallowCloneResult<R>(result: R): R {
    if (result === null || typeof result !== 'object') {
        return result;
    }
    return { ...(result as Record<string, unknown>) } as R;
}

/**
 * Abstract base gateway that provides hook execution for all operations.
 * All concrete gateway implementations should extend this class.
 */
export abstract class BaseGateway implements PaymentGateway {
    abstract readonly name: GatewayName;

    /**
     * Redacting logger shared by all gateways. Defaults to a no-op when the
     * client is created without a logger. Never log secrets/PII directly;
     * structured context passed here is scrubbed before reaching the sink.
     */
    protected readonly logger: Logger;

    constructor(
        protected readonly config: GatewayConfig,
        protected readonly hooks: HooksManager,
        logger?: Logger
    ) {
        // Skip the redacting wrapper entirely when no logger is configured, so
        // redaction work isn't done for logs that would be discarded anyway.
        this.logger = logger ? createRedactingLogger(logger) : noopLogger;
    }

    /**
     * Template method that wraps any operation with before/after/error hooks
     */
    protected async executeWithHooks<T, R>(
        operation: OperationType,
        params: T,
        executor: (params: T) => Promise<R>,
        schema?: z.ZodTypeAny
    ): Promise<R> {
        // Validation Layer — use parsed data so Zod defaults/transforms apply
        let validatedParams = params;
        if (schema) {
            const parsed = schema.safeParse(params);
            if (!parsed.success) {
                throw new InvalidRequestError(
                    `Validation failed for ${operation}`,
                    parsed.error.errors
                );
            }
            validatedParams = parsed.data as T;
        }

        const ctx: HookContext<T> = {
            gateway: this.name,
            operation,
            params: validatedParams,
            timestamp: new Date(),
            metadata: {},
        };

        // Execute before hooks
        const beforeResult = await this.hooks.runBefore(ctx);
        if (!beforeResult.proceed) {
            throw new PaymentAbortedError(beforeResult.abortReason);
        }

        // Use modified params if provided by hooks; re-validate so defaults/transforms apply
        let finalParams = beforeResult.params ?? validatedParams;
        if (schema) {
            const parsed = schema.safeParse(finalParams);
            if (!parsed.success) {
                throw new InvalidRequestError(
                    `Validation failed for ${operation}`,
                    parsed.error.errors
                );
            }
            finalParams = parsed.data as T;
        }

        let result: R;
        try {
            // Execute the actual gateway operation
            result = await executor(finalParams);
        } catch (error) {
            // Map to standardized error
            const mappedError = this.mapError(error);

            // Error hooks are secondary: log failures but always rethrow the mapped error
            try {
                await this.hooks.runError(ctx, mappedError);
            } catch (hookError) {
                this.logger.error('onError hook failed', {
                    operation,
                    gateway: this.name,
                    hookError:
                        hookError instanceof Error
                            ? hookError.message
                            : String(hookError),
                    originalError: mappedError.message,
                });
            }
            throw mappedError;
        }

        // After hooks run only on successful executor. The gateway side-effect
        // already committed — after hooks must never convert success into a
        // payment failure (no PaymentAbortedError, no rethrow of hook errors).
        // runAfter isolates per-handler throws/proceed:false and keeps last good
        // modifiedResult; this outer catch is a residual safety net.
        //
        // Pass a shallow clone into runAfter so in-place mutation of the hook
        // argument cannot poison the original freeze snapshot used below.
        const originalResult = result;
        const resultForHooks = shallowCloneResult(result);

        let afterResult: { proceed: boolean; modifiedResult?: R };
        try {
            afterResult = await this.hooks.runAfter(
                { ...ctx, params: finalParams },
                resultForHooks,
            );
        } catch (hookError) {
            this.logger.error(
                'after hook threw; returning successful gateway result',
                {
                    operation,
                    gateway: this.name,
                    hookError:
                        hookError instanceof Error
                            ? hookError.message
                            : String(hookError),
                },
            );
            return originalResult;
        }

        if (!afterResult.proceed) {
            this.logger.warn(
                'after hook returned proceed:false; ignored because side-effect already committed',
                {
                    operation,
                    gateway: this.name,
                },
            );
        }

        const modified = (afterResult.modifiedResult ?? originalResult) as R;
        if (modified === null || typeof modified !== 'object') {
            this.logger.warn(
                'after hook modifiedResult was not a non-null object; ignored',
                {
                    operation,
                    gateway: this.name,
                },
            );
        }
        return restoreMoneyIdentityFields(originalResult, modified);
    }

    /**
     * Map gateway-specific error to SDK unified error.
     * Gateways can override this to provide specific mapping logic.
     */
    protected mapError(error: unknown): Error {
        // If it's already a PaymentError (from SDK), pass it through
        if (error instanceof PaymentError) {
            return error;
        }
        return error instanceof Error ? error : new Error(String(error));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Abstract methods to be implemented by concrete gateways
    // ═══════════════════════════════════════════════════════════════════════════

    abstract createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult>;
    abstract capturePayment(params: CaptureParams): Promise<GatewayPaymentResult>;
    abstract refundPayment(params: RefundParams): Promise<GatewayRefundResult>;
    abstract verifyWebhook(
        payload: unknown,
        signature?: string,
        headers?: Record<string, string>,
    ): boolean;
    abstract parseWebhookEvent(payload: unknown): WebhookEvent;
}
