// file: packages/payments/src/types/config.types.ts

import type { GatewayName } from './payment.types';
import type { PaymentHooks } from '../hooks/hooks.types';

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
}

/**
 * Paymob region identifiers
 */
export type PaymobRegion = 'ksa' | 'eg' | 'pk' | 'om' | 'ae';

/**
 * Paymob gateway configuration (KSA Unified Intention API)
 * @see https://developers.paymob.com/ksa/getting-started-ksa
 */
export interface PaymobConfig {
    /** Secret key for HMAC signature generation (KSA API) */
    secretKey: string;
    /** Public key for authorization header (KSA API) */
    publicKey: string;
    /** HMAC secret for webhook verification */
    hmacSecret?: string;
    /** Region (determines base URL). Default: 'ksa' */
    region?: PaymobRegion;
    /** Optional base URL override (takes precedence over region) */
    baseUrl?: string;
    /** Integration ID (for specific payment methods) */
    integrationId?: string;
    /** Service ID for specific endpoint HMAC calculation */
    serviceId?: string;

    // ═══════════════════════════════════════════════════════════════════════════
    // Legacy fields (deprecated, for backward compat with Egypt API)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @deprecated Use secretKey/publicKey instead for KSA API.
     * Kept for backward compatibility with Egypt legacy API.
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
    /** API version (optional, defaults to latest) */
    apiVersion?: string;
}

/**
 * Tabby gateway configuration
 */
export interface TabbyConfig {
    /** Secret API key */
    secretKey: string;
    /** Merchant code from Tabby dashboard */
    merchantCode: string;
    /** Use sandbox environment */
    sandbox?: boolean;
    /** Optional webhook auth header value for verification */
    webhookAuthHeader?: string;
}

/**
 * Tamara gateway configuration
 */
export interface TamaraConfig {
    /** API Token for Bearer authorization */
    apiToken: string;
    /** Notification token for webhook JWT verification */
    notificationToken?: string;
    /** Use sandbox environment */
    sandbox?: boolean;
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
    /** Tabby gateway configuration */
    tabby?: TabbyConfig;
    /** Tamara gateway configuration */
    tamara?: TamaraConfig;

    /** Global lifecycle hooks */
    hooks?: PaymentHooks;

    /** Default gateway to use when not specified */
    defaultGateway?: GatewayName;
}
