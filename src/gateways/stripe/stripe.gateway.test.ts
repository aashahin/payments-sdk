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
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return {
        ok,
        status,
        json: async () => data,
        text: async () => text,
        headers: new Headers(),
    } as unknown as Response;
}

function createStripeSignature(payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac('sha256', STRIPE_TEST_CONFIG.webhookSecret!)
        .update(`${timestamp}.${payload}`)
        .digest('hex');
    return `t=${timestamp},v1=${signature}`;
}

function createStripeRefundList(data: Array<Record<string, unknown>>, hasMore = false) {
    return {
        object: 'list',
        data,
        has_more: hasMore,
    };
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

        it('should fail closed when webhook secret is missing', () => {
            const insecureGateway = new StripeGateway({
                secretKey: 'sk_test_123',
            }, hooksManager);

            expect(insecureGateway.verifyWebhook(JSON.stringify({ id: 'evt_123' }), 't=1,v1=test')).toBe(false);
        });

        it('should accept any matching v1 signature in the header', () => {
            const payload = JSON.stringify({ id: 'evt_123' });
            const timestamp = Math.floor(Date.now() / 1000);
            const validSignature = createStripeSignature(payload, timestamp);

            const result = gateway.verifyWebhook(payload, `t=${timestamp},v1=bad_signature,${validSignature.split(',')[1]}`);

            expect(result).toBe(true);
        });

        it('should read stripe-signature headers case-insensitively', () => {
            const payload = JSON.stringify({ id: 'evt_123' });
            const signature = createStripeSignature(payload);

            const result = gateway.verifyWebhook(payload, undefined, {
                'STRIPE-SIGNATURE': signature,
            });

            expect(result).toBe(true);
        });

        it('should reject parsed objects because raw body is required', () => {
            const payload = { id: 'evt_123' };
            const rawPayload = JSON.stringify(payload);
            const signature = createStripeSignature(rawPayload);

            expect(gateway.verifyWebhook(payload, signature)).toBe(false);
        });

        it('should verify Buffer payloads using the exact raw bytes', () => {
            const payload = Buffer.from([0x7b, 0x22, 0x69, 0x64, 0x22, 0x3a, 0xff, 0x7d]);
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = createHmac('sha256', STRIPE_TEST_CONFIG.webhookSecret!)
                .update(Buffer.concat([
                    Buffer.from(`${timestamp}.`, 'utf8'),
                    payload,
                ]))
                .digest('hex');

            expect(gateway.verifyWebhook(payload, `t=${timestamp},v1=${signature}`)).toBe(true);
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

        it('should parse raw Buffer payloads', () => {
            const payload = Buffer.from(JSON.stringify({
                id: 'evt_buffer',
                type: 'payment_intent.succeeded',
                created: 1623456789,
                data: {
                    object: {
                        id: 'pi_buffer',
                        object: 'payment_intent',
                        status: 'succeeded',
                        amount: 1000,
                        currency: 'usd',
                        metadata: {},
                    },
                },
                livemode: false,
            }));

            const event = gateway.parseWebhookEvent(payload);

            expect(event.gatewayPaymentId).toBe('pi_buffer');
            expect(event.status).toBe('paid');
            expect(event.amount).toBe(10);
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
	                        payment_intent: 'pi_checkout_123',
	                        metadata: { paymentId: 'internal_checkout_123' },
	                    },
                },
                livemode: false,
            };

            const event = gateway.parseWebhookEvent(payload);

	            expect(event.gateway).toBe('stripe');
	            expect(event.type).toBe('checkout.session.completed');
	            expect(event.status).toBe('paid');
	            expect(event.gatewayPaymentId).toBe('pi_checkout_123');
		    expect(event.gatewayObjectId).toBe('cs_123');
		    expect(event.paymentId).toBe('internal_checkout_123');
		});

        it('should parse setup checkout completion as setup_completed', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_checkout_setup',
                type: 'checkout.session.completed',
                created: 1623456789,
		                data: {
		                    object: {
		                        id: 'cs_setup_done',
		                        object: 'checkout.session',
		                        payment_status: 'no_payment_required',
		                        status: 'complete',
		                        currency: 'usd',
		                        metadata: { paymentId: 'setup_123' },
		                    },
		                },
		                livemode: false,
		            });

		            expect(event.status).toBe('setup_completed');
            expect(event.gatewayPaymentId).toBe('cs_setup_done');
            expect(event.paymentId).toBe('setup_123');
        });

        it('should use SetupIntent ID for setup checkout completion when Stripe includes it', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_checkout_setup_intent',
                type: 'checkout.session.completed',
                created: 1623456789,
                data: {
                    object: {
                        id: 'cs_setup_done',
                        object: 'checkout.session',
                        payment_status: 'no_payment_required',
                        status: 'complete',
                        setup_intent: 'seti_123',
                        currency: 'usd',
                        metadata: { paymentId: 'setup_123' },
                    },
                },
                livemode: false,
            });

            expect(event.status).toBe('setup_completed');
            expect(event.gatewayPaymentId).toBe('seti_123');
            expect(event.gatewayObjectId).toBe('cs_setup_done');
        });

        it('should use Subscription ID for subscription checkout completion', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_checkout_subscription',
                type: 'checkout.session.completed',
                created: 1623456789,
                data: {
                    object: {
                        id: 'cs_sub_done',
                        object: 'checkout.session',
                        payment_status: 'paid',
                        status: 'complete',
                        subscription: 'sub_123',
                        amount_total: 2000,
                        currency: 'usd',
                        metadata: { paymentId: 'order_sub_123' },
                    },
                },
                livemode: false,
            });

            expect(event.status).toBe('paid');
            expect(event.gatewayPaymentId).toBe('sub_123');
            expect(event.gatewayObjectId).toBe('cs_sub_done');
            expect(event.amount).toBe(20);
        });

		        it('should parse JPY webhook amounts without dividing by 100', () => {
		            const event = gateway.parseWebhookEvent({
	                id: 'evt_jpy',
	                type: 'payment_intent.succeeded',
	                created: 1623456789,
	                data: {
	                    object: {
	                        id: 'pi_jpy',
	                        object: 'payment_intent',
	                        status: 'succeeded',
	                        amount: 500,
	                        currency: 'jpy',
	                        metadata: {},
	                    },
	                },
	                livemode: false,
	            });

	            expect(event.amount).toBe(500);
	            expect(event.currency).toBe('jpy');
	        });

	        it('should use related PaymentIntent for charge refund events', () => {
	            const event = gateway.parseWebhookEvent({
	                id: 'evt_charge_refunded',
	                type: 'charge.refunded',
	                created: 1623456789,
	                data: {
	                    object: {
	                        id: 'ch_123',
	                        object: 'charge',
	                        status: 'succeeded',
	                        amount: 2500,
	                        currency: 'usd',
	                        payment_intent: 'pi_from_charge',
	                        metadata: { paymentId: 'internal_charge' },
	                    },
	                },
	                livemode: false,
	            });

	            expect(event.status).toBe('refunded');
	            expect(event.gatewayPaymentId).toBe('pi_from_charge');
	            expect(event.gatewayObjectId).toBe('ch_123');
		            expect(event.amount).toBe(25);
		        });

		        it('should mark charge.refunded partial refunds as partially_refunded', () => {
		            const event = gateway.parseWebhookEvent({
		                id: 'evt_charge_partial_refunded',
		                type: 'charge.refunded',
		                created: 1623456789,
		                data: {
		                    object: {
		                        id: 'ch_partial',
		                        object: 'charge',
		                        status: 'succeeded',
		                        amount: 2500,
		                        amount_refunded: 1200,
		                        currency: 'usd',
		                        payment_intent: 'pi_partial_refund',
		                        metadata: {},
		                    },
		                },
		                livemode: false,
		            });

		            expect(event.status).toBe('partially_refunded');
		            expect(event.gatewayPaymentId).toBe('pi_partial_refund');
		            expect(event.amount).toBe(12);
		        });

		        it('should use related PaymentIntent for legacy refund update events', () => {
	            const event = gateway.parseWebhookEvent({
	                id: 'evt_refund_updated',
	                type: 'charge.refund.updated',
	                created: 1623456789,
	                data: {
	                    object: {
	                        id: 're_123',
	                        object: 'refund',
	                        status: 'succeeded',
	                        amount: 1200,
	                        currency: 'usd',
	                        payment_intent: 'pi_from_refund',
	                        metadata: { paymentId: 'internal_refund' },
	                    },
	                },
	                livemode: false,
	            });

		            expect(event.status).toBe('refund_completed');
	            expect(event.gatewayPaymentId).toBe('pi_from_refund');
		            expect(event.gatewayObjectId).toBe('re_123');
		            expect(event.amount).toBe(12);
		        });

			        it('should not guess full or partial refund status without expanded charge totals', () => {
			            const event = gateway.parseWebhookEvent({
			                id: 'evt_refund_updated_modern',
			                type: 'refund.updated',
		                created: 1623456789,
		                data: {
		                    object: {
		                        id: 're_modern',
		                        object: 'refund',
		                        status: 'succeeded',
		                        amount: 1200,
		                        currency: 'usd',
		                        payment_intent: 'pi_modern_refund',
		                        metadata: {},
		                    },
		                },
			                livemode: false,
			            });

			            expect(event.status).toBe('refund_completed');
			            expect(event.gatewayPaymentId).toBe('pi_modern_refund');
			            expect(event.amount).toBe(12);
			        });

			        it('should mark refund.created succeeded as completed when aggregate payment state is unknown', () => {
			            const event = gateway.parseWebhookEvent({
			                id: 'evt_refund_created_modern',
			                type: 'refund.created',
			                created: 1623456789,
			                data: {
			                    object: {
			                        id: 're_created',
			                        object: 'refund',
			                        status: 'succeeded',
			                        amount: 2500,
			                        currency: 'usd',
			                        payment_intent: 'pi_created_refund',
			                        metadata: {},
			                    },
			                },
			                livemode: false,
			            });

			            expect(event.status).toBe('refund_completed');
			            expect(event.gatewayPaymentId).toBe('pi_created_refund');
			            expect(event.gatewayObjectId).toBe('re_created');
			            expect(event.amount).toBe(25);
			        });

        it('should mark refund events as fully refunded when expanded charge totals prove it', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_refund_full',
                type: 'refund.updated',
		                created: 1623456789,
		                data: {
		                    object: {
		                        id: 're_full',
		                        object: 'refund',
		                        status: 'succeeded',
		                        amount: 2500,
		                        currency: 'usd',
		                        payment_intent: 'pi_full_refund',
		                        charge: {
		                            id: 'ch_full',
		                            amount: 2500,
		                            amount_refunded: 2500,
		                        },
		                        metadata: {},
		                    },
		                },
		                livemode: false,
		            });

		            expect(event.status).toBe('refunded');
			            expect(event.gatewayPaymentId).toBe('pi_full_refund');
            expect(event.amount).toBe(25);
        });

        it('should normalize paid subscription invoice events', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_invoice_paid',
                type: 'invoice.paid',
                created: 1623456789,
                data: {
                    object: {
                        id: 'in_123',
                        object: 'invoice',
                        status: 'paid',
                        amount_paid: 3000,
                        total: 3000,
                        currency: 'usd',
                        metadata: {},
                        parent: {
                            subscription_details: {
                                subscription: 'sub_invoice_123',
                                metadata: { paymentId: 'internal_sub_123' },
                            },
                        },
                    },
                },
                livemode: false,
            } as any);

            expect(event.status).toBe('paid');
            expect(event.gatewayPaymentId).toBe('sub_invoice_123');
            expect(event.gatewayObjectId).toBe('in_123');
            expect(event.paymentId).toBe('internal_sub_123');
            expect(event.amount).toBe(30);
        });

        it('should normalize failed invoice payment events', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_invoice_failed',
                type: 'invoice.payment_failed',
                created: 1623456789,
                data: {
                    object: {
                        id: 'in_failed',
                        object: 'invoice',
                        status: 'open',
                        amount_due: 4500,
                        amount_paid: 0,
                        amount_remaining: 4500,
                        currency: 'usd',
                        payment_intent: 'pi_invoice_failed',
                        metadata: { paymentId: 'internal_invoice_failed' },
                    },
                },
                livemode: false,
            } as any);

            expect(event.status).toBe('failed');
            expect(event.gatewayPaymentId).toBe('pi_invoice_failed');
            expect(event.gatewayObjectId).toBe('in_failed');
            expect(event.amount).toBe(45);
        });

        it('should normalize subscription lifecycle events', () => {
            const event = gateway.parseWebhookEvent({
                id: 'evt_sub_deleted',
                type: 'customer.subscription.deleted',
                created: 1623456789,
                data: {
                    object: {
                        id: 'sub_deleted',
                        object: 'subscription',
                        status: 'canceled',
                        currency: 'usd',
                        metadata: { paymentId: 'internal_deleted_sub' },
                    },
                },
                livemode: false,
            } as any);

            expect(event.status).toBe('cancelled');
            expect(event.gatewayPaymentId).toBe('sub_deleted');
            expect(event.paymentId).toBe('internal_deleted_sub');
        });

        it('should reject non-snapshot webhook payloads with a clear error', () => {
            expect(() => gateway.parseWebhookEvent({
                id: 'evt_thin',
			                type: 'payment_intent.succeeded',
			                created: 1623456789,
			                data: {
			                    object: {
			                        id: 'pi_thin',
			                        object: 'payment_intent',
			                    },
			                },
			                livemode: false,
			            })).toThrow('Invalid Stripe webhook payload: expected a snapshot payment_intent object');
			        });
			    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Create Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

    describe('createPayment', () => {
	        it('should create payment intent', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                id: 'pi_321',
	                object: 'payment_intent',
	                status: 'requires_payment_method',
	                amount: 5000,
	                currency: 'usd',
	                client_secret: 'pi_321_secret',
	                next_action: { type: 'redirect_to_url', redirect_to_url: { url: 'https://stripe.example/next' } },
	            })
	            }) as unknown as typeof fetch;

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
	            expect(result.clientSecret).toBe('pi_321_secret');
	            expect(result.nextAction).toEqual({ type: 'redirect_to_url', redirect_to_url: { url: 'https://stripe.example/next' } });
	            expect(result.redirectUrl).toBe('https://stripe.example/next');
	            expect(new URLSearchParams(capturedBody).get('amount')).toBe('5000');
	        });

	        it('should create JPY payment intent without multiplying by 100', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_jpy',
	                    object: 'payment_intent',
	                    status: 'requires_payment_method',
	                    amount: 5000,
	                    currency: 'jpy',
	                    client_secret: 'pi_jpy_secret',
	                });
	            }) as unknown as typeof fetch;

	            const result = await gateway.createPayment({
	                amount: 5000,
	                currency: 'JPY',
	                callbackUrl: 'https://example.com',
	            });

	            const params = new URLSearchParams(capturedBody);
	            expect(params.get('amount')).toBe('5000');
	            expect(params.get('currency')).toBe('jpy');
	            expect(result.amount).toBe(5000);
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
            expect(params.get('return_url')).toBe('http://cb');
            expect(params.get('automatic_payment_methods[allow_redirects]')).toBeNull();
        });

        it('should disable redirect payment methods when confirming without callbackUrl', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'pi_no_return_url',
                    status: 'succeeded',
                    amount: 2000,
                    currency: 'usd',
                });
            }) as unknown as typeof fetch;

            await gateway.createPayment({
                amount: 20,
                currency: 'USD',
                stripePaymentMethodId: 'pm_card_visa',
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('confirm')).toBe('true');
            expect(params.get('return_url')).toBeNull();
            expect(params.get('automatic_payment_methods[enabled]')).toBe('true');
            expect(params.get('automatic_payment_methods[allow_redirects]')).toBe('never');
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

	        it('should not force automatic capture when capture is true/defaulted', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_default_capture',
	                    status: 'requires_payment_method',
	                    amount: 5000,
	                    currency: 'usd',
	                });
	            }) as unknown as typeof fetch;

	            await gateway.createPayment({
	                amount: 50,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	            });

	            const params = new URLSearchParams(capturedBody);
	            expect(params.get('capture_method')).toBeNull();
	        });

	        it('should reject metadata objects because Stripe metadata is scalar strings', async () => {
	            await expect(gateway.createPayment({
	                amount: 50,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	                metadata: { nested: { id: 'x' } },
	            })).rejects.toThrow('Stripe metadata value for "nested" must be a string, number, or boolean');
	        });

	        it('should reject amounts with too many decimals', async () => {
	            await expect(gateway.createPayment({
	                amount: 10.999,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	            })).rejects.toThrow('Stripe USD amounts cannot have more decimal places than the currency supports');
	        });

	        it('should leave settlement-dependent minimum amount validation to Stripe', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_small',
	                    status: 'requires_payment_method',
	                    amount: 49,
	                    currency: 'usd',
	                });
	            }) as unknown as typeof fetch;

	            await gateway.createPayment({
	                amount: 0.49,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	            });

	            expect(new URLSearchParams(capturedBody).get('amount')).toBe('49');
	        });

	        it('should reject charges above the currency-specific Stripe maximum', async () => {
	            await expect(gateway.createPayment({
	                amount: 1_000_000,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	            })).rejects.toThrow('Stripe USD amount must be at most 99999999');
	        });

	        it('should allow higher Stripe maximums for currencies that support them', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_large_jpy',
	                    status: 'requires_payment_method',
	                    amount: 100000000,
	                    currency: 'jpy',
	                });
	            }) as unknown as typeof fetch;

	            await gateway.createPayment({
	                amount: 100000000,
	                currency: 'JPY',
	                callbackUrl: 'http://cb',
	            });

	            expect(new URLSearchParams(capturedBody).get('amount')).toBe('100000000');
	        });

	        it('should accept valid decimal amounts affected by floating point representation', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_decimal',
	                    status: 'requires_payment_method',
	                    amount: 129,
	                    currency: 'usd',
	                });
	            }) as unknown as typeof fetch;

	            const result = await gateway.createPayment({
	                amount: 1.29,
	                currency: 'USD',
	            });

	            expect(new URLSearchParams(capturedBody).get('amount')).toBe('129');
	            expect(result.amount).toBe(1.29);
	        });

	        it('should reject Stripe metadata keys that exceed Stripe limits', async () => {
	            await expect(gateway.createPayment({
	                amount: 50,
	                currency: 'USD',
	                metadata: { ['x'.repeat(41)]: 'value' },
	            })).rejects.toThrow('must be 40 characters or fewer');
	        });

	        it('should reject Stripe metadata keys with square brackets', async () => {
	            await expect(gateway.createPayment({
	                amount: 50,
	                currency: 'USD',
	                metadata: { 'bad[key]': 'value' },
	            })).rejects.toThrow('cannot contain square brackets');
	        });

	        it('should revalidate params modified by hooks before sending to Stripe', async () => {
	            const hookGateway = new StripeGateway(STRIPE_TEST_CONFIG, new HooksManager({
	                beforeCreatePayment: (ctx) => ({
	                    proceed: true,
	                    params: {
	                        ...(ctx.params as CreatePaymentParams),
	                        amount: -1,
	                    },
	                }),
	            }));

	            await expect(hookGateway.createPayment({
	                amount: 50,
	                currency: 'USD',
	                callbackUrl: 'http://cb',
	            })).rejects.toThrow('Validation failed for createPayment');
	        });
	    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Capture Payment Tests
    // ═══════════════════════════════════════════════════════════════════════════

	    describe('capturePayment', () => {
	        it('should capture payment intent', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                id: 'pi_cap',
	                status: 'succeeded',
	                amount_received: 10000,
	                currency: 'usd',
	            })
	            }) as unknown as typeof fetch;

	            const result = await gateway.capturePayment({ gatewayPaymentId: 'pi_cap' });
	            expect(result.status).toBe('paid');
	            expect(result.amount).toBe(100);
	            expect(new URLSearchParams(capturedBody).toString()).toBe("");
	        });

		        it('should capture JPY partial amount without multiplying by 100', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 'pi_cap_jpy',
	                    status: 'succeeded',
	                    amount_received: 750,
	                    currency: 'jpy',
	                });
	            }) as unknown as typeof fetch;

	            const result = await gateway.capturePayment({
	                gatewayPaymentId: 'pi_cap_jpy',
	                amount: 750,
	                currency: 'JPY',
	            });

		            expect(new URLSearchParams(capturedBody).get('amount_to_capture')).toBe('750');
			            expect(result.amount).toBe(750);
			        });

		        it('should leave capturable amount limits to Stripe for partial captures', async () => {
		            let capturedBody: string = "";
		            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                capturedBody = opts.body as string;
		                return createMockResponse({
		                    id: 'pi_cap_large',
		                    status: 'succeeded',
		                    amount_received: 100000000,
		                    currency: 'usd',
		                });
		            }) as unknown as typeof fetch;

		            await gateway.capturePayment({
		                gatewayPaymentId: 'pi_cap_large',
		                amount: 1_000_000,
		                currency: 'USD',
		            });

		            expect(new URLSearchParams(capturedBody).get('amount_to_capture')).toBe('100000000');
		        });

		        it('should reject partial capture without currency', async () => {
		            await expect(gateway.capturePayment({
		                gatewayPaymentId: 'pi_cap_missing_currency',
		                amount: 10,
		            })).rejects.toThrow('Stripe capturePayment requires currency when amount is provided');
		        });

	        it('should reject malformed PaymentIntent IDs before building request URLs', async () => {
	            await expect(gateway.capturePayment({
	                gatewayPaymentId: 'pi_cap/../charges',
	            })).rejects.toThrow('Stripe PaymentIntent ID must start with pi_');
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
	                currency: 'usd',
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

        it('should create checkout session with JPY simple amount without multiplying by 100', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
	                    id: 'cs_jpy',
	                    object: 'checkout.session',
	                    url: 'https://checkout.stripe.com/jpy',
	                    status: 'open',
	                    payment_status: 'unpaid',
	                });
	            }) as unknown as typeof fetch;

	            await gateway.createCheckoutSession({
	                amount: 5000,
	                currency: 'JPY',
	                successUrl: 'https://success',
	                cancelUrl: 'https://cancel',
	            });

	            const params = new URLSearchParams(capturedBody);
            expect(params.get('line_items[0][price_data][currency]')).toBe('jpy');
            expect(params.get('line_items[0][price_data][unit_amount]')).toBe('5000');
        });

        it('should allow checkout sessions without cancelUrl because Stripe makes cancel_url optional', async () => {
            let capturedBody: string = "";
            globalThis.fetch = mock(async (url, opts: RequestInit) => {
                capturedBody = opts.body as string;
                return createMockResponse({
                    id: 'cs_no_cancel',
                    object: 'checkout.session',
                    url: 'https://checkout.stripe.com/no-cancel',
                    status: 'open',
                    payment_status: 'unpaid',
                });
            }) as unknown as typeof fetch;

            await gateway.createCheckoutSession({
                amount: 20,
                currency: 'USD',
                successUrl: 'https://success',
            });

            const params = new URLSearchParams(capturedBody);
            expect(params.get('success_url')).toBe('https://success');
            expect(params.get('cancel_url')).toBeNull();
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
		            mode: 'setup',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            currency: 'USD',
		            customerId: 'cus_123',
		        });

	        const params = new URLSearchParams(capturedBody);
	        expect(params.get('mode')).toBe('setup');
	        expect(params.get('currency')).toBe('usd');
	        expect(params.get('customer')).toBe('cus_123');
	        // Ensure no line items are sent for setup mode defaults
		        expect(params.toString().includes('line_items')).toBe(false);
		    });

		    it('should create checkout session with base-unit priceData amount', async () => {
		        let capturedBody: string = "";
		        globalThis.fetch = mock(async (url, opts: RequestInit) => {
		            capturedBody = opts.body as string;
		            return createMockResponse({
		                id: 'cs_amount_price_data',
		                object: 'checkout.session',
		                url: 'https://checkout.stripe.com/amount',
		            });
		        }) as unknown as typeof fetch;

		        await gateway.createCheckoutSession({
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            lineItems: [{
		                priceData: {
		                    currency: 'USD',
		                    productData: { name: 'Plan' },
		                    amount: 20,
		                },
		                quantity: 1,
		            }],
		        });

		        const params = new URLSearchParams(capturedBody);
		        expect(params.get('line_items[0][price_data][unit_amount]')).toBe('2000');
		    });

			    it('should propagate checkout metadata to the PaymentIntent data', async () => {
			        let capturedBody: string = "";
			        globalThis.fetch = mock(async (url, opts: RequestInit) => {
		            capturedBody = opts.body as string;
		            return createMockResponse({
		                id: 'cs_metadata',
		                object: 'checkout.session',
		                url: 'https://checkout.stripe.com/metadata',
		            });
		        }) as unknown as typeof fetch;

		        await gateway.createCheckoutSession({
		            amount: 20,
		            currency: 'USD',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            metadata: { paymentId: 'order_123' },
		        });

		        const params = new URLSearchParams(capturedBody);
			        expect(params.get('metadata[paymentId]')).toBe('order_123');
			        expect(params.get('payment_intent_data[metadata][paymentId]')).toBe('order_123');
			    });

			    it('should stringify scalar checkout metadata values consistently', async () => {
			        let capturedBody: string = "";
			        globalThis.fetch = mock(async (url, opts: RequestInit) => {
			            capturedBody = opts.body as string;
			            return createMockResponse({
			                id: 'cs_scalar_metadata',
			                object: 'checkout.session',
			                url: 'https://checkout.stripe.com/scalar-metadata',
			            });
			        }) as unknown as typeof fetch;

			        await gateway.createCheckoutSession({
			            amount: 20,
			            currency: 'USD',
			            successUrl: 'https://success',
			            cancelUrl: 'https://cancel',
			            metadata: { attempt: 2, testMode: true },
			        });

			        const params = new URLSearchParams(capturedBody);
			        expect(params.get('metadata[attempt]')).toBe('2');
			        expect(params.get('metadata[testMode]')).toBe('true');
			        expect(params.get('payment_intent_data[metadata][attempt]')).toBe('2');
			        expect(params.get('payment_intent_data[metadata][testMode]')).toBe('true');
			    });

		    it('should reject setup checkout without currency or payment method types', async () => {
		        await expect(gateway.createCheckoutSession({
		            mode: 'setup',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            customerId: 'cus_123',
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

	    it('should reject payment checkout without line items or simple amount', async () => {
	        await expect(gateway.createCheckoutSession({
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
	        })).rejects.toThrow('Validation failed for createCheckoutSession');
	    });

	    it('should reject checkout line item without price or priceData', async () => {
	        await expect(gateway.createCheckoutSession({
	            mode: 'payment',
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
	            lineItems: [{ quantity: 1 } as any],
	        })).rejects.toThrow('Validation failed for createCheckoutSession');
	    });

	    it('should reject checkout line item with both price and priceData', async () => {
	        await expect(gateway.createCheckoutSession({
	            mode: 'payment',
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
	            lineItems: [{
	                price: 'price_123',
	                priceData: {
	                    currency: 'USD',
	                    productData: { name: 'Plan' },
	                    unitAmount: 1000,
	                },
	                quantity: 1,
	            }],
	        })).rejects.toThrow('Validation failed for createCheckoutSession');
	    });

		    it('should reject empty checkout line items instead of sending an empty Stripe payload', async () => {
		        await expect(gateway.createCheckoutSession({
		            amount: 20,
		            currency: 'USD',
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
		            lineItems: [],
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject checkout sessions that mix line items with amount fields', async () => {
		        await expect(gateway.createCheckoutSession({
		            amount: 20,
		            currency: 'USD',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            lineItems: [{ price: 'price_123', quantity: 1 }],
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject unsupported checkout passthrough fields instead of dropping them', async () => {
		        await expect(gateway.createCheckoutSession({
		            amount: 20,
		            currency: 'USD',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            allowPromotionCodes: true,
		        } as any)).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject payment checkout sessions above Stripe line item limits', async () => {
		        await expect(gateway.createCheckoutSession({
		            mode: 'payment',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            lineItems: Array.from({ length: 101 }, (_, index) => ({
		                price: `price_${index}`,
		                quantity: 1,
		            })),
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject subscription checkout sessions above Stripe recurring line item limits', async () => {
		        await expect(gateway.createCheckoutSession({
		            mode: 'subscription',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            lineItems: Array.from({ length: 21 }, (_, index) => ({
		                priceData: {
		                    currency: 'USD',
		                    productData: { name: `Plan ${index}` },
		                    amount: 20,
		                    recurring: { interval: 'month' as const },
		                },
		                quantity: 1,
		            })),
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject setup checkout sessions with line items', async () => {
		        await expect(gateway.createCheckoutSession({
		            mode: 'setup',
		            successUrl: 'https://success',
		            cancelUrl: 'https://cancel',
		            currency: 'USD',
		            lineItems: [{ price: 'price_123', quantity: 1 }],
		        })).rejects.toThrow('Validation failed for createCheckoutSession');
		    });

		    it('should reject inline subscription priceData without recurring settings', async () => {
		        await expect(gateway.createCheckoutSession({
		            mode: 'subscription',
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
	            lineItems: [{
	                priceData: {
	                    currency: 'USD',
	                    productData: { name: 'Plan' },
	                    amount: 20,
	                },
	                quantity: 1,
	            }],
	        })).rejects.toThrow('Validation failed for createCheckoutSession');
	    });

	    it('should send recurring settings for inline subscription priceData', async () => {
	        let capturedBody: string = "";
	        globalThis.fetch = mock(async (url, opts: RequestInit) => {
	            capturedBody = opts.body as string;
	            return createMockResponse({
	                id: 'cs_sub_inline',
	                object: 'checkout.session',
	                url: 'https://checkout.stripe.com/sub-inline',
	            });
	        }) as unknown as typeof fetch;

	        await gateway.createCheckoutSession({
	            mode: 'subscription',
	            successUrl: 'https://success',
	            cancelUrl: 'https://cancel',
	            lineItems: [{
	                priceData: {
	                    currency: 'USD',
	                    productData: { name: 'Plan' },
	                    amount: 20,
	                    recurring: { interval: 'month', intervalCount: 1 },
	                },
	                quantity: 1,
	            }],
	        });

        const params = new URLSearchParams(capturedBody);
        expect(params.get('line_items[0][price_data][recurring][interval]')).toBe('month');
        expect(params.get('line_items[0][price_data][recurring][interval_count]')).toBe('1');
    });

    it('should allow zero-amount checkout line item priceData', async () => {
        let capturedBody: string = "";
        globalThis.fetch = mock(async (url, opts: RequestInit) => {
            capturedBody = opts.body as string;
            return createMockResponse({
                id: 'cs_zero_amount',
                object: 'checkout.session',
                url: 'https://checkout.stripe.com/zero',
            });
        }) as unknown as typeof fetch;

        await gateway.createCheckoutSession({
            successUrl: 'https://success',
            cancelUrl: 'https://cancel',
            lineItems: [{
                priceData: {
                    currency: 'USD',
                    productData: { name: 'Free setup' },
                    amount: 0,
                },
                quantity: 1,
            }],
        });

        const params = new URLSearchParams(capturedBody);
        expect(params.get('line_items[0][price_data][unit_amount]')).toBe('0');
    });

    it('should allow zero-amount checkout line item unitAmount', async () => {
        let capturedBody: string = "";
        globalThis.fetch = mock(async (url, opts: RequestInit) => {
            capturedBody = opts.body as string;
            return createMockResponse({
                id: 'cs_zero_unit_amount',
                object: 'checkout.session',
                url: 'https://checkout.stripe.com/zero-unit',
            });
        }) as unknown as typeof fetch;

        await gateway.createCheckoutSession({
            successUrl: 'https://success',
            cancelUrl: 'https://cancel',
            lineItems: [{
                priceData: {
                    currency: 'USD',
                    productData: { name: 'Free item' },
                    unitAmount: 0,
                },
                quantity: 1,
            }],
        });

        const params = new URLSearchParams(capturedBody);
        expect(params.get('line_items[0][price_data][unit_amount]')).toBe('0');
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
		        it('should refund payment intent and return cumulative refunded amount', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                if (String(url).includes('/refunds?')) {
		                    return createMockResponse(createStripeRefundList([
		                        { id: 're_old', status: 'succeeded', amount: 200, currency: 'usd' },
		                        { id: 're_123', status: 'succeeded', amount: 500, currency: 'usd' },
		                        { id: 're_pending', status: 'pending', amount: 300, currency: 'usd' },
		                        { id: 're_action', status: 'requires_action', amount: 400, currency: 'usd' },
		                    ]));
		                }
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 're_123',
	                    status: 'succeeded',
	                    amount: 500,
	                    currency: 'usd',
	                })
	            }) as unknown as typeof fetch;

		            const result = await gateway.refundPayment({ gatewayPaymentId: 'pi_ref', amount: 5, currency: 'USD' });
		            expect(result.success).toBe(true);
		            expect(result.totalRefunded).toBe(7);
		            expect(new URLSearchParams(capturedBody).get('amount')).toBe('500');
		        });

		        it('should reject partial refund without currency', async () => {
		            await expect(gateway.refundPayment({
		                gatewayPaymentId: 'pi_ref_missing_currency',
		                amount: 5,
		            })).rejects.toThrow('Stripe refundPayment requires currency when amount is provided');
		        });

	        it('should refund JPY amount without multiplying by 100', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                if (String(url).includes('/refunds?')) {
	                    return createMockResponse(createStripeRefundList([
	                        { id: 're_jpy', status: 'succeeded', amount: 500, currency: 'jpy' },
	                    ]));
	                }
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 're_jpy',
	                    status: 'succeeded',
	                    amount: 500,
	                    currency: 'jpy',
	                });
	            }) as unknown as typeof fetch;

	            const result = await gateway.refundPayment({
	                gatewayPaymentId: 'pi_ref_jpy',
	                amount: 500,
	                currency: 'JPY',
	            });

		            expect(new URLSearchParams(capturedBody).get('amount')).toBe('500');
		            expect(result.totalRefunded).toBe(500);
		        });

		        it('should leave refundable amount limits to Stripe for partial refunds', async () => {
		            let capturedBody: string = "";
		            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                if (String(url).includes('/refunds?')) {
		                    return createMockResponse(createStripeRefundList([
		                        { id: 're_large', status: 'succeeded', amount: 100000000, currency: 'usd' },
		                    ]));
		                }
		                capturedBody = opts.body as string;
		                return createMockResponse({
		                    id: 're_large',
		                    status: 'succeeded',
		                    amount: 100000000,
		                    currency: 'usd',
		                });
		            }) as unknown as typeof fetch;

		            const result = await gateway.refundPayment({
		                gatewayPaymentId: 'pi_ref_large',
		                amount: 1_000_000,
		                currency: 'USD',
		            });

		            expect(new URLSearchParams(capturedBody).get('amount')).toBe('100000000');
		            expect(result.totalRefunded).toBe(1_000_000);
		        });

	        it('should send official Stripe refund reasons as reason', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                if (String(url).includes('/refunds?')) {
	                    return createMockResponse(createStripeRefundList([
	                        { id: 're_reason', status: 'succeeded', amount: 500, currency: 'usd' },
	                    ]));
	                }
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 're_reason',
	                    status: 'succeeded',
	                    amount: 500,
	                    currency: 'usd',
	                });
	            }) as unknown as typeof fetch;

		            await gateway.refundPayment({
		                gatewayPaymentId: 'pi_ref',
		                amount: 5,
		                currency: 'USD',
		                reason: 'requested_by_customer',
		            });

	            const params = new URLSearchParams(capturedBody);
	            expect(params.get('reason')).toBe('requested_by_customer');
	            expect(params.get('metadata[reason]')).toBeNull();
	        });

	        it('should send custom refund reasons as metadata', async () => {
	            let capturedBody: string = "";
	            globalThis.fetch = mock(async (url, opts: RequestInit) => {
	                if (String(url).includes('/refunds?')) {
	                    return createMockResponse(createStripeRefundList([
	                        { id: 're_custom_reason', status: 'succeeded', amount: 500, currency: 'usd' },
	                    ]));
	                }
	                capturedBody = opts.body as string;
	                return createMockResponse({
	                    id: 're_custom_reason',
	                    status: 'succeeded',
	                    amount: 500,
	                    currency: 'usd',
	                });
	            }) as unknown as typeof fetch;

		            await gateway.refundPayment({
		                gatewayPaymentId: 'pi_ref',
		                amount: 5,
		                currency: 'USD',
		                reason: 'warehouse_return',
		            });

	            const params = new URLSearchParams(capturedBody);
	            expect(params.get('reason')).toBeNull();
	            expect(params.get('metadata[reason]')).toBe('warehouse_return');
	        });
	    });

		    describe('getPayment', () => {
		        it('should reject empty payment IDs before calling Stripe', async () => {
		            await expect(gateway.getPayment({ gatewayPaymentId: '' })).rejects.toThrow('Validation failed for getPayment');
		        });

	        it('should reject malformed payment IDs before calling Stripe', async () => {
	            await expect(gateway.getPayment({
	                gatewayPaymentId: 'pi_get?expand[]=charges',
	            })).rejects.toThrow('Stripe PaymentIntent ID must start with pi_');
	        });

		        it('should retrieve JPY payment intent without dividing by 100', async () => {
	            globalThis.fetch = mock(async () => createMockResponse({
	                id: 'pi_get_jpy',
	                object: 'payment_intent',
	                status: 'succeeded',
	                amount: 5000,
	                currency: 'jpy',
	                client_secret: 'pi_get_jpy_secret',
	            })) as unknown as typeof fetch;

	            const result = await gateway.getPayment({ gatewayPaymentId: 'pi_get_jpy' });

	            expect(result.amount).toBe(5000);
		            expect(result.clientSecret).toBe('pi_get_jpy_secret');
		        });
		    });

		    describe('stripeRequest headers', () => {
		        it('should pin the default Stripe API version', async () => {
		            let capturedVersion = "";
		            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                capturedVersion = new Headers(opts.headers).get('Stripe-Version') ?? "";
		                return createMockResponse({
		                    id: 'pi_headers',
		                    object: 'payment_intent',
		                    status: 'requires_payment_method',
		                    amount: 1000,
		                    currency: 'usd',
		                });
		            }) as unknown as typeof fetch;

		            await gateway.createPayment({
		                amount: 10,
		                currency: 'USD',
		                callbackUrl: 'https://example.com',
		            });

		            expect(capturedVersion).toBe('2026-02-25.clover');
		        });

		        it('should reject idempotency keys longer than Stripe allows', async () => {
		            await expect(gateway.createPayment({
		                amount: 10,
		                currency: 'USD',
		                idempotencyKey: 'x'.repeat(256),
		            })).rejects.toThrow('Stripe idempotency keys must be 255 characters or fewer');
		        });

		        it('should time out hanging Stripe requests', async () => {
		            const timeoutGateway = new StripeGateway({
		                ...STRIPE_TEST_CONFIG,
		                timeoutMs: 1,
		            }, hooksManager);

		            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                return new Promise<Response>((_resolve, reject) => {
		                    opts.signal?.addEventListener('abort', () => {
		                        reject(new DOMException('Aborted', 'AbortError'));
		                    });
		                });
		            }) as unknown as typeof fetch;

			            await expect(timeoutGateway.createPayment({
			                amount: 10,
			                currency: 'USD',
			            })).rejects.toThrow('Stripe API request timed out after 1ms');
			        });

		        it('should time out while reading a hanging Stripe response body', async () => {
		            const timeoutGateway = new StripeGateway({
		                ...STRIPE_TEST_CONFIG,
		                timeoutMs: 1,
		            }, hooksManager);

		            globalThis.fetch = mock(async (url, opts: RequestInit) => {
		                return {
		                    ok: true,
		                    status: 200,
		                    headers: new Headers(),
		                    text: async () => new Promise<string>((_resolve, reject) => {
		                        opts.signal?.addEventListener('abort', () => {
		                            reject(new DOMException('Aborted', 'AbortError'));
		                        });
		                    }),
		                } as unknown as Response;
		            }) as unknown as typeof fetch;

		            await expect(timeoutGateway.createPayment({
		                amount: 10,
		                currency: 'USD',
		            })).rejects.toThrow('Stripe API request timed out after 1ms');
		        });
			    });
		});
