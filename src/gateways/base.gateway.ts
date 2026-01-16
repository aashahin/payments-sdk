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

/**
 * Abstract base gateway that provides hook execution for all operations.
 * All concrete gateway implementations should extend this class.
 */
export abstract class BaseGateway implements PaymentGateway {
    abstract readonly name: GatewayName;

    constructor(
        protected readonly config: GatewayConfig,
        protected readonly hooks: HooksManager
    ) { }

    /**
     * Template method that wraps any operation with before/after/error hooks
     */
    protected async executeWithHooks<T, R>(
        operation: OperationType,
        params: T,
        executor: (params: T) => Promise<R>,
        schema?: z.ZodTypeAny
    ): Promise<R> {
        // Validation Layer
        if (schema) {
            const result = schema.safeParse(params);
            if (!result.success) {
                throw new InvalidRequestError(
                    `Validation failed for ${operation}`,
                    result.error.errors
                );
            }
        }

        const ctx: HookContext<T> = {
            gateway: this.name,
            operation,
            params,
            timestamp: new Date(),
            metadata: {},
        };

        // Execute before hooks
        const beforeResult = await this.hooks.runBefore(ctx);
        if (!beforeResult.proceed) {
            throw new PaymentAbortedError(beforeResult.abortReason);
        }

        // Use modified params if provided by hooks
        const finalParams = beforeResult.params ?? params;

        try {
            // Execute the actual gateway operation
            const result = await executor(finalParams);

            // Execute after hooks
            const afterResult = await this.hooks.runAfter(
                { ...ctx, params: finalParams },
                result
            );

            if (!afterResult.proceed) {
                throw new PaymentAbortedError('Operation rejected by after hook');
            }

            return (afterResult.modifiedResult ?? result) as R;
        } catch (error) {
            // Map to standardized error
            const mappedError = this.mapError(error);

            // Execute error hooks
            await this.hooks.runError(ctx, mappedError);
            throw mappedError;
        }
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
    abstract verifyWebhook(payload: unknown, signature?: string): boolean;
    abstract parseWebhookEvent(payload: unknown): WebhookEvent;
}
