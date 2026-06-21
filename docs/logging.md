# Logging

The SDK never writes to `console` directly. Card data, tokens, auth headers, and
customer PII can leak into logs, so all gateway logging is routed through an
injectable, **redacting** logger. The default is a no-op — the SDK is silent
unless you provide a logger.

## Configuration

```typescript
import { PaymentClient, type Logger } from '@abshahin/payments-sdk';

const logger: Logger = {
  debug: (msg, ctx) => console.debug(msg, ctx),
  info: (msg, ctx) => console.info(msg, ctx),
  warn: (msg, ctx) => console.warn(msg, ctx),
  error: (msg, ctx) => console.error(msg, ctx),
};

const client = new PaymentClient({
  moyasar: { secretKey: process.env.MOYASAR_SECRET_KEY! },
  logger,
});
```

You can plug in any logger (Pino, Winston, a Cloudflare Workers logger, etc.) as
long as it implements the four methods.

## Redaction

Structured context passed as the second argument to a log method is deep-cloned
and scrubbed before it reaches your logger. Keys whose names look sensitive
(containing `secret`, `token`, `authorization`, `card`, `cvv`, `pan`, `email`,
`phone`, `name`, `address`, `signature`, `hmac`, `given_id`, and similar) are
replaced with `[REDACTED]`. Redaction is recursive and applies to nested objects
and arrays.

```typescript
import { redact } from '@abshahin/payments-sdk';

redact({ amount: 100, card: { number: '4242...' }, customerEmail: 'a@b.com' });
// => { amount: 100, card: '[REDACTED]', customerEmail: '[REDACTED]' }
```

> Note: redaction only applies to the structured `context` object. Never
> interpolate secrets into the `message` string itself.
