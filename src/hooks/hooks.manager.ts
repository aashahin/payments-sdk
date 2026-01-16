// file: packages/payments/src/hooks/hooks.manager.ts

import type {
    PaymentHooks,
    HookContext,
    BeforeHookResult,
    AfterHookResult,
    OperationType,
} from './hooks.types';
import type { WebhookEvent } from '../types/webhook.types';
import type { GatewayName } from '../types/payment.types';

/**
 * Manages registration and execution of lifecycle hooks
 */
export class HooksManager {
    private hooks: PaymentHooks;

    constructor(hooks?: PaymentHooks) {
        this.hooks = hooks ?? {};
    }

    /**
     * Register a hook at runtime
     */
    register<K extends keyof PaymentHooks>(
        name: K,
        handler: PaymentHooks[K]
    ): void {
        // Type assertion needed due to complex union types
        (this.hooks as Record<string, unknown>)[name] = handler;
    }

    /**
     * Run before hooks for an operation
     */
    async runBefore<T>(ctx: HookContext<T>): Promise<BeforeHookResult<T>> {
        // Run global onBefore hook first
        if (this.hooks.onBefore) {
            const globalResult = await this.hooks.onBefore(ctx as HookContext);
            if (!globalResult.proceed) {
                return globalResult as BeforeHookResult<T>;
            }
            // Apply any param modifications from global hook
            if (globalResult.params !== undefined) {
                ctx.params = globalResult.params as T;
            }
        }

        // Run operation-specific before hook
        const specificHook = this.getSpecificBeforeHook<T>(ctx.operation);
        if (specificHook) {
            const result = await specificHook(ctx);
            if (!result.proceed) {
                return result;
            }
            // Apply any param modifications
            if (result.params !== undefined) {
                return { proceed: true, params: result.params };
            }
        }

        return { proceed: true, params: ctx.params };
    }

    /**
     * Run after hooks for an operation
     */
    async runAfter<T, R>(
        ctx: HookContext<T>,
        result: R
    ): Promise<AfterHookResult<R>> {
        let finalResult = result;

        // Run operation-specific after hook first
        const specificHook = this.getSpecificAfterHook<T, R>(ctx.operation);
        if (specificHook) {
            const hookResult = await specificHook(ctx, finalResult);
            if (!hookResult.proceed) {
                return hookResult;
            }
            if (hookResult.modifiedResult !== undefined) {
                finalResult = hookResult.modifiedResult as R;
            }
        }

        // Run global onAfter hook
        if (this.hooks.onAfter) {
            const globalResult = await this.hooks.onAfter(ctx as HookContext, finalResult);
            if (!globalResult.proceed) {
                return globalResult as AfterHookResult<R>;
            }
            if (globalResult.modifiedResult !== undefined) {
                finalResult = globalResult.modifiedResult as R;
            }
        }

        return { proceed: true, modifiedResult: finalResult };
    }

    /**
     * Run error hook
     */
    async runError(ctx: HookContext, error: Error): Promise<void> {
        if (this.hooks.onError) {
            await this.hooks.onError(ctx, error);
        }
    }

    /**
     * Run webhook received hook
     */
    async runWebhookReceived(
        gateway: GatewayName,
        payload: unknown
    ): Promise<void> {
        if (this.hooks.onWebhookReceived) {
            await this.hooks.onWebhookReceived(gateway, payload);
        }
    }

    /**
     * Run webhook verified hook
     */
    async runWebhookVerified(event: WebhookEvent): Promise<void> {
        if (this.hooks.onWebhookVerified) {
            await this.hooks.onWebhookVerified(event);
        }
    }

    /**
     * Run webhook failed hook
     */
    async runWebhookFailed(payload: unknown, error: Error): Promise<void> {
        if (this.hooks.onWebhookFailed) {
            await this.hooks.onWebhookFailed(payload, error);
        }
    }

    /**
     * Get operation-specific before hook
     */
    private getSpecificBeforeHook<T>(
        operation: OperationType
    ): ((ctx: HookContext<T>) => Promise<BeforeHookResult<T>> | BeforeHookResult<T>) | undefined {
        switch (operation) {
            case 'createPayment':
                return this.hooks.beforeCreatePayment as typeof this.getSpecificBeforeHook<T> extends never ? never : ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'capturePayment':
                return this.hooks.beforeCapture as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            case 'refundPayment':
                return this.hooks.beforeRefund as ReturnType<typeof this.getSpecificBeforeHook<T>>;
            default:
                return undefined;
        }
    }

    /**
     * Get operation-specific after hook
     */
    private getSpecificAfterHook<T, R>(
        operation: OperationType
    ): ((ctx: HookContext<T>, result: R) => Promise<AfterHookResult<R>> | AfterHookResult<R>) | undefined {
        switch (operation) {
            case 'createPayment':
                return this.hooks.afterCreatePayment as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'capturePayment':
                return this.hooks.afterCapture as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            case 'refundPayment':
                return this.hooks.afterRefund as ReturnType<typeof this.getSpecificAfterHook<T, R>>;
            default:
                return undefined;
        }
    }
}
