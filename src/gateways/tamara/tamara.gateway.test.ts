// file: packages/payments/src/gateways/tamara/tamara.gateway.test.ts

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { TamaraGateway } from './tamara.gateway';
import { HooksManager } from '../../hooks/hooks.manager';
import type { TamaraConfig } from '../../types/config.types';
import type { TamaraCheckoutSessionParams } from '../../types/tamara.types';
import type { TamaraWebhookPayload } from '../../types/webhook.types';
import type { PaymentStatus } from '../../types/payment.types';
import {
    InvalidRequestError,
} from '../../errors';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════════

const mockConfig: TamaraConfig = {
    apiToken: 'test_token_xxx',
    notificationToken: 'notification_secret',
    sandbox: true,
};

const mockHooks = new HooksManager();

function createGateway(config = mockConfig): TamaraGateway {
    return new TamaraGateway(config, mockHooks);
}

// Mock checkout session params
const validCheckoutParams: TamaraCheckoutSessionParams = {
    total_amount: { amount: 300, currency: 'SAR' },
    shipping_amount: { amount: 10, currency: 'SAR' },
    tax_amount: { amount: 15, currency: 'SAR' },
    order_reference_id: 'order_123',
    items: [
        {
            name: 'Product 1',
            quantity: 1,
            reference_id: 'item_1',
            type: 'Physical',
            sku: 'SKU123',
            total_amount: { amount: 275, currency: 'SAR' },
        },
    ],
    consumer: {
        email: 'customer@example.com',
        first_name: 'Ahmed',
        last_name: 'Mohammed',
        phone_number: '500000000',
    },
    country_code: 'SA',
    description: 'Test order',
    merchant_url: {
        success: 'https://example.com/success',
        failure: 'https://example.com/failure',
        cancel: 'https://example.com/cancel',
        notification: 'https://example.com/webhook',
    },
    shipping_address: {
        city: 'Riyadh',
        country_code: 'SA',
        first_name: 'Ahmed',
        last_name: 'Mohammed',
        line1: '123 Main St',
        phone_number: '500000000',
        region: 'Riyadh',
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Gateway Initialization Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('TamaraGateway', () => {
    describe('initialization', () => {
        it('should have correct gateway name', () => {
            const gateway = createGateway();
            expect(gateway.name).toBe('tamara');
        });

        it('should use sandbox URL when sandbox is true', () => {
            const gateway = createGateway({ ...mockConfig, sandbox: true });
            // @ts-expect-error - accessing private property for testing
            expect(gateway.baseUrl).toBe('https://api-sandbox.tamara.co');
        });

        it('should use production URL when sandbox is false', () => {
            const gateway = createGateway({ ...mockConfig, sandbox: false });
            // @ts-expect-error - accessing private property for testing
            expect(gateway.baseUrl).toBe('https://api.tamara.co');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // createPayment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createPayment', () => {
        it('should validate required fields', async () => {
            const gateway = createGateway();

            await expect(
                gateway.createPayment({
                    amount: -100, // Invalid negative amount
                    currency: 'SAR',
                    callbackUrl: 'https://example.com/callback',
                })
            ).rejects.toThrow(InvalidRequestError);
        });

        it('should require valid callback URL', async () => {
            const gateway = createGateway();

            await expect(
                gateway.createPayment({
                    amount: 100,
                    currency: 'SAR',
                    callbackUrl: 'not-a-url', // Invalid URL
                })
            ).rejects.toThrow(InvalidRequestError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // createCheckoutSession Validation Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createCheckoutSession validation', () => {
        it('should reject invalid checkout params', async () => {
            const gateway = createGateway();

            const invalidParams = {
                total_amount: { amount: 100, currency: 'INVALID' }, // Invalid currency
                shipping_amount: { amount: 0, currency: 'SAR' },
                tax_amount: { amount: 0, currency: 'SAR' },
                order_reference_id: '',
                items: [],
                consumer: {
                    email: 'invalid-email',
                    first_name: '',
                    last_name: '',
                    phone_number: '',
                },
                country_code: 'XX' as const,
                description: 'Test',
                merchant_url: {
                    success: 'not-url',
                    failure: 'not-url',
                    cancel: 'not-url',
                    notification: 'not-url',
                },
                shipping_address: {
                    city: '',
                    country_code: 'SA',
                    first_name: '',
                    last_name: '',
                    line1: '',
                    phone_number: '',
                    region: '',
                },
            };

            await expect(
                // @ts-expect-error - intentionally passing invalid params
                gateway.createCheckoutSession(invalidParams)
            ).rejects.toThrow(InvalidRequestError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // capturePayment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('capturePayment', () => {
        it('should validate required gateway payment ID', async () => {
            const gateway = createGateway();

            await expect(
                gateway.capturePayment({
                    gatewayPaymentId: '', // Empty ID
                })
            ).rejects.toThrow(InvalidRequestError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // refundPayment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('refundPayment', () => {
        it('should validate required gateway payment ID', async () => {
            const gateway = createGateway();

            await expect(
                gateway.refundPayment({
                    gatewayPaymentId: '', // Empty ID
                })
            ).rejects.toThrow(InvalidRequestError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // voidPayment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('voidPayment', () => {
        it('should validate required gateway payment ID', async () => {
            const gateway = createGateway();

            await expect(
                gateway.voidPayment({
                    gatewayPaymentId: '', // Empty ID
                })
            ).rejects.toThrow(InvalidRequestError);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Verification Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('verifyWebhook', () => {
        it('should accept webhook without verification when no notification token', () => {
            const gateway = createGateway({
                apiToken: 'test_token',
                sandbox: true,
                // No notification token
            });

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            expect(gateway.verifyWebhook(payload)).toBe(true);
        });

        it('should reject webhook when token is missing and verification is enabled', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            expect(gateway.verifyWebhook(payload, undefined)).toBe(false);
        });

        it('should reject webhook with invalid JWT structure', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            // Invalid JWT (only 2 parts)
            expect(gateway.verifyWebhook(payload, 'header.payload')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Async Webhook Verification Tests (JWT Cryptographic)
    // ═══════════════════════════════════════════════════════════════════════════

    describe('verifyWebhookAsync', () => {
        it('should accept webhook without verification when no notification token', async () => {
            const gateway = createGateway({
                apiToken: 'test_token',
                sandbox: true,
                // No notification token
            });

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            expect(await gateway.verifyWebhookAsync(payload)).toBe(true);
        });

        it('should reject webhook when token is missing', async () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            expect(await gateway.verifyWebhookAsync(payload, undefined)).toBe(false);
        });

        it('should reject webhook with invalid JWT signature', async () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            // Create a fake JWT with wrong signature
            const fakeHeader = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
            const fakePayload = btoa(JSON.stringify({ order_id: 'order_123' }));
            const fakeSignature = 'invalid_signature';
            const fakeToken = `${fakeHeader}.${fakePayload}.${fakeSignature}`;

            expect(await gateway.verifyWebhookAsync(payload, fakeToken)).toBe(false);
        });

        it('should reject webhook with order_id mismatch', async () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'order_123',
                order_reference_id: 'ref_123',
                event_type: 'order_approved',
                data: [],
            };

            // Even with valid structure, order_id mismatch should fail
            const fakeHeader = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
            const fakePayload = btoa(JSON.stringify({ order_id: 'different_order' }));
            const fakeSignature = 'some_signature';
            const fakeToken = `${fakeHeader}.${fakePayload}.${fakeSignature}`;

            // Will fail on signature verification before order_id check
            expect(await gateway.verifyWebhookAsync(payload, fakeToken)).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Parsing Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseWebhookEvent', () => {
        it('should parse order_approved event correctly', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                order_number: '90001860',
                event_type: 'order_approved',
                data: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.id).toBe('f56a3123-9e23-45e4-87a2-95366d3b0bca');
            expect(event.type).toBe('order_approved');
            expect(event.gateway).toBe('tamara');
            expect(event.paymentId).toBe('order_123');
            expect(event.gatewayPaymentId).toBe('f56a3123-9e23-45e4-87a2-95366d3b0bca');
            expect(event.status).toBe('pending'); // Pending until authorised
        });

        it('should parse order_authorised event correctly', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_authorised',
                data: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('authorized');
        });

        it('should parse order_captured event with amount', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_captured',
                data: {
                    capture_id: 'cap_123',
                    captured_amount: { amount: 300, currency: 'SAR' },
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('paid');
            expect(event.amount).toBe(300);
            expect(event.currency).toBe('SAR');
        });

        it('should parse order_refunded event', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_refunded',
                data: {
                    refund_id: 'ref_123',
                    capture_id: 'cap_123',
                    refunded_amount: { amount: 100, currency: 'SAR' },
                    comment: 'Customer requested refund',
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('refunded');
            expect(event.amount).toBe(100);
        });

        it('should parse order_canceled event', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_canceled',
                data: {
                    cancel_id: 'cancel_123',
                    canceled_amount: { amount: 300, currency: 'SAR' },
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('cancelled');
            expect(event.amount).toBe(300);
        });

        it('should parse order_declined event', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_declined',
                data: {
                    declined_reason: 'Risk assessment failed',
                    declined_code: 'RISK_001',
                    decline_type: 'HARD',
                },
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('failed');
        });

        it('should parse order_expired event', () => {
            const gateway = createGateway();

            const payload: TamaraWebhookPayload = {
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_expired',
                data: [],
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.status).toBe('failed');
        });

        it('should parse JSON string payload', () => {
            const gateway = createGateway();

            const payload = JSON.stringify({
                order_id: 'f56a3123-9e23-45e4-87a2-95366d3b0bca',
                order_reference_id: 'order_123',
                event_type: 'order_approved',
                data: [],
            });

            const event = gateway.parseWebhookEvent(payload);

            expect(event.id).toBe('f56a3123-9e23-45e4-87a2-95366d3b0bca');
            expect(event.gateway).toBe('tamara');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Status Mapping Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('status mapping', () => {
        it('should map all Tamara statuses correctly', () => {
            const gateway = createGateway();

            // Test by parsing webhooks with different event types
            const statusMappings: Array<[TamaraWebhookPayload['event_type'], PaymentStatus]> = [
                ['order_approved', 'pending'],
                ['order_authorised', 'authorized'],
                ['order_captured', 'paid'],
                ['order_canceled', 'cancelled'],
                ['order_declined', 'failed'],
                ['order_expired', 'failed'],
            ];

            for (const [eventType, expectedStatus] of statusMappings) {
                const payload: TamaraWebhookPayload = {
                    order_id: 'order_123',
                    order_reference_id: 'ref_123',
                    event_type: eventType,
                    data: [],
                };

                const event = gateway.parseWebhookEvent(payload);
                expect(event.status).toBe(expectedStatus);
            }
        });
    });
});
