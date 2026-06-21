import { describe, it, expect } from "bun:test";
import {
  withRetry,
  parseRetryAfterSeconds,
  extractRetryAfterSeconds,
} from "./retry";
import { redact, createRedactingLogger, type Logger } from "./logger";
import {
  InMemoryIdempotencyStore,
  fingerprintParams,
} from "./idempotency";

describe("withRetry", () => {
  const fastConfig = { baseDelayMs: 0, maxDelayMs: 0 };

  it("retries retryable failures and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      { isRetryable: () => true, config: fastConfig },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("permanent");
        },
        { isRetryable: () => false, config: fastConfig },
      ),
    ).rejects.toThrow("permanent");
    expect(attempts).toBe(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error(`fail-${attempts}`);
        },
        { isRetryable: () => true, config: { ...fastConfig, maxAttempts: 4 } },
      ),
    ).rejects.toThrow("fail-4");
    expect(attempts).toBe(4);
  });
});

describe("parseRetryAfterSeconds", () => {
  it("parses numeric delta-seconds", () => {
    const headers = new Headers({ "retry-after": "30" });
    expect(parseRetryAfterSeconds(headers)).toBe(30);
  });

  it("returns undefined when header absent", () => {
    expect(parseRetryAfterSeconds(new Headers())).toBeUndefined();
    expect(parseRetryAfterSeconds(undefined)).toBeUndefined();
  });
});

describe("extractRetryAfterSeconds", () => {
  it("reads retryAfterSeconds from an error object", () => {
    expect(extractRetryAfterSeconds({ retryAfterSeconds: 12 })).toBe(12);
    expect(extractRetryAfterSeconds(new Error("x"))).toBeUndefined();
  });
});

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      amount: 100,
      card: { number: "4242424242424242", brand: "visa" },
      customerEmail: "a@b.com",
      authorization: "Bearer secret",
      nested: { token: "tok_123", note: "ok" },
      items: [{ name: "Phone", price: 10 }],
    };

    const out = redact(input) as Record<string, any>;

    expect(out.amount).toBe(100);
    expect(out.card).toBe("[REDACTED]");
    expect(out.customerEmail).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.nested.token).toBe("[REDACTED]");
    expect(out.nested.note).toBe("ok");
    expect(out.items[0].name).toBe("[REDACTED]");
    expect(out.items[0].price).toBe(10);
  });

  it("does not mutate the input", () => {
    const input = { token: "tok_123" };
    redact(input);
    expect(input.token).toBe("tok_123");
  });
});

describe("createRedactingLogger", () => {
  it("redacts structured context before forwarding", () => {
    const calls: Array<[string, unknown]> = [];
    const sink: Logger = {
      debug: () => {},
      info: () => {},
      warn: (m, c) => calls.push([m, c]),
      error: () => {},
    };

    const logger = createRedactingLogger(sink);
    logger.warn("charging", { amount: 5, card: { number: "4242" } });

    expect(calls[0]![0]).toBe("charging");
    expect((calls[0]![1] as any).amount).toBe(5);
    expect((calls[0]![1] as any).card).toBe("[REDACTED]");
  });
});

describe("InMemoryIdempotencyStore", () => {
  it("reserves a free key and reports existing on second reserve", () => {
    const store = new InMemoryIdempotencyStore();
    const record = { status: "in_progress" as const, fingerprint: "fp", createdAt: Date.now() };

    expect(store.reserve("k", record)).toBeUndefined();
    expect(store.reserve("k", record)).toEqual(record);
  });

  it("expires entries after the TTL", () => {
    const store = new InMemoryIdempotencyStore(1);
    store.set("k", { status: "completed", fingerprint: "fp", createdAt: Date.now() });
    const before = store.get("k");
    expect(before).toBeDefined();
    // Wait past the 1ms TTL.
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }
    expect(store.get("k")).toBeUndefined();
  });
});

describe("fingerprintParams", () => {
  it("is stable regardless of key order", () => {
    expect(fingerprintParams({ a: 1, b: 2 })).toBe(fingerprintParams({ b: 2, a: 1 }));
  });

  it("differs when values differ", () => {
    expect(fingerprintParams({ amount: 50 })).not.toBe(fingerprintParams({ amount: 60 }));
  });
});
