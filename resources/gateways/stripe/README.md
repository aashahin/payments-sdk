# Stripe Gateway Resources

Minimal reference notes for the Stripe gateway implementation.

## Official References

- PaymentIntents API: https://docs.stripe.com/api/payment_intents
- Checkout Sessions API: https://docs.stripe.com/api/checkout/sessions
- Invoices API: https://docs.stripe.com/api/invoices
- Subscriptions API: https://docs.stripe.com/api/subscriptions
- Refunds API: https://docs.stripe.com/api/refunds
- Refund events: https://docs.stripe.com/refunds#refund-events
- Supported currencies and minor units: https://docs.stripe.com/currencies
- Metadata limits: https://docs.stripe.com/metadata
- Idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Webhook signature verification: https://docs.stripe.com/webhooks/signatures
- Webhook security and replay tolerance: https://docs.stripe.com/webhooks
- Rate limits and lock timeouts: https://docs.stripe.com/rate-limits
- API versioning: https://docs.stripe.com/api/versioning

## SDK Assumptions

- SDK callers pass amounts in base currency units; the Stripe gateway converts to Stripe minor units.
- Amount conversion must be decimal-safe because JavaScript floats can represent valid decimal amounts such as `0.29` imprecisely.
- Zero-decimal currencies are not multiplied by 100. ISK and UGX are represented with Stripe's backwards-compatible two-decimal API format and must be whole currency units.
- Partial capture and partial refund calls require `currency` when `amount` is provided.
- `priceData.amount` uses base currency units; `priceData.unitAmount` is a Stripe minor-unit escape hatch. Checkout line-item prices may be zero where Stripe accepts zero-priced items.
- Checkout Sessions use either `lineItems` or the simple `amount`/`currency` form, not both; setup mode does not accept `lineItems` or `amount`.
- `cancelUrl` maps to Stripe's optional `cancel_url` parameter and should not be required by SDK validation.
- Checkout Session inputs reject unsupported passthrough fields instead of silently dropping them.
- Checkout Session line item counts are validated against Stripe's published payment/subscription mode limits where the SDK has enough information.
- Inline Checkout subscription `priceData` must include recurring settings.
- Stripe metadata is restricted to scalar string/number/boolean values and is sent as string metadata within Stripe's key count, key length, value length, and key character limits.
- Checkout Session metadata is also propagated into `payment_intent_data`, `setup_intent_data`, or `subscription_data` metadata where Stripe supports it.
- Webhook verification requires the raw request body and a configured endpoint signing secret. Buffer payloads must be signed using their original bytes, not a UTF-8 decoded string.
- Server-side PaymentIntent confirmation with a payment method and no callback URL disables redirect payment methods via `automatic_payment_methods.allow_redirects=never`.
- Webhook parsing expects snapshot event payloads with `data.object`; thin events must be hydrated by the caller before normalization.
- Webhook endpoint API versions should be kept aligned with the gateway `apiVersion` because endpoint event shapes can differ from REST request versions.
- Webhook `gatewayPaymentId` is normalized to the most useful related Stripe object ID when Stripe provides one: PaymentIntent, SetupIntent, Subscription, then the emitting object as fallback. `gatewayObjectId` keeps the original event object ID.
- Refund API results use a follow-up refund list request for cumulative succeeded-refund `totalRefunded`; if that request fails after refund creation, `totalRefunded` is omitted.
- Refund webhooks normalize `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, and legacy `charge.refund.updated`. Refund object events only distinguish full from partial refunds when Stripe includes enough charge totals; successful refund object events without those totals use `refund_completed`.
- Setup-mode `checkout.session.completed` webhooks use `setup_completed`; when Stripe includes `setup_intent`, the gateway uses that as `gatewayPaymentId`.
- Subscription-mode `checkout.session.completed` webhooks prefer the related `sub_...` ID. Invoice payment success/failure events and subscription lifecycle events are normalized for common recurring-billing flows.
- REST requests send a pinned `Stripe-Version` header by default unless callers override `apiVersion`.
- REST requests enforce Stripe idempotency key length and use a configurable timeout.
- Charge creation validates currency precision and Stripe's published maximums; minimum charge amounts can depend on settlement currency, so Stripe remains the source of truth for minimum enforcement. Partial capture/refund amount validation still only applies currency minor-unit formatting because Stripe validates them against the original charge.
- PaymentIntent `next_action` redirect URLs are surfaced on the normalized `redirectUrl` field when Stripe returns a known redirect action.
