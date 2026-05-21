import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PaymentClient } from './client';

function createMockResponse(data: unknown): Response {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(data),
        json: async () => data,
        headers: new Headers(),
    } as unknown as Response;
}

describe('PaymentClient Stripe convenience methods', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should route voidPayment to the selected gateway', async () => {
        let requestedUrl = '';
        globalThis.fetch = mock(async (url) => {
            requestedUrl = String(url);
            return createMockResponse({
                id: 'pi_cancel',
                object: 'payment_intent',
                status: 'canceled',
                amount: 5000,
                currency: 'usd',
                client_secret: null,
            });
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_123' },
            defaultGateway: 'stripe',
        });

        const result = await client.voidPayment({ gatewayPaymentId: 'pi_cancel' });

        expect(requestedUrl).toContain('/payment_intents/pi_cancel/cancel');
        expect(result.status).toBe('cancelled');
    });

    it('should route getPaymentStatus to the selected gateway', async () => {
        let requestedUrl = '';
        globalThis.fetch = mock(async (url) => {
            requestedUrl = String(url);
            return createMockResponse({
                id: 'pi_paid',
                object: 'payment_intent',
                status: 'succeeded',
                amount: 5000,
                currency: 'usd',
                client_secret: null,
            });
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            stripe: { secretKey: 'sk_test_123', webhookSecret: 'whsec_test_123' },
            defaultGateway: 'stripe',
        });

        const status = await client.getPaymentStatus('pi_paid');

        expect(requestedUrl).toContain('/payment_intents/pi_paid');
        expect(status).toBe('paid');
    });
});

describe('PaymentClient PayPal webhooks', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = originalFetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('should verify PayPal webhooks asynchronously when headers are passed', async () => {
        let verifyCalled = false;
        globalThis.fetch = mock(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : (input as Request).url;

            if (url.includes('oauth2/token')) {
                return createMockResponse({
                    access_token: 'test_token',
                    expires_in: 3600,
                });
            }

            if (url.includes('verify-webhook-signature')) {
                verifyCalled = true;
                return createMockResponse({ verification_status: 'SUCCESS' });
            }

            throw new Error(`Unexpected URL: ${url}`);
        }) as unknown as typeof fetch;

        const client = new PaymentClient({
            paypal: {
                clientId: 'paypal_client',
                clientSecret: 'paypal_secret',
                webhookId: 'WH123',
                sandbox: true,
            },
            defaultGateway: 'paypal',
        });

        const payload = {
            id: 'WH-event-123',
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            create_time: '2024-06-15T14:30:00Z',
            resource_type: 'capture',
            resource: {
                id: 'CAPTURE-123',
                status: 'COMPLETED',
                amount: {
                    currency_code: 'USD',
                    value: '10.00',
                },
            },
        };

        const event = await client.handleWebhook('paypal', payload, {
            'PAYPAL-TRANSMISSION-ID': 'trans-123',
            'PAYPAL-TRANSMISSION-TIME': '2024-01-15T10:00:00Z',
            'PAYPAL-TRANSMISSION-SIG': 'signature',
            'PAYPAL-CERT-URL': 'https://api.paypal.com/cert',
            'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
        });

        expect(verifyCalled).toBe(true);
        expect(event.gateway).toBe('paypal');
        expect(event.gatewayPaymentId).toBe('CAPTURE-123');
    });
});
