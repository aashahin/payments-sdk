// file: packages/payments/src/gateways/paypal/paypal.gateway.test.ts
// Comprehensive test suite for PayPal Gateway using Bun test runner

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { PayPalGateway } from './paypal.gateway';
import { HooksManager } from '../../hooks/hooks.manager';
import {
    GatewayApiError,
    InvalidRequestError,
    CardDeclinedError,
    InsufficientFundsError,
    AuthenticationError,
    RateLimitError
} from '../../errors';
import type { PayPalConfig } from '../../types/config.types';
import type { CreatePaymentParams } from '../../types/payment.types';
import type { HookContext } from '../../hooks/hooks.types';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const PAYPAL_TEST_CONFIG: PayPalConfig = {
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret',
    webhookId: 'test_webhook_id',
    sandbox: true,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Fetch Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a mock Response object
 */
function createMockResponse(data: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => data,
        headers: new Headers(),
        redirected: false,
        statusText: ok ? 'OK' : 'Error',
        type: 'basic',
        url: '',
        clone: () => createMockResponse(data, ok, status),
        body: null,
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(0),
        blob: async () => new Blob(),
        formData: async () => new FormData(),
        text: async () => JSON.stringify(data),
    } as Response;
}

/**
 * Create a mock fetch that handles token requests automatically
 */
function createMockFetch(
    apiResponse: unknown,
    apiOk = true,
    apiStatus = 200
): typeof fetch {
    const mockFn = mock(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : (input as Request).url;

        // Token request
        if (url.includes('oauth2/token')) {
            return createMockResponse({
                access_token: 'test_token_' + Math.random(),
                expires_in: 3600,
            });
        }

        // API request
        return createMockResponse(apiResponse, apiOk, apiStatus);
    }) as unknown as typeof fetch;
    return mockFn;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

