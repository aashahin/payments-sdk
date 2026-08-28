// file: packages/payments-sdk/src/index.ts

/**
 * @abshahin/payments-sdk
 *
 * Framework-agnostic multi-gateway payment SDK with lifecycle hooks.
 * Supports Moyasar, PayPal, Paymob, and Stripe.
 * Node/Bun barrel. Synchronous webhook HMAC uses `node:crypto`.
 * Cloudflare Workers must import `@abshahin/payments-sdk/cloudflare` instead —
 * Worker ingress verifies with WebCrypto in webhook-verify.ts.
 *
 * @example
 * ```typescript
 * import { PaymentClient } from '@abshahin/payments-sdk';
 *
 * const client = new PaymentClient({
 *   moyasar: {
 *     secretKey: process.env.MOYASAR_SECRET_KEY!,
 *     webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET,
 *   },
 *   defaultGateway: 'moyasar',
 * });
 *
 * // Create a payment
 * const result = await client.createPayment({
 *   amount: 100,
 *   currency: 'SAR',
 *   callbackUrl: 'https://example.com/callback',
 *   moyasarSource: {
 *     type: 'token',
 *     token: 'token_xxx',
 *   },
 *   metadata: { orderId: 'order_123' },
 * });
 *
 * // Handle webhook
 * const event = await client.handleWebhook('moyasar', webhookPayload);
 * ```
 */

import "./runtime/install-node-crypto";

export * from "./public";
