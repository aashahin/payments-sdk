/**
 * Cloudflare Workers barrel. Same PaymentClient / gateway HTTP surface as `.`,
 * without installing `node:crypto`. Sync `verifyWebhook` fails closed here;
 * Workers verify Stripe/Moyasar/Paymob in webhook-verify.ts and PayPal via
 * `verifyWebhookAsync`.
 */
export * from "../public";
