// file: packages/payments/src/types/config.types.ts

import type { GatewayName } from './payment.types';
import type { PaymentHooks } from '../hooks/hooks.types';
import type { IdempotencyStore } from '../utils/idempotency';
import type { Logger } from '../utils/logger';

/**
 * Moyasar gateway configuration
 */
export interface MoyasarConfig {
    /** Secret API key */
    secretKey: string;
    /** Publishable key (for client-side tokenization reference) */
    publishableKey?: string;
    /** Use sandbox environment */
    sandbox?: boolean;
    /** Webhook secret for verification */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
    /**
     * Optional injectable idempotency store for refund/capture/void. Moyasar's
     * API has no native idempotency for these endpoints, so without a store a
     * retried refund can refund the customer twice. Provide a process-wide
     * store (Redis/SQL, ideally with an atomic `reserve`) for full protection;
     * an in-memory store only dedupes within a single process.
     */
    idempotencyStore?: IdempotencyStore;
}

/**
 * PayPal gateway configuration
 */
export interface PayPalConfig {
    /** Client ID */
    clientId: string;
    /** Client Secret */
    clientSecret: string;
    /** Use sandbox environment */
    sandbox?: boolean;
    /** Webhook ID for verification */
    webhookId?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
}

/**
 * Paymob region identifiers
 */
export type PaymobRegion = 'ksa' | 'eg' | 'pk' | 'om' | 'ae';

export type MaybePromise<T> = T | Promise<T>;

export interface PaymobIdempotencyRecord {
    fingerprint: string;
    status: 'in_progress' | 'completed' | 'unknown';
    createdAt: number;
    expiresAt: number;
    result?: unknown;
}

export interface PaymobIdempotencyStore {
    /**
     * Optional atomic reservation. Implement with Redis SET NX, a database unique
     * constraint, or equivalent to prevent duplicate cross-worker API calls.
     * Return an existing record when the key is already reserved, otherwise store
     * the supplied in-progress record and return undefined.
     */
    reserve?(key: string, record: PaymobIdempotencyRecord): MaybePromise<PaymobIdempotencyRecord | undefined>;
    get(key: string): MaybePromise<PaymobIdempotencyRecord | undefined>;
    set(key: string, record: PaymobIdempotencyRecord): MaybePromise<void>;
    delete(key: string): MaybePromise<void>;
}

/**
 * Paymob gateway configuration (KSA Unified Intention API)
 * @see https://developers.paymob.com/ksa/getting-started-ksa
 */
export interface PaymobConfig {
    /** Secret key for Unified Intention API authorization */
    secretKey?: string;
    /** Public key used to launch Unified Checkout */
    publicKey?: string;
    /** HMAC secret for webhook verification */
    hmacSecret?: string;
    /**
     * Allow Paymob webhooks without HMAC verification.
     * Intended only for local development; ignored when NODE_ENV=production.
     * Production should configure hmacSecret.
     */
    allowUnverifiedWebhooks?: boolean;
    /** Region (determines base URL). Default: 'ksa' */
    region?: PaymobRegion;
    /** Optional base URL override (takes precedence over region) */
    baseUrl?: string;
    /** Integration ID or payment method alias used by the Intention API */
    integrationId?: string | number;
    /**
     * Integration ID/payment method alias for Paymob auth/capture flows.
     * Used when createPayment receives capture: false and no per-request
     * paymobIntegrationId/paymobPaymentMethods override is provided.
     */
    authIntegrationId?: string | number;
    /** Legacy iframe ID, required only for deprecated iframe checkout flow */
    iframeId?: string | number;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
    /**
     * Optional shared idempotency store for Paymob operations. Configure this with
     * Redis, a database, or another process-wide store when running multiple
     * workers. Implement reserve atomically for full cross-worker protection.
     * Without it, idempotency is scoped to one gateway instance.
     */
    idempotencyStore?: PaymobIdempotencyStore;

    // ═══════════════════════════════════════════════════════════════════════════
    // Legacy fields (deprecated, for backward compat with Egypt API)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * API key used to generate auth tokens for legacy checkout and payment
     * management APIs such as capture, refund, void, and transaction inquiry.
     */
    apiKey?: string;
}

/**
 * Stripe gateway configuration
 */
export interface StripeConfig {
    /** Stripe Secret API Key */
    secretKey: string;
    /** Stripe Publishable Key */
    publishableKey?: string;
    /** Webhook signing secret */
    webhookSecret?: string;
    /** API version (optional, defaults to the SDK's pinned Stripe API version) */
    apiVersion?: string;
    /** Expected webhook endpoint API version. Defaults to apiVersion/the SDK's pinned Stripe API version. */
    webhookApiVersion?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
}

/**
 * Base gateway configuration - generic record type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GatewayConfig = Record<string, any>;

/**
 * Main PaymentClient configuration
 */
export interface PaymentClientConfig {
    /** Moyasar gateway configuration */
    moyasar?: MoyasarConfig;
    /** PayPal gateway configuration */
    paypal?: PayPalConfig;
    /** Paymob gateway configuration */
    paymob?: PaymobConfig;
    /** Stripe gateway configuration */
    stripe?: StripeConfig;

    /** Global lifecycle hooks */
    hooks?: PaymentHooks;

    /** Default gateway to use when not specified */
    defaultGateway?: GatewayName;

    /**
     * Optional logger. All gateway logging is routed through this and secrets/PII
     * are redacted before being passed to it. Defaults to a no-op (the SDK is
     * silent unless a logger is provided).
     */
    logger?: Logger;
}
