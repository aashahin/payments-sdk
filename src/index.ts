// file: packages/payments/src/index.ts

/**
 * @abshahin/payments-sdk
 *
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
 * ```
 */

import "./runtime/install-node-crypto";

export * from "./public";
