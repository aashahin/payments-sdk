// file: packages/payments/src/gateways/tabby/tabby.gateway.test.ts

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TabbyGateway } from './tabby.gateway';
import { HooksManager } from '../../hooks/hooks.manager';
import type { TabbyConfig } from '../../types/config.types';
import type { TabbyCheckoutSessionParams } from '../../types/tabby.types';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const TABBY_TEST_CONFIG: TabbyConfig = {
    secretKey: 'sk_test_123',
    merchantCode: 'test_merchant',
    sandbox: true,
    webhookAuthHeader: 'Bearer webhook_secret_123',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function createMockResponse(data: unknown, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => data,
        headers: new Headers(),
    } as unknown as Response;
}

function createTestCheckoutParams(): TabbyCheckoutSessionParams {
    return {
        amount: '100.00',
        currency: 'SAR',
        description: 'Test Order',
        buyer: {
            name: 'John Doe',
            email: 'john@example.com',
            phone: '500000001',
        },
        order: {
            reference_id: 'order_123',
            items: [{
                reference_id: 'SKU001',
                title: 'Test Product',
                quantity: 2,
                unit_price: '50.00',
                category: 'Electronics',
            }],
        },
        merchantUrls: {
            success: 'https://example.com/success',
            cancel: 'https://example.com/cancel',
            failure: 'https://example.com/failure',
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

describe('TabbyGateway', () => {
    let gateway: TabbyGateway;
    let hooksManager: HooksManager;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        hooksManager = new HooksManager({});
        gateway = new TabbyGateway(TABBY_TEST_CONFIG, hooksManager);
        globalThis.fetch = originalFetch;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Checkout Session Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createCheckoutSession', () => {
        it('should create checkout session with full cart data', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'session_123',
                status: 'created',
                configuration: {
                    available_products: {
                        installments: [{
                            web_url: 'https://checkout.tabby.ai/session_123',
                        }],
                    },
                    products: {
                        installments: {
                            type: 'installments',
                            is_available: true,
                            rejection_reason: null,
                        },
                    },
                },
                payment: {
                    id: 'payment_123',
                    status: 'CREATED',
                    amount: '100.00',
                    currency: 'SAR',
                    created_at: '2024-01-15T10:00:00Z',
                    is_test: true,
                },
                merchant_urls: {
                    success: 'https://example.com/success',
                    cancel: 'https://example.com/cancel',
                    failure: 'https://example.com/failure',
                },
            })) as unknown as typeof fetch;

            const params = createTestCheckoutParams();
            const response = await gateway.createCheckoutSession(params);

            expect(response.id).toBe('session_123');
            expect(response.status).toBe('created');
            expect(response.payment.id).toBe('payment_123');
            expect(response.configuration.available_products?.installments?.[0]?.web_url).toBe(
                'https://checkout.tabby.ai/session_123'
            );
        });

        it('should handle rejected customer eligibility', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'session_rejected',
                status: 'rejected',
                configuration: {
                    products: {
                        installments: {
                            type: 'installments',
                            is_available: false,
                            rejection_reason: 'order_amount_too_high',
                        },
                    },
                },
                payment: {
                    id: 'payment_rejected',
                    status: 'REJECTED',
                    amount: '5000.00',
                    currency: 'SAR',
                    created_at: '2024-01-15T10:00:00Z',
                    is_test: true,
                },
                merchant_urls: {},
            })) as unknown as typeof fetch;

            const params = createTestCheckoutParams();
            params.amount = '5000.00';

            const response = await gateway.createCheckoutSession(params);

            expect(response.status).toBe('rejected');
            expect(response.configuration.products?.installments?.rejection_reason).toBe('order_amount_too_high');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Eligibility Check Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('checkEligibility', () => {
        it('should return eligible true for approved customers', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'session_eligible',
                status: 'created',
                configuration: {
                    products: { installments: { is_available: true, rejection_reason: null } },
                },
                payment: { id: 'p1', status: 'CREATED', amount: '100.00', currency: 'SAR' },
            })) as unknown as typeof fetch;

            const result = await gateway.checkEligibility(createTestCheckoutParams());

            expect(result.eligible).toBe(true);
            expect(result.rejectionReason).toBeUndefined();
        });

        it('should return eligible false for rejected customers', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'session_rejected',
                status: 'rejected',
                configuration: {
                    products: {
                        installments: {
                            is_available: false,
                            rejection_reason: 'not_available',
                        },
                    },
                },
                payment: { id: 'p1', status: 'REJECTED' },
            })) as unknown as typeof fetch;

            const result = await gateway.checkEligibility(createTestCheckoutParams());

            expect(result.eligible).toBe(false);
            expect(result.rejectionReason).toBe('not_available');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Capture Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('capturePayment', () => {
        it('should capture authorized payment', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_123',
                status: 'CLOSED',
                amount: '100.00',
                currency: 'SAR',
                captures: [{
                    id: 'capture_1',
                    amount: '100.00',
                    created_at: '2024-01-15T10:05:00Z',
                }],
                refunds: [],
            })) as unknown as typeof fetch;

            const result = await gateway.capturePayment({
                gatewayPaymentId: 'payment_123',
                amount: 100,
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('paid');
            expect(result.capturedAmount).toBe(100);
        });

        it('should handle partial capture', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_partial',
                status: 'AUTHORIZED', // Still authorized after partial capture
                amount: '100.00',
                currency: 'SAR',
                captures: [{
                    id: 'capture_partial',
                    amount: '50.00',
                    created_at: '2024-01-15T10:05:00Z',
                }],
                refunds: [],
            })) as unknown as typeof fetch;

            const result = await gateway.capturePayment({
                gatewayPaymentId: 'payment_partial',
                amount: 50,
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('authorized');
            expect(result.capturedAmount).toBe(50);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Refund Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('refundPayment', () => {
        it('should refund closed payment', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_refund',
                status: 'CLOSED',
                amount: '100.00',
                currency: 'SAR',
                captures: [{ id: 'c1', amount: '100.00' }],
                refunds: [{
                    id: 'refund_1',
                    amount: '100.00',
                    created_at: '2024-01-15T11:00:00Z',
                    reason: 'Customer request',
                }],
            })) as unknown as typeof fetch;

            const result = await gateway.refundPayment({
                gatewayPaymentId: 'payment_refund',
                reason: 'Customer request',
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('completed');
            expect(result.totalRefunded).toBe(100);
        });

        it('should handle partial refund', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_partial_refund',
                status: 'CLOSED',
                amount: '100.00',
                currency: 'SAR',
                captures: [{ id: 'c1', amount: '100.00' }],
                refunds: [{
                    id: 'refund_partial',
                    amount: '30.00',
                    created_at: '2024-01-15T11:00:00Z',
                }],
            })) as unknown as typeof fetch;

            const result = await gateway.refundPayment({
                gatewayPaymentId: 'payment_partial_refund',
                amount: 30,
            });

            expect(result.success).toBe(true);
            expect(result.totalRefunded).toBe(30);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Void Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('voidPayment', () => {
        it('should close/void payment', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_void',
                status: 'CLOSED',
                amount: '100.00',
                currency: 'SAR',
                captures: [],
                refunds: [],
            })) as unknown as typeof fetch;

            const result = await gateway.voidPayment({
                gatewayPaymentId: 'payment_void',
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe('paid'); // CLOSED maps to paid
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Verification Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('verifyWebhook', () => {
        it('should verify webhook with valid auth header', () => {
            const result = gateway.verifyWebhook(
                { id: 'evt_123' },
                undefined,
                { 'authorization': 'Bearer webhook_secret_123' }
            );

            expect(result).toBe(true);
        });

        it('should reject webhook with invalid auth header', () => {
            const result = gateway.verifyWebhook(
                { id: 'evt_123' },
                undefined,
                { 'authorization': 'Bearer wrong_secret' }
            );

            expect(result).toBe(false);
        });

        it('should reject webhook with missing auth header', () => {
            const result = gateway.verifyWebhook(
                { id: 'evt_123' },
                undefined,
                {}
            );

            expect(result).toBe(false);
        });

        it('should pass verification if no webhook auth configured', () => {
            const noAuthGateway = new TabbyGateway(
                { ...TABBY_TEST_CONFIG, webhookAuthHeader: undefined },
                hooksManager
            );

            const result = noAuthGateway.verifyWebhook({ id: 'evt_123' });
            expect(result).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Parsing Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseWebhookEvent', () => {
        it('should parse authorized webhook event', () => {
            const payload = {
                id: 'payment_auth',
                status: 'authorized',
                created_at: '2024-01-15T10:00:00Z',
                is_test: true,
                amount: '100.00',
                currency: 'SAR',
                order: { reference_id: 'order_123' },
                captures: [],
                refunds: [],
                meta: { paymentId: 'internal_123' },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.gateway).toBe('tabby');
            expect(event.type).toBe('payment.authorized');
            expect(event.status).toBe('authorized');
            expect(event.amount).toBe(100);
            expect(event.currency).toBe('SAR');
            expect(event.paymentId).toBe('internal_123');
            expect(event.gatewayPaymentId).toBe('payment_auth');
        });

        it('should parse closed webhook event as paid', () => {
            const payload = {
                id: 'payment_closed',
                status: 'closed',
                created_at: '2024-01-15T10:00:00Z',
                closed_at: '2024-01-15T10:05:00Z',
                is_test: true,
                amount: '100.00',
                currency: 'SAR',
                order: { reference_id: 'order_123' },
                captures: [{ id: 'c1', amount: '100.00', created_at: '2024-01-15T10:05:00Z' }],
                refunds: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('paid');
        });

        it('should parse closed webhook with refunds as refunded', () => {
            const payload = {
                id: 'payment_refunded',
                status: 'closed',
                created_at: '2024-01-15T10:00:00Z',
                is_test: true,
                amount: '100.00',
                currency: 'SAR',
                order: { reference_id: 'order_123' },
                captures: [{ id: 'c1', amount: '100.00', created_at: '2024-01-15T10:05:00Z' }],
                refunds: [{ id: 'r1', amount: '100.00', created_at: '2024-01-15T11:00:00Z' }],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('refunded');
            expect(event.type).toBe('payment.refunded');
        });

        it('should parse rejected webhook event as failed', () => {
            const payload = {
                id: 'payment_rejected',
                status: 'rejected',
                created_at: '2024-01-15T10:00:00Z',
                is_test: true,
                amount: '100.00',
                currency: 'SAR',
                order: { reference_id: 'order_123' },
                captures: [],
                refunds: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('failed');
        });

        it('should parse expired webhook event as cancelled', () => {
            const payload = {
                id: 'payment_expired',
                status: 'expired',
                created_at: '2024-01-15T10:00:00Z',
                is_expired: true,
                is_test: true,
                amount: '100.00',
                currency: 'SAR',
                order: { reference_id: 'order_123' },
                captures: [],
                refunds: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('cancelled');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Error Handling Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('error handling', () => {
        it('should handle 401 unauthorized error', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                status: 'error',
                errorType: 'unauthorized',
                error: 'Invalid or missing authentication token',
            }, false, 401)) as unknown as typeof fetch;

            await expect(gateway.getPayment('payment_123'))
                .rejects.toThrow('Invalid or missing authentication token');
        });

        it('should handle 400 bad request error', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                status: 'error',
                errorType: 'bad_data',
                error: 'Missing required parameter: payment.amount',
            }, false, 400)) as unknown as typeof fetch;

            await expect(gateway.createCheckoutSession(createTestCheckoutParams()))
                .rejects.toThrow('Missing required parameter: payment.amount');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Validation Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('validation', () => {
        it('should reject createCheckoutSession with invalid email', async () => {
            const invalidParams = createTestCheckoutParams();
            invalidParams.buyer.email = 'not-an-email';

            await expect(gateway.createCheckoutSession(invalidParams))
                .rejects.toThrow('Invalid checkout session params');
        });

        it('should reject createCheckoutSession with invalid amount format', async () => {
            const invalidParams = createTestCheckoutParams();
            invalidParams.amount = 'invalid';

            await expect(gateway.createCheckoutSession(invalidParams))
                .rejects.toThrow('Invalid checkout session params');
        });

        it('should reject createCheckoutSession with empty items array', async () => {
            const invalidParams = createTestCheckoutParams();
            invalidParams.order.items = [];

            await expect(gateway.createCheckoutSession(invalidParams))
                .rejects.toThrow('Invalid checkout session params');
        });

        it('should reject createPayment with invalid callbackUrl', async () => {
            await expect(gateway.createPayment({
                amount: 100,
                currency: 'SAR',
                callbackUrl: 'not-a-url',
            })).rejects.toThrow('Validation failed');
        });

        it('should reject capturePayment with empty gatewayPaymentId', async () => {
            await expect(gateway.capturePayment({
                gatewayPaymentId: '',
            })).rejects.toThrow('Validation failed');
        });

        it('should reject refundPayment with empty gatewayPaymentId', async () => {
            await expect(gateway.refundPayment({
                gatewayPaymentId: '',
            })).rejects.toThrow('Validation failed');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Get Payment Status Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('getPaymentStatus', () => {
        it('should retrieve payment status', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'payment_status',
                status: 'AUTHORIZED',
                amount: '100.00',
                currency: 'SAR',
                captures: [],
                refunds: [],
            })) as unknown as typeof fetch;

            const status = await gateway.getPaymentStatus('payment_status');

            expect(status).toBe('authorized');
        });
    });
});
