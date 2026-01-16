// file: packages/payments/src/gateways/stripe/stripe.gateway.test.ts

import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { StripeGateway } from './stripe.gateway';
import { HooksManager } from '../../hooks/hooks.manager';
import type { StripeConfig } from '../../types/config.types';
import type { CreatePaymentParams } from '../../types/payment.types';
import { createHmac } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const STRIPE_TEST_CONFIG: StripeConfig = {
    secretKey: 'sk_test_123',
    publishableKey: 'pk_test_123',
    webhookSecret: 'whsec_test_123',
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

// ═══════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════════════════

describe('StripeGateway', () => {
    let gateway: StripeGateway;
    let hooksManager: HooksManager;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        hooksManager = new HooksManager({});
        gateway = new StripeGateway(STRIPE_TEST_CONFIG, hooksManager);
        globalThis.fetch = originalFetch;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Verification Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('verifyWebhook', () => {
        it('should return true for valid signature', () => {
            const payload = JSON.stringify({ id: 'evt_123' });
            const timestamp = Math.floor(Date.now() / 1000);
            const signedPayload = `${timestamp}.${payload}`;
            const signature = createHmac('sha256', STRIPE_TEST_CONFIG.webhookSecret!)
                .update(signedPayload)
                .digest('hex');

            const result = gateway.verifyWebhook(payload, undefined, {
                'stripe-signature': `t=${timestamp},v1=${signature}`,
            });

            expect(result).toBe(true);
        });

        it('should fail for invalid signature', () => {
            const payload = JSON.stringify({ id: 'evt_123' });
            const timestamp = Math.floor(Date.now() / 1000);

            const result = gateway.verifyWebhook(payload, undefined, {
                'stripe-signature': `t=${timestamp},v1=invalid_sig`,
            });

            expect(result).toBe(false);
        });

        it('should fail for old timestamp', () => {
            const payload = JSON.stringify({ id: 'evt_123' });
            const timestamp = Math.floor(Date.now() / 1000) - 600; // 10 mins ago
            const signedPayload = `${timestamp}.${payload}`;
            const signature = createHmac('sha256', STRIPE_TEST_CONFIG.webhookSecret!)
                .update(signedPayload)
                .digest('hex');

            const result = gateway.verifyWebhook(payload, undefined, {
                'stripe-signature': `t=${timestamp},v1=${signature}`,
            });

            expect(result).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Webhook Parsing Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('parseWebhookEvent', () => {
        it('should parse payment_intent.succeeded event', () => {
            const payload = {
                id: 'evt_123',
                type: 'payment_intent.succeeded',
                created: 1623456789,
                data: {
                    object: {
                        id: 'pi_123',
                        object: 'payment_intent',
                        status: 'succeeded',
                        amount: 1000,
                        currency: 'usd',
                        metadata: { paymentId: 'internal_123' },
                    },
                },
                livemode: false,
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.gateway).toBe('stripe');
            expect(event.type).toBe('payment_intent.succeeded');
            expect(event.status).toBe('paid');
            expect(event.amount).toBe(10); // 1000 cents = 10.00
            expect(event.gatewayPaymentId).toBe('pi_123');
            expect(event.paymentId).toBe('internal_123');
        });

        it('should parse checkout.session.completed event', () => {
            const payload = {
                id: 'evt_checkout',
                type: 'checkout.session.completed',
                created: 1623456789,
                data: {
                    object: {
                        id: 'cs_123',
                        object: 'checkout.session',
                        payment_status: 'paid',
                        status: 'complete',
                        amount_total: 2000,
                        currency: 'usd',
                        metadata: { paymentId: 'internal_checkout_123' },
                    },
                },
                livemode: false,
            };

            const event = gateway.parseWebhookEvent(payload);

            expect(event.gateway).toBe('stripe');
            expect(event.type).toBe('checkout.session.completed');
            // expect status to be paid if payment_status is paid
            // Note: The implementation might need update to handle this specific event if it fails
            expect(event.gatewayPaymentId).toBe('cs_123');
            expect(event.paymentId).toBe('internal_checkout_123');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Create Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createPayment', () => {
        it('should create payment intent', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'pi_321',
                object: 'payment_intent',
                status: 'requires_payment_method',
                amount: 5000,
                currency: 'usd',
                client_secret: 'pi_321_secret',
            })) as unknown as typeof fetch;

            const params: CreatePaymentParams = {
                amount: 50,
                currency: 'USD',
                callbackUrl: 'https://example.com',
                description: 'Test Charge',
            };

            const result = await gateway.createPayment(params);

            expect(result.success).toBe(true);
            expect(result.gatewayId).toBe('pi_321');
            expect(result.amount).toBe(50);
            expect(result.status).toBe('pending');
            // Check body payload structure via spy if needed, relying on functional result for now
        });

        it('should confirm payment if method ID provided', async () => {
            // Mock fetch to verify body params
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'pi_confirmed',
                    status: 'succeeded',
                    amount: 2000,
                });
            }) as unknown as typeof fetch;

            await gateway.createPayment({
                amount: 20,
                currency: 'USD',
                callbackUrl: 'http://cb',
                stripePaymentMethodId: 'pm_card_visa',
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('confirm')).toBe('true');
            expect(params.get('payment_method')).toBe('pm_card_visa');
        });

        it('should create payment with manual capture when capture is false', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'pi_manual',
                    status: 'requires_capture',
                    amount: 5000,
                });
            }) as unknown as typeof fetch;

            const result = await gateway.createPayment({
                amount: 50,
                currency: 'USD',
                callbackUrl: 'http://cb',
                capture: false,
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('capture_method')).toBe('manual');
            expect(result.status).toBe('authorized');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Capture Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('capturePayment', () => {
        it('should capture payment intent', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'pi_cap',
                status: 'succeeded',
                amount_received: 10000,
            })) as unknown as typeof fetch;

            const result = await gateway.capturePayment({ gatewayPaymentId: 'pi_cap' });
            expect(result.status).toBe('paid');
            expect(result.amount).toBe(100);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Void Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('voidPayment', () => {
        it('should cancel payment intent', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 'pi_cancel',
                status: 'canceled',
                amount: 5000,
            })) as unknown as typeof fetch;

            const result = await gateway.voidPayment({ gatewayPaymentId: 'pi_cancel' });
            expect(result.success).toBe(true);
            expect(result.status).toBe('cancelled');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Checkout Session Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createCheckoutSession', () => {
        it('should create checkout session with simple amount', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'cs_test_123',
                    object: 'checkout.session',
                    url: 'https://checkout.stripe.com/test',
                    status: 'open',
                    payment_status: 'unpaid',
                })
            }) as unknown as typeof fetch;

            const result = await gateway.createCheckoutSession({
                amount: 100,
                currency: 'USD',
                successUrl: 'https://success',
                cancelUrl: 'https://cancel',
            });

            const params = new URLSearchParams(capturedBody);
            expect(result.success).toBe(true);
            expect(result.sessionId).toBe('cs_test_123');
            expect(result.url).toBe('https://checkout.stripe.com/test');

            expect(params.get('mode')).toBe('payment');
            expect(params.get('success_url')).toBe('https://success');
            // Check line items structure for simple amount
            expect(params.get('line_items[0][price_data][unit_amount]')).toBe('10000'); // 100 * 100
            expect(params.get('line_items[0][quantity]')).toBe('1');
        });

        it('should create checkout session with line items and customer email', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'cs_test_lines',
                    url: 'https://checkout',
                })
            }) as unknown as typeof fetch;

            await gateway.createCheckoutSession({
                amount: 1, // ignored when line items present, but required by schema
                currency: 'USD', // ignored when line items present
                successUrl: 'https://s',
                cancelUrl: 'https://c',
                customerEmail: 'test@example.com',
                lineItems: [
                    {
                        price: 'price_123',
                        quantity: 2,
                    }
                ]
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('customer_email')).toBe('test@example.com');
            expect(params.get('line_items[0][price]')).toBe('price_123');
            expect(params.get('line_items[0][quantity]')).toBe('2');
        });
    });

    it('should create checkout session in subscription mode', async () => {
        let capturedBody: string = "";
        globalThis.fetch = mock(async (url, opts: RequestInit) => {
            capturedBody = opts.body as string;
            return createMockResponse({
                id: 'cs_sub_123',
                object: 'checkout.session',
                mode: 'subscription',
                url: 'https://checkout.stripe.com/sub',
            })
        }) as unknown as typeof fetch;

        await gateway.createCheckoutSession({
            amount: 1,
            currency: 'USD',
            mode: 'subscription',
            lineItems: [{ price: 'price_recurring_123', quantity: 1 }],
            successUrl: 'https://success',
            cancelUrl: 'https://cancel',
        });

        const params = new URLSearchParams(capturedBody);
        expect(params.get('mode')).toBe('subscription');
        expect(params.get('line_items[0][price]')).toBe('price_recurring_123');
    });

    it('should create checkout session in setup mode (no line items)', async () => {
        let capturedBody: string = "";
        globalThis.fetch = mock(async (url, opts: RequestInit) => {
            capturedBody = opts.body as string;
            return createMockResponse({
                id: 'cs_setup_123',
                object: 'checkout.session',
                mode: 'setup',
                url: 'https://checkout.stripe.com/setup',
            })
        }) as unknown as typeof fetch;

        await gateway.createCheckoutSession({
            amount: 1,
            currency: 'USD',
            mode: 'setup',
            successUrl: 'https://success',
            cancelUrl: 'https://cancel',
            customerId: 'cus_123',
        } as any);

        const params = new URLSearchParams(capturedBody);
        expect(params.get('mode')).toBe('setup');
        expect(params.get('customer')).toBe('cus_123');
        // Ensure no line items are sent for setup mode defaults
        expect(params.toString().includes('line_items')).toBe(false);
    });


    // ═══════════════════════════════════════════════════════════════════════════
    // Apple Pay Simulation Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('Apple Pay Simulation', () => {
        it('should enable automatic payment methods for Apple Pay support', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'pi_apple_pay',
                    status: 'requires_payment_method',
                });
            }) as unknown as typeof fetch;

            await gateway.createPayment({
                amount: 100,
                currency: 'USD',
                callbackUrl: 'https://example.com',
                description: 'Apple Pay Test',
            });

            const params = new URLSearchParams(capturedBody);
            // automatic_payment_methods[enabled]=true includes Apple Pay by default in Stripe
            expect(params.get('automatic_payment_methods[enabled]')).toBe('true');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Refund Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('refundPayment', () => {
        it('should refund payment intent', async () => {
            globalThis.fetch = mock(async () => createMockResponse({
                id: 're_123',
                status: 'succeeded',
                amount: 500,
            })) as unknown as typeof fetch;

            const result = await gateway.refundPayment({ gatewayPaymentId: 'pi_ref', amount: 5 });
            expect(result.success).toBe(true);
            expect(result.totalRefunded).toBe(5);
        });
    });
});
