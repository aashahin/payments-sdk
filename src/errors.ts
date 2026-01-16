// file: packages/payments/src/errors.ts

/**
 * Base error class for all payment-related errors
 */
export class PaymentError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 500
    ) {
        super(message);
        this.name = 'PaymentError';
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Thrown when a payment operation is aborted by a hook
 */
export class PaymentAbortedError extends PaymentError {
    constructor(reason?: string) {
        super(
            reason ?? 'Payment operation was aborted',
            'PAYMENT_ABORTED',
            400
        );
        this.name = 'PaymentAbortedError';
    }
}

/**
 * Thrown when a gateway is not properly configured
 */
export class GatewayNotConfiguredError extends PaymentError {
    constructor(gatewayName: string) {
        super(
            `Gateway '${gatewayName}' is not configured`,
            'GATEWAY_NOT_CONFIGURED',
            400
        );
        this.name = 'GatewayNotConfiguredError';
    }
}

/**
 * Thrown when webhook verification fails
 */
export class InvalidWebhookError extends PaymentError {
    constructor(message?: string) {
        super(
            message ?? 'Webhook verification failed',
            'INVALID_WEBHOOK',
            403
        );
        this.name = 'InvalidWebhookError';
    }
}

/**
 * Thrown when a gateway API call fails
 */
export class GatewayApiError extends PaymentError {
    constructor(
        message: string,
        public readonly gatewayName: string,
        public readonly rawError?: unknown
    ) {
        super(message, 'GATEWAY_API_ERROR', 502);
        this.name = 'GatewayApiError';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Standardized Logic Errors
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thrown when the card is declined by the issuer
 */
export class CardDeclinedError extends PaymentError {
    constructor(message = 'Card was declined', public readonly rawError?: unknown) {
        super(message, 'CARD_DECLINED', 402);
        this.name = 'CardDeclinedError';
    }
}

/**
 * Thrown when the card has insufficient funds
 */
export class InsufficientFundsError extends PaymentError {
    constructor(message = 'Insufficient funds', public readonly rawError?: unknown) {
        super(message, 'INSUFFICIENT_FUNDS', 402);
        this.name = 'InsufficientFundsError';
    }
}

/**
 * Thrown when authentication fails (e.g. 3DS failed, wrong CVV/Expiry)
 */
export class AuthenticationError extends PaymentError {
    constructor(message = 'Authentication failed', public readonly rawError?: unknown) {
        super(message, 'AUTHENTICATION_FAILED', 401);
        this.name = 'AuthenticationError';
    }
}

/**
 * Thrown when the gateway rate limit is exceeded
 */
export class RateLimitError extends PaymentError {
    constructor(gatewayName: string, retryAfter?: number) {
        super(
            `Rate limit exceeded for ${gatewayName}${retryAfter ? `. Retry after ${retryAfter}s` : ''}`,
            'RATE_LIMIT_EXCEEDED',
            429
        );
        this.name = 'RateLimitError';
    }
}

/**
 * Thrown when the request is invalid (validation failed upstream or at gateway)
 */
export class InvalidRequestError extends PaymentError {
    constructor(message: string, public readonly validationErrors?: unknown[]) {
        super(message, 'INVALID_REQUEST', 400);
        this.name = 'InvalidRequestError';
    }
}

/**
 * Thrown when there is a network connectivity issue usually transient
 */
export class NetworkError extends PaymentError {
    constructor(message = 'Network error occurred', public readonly originalError?: unknown) {
        super(message, 'NETWORK_ERROR', 503);
        this.name = 'NetworkError';
    }
}
