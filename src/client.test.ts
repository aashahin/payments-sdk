import { describe, it, expect, beforeEach, mock } from 'bun:test';
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