describe('PayPalGateway', () => {
    let gateway: PayPalGateway;
    let hooksManager: HooksManager;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        // Fresh gateway for each test to avoid token caching issues
        hooksManager = new HooksManager({});
        gateway = new PayPalGateway(PAYPAL_TEST_CONFIG, hooksManager);
        // Reset fetch
        globalThis.fetch = originalFetch;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Verification Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('verifyWebhook', () => {
        it('should warn and return true when webhookId is not configured', () => {
            const gatewayNoWebhookId = new PayPalGateway(
                { clientId: 'test', clientSecret: 'test' },
                hooksManager
            );

            const warnSpy = spyOn(console, 'warn');
            const result = gatewayNoWebhookId.verifyWebhook({}, undefined, {});

            expect(result).toBe(true);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('should return false when required headers are missing', () => {
            const result = gateway.verifyWebhook({}, undefined, {});
            expect(result).toBe(false);
        });

        it('should return true with warning for sync verification (requires async)', () => {
            const warnSpy = spyOn(console, 'warn');
            const result = gateway.verifyWebhook(
                { id: 'test' },
                'sig',
                {
                    'paypal-transmission-id': 'trans-123',
                    'paypal-transmission-time': '2024-01-15T10:00:00Z',
                    'paypal-transmission-sig': 'signature',
                    'paypal-cert-url': 'https://api.paypal.com/cert',
                    'paypal-auth-algo': 'SHA256withRSA',
                }
            );

            expect(result).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('verifyWebhookAsync')
            );
        });
    });

    describe('verifyWebhookAsync', () => {
        it('should return true when webhookId is not configured', async () => {
            const gatewayNoWebhookId = new PayPalGateway(
                { clientId: 'test', clientSecret: 'test' },
                hooksManager
            );

            const result = await gatewayNoWebhookId.verifyWebhookAsync({}, {});
            expect(result).toBe(true);
        });

        it('should return false when headers are missing', async () => {
            const result = await gateway.verifyWebhookAsync({}, {});
            expect(result).toBe(false);
        });

        it('should call PayPal API and return true on SUCCESS', async () => {
            globalThis.fetch = mock(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                return createMockResponse({ verification_status: 'SUCCESS' });
            }) as unknown as typeof fetch;

            const result = await gateway.verifyWebhookAsync(
                { id: 'event-123', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
                {
                    'paypal-transmission-id': 'trans-123',
                    'paypal-transmission-time': '2024-01-15T10:00:00Z',
                    'paypal-transmission-sig': 'signature',
                    'paypal-cert-url': 'https://api.paypal.com/cert',
                    'paypal-auth-algo': 'SHA256withRSA',
                }
            );

            expect(result).toBe(true);
        });

        it('should return false on FAILURE verification status', async () => {
            globalThis.fetch = mock(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                return createMockResponse({ verification_status: 'FAILURE' });
            }) as unknown as typeof fetch;

            const result = await gateway.verifyWebhookAsync(
                { id: 'event-123' },
                {
                    'paypal-transmission-id': 'trans-123',
                    'paypal-transmission-time': '2024-01-15T10:00:00Z',
                    'paypal-transmission-sig': 'signature',
                    'paypal-cert-url': 'https://api.paypal.com/cert',
                    'paypal-auth-algo': 'SHA256withRSA',
                }
            );

            expect(result).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Parsing Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseWebhookEvent', () => {
        it('should parse PAYMENT.CAPTURE.COMPLETED event', () => {
            const payload = {
                id: 'WH-event-123',
                event_type: 'PAYMENT.CAPTURE.COMPLETED',
                create_time: '2024-06-15T14:30:00Z',
                resource_type: 'capture',
                resource: {
                    id: 'capture-abc123',
                    status: 'COMPLETED',
                    amount: {
                        currency_code: 'USD',
                        value: '99.99',
                    },
                    custom_id: 'internal_payment_001',
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.id).toBe('WH-event-123');
            expect(event.type).toBe('PAYMENT.CAPTURE.COMPLETED');
            expect(event.gateway).toBe('paypal');
            expect(event.gatewayPaymentId).toBe('capture-abc123');
            expect(event.paymentId).toBe('internal_payment_001');
            expect(event.status).toBe('paid');
            expect(event.amount).toBe(99.99);
            expect(event.currency).toBe('USD');
            expect(event.timestamp).toBeInstanceOf(Date);
            expect(event.rawPayload).toEqual(payload);
        });

        it('should parse event without amount (e.g., dispute events)', () => {
            const payload = {
                id: 'WH-dispute-456',
                event_type: 'CUSTOMER.DISPUTE.CREATED',
                create_time: '2024-06-15T15:00:00Z',
                resource_type: 'dispute',
                resource: {
                    id: 'dispute-xyz789',
                    status: 'PENDING',
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.amount).toBe(0);
            expect(event.currency).toBe('USD');
            expect(event.gatewayPaymentId).toBe('dispute-xyz789');
        });

        it('should extract capture ID from supplementary_data', () => {
            const payload = {
                id: 'WH-order-789',
                event_type: 'CHECKOUT.ORDER.COMPLETED',
                create_time: '2024-06-15T16:00:00Z',
                resource_type: 'checkout-order',
                resource: {
                    id: 'order-123',
                    status: 'COMPLETED',
                    supplementary_data: {
                        related_ids: {
                            capture_id: 'capture-from-supplementary',
                        },
                    },
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.gatewayPaymentId).toBe('capture-from-supplementary');
        });

        it('should extract custom_id from purchase_units', () => {
            const payload = {
                id: 'WH-order-101',
                event_type: 'CHECKOUT.ORDER.APPROVED',
                create_time: '2024-06-15T17:00:00Z',
                resource_type: 'checkout-order',
                resource: {
                    id: 'order-456',
                    status: 'APPROVED',
                    purchase_units: [
                        {
                            custom_id: 'payment-from-purchase-unit',
                        },
                    ],
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.paymentId).toBe('payment-from-purchase-unit');
        });

        it('should throw error for invalid payload (missing id)', () => {
            expect(() => {
                gateway.parseWebhookEvent({ event_type: 'TEST' });
            }).toThrow(GatewayApiError);
        });

        it('should throw error for invalid payload (missing event_type)', () => {
            expect(() => {
                gateway.parseWebhookEvent({ id: 'test-123' });
            }).toThrow(GatewayApiError);
        });

        it('should throw error for invalid payload (missing resource)', () => {
            expect(() => {
                gateway.parseWebhookEvent({ id: 'test-123', event_type: 'TEST' });
            }).toThrow(GatewayApiError);
        });

        it('should throw error for non-object payload', () => {
            expect(() => {
                gateway.parseWebhookEvent('invalid');
            }).toThrow(GatewayApiError);

            expect(() => {
                gateway.parseWebhookEvent(null);
            }).toThrow(GatewayApiError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Status Mapping Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Status Mapping', () => {
        const orderStatusMappings = [
            { paypal: 'CREATED', expected: 'pending' },
            { paypal: 'SAVED', expected: 'pending' },
            { paypal: 'APPROVED', expected: 'authorized' },
            { paypal: 'VOIDED', expected: 'cancelled' },
            { paypal: 'COMPLETED', expected: 'paid' },
            { paypal: 'PAYER_ACTION_REQUIRED', expected: 'pending' },
            { paypal: 'UNKNOWN_STATUS', expected: 'pending' },
        ];

        for (const { paypal, expected } of orderStatusMappings) {
            it(`should map order status '${paypal}' to '${expected}'`, () => {
                const mapped = (gateway as any).mapStatus(paypal);
                expect(mapped).toBe(expected);
            });
        }

        const resourceStatusMappings = [
            { paypal: 'COMPLETED', expected: 'paid' },
            { paypal: 'DECLINED', expected: 'failed' },
            { paypal: 'PARTIALLY_REFUNDED', expected: 'partially_refunded' },
            { paypal: 'PENDING', expected: 'pending' },
            { paypal: 'REFUNDED', expected: 'refunded' },
            { paypal: 'FAILED', expected: 'failed' },
            { paypal: 'UNKNOWN', expected: 'pending' },
        ];

        for (const { paypal, expected } of resourceStatusMappings) {
            it(`should map resource status '${paypal}' to '${expected}'`, () => {
                const mapped = (gateway as any).mapResourceStatus(paypal);
                expect(mapped).toBe(expected);
            });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Create Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createPayment', () => {
        it('should create order with correct request body', async () => {
            let capturedBody: unknown = null;

            globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                if (init?.body) {
                    capturedBody = JSON.parse(init.body as string);
                }

                return createMockResponse({
                    id: 'ORDER-123',
                    status: 'CREATED',
                    links: [
                        { rel: 'approve', href: 'https://paypal.com/approve/ORDER-123' },
                    ],
                });
            }) as unknown as typeof fetch;

            const params: CreatePaymentParams = {
                amount: 99.99,
                currency: 'USD',
                callbackUrl: 'https://example.com/callback',
                orderId: 'order-001',
                description: 'Test payment',
                idempotencyKey: 'idem-key-123',
                metadata: { paymentId: 'pay-001' },
            };

            const result = await gateway.createPayment(params);

            expect(result.success).toBe(true);
            expect(result.gatewayId).toBe('ORDER-123');
            expect(result.status).toBe('pending');
            expect(result.redirectUrl).toBe('https://paypal.com/approve/ORDER-123');

            expect(capturedBody).toEqual({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        reference_id: 'order-001',
                        description: 'Test payment',
                        custom_id: 'pay-001',
                        amount: {
                            currency_code: 'USD',
                            value: '99.99',
                        },
                    },
                ],
                application_context: {
                    return_url: 'https://example.com/callback',
                    cancel_url: 'https://example.com/callback',
                    user_action: 'PAY_NOW',
                },
            });
        });

        it('should include PayPal-Request-Id header for idempotency', async () => {
            let capturedHeaders: Record<string, string> | null = null;

            globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                // Capture headers from checkout/orders request
                if (url.includes('checkout/orders') && init?.headers) {
                    capturedHeaders = init.headers as Record<string, string>;
                }

                return createMockResponse({
                    id: 'ORDER-456',
                    status: 'CREATED',
                });
            }) as unknown as typeof fetch;

            await gateway.createPayment({
                amount: 50,
                currency: 'USD',
                callbackUrl: 'https://example.com/callback',
                idempotencyKey: 'unique-key-abc',
            });

            expect(capturedHeaders).not.toBeNull();
            expect(capturedHeaders!['PayPal-Request-Id']).toBe('unique-key-abc');
        });

        it('should throw GatewayApiError on API failure', async () => {
            globalThis.fetch = createMockFetch(
                {
                    name: 'INVALID_REQUEST',
                    message: 'Request is not well-formed',
                    details: [
                        { issue: 'MISSING_REQUIRED_PARAMETER', description: 'Amount is required' },
                    ],
                },
                false,
                400
            );

            await expect(
                gateway.createPayment({
                    amount: 10,
                    currency: 'USD',
                    callbackUrl: 'https://example.com/callback',
                })
            ).rejects.toThrow(InvalidRequestError);
        });

        it('should include detailed error message from details array', async () => {
            globalThis.fetch = createMockFetch(
                {
                    name: 'UNPROCESSABLE_ENTITY',
                    message: 'The requested action could not be performed',
                    details: [
                        { issue: 'CURRENCY_NOT_SUPPORTED', description: 'Currency XYZ is not supported' },
                        { issue: 'AMOUNT_MISMATCH', description: 'Amount does not match' },
                    ],
                },
                false,
                422
            );

            try {
                await gateway.createPayment({
                    amount: 100,
                    currency: 'XYZ',
                    callbackUrl: 'https://example.com/callback',
                });
                expect(true).toBe(false); // Should not reach
            } catch (error: any) {
                expect(error.name).toBe('GatewayApiError');
                const apiError = error as GatewayApiError;
                expect(apiError.message).toContain('Currency XYZ is not supported');
                expect(apiError.message).toContain('Amount does not match');
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Capture Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('capturePayment', () => {
        it('should capture order and return capture ID', async () => {
            globalThis.fetch = createMockFetch({
                id: 'ORDER-789',
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAPTURE-XYZ',
                                    status: 'COMPLETED',
                                    amount: {
                                        currency_code: 'USD',
                                        value: '150.00',
                                    },
                                },
                            ],
                        },
                    },
                ],
            });

            const result = await gateway.capturePayment({
                gatewayPaymentId: 'ORDER-789',
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('paid');
            expect(result.amount).toBe(150);
            expect((result.rawResponse as any).captureId).toBe('CAPTURE-XYZ');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Refund Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('refundPayment', () => {
        it('should throw error when currency is missing for partial refund', async () => {
            globalThis.fetch = createMockFetch({
                access_token: 'test_token',
                expires_in: 3600,
            });

            await expect(
                gateway.refundPayment({
                    gatewayPaymentId: 'CAPTURE-123',
                    amount: 50, // Partial refund without currency
                })
            ).rejects.toThrow('Currency is required for partial PayPal refunds');
        });

        it('should refund successfully with currency', async () => {
            globalThis.fetch = createMockFetch({
                id: 'REFUND-ABC',
                status: 'COMPLETED',
            });

            const result = await gateway.refundPayment({
                gatewayPaymentId: 'CAPTURE-123',
                amount: 25.5,
                currency: 'USD',
                reason: 'Customer request',
            });

            expect(result.success).toBe(true);
            expect(result.gatewayRefundId).toBe('REFUND-ABC');
            expect(result.status).toBe('completed');
        });

        it('should refund full amount without currency', async () => {
            let capturedBody: unknown = null;

            globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                capturedBody = init?.body;

                return createMockResponse({
                    id: 'REFUND-FULL',
                    status: 'COMPLETED',
                });
            }) as unknown as typeof fetch;

            await gateway.refundPayment({
                gatewayPaymentId: 'CAPTURE-456',
                // No amount = full refund
            });

            // Full refund should have null body
            expect(capturedBody).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Void Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('voidPayment', () => {
        it('should void an authorized payment successfully (204 response)', async () => {
            globalThis.fetch = mock(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                // PayPal returns 204 No Content on successful void
                return {
                    ok: true,
                    status: 204,
                    json: async () => null,
                    headers: new Headers(),
                    redirected: false,
                    statusText: 'No Content',
                    type: 'basic',
                    url: '',
                    clone: () => ({} as Response),
                    body: null,
                    bodyUsed: false,
                    arrayBuffer: async () => new ArrayBuffer(0),
                    blob: async () => new Blob(),
                    formData: async () => new FormData(),
                    text: async () => '',
                } as Response;
            }) as unknown as typeof fetch;

            const result = await gateway.voidPayment({
                gatewayPaymentId: 'AUTH-123',
            });

            expect(result.success).toBe(true);
            expect(result.gatewayId).toBe('AUTH-123');
            expect(result.status).toBe('cancelled');
        });

        it('should call correct void endpoint', async () => {
            let capturedUrl: string | null = null;

            globalThis.fetch = mock(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    return createMockResponse({
                        access_token: 'test_token',
                        expires_in: 3600,
                    });
                }

                capturedUrl = url;

                return {
                    ok: true,
                    status: 204,
                    json: async () => null,
                    headers: new Headers(),
                    redirected: false,
                    statusText: 'No Content',
                    type: 'basic',
                    url: '',
                    clone: () => ({} as Response),
                    body: null,
                    bodyUsed: false,
                    arrayBuffer: async () => new ArrayBuffer(0),
                    blob: async () => new Blob(),
                    formData: async () => new FormData(),
                    text: async () => '',
                } as Response;
            }) as unknown as typeof fetch;

            await gateway.voidPayment({
                gatewayPaymentId: 'AUTH-456',
            });

            expect(capturedUrl as unknown as string).toContain('/v2/payments/authorizations/AUTH-456/void');
        });

        it('should throw GatewayApiError when void fails', async () => {
            globalThis.fetch = createMockFetch(
                {
                    name: 'UNPROCESSABLE_ENTITY',
                    message: 'Authorization has already been captured',
                    details: [
                        { issue: 'AUTHORIZATION_ALREADY_CAPTURED', description: 'This authorization has been captured' },
                    ],
                },
                false,
                422
            );

            await expect(
                gateway.voidPayment({
                    gatewayPaymentId: 'AUTH-CAPTURED',
                })
            ).rejects.toThrow(GatewayApiError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Token Caching Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Token Caching', () => {
        it('should cache access token and reuse it', async () => {
            let tokenFetchCount = 0;

            globalThis.fetch = mock(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : (input as Request).url;

                if (url.includes('oauth2/token')) {
                    tokenFetchCount++;
                    return createMockResponse({
                        access_token: 'cached_token_xyz',
                        expires_in: 3600,
                    });
                }

                return createMockResponse({
                    id: 'ORDER-TEST',
                    status: 'CREATED',
                });
            }) as unknown as typeof fetch;

            // Create a fresh gateway for this test
            const freshGateway = new PayPalGateway(PAYPAL_TEST_CONFIG, hooksManager);

            // Make multiple requests
            await freshGateway.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com',
            });

            await freshGateway.createPayment({
                amount: 20,
                currency: 'USD',
                callbackUrl: 'https://example.com',
            });

            await freshGateway.createPayment({
                amount: 30,
                currency: 'USD',
                callbackUrl: 'https://example.com',
            });

            // Token should only be fetched once
            expect(tokenFetchCount).toBe(1);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Lifecycle Hooks Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Lifecycle Hooks', () => {
        it('should execute beforeCreatePayment hook', async () => {
            let hookCalled = false;
            let hookGateway: string | undefined;

            const hooksWithBefore = new HooksManager({
                beforeCreatePayment: async (ctx: HookContext<CreatePaymentParams>) => {
                    hookCalled = true;
                    hookGateway = ctx.gateway;
                    return { proceed: true };
                },
            });

            const gatewayWithHooks = new PayPalGateway(PAYPAL_TEST_CONFIG, hooksWithBefore);

            globalThis.fetch = createMockFetch({
                id: 'ORDER-HOOK',
                status: 'CREATED',
            });

            await gatewayWithHooks.createPayment({
                amount: 10,
                currency: 'USD',
                callbackUrl: 'https://example.com',
            });

            expect(hookCalled).toBe(true);
            expect(hookGateway).toBe('paypal');
        });

        it('should abort payment when hook returns proceed: false', async () => {
            const hooksWithAbort = new HooksManager({
                beforeCreatePayment: async () => {
                    return { proceed: false, abortReason: 'Blocked by fraud check' };
                },
            });

            const gatewayWithAbort = new PayPalGateway(PAYPAL_TEST_CONFIG, hooksWithAbort);

            await expect(
                gatewayWithAbort.createPayment({
                    amount: 10,
                    currency: 'USD',
                    callbackUrl: 'https://example.com',
                })
            ).rejects.toThrow('Blocked by fraud check');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // GetPayment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('getPayment', () => {
        it('should retrieve order details', async () => {
            globalThis.fetch = createMockFetch({
                id: 'ORDER-GET-123',
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAP-001',
                                    status: 'COMPLETED',
                                    amount: {
                                        currency_code: 'USD',
                                        value: '200.00',
                                    },
                                },
                            ],
                        },
                    },
                ],
            });

            const result = await gateway.getPayment({ gatewayPaymentId: 'ORDER-GET-123' });

            expect(result.success).toBe(true);
            expect(result.gatewayId).toBe('ORDER-GET-123');
            expect(result.status).toBe('paid');
            expect(result.amount).toBe(200);
        });
        describe('getPaymentStatus', () => {
            it('should return status for order', async () => {
                globalThis.fetch = createMockFetch({
                    id: 'ORDER-123',
                    status: 'COMPLETED',
                });

                const status = await gateway.getPaymentStatus('ORDER-123');
                expect(status).toBe('paid');
            });
        });
    });
});
