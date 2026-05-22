import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { PaymobGateway } from "./paymob.gateway";
import { HooksManager } from "../../hooks/hooks.manager";
import {
  AuthenticationError,
  GatewayApiError,
  InvalidRequestError,
  InvalidWebhookError,
  InsufficientFundsError,
  NetworkError,
  PaymentError,
  RateLimitError,
  ResourceNotFoundError,
} from "../../errors";
import type { PaymobConfig, PaymobIdempotencyRecord, PaymobIdempotencyStore } from "../../types/config.types";
import type { HookContext } from "../../hooks/hooks.types";
import type { CreatePaymentParams } from "../../types/payment.types";
import type { PaymobCardTokenWebhookPayload, PaymobWebhookPayload } from "../../types/webhook.types";

const PAYMOB_TEST_CONFIG: PaymobConfig = {
  secretKey: "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  publicKey: "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  hmacSecret: "test_hmac_secret_key",
  region: "ksa",
  integrationId: "123456",
};

const PAYMOB_ACTION_CONFIG: PaymobConfig = {
  ...PAYMOB_TEST_CONFIG,
  apiKey: "api_key_xxxxxxxxxxxxxxxxxxxxxxxx",
};

const PAYMOB_AUTH_CONFIG: PaymobConfig = {
  ...PAYMOB_TEST_CONFIG,
  authIntegrationId: "auth-card",
};

const PAYMOB_LEGACY_CONFIG: PaymobConfig = {
  apiKey: "legacy_api_key_xxxxxxxxxxxxxxxxxxxxxxxx",
  region: "eg",
  integrationId: "654321",
  iframeId: "998877",
};

const VALID_CREATE_PARAMS: CreatePaymentParams = {
  amount: 100,
  currency: "SAR",
  callbackUrl: "https://example.com/webhook",
  returnUrl: "https://example.com/success",
  orderId: "order_123",
  metadata: {
    paymentId: "payment_123",
    tenantId: "tenant_123",
    email: "customer@example.com",
    firstName: "Mohammed",
    lastName: "Ali",
    phone: "+966500000000",
  },
};

let hooksManager: HooksManager;
let gateway: PaymobGateway;
let originalFetch: typeof fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }>;

class MemoryIdempotencyStore implements PaymobIdempotencyStore {
  readonly records = new Map<string, PaymobIdempotencyRecord>();

  reserve(key: string, record: PaymobIdempotencyRecord): PaymobIdempotencyRecord | undefined {
    const existing = this.records.get(key);
    if (existing) {
      return existing;
    }
    this.records.set(key, record);
    return undefined;
  }

  get(key: string): PaymobIdempotencyRecord | undefined {
    return this.records.get(key);
  }

  set(key: string, record: PaymobIdempotencyRecord): void {
    this.records.set(key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }
}

class ExpiredThenContendedIdempotencyStore implements PaymobIdempotencyStore {
  readonly deleted: string[] = [];
  reserveCalls = 0;

  async reserve(_key: string, record: PaymobIdempotencyRecord): Promise<PaymobIdempotencyRecord | undefined> {
    this.reserveCalls += 1;
    if (this.reserveCalls === 1) {
      return {
        ...record,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
      };
    }

    return {
      ...record,
      status: "in_progress",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
  }

  get(_key: string): PaymobIdempotencyRecord | undefined {
    return undefined;
  }

  set(_key: string, _record: PaymobIdempotencyRecord): void {
    // Not used by this regression test.
  }

  delete(key: string): void {
    this.deleted.push(key);
  }
}

class FailingSetIdempotencyStore extends MemoryIdempotencyStore {
  setCalls = 0;

  set(_key: string, _record: PaymobIdempotencyRecord): void {
    this.setCalls += 1;
    throw new Error("idempotency store write failed");
  }
}

function createMockWebhookPayload(
  overrides: Partial<PaymobWebhookPayload["obj"]> = {},
): PaymobWebhookPayload {
  return {
    type: "TRANSACTION",
    obj: {
      id: 123456789,
      pending: false,
      success: true,
      amount_cents: 10000,
      currency: "SAR",
      created_at: "2024-12-31T12:00:00Z",
      is_auth: false,
      is_capture: false,
      is_void: false,
      is_refund: false,
      is_standalone_payment: true,
      has_parent_transaction: false,
      error_occured: false,
      is_3d_secure: true,
      integration_id: 123456,
      profile_id: 789,
      owner: 302852,
      source_data: {
        type: "card",
        pan: "2346",
        sub_type: "MADA",
      },
      order: {
        id: 987654,
        merchant_order_id: "order_abc123",
      },
      transaction_id: "txn_xyz789",
      data_message: "Approved",
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetchSequence(...responses: Array<Response | Error>): void {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const response = responses[index++];
    if (response instanceof Error) {
      throw response;
    }
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  }) as typeof fetch;
}

function signPayload(payload: PaymobWebhookPayload, hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!): string {
  const dataString = (gateway as unknown as {
    buildHmacString(obj: PaymobWebhookPayload["obj"]): string;
  }).buildHmacString(payload.obj);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

function signCardTokenPayload(
  payload: PaymobCardTokenWebhookPayload,
  hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!,
): string {
  const dataString = (gateway as unknown as {
    buildCardTokenHmacString(obj: PaymobCardTokenWebhookPayload["obj"]): string;
  }).buildCardTokenHmacString(payload.obj);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

function signRedirectPayload(
  payload: Record<string, unknown>,
  hmacSecret = PAYMOB_TEST_CONFIG.hmacSecret!,
): string {
  const dataString = (gateway as unknown as {
    buildRedirectHmacString(obj: Record<string, unknown>): string;
  }).buildRedirectHmacString(payload);

  return createHmac("sha512", hmacSecret).update(dataString).digest("hex");
}

describe("PaymobGateway", () => {
  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    fetchCalls = [];
    hooksManager = new HooksManager({});
    gateway = new PaymobGateway(PAYMOB_TEST_CONFIG, hooksManager);
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Configuration", () => {
    it("uses KSA base URL by default", () => {
      const ksaGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: undefined } as PaymobConfig,
        hooksManager,
      );

      expect((ksaGateway as any).baseUrl).toBe("https://ksa.paymob.com");
    });

    it("uses Egypt base URL for eg region", () => {
      const egGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      expect((egGateway as any).baseUrl).toBe("https://accept.paymob.com");
    });

    it("uses custom base URL without trailing slash", () => {
      const customGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, baseUrl: "https://custom.paymob.com/" },
        hooksManager,
      );

      expect((customGateway as any).baseUrl).toBe("https://custom.paymob.com");
    });

    it("uses current UAE base URL", () => {
      const aeGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "ae" },
        hooksManager,
      );

      expect((aeGateway as any).baseUrl).toBe("https://uae.paymob.com");
    });
  });

  describe("createPayment", () => {
    it("creates an Intention payment with Token auth, payment methods, and safe redirect handling", async () => {
      mockFetchSequence(jsonResponse({
        id: "pi_test_123",
        client_secret: "csk_test_123",
        status: "intended",
      }));

      const result = await gateway.createPayment(VALID_CREATE_PARAMS);
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(fetchCalls[0]!.url).toBe("https://ksa.paymob.com/v1/intention/");
      expect(fetchCalls[0]!.init!.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Token ${PAYMOB_TEST_CONFIG.secretKey}`,
      });
      expect(requestBody.amount).toBe(10000);
      expect(requestBody.payment_methods).toEqual([123456]);
      expect(requestBody.billing_data.email).toBe("customer@example.com");
      expect(requestBody.redirection_url).toBe("https://example.com/success");
      expect(result.gatewayId).toBe("pi_test_123");
      expect(result.redirectUrl).toBe(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&clientSecret=csk_test_123",
      );
      expect(result.nextAction).toEqual({
        type: "redirect",
        checkoutUrl: result.redirectUrl,
        intentionId: "pi_test_123",
        clientSecret: "csk_test_123",
        paymentKeys: undefined,
      });
    });

    it("uses ISO minor units for OMR instead of assuming two decimals", async () => {
      const omGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "om", integrationId: 158 },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_omr_123", client_secret: "oman_csk_test_123" }));

      await omGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 20.125,
        currency: "OMR",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(fetchCalls[0]!.url).toBe("https://oman.paymob.com/v1/intention/");
      expect(requestBody.amount).toBe(20125);
    });

    it("rejects Paymob amounts below the currency minor unit before sending requests", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 0.004,
        currency: "SAR",
      })).rejects.toThrow(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects Paymob amounts with more precision than the currency supports", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        amount: 10.001,
        currency: "SAR",
      })).rejects.toThrow(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("normalizes currency to uppercase before sending Intention requests", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "sar",
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.currency).toBe("SAR");
      expect(requestBody.amount).toBe(10000);
    });

    it("encodes Unified Checkout query parameters", async () => {
      const encodedGateway = new PaymobGateway(
        {
          ...PAYMOB_TEST_CONFIG,
          publicKey: "pk_test_with/+==",
        },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_with/+==" }));

      const result = await encodedGateway.createPayment(VALID_CREATE_PARAMS);

      expect(result.redirectUrl).toBe(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk_test_with%2F%2B%3D%3D&clientSecret=csk_test_with%2F%2B%3D%3D",
      );
    });

    it("preserves Paymob payment method aliases instead of turning them into NaN", async () => {
      const aliasGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, integrationId: "card" },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await aliasGateway.createPayment(VALID_CREATE_PARAMS);
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.payment_methods).toEqual(["card"]);
    });

    it("warns when per-payment callbacks are used with explicit non-card aliases", async () => {
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      try {
        await gateway.createPayment({
          ...VALID_CREATE_PARAMS,
          paymobPaymentMethods: ["wallet"],
        });
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings[0]?.[0]).toContain("notification_url/redirection_url");
    });

    it("uses the configured auth integration when capture is false", async () => {
      const authGateway = new PaymobGateway(PAYMOB_AUTH_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ id: "pi_auth_123", client_secret: "csk_auth_123" }));

      await authGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.payment_methods).toEqual(["auth-card"]);
    });

    it("fails loudly when capture is false but no auth integration is configured", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        capture: false,
      })).rejects.toThrow(GatewayApiError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("uses idempotencyKey as special_reference when no payment/order reference is provided", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/webhook",
        idempotencyKey: "idem_123",
        paymobBillingData: {
          email: "customer@example.com",
          firstName: "Mohammed",
          lastName: "Ali",
          phone: "+966500000000",
        },
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.special_reference).toBe("idem_123");
      expect(requestBody.extras.idempotencyKey).toBe("idem_123");
    });

    it("allows Paymob Intention creation without per-payment notification_url", async () => {
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gateway.createPayment({
        amount: 100,
        currency: "SAR",
        paymobBillingData: {
          email: "customer@example.com",
          firstName: "Mohammed",
          lastName: "Ali",
          phone: "+966500000000",
        },
      });
      const requestBody = JSON.parse(fetchCalls[0]!.init!.body as string);

      expect(requestBody.notification_url).toBeUndefined();
    });

    it("rejects malformed successful Intention responses", async () => {
      mockFetchSequence(jsonResponse({ status: "intended" }));

      await expect(gateway.createPayment(VALID_CREATE_PARAMS)).rejects.toThrow(GatewayApiError);
    });

    it("rejects invalid billing metadata before sending Paymob requests", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        metadata: {
          ...VALID_CREATE_PARAMS.metadata,
          email: "not-an-email",
        },
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("does not send fake billing data when required customer fields are missing", async () => {
      await expect(
        gateway.createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/webhook",
        }),
      ).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("requires both secretKey and publicKey for Intention checkout", async () => {
      const incompleteGateway = new PaymobGateway(
        { secretKey: "sk_test_only", region: "ksa", integrationId: "123456" },
        hooksManager,
      );

      await expect(incompleteGateway.createPayment(VALID_CREATE_PARAMS)).rejects.toThrow(GatewayApiError);
    });

    it("creates a legacy iframe payment with apiKey, integrationId, and iframeId", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({ token: "payment_key_123" }),
      );

      const result = await legacyGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
      });

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://accept.paymob.com/api/auth/tokens",
        "https://accept.paymob.com/api/ecommerce/orders",
        "https://accept.paymob.com/api/acceptance/payment_keys",
      ]);
      expect(result.gatewayId).toBe("777");
      expect(result.gatewayObjectId).toBe("777");
      expect(result.orderId).toBe("777");
      expect(result.nextAction).toEqual({
        type: "redirect",
        checkoutUrl: result.redirectUrl,
        orderId: "777",
        paymentToken: "payment_key_123",
      });
      expect(result.redirectUrl).toBe(
        "https://accept.paymob.com/api/acceptance/iframes/998877?payment_token=payment_key_123",
      );
    });

    it("URL-encodes legacy iframe payment tokens", async () => {
      const legacyGateway = new PaymobGateway(PAYMOB_LEGACY_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 777 }),
        jsonResponse({ token: "payment/key+123==" }),
      );

      const result = await legacyGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        currency: "EGP",
      });

      expect(result.redirectUrl).toBe(
        "https://accept.paymob.com/api/acceptance/iframes/998877?payment_token=payment%2Fkey%2B123%3D%3D",
      );
    });

    it("rejects whitespace-only Paymob payment method overrides", async () => {
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        paymobPaymentMethods: ["   "],
      })).rejects.toThrow(InvalidRequestError);
      await expect(gateway.createPayment({
        ...VALID_CREATE_PARAMS,
        paymobIntegrationId: "   ",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("payment management APIs", () => {
    it("requires apiKey before capture/refund/void/getPayment token auth", async () => {
      await expect(gateway.capturePayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(PaymentError);
      await expect(gateway.refundPayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(PaymentError);
      await expect(gateway.voidPayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(PaymentError);
      await expect(gateway.getPayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(PaymentError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("wraps auth network failures as NetworkError", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(new Error("socket closed"));

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "123456789" })).rejects.toThrow(NetworkError);
    });

    it("maps failed refund responses to failed results", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: false, pending: false }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
    });

    it("maps pending refund responses to pending even when success is true", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, pending: true }),
      );

      const result = await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("pending");
    });

    it("derives full capture amount from transaction inquiry when amount is omitted", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 2500, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 10000 }),
      );

      await actionGateway.capturePayment({ gatewayPaymentId: "123456789" });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/capture",
      ]);
      expect(captureBody.amount_cents).toBe(7500);
    });

    it("derives action amounts from wrapped transaction inquiry responses", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          type: "TRANSACTION",
          obj: {
            id: 123,
            amount_cents: "10000",
            captured_amount: "2500",
            currency: "SAR",
          },
        }),
        jsonResponse({ id: 123, success: true, captured_amount: 10000 }),
      );

      await actionGateway.capturePayment({ gatewayPaymentId: "123456789" });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(captureBody.amount_cents).toBe(7500);
    });

    it("derives remaining refund amount from transaction inquiry when amount is omitted", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 2000, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 10000 }),
      );

      const result = await actionGateway.refundPayment({ gatewayPaymentId: "123456789" });
      const refundBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(refundBody.amount_cents).toBe(8000);
      expect(result.totalRefunded).toBe(100);
    });

    it("deduplicates management calls with the same idempotency key", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      };
      const first = await actionGateway.refundPayment(params);
      const second = await actionGateway.refundPayment(params);

      expect(first).toBe(second);
      expect(first.totalRefunded).toBe(50);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("deduplicates concurrent management calls with the same idempotency key", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_concurrent_idem_123",
      };
      const [first, second] = await Promise.all([
        actionGateway.refundPayment(params),
        actionGateway.refundPayment(params),
      ]);

      expect(first).toBe(second);
      expect(first.totalRefunded).toBe(50);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps idempotency keys blocked after network failures on mutating calls", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_123",
      };

      await expect(actionGateway.refundPayment(params)).rejects.toThrow(NetworkError);
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("keeps idempotency keys blocked after Paymob 5xx responses on mutating calls", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ message: "upstream timeout" }, 500),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_unknown_500",
      };

      await expect(actionGateway.refundPayment(params)).rejects.toThrow(NetworkError);
      await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("does not block idempotency retries when preflight auth fails before mutation", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        new Error("auth network down"),
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      const params = {
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_retry_after_auth_failure",
      };

      await expect(actionGateway.refundPayment(params)).rejects.toThrow(NetworkError);
      const result = await actionGateway.refundPayment(params);

      expect(result.status).toBe("completed");
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
        "https://ksa.paymob.com/api/acceptance/void_refund/refund",
      ]);
    });

    it("rejects idempotency key reuse with different parameters", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      await actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      });

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 60,
        currency: "SAR",
        idempotencyKey: "refund_idem_123",
      })).rejects.toThrow(InvalidRequestError);
    });

    it("can replay idempotent results across gateway instances with a shared store", async () => {
      const idempotencyStore = new MemoryIdempotencyStore();
      const firstGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );
      const secondGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      const first = await firstGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_idem_123",
      });
      const second = await secondGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_idem_123",
      });

      expect(second).toEqual(first);
      expect(fetchCalls).toHaveLength(1);
    });

    it("does not proceed when an expired shared idempotency record is replaced by another worker", async () => {
      const idempotencyStore = new ExpiredThenContendedIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, idempotencyStore },
        hooksManager,
      );

      await expect(actionGateway.createPayment({
        ...VALID_CREATE_PARAMS,
        idempotencyKey: "create_expired_race",
      })).rejects.toThrow(InvalidRequestError);

      expect(idempotencyStore.reserveCalls).toBe(2);
      expect(idempotencyStore.deleted).toEqual(["createPayment:create_expired_race"]);
      expect(fetchCalls).toHaveLength(0);
    });

    it("does not fail a completed Paymob mutation when the shared idempotency result write fails", async () => {
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      const idempotencyStore = new FailingSetIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 5000 }),
      );

      try {
        const params = {
          gatewayPaymentId: "123456789",
          amount: 50,
          currency: "SAR",
          idempotencyKey: "refund_store_write_fails_after_success",
        };
        const first = await actionGateway.refundPayment(params);
        const second = await actionGateway.refundPayment(params);

        expect(first.status).toBe("completed");
        expect(second).toBe(first);
        expect(idempotencyStore.setCalls).toBe(1);
        expect(warnings[0]?.[0]).toContain("Failed to persist refundPayment idempotency record");
        expect(fetchCalls.map((call) => call.url)).toEqual([
          "https://ksa.paymob.com/api/auth/tokens",
          "https://ksa.paymob.com/api/acceptance/transactions/123456789",
          "https://ksa.paymob.com/api/acceptance/void_refund/refund",
        ]);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("keeps local unknown-outcome protection when the shared idempotency unknown write fails", async () => {
      const originalWarn = console.warn;
      const warnings: unknown[][] = [];
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      const idempotencyStore = new FailingSetIdempotencyStore();
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, idempotencyStore },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 5000, refunded_amount_cents: 0, currency: "SAR" }),
        new Error("socket closed after gateway accepted request"),
      );

      try {
        const params = {
          gatewayPaymentId: "123456789",
          amount: 50,
          currency: "SAR",
          idempotencyKey: "refund_unknown_store_write_fails",
        };

        await expect(actionGateway.refundPayment(params)).rejects.toThrow(NetworkError);
        await expect(actionGateway.refundPayment(params)).rejects.toThrow(InvalidRequestError);
        expect(idempotencyStore.setCalls).toBe(1);
        expect(warnings[0]?.[0]).toContain("Failed to persist refundPayment idempotency record");
        expect(fetchCalls.map((call) => call.url)).toEqual([
          "https://ksa.paymob.com/api/auth/tokens",
          "https://ksa.paymob.com/api/acceptance/transactions/123456789",
          "https://ksa.paymob.com/api/acceptance/void_refund/refund",
        ]);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("rejects explicit action amounts above the remaining transaction amount", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, refunded_amount_cents: 9000, currency: "SAR" }),
      );

      await expect(actionGateway.refundPayment({
        gatewayPaymentId: "123456789",
        amount: 20,
        currency: "SAR",
      })).rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
      ]);
    });

    it("rejects explicit action currency that differs from the transaction currency", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 10,
        currency: "OMR",
      })).rejects.toThrow(InvalidRequestError);
    });

    it("derives remaining refund amount from captured amount after partial capture", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123,
          amount_cents: 10000,
          currency: "SAR",
          captured_amount: 4000,
          refunded_amount_cents: 1000,
        }),
        jsonResponse({ id: 123, success: true, refunded_amount_cents: 4000 }),
      );

      await actionGateway.refundPayment({ gatewayPaymentId: "123456789" });
      const refundBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(refundBody.amount_cents).toBe(3000);
    });

    it("rejects refunding uncaptured authorizations and directs callers to void", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123,
          success: true,
          amount_cents: 10000,
          captured_amount: 0,
          currency: "SAR",
          is_auth: true,
          is_capture: false,
          is_captured: false,
        }),
      );

      await expect(actionGateway.refundPayment({ gatewayPaymentId: "123456789" }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls.map((call) => call.url)).toEqual([
        "https://ksa.paymob.com/api/auth/tokens",
        "https://ksa.paymob.com/api/acceptance/transactions/123456789",
      ]);
    });

    it("converts OMR action amounts and response amounts with three decimal places", async () => {
      const actionGateway = new PaymobGateway(
        { ...PAYMOB_ACTION_CONFIG, region: "om" },
        hooksManager,
      );
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 50000, captured_amount: 0, currency: "OMR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 20125 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 20.125,
        currency: "OMR",
      });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(captureBody.amount_cents).toBe(20125);
      expect(result.capturedAmount).toBe(20.125);
    });

    it("uses transaction currency when an explicit action amount omits currency", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 50000, currency: "OMR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 20125 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 20.125,
      });
      const captureBody = JSON.parse(fetchCalls[2]!.init!.body as string);

      expect(fetchCalls[1]!.url).toBe("https://ksa.paymob.com/api/acceptance/transactions/123456789");
      expect(captureBody.amount_cents).toBe(20125);
      expect(result.capturedAmount).toBe(20.125);
    });

    it("rejects transaction inquiry responses that include money without currency", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, success: true, amount_cents: 10000 }),
      );

      await expect(actionGateway.getPayment({ gatewayPaymentId: "123456789" }))
        .rejects.toThrow(GatewayApiError);
    });

    it("normalizes wrapped transaction inquiry responses for getPayment", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          type: "TRANSACTION",
          obj: {
            id: "123456789",
            success: "true",
            pending: "false",
            amount_cents: "10000",
            captured_amount: "4000",
            refunded_amount_cents: "1000",
            currency: "SAR",
          },
        }),
      );

      const result = await actionGateway.getPayment({ gatewayPaymentId: "123456789" });

      expect(result.gatewayId).toBe("123456789");
      expect(result.status).toBe("partially_captured");
      expect(result.amount).toBe(100);
      expect(result.capturedAmount).toBe(40);
      expect(result.refundedAmount).toBe(10);
    });

    it("returns Paymob payment status via transaction inquiry", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({
          id: 123456789,
          success: true,
          pending: false,
          amount_cents: 10000,
          currency: "SAR",
        }),
      );

      await expect(actionGateway.getPaymentStatus("123456789")).resolves.toBe("paid");
    });

    it("rejects intention IDs for transaction lookup with a clear error", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);

      await expect(actionGateway.getPayment({ gatewayPaymentId: "pi_test_123" }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects intention IDs for capture, refund, and void before calling Paymob", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "pi_test_123" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.refundPayment({ gatewayPaymentId: "pi_test_123" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.voidPayment({ gatewayPaymentId: "pi_test_123" }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-numeric Paymob transaction IDs before calling Paymob", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);

      await expect(actionGateway.capturePayment({ gatewayPaymentId: "order_123" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.refundPayment({ gatewayPaymentId: "txn_123" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.voidPayment({ gatewayPaymentId: "abc" }))
        .rejects.toThrow(InvalidRequestError);
      await expect(actionGateway.getPayment({ gatewayPaymentId: "missing_txn" }))
        .rejects.toThrow(InvalidRequestError);
      expect(fetchCalls).toHaveLength(0);
    });

    it("maps successful partial capture responses to partially_captured", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, amount_cents: 10000, captured_amount: 4000 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 40,
        currency: "SAR",
      });

      expect(result.status).toBe("partially_captured");
      expect(result.capturedAmount).toBe(40);
    });

    it("uses transaction inquiry totals to map partial captures when capture response omits amount_cents", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123, success: true, captured_amount: 4000 }),
      );

      const result = await actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 40,
        currency: "SAR",
      });

      expect(result.status).toBe("partially_captured");
      expect(result.capturedAmount).toBe(40);
    });

    it("rejects malformed successful action responses", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ id: 123 }),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      })).rejects.toThrow(GatewayApiError);
    });

    it("maps Paymob API errors safely when raw message is not a string", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ message: ["authentication failed"] }, 400),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      })).rejects.toThrow(AuthenticationError);
    });

    it("maps Paymob 401 responses to AuthenticationError", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ detail: "Invalid token" }, 401));

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
      })).rejects.toThrow(AuthenticationError);
    });

    it("maps Paymob 404 and 429 responses to operational error types", async () => {
      const notFoundGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ token: "auth_token_123" }, 200), jsonResponse({ message: "Not found" }, 404));

      await expect(notFoundGateway.getPayment({ gatewayPaymentId: "404404" }))
        .rejects.toThrow(ResourceNotFoundError);

      const rateLimitedGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(jsonResponse({ detail: "Too many requests" }, 429));

      await expect(rateLimitedGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
      })).rejects.toThrow(RateLimitError);
    });

    it("maps insufficient-funds Paymob messages to InsufficientFundsError", async () => {
      const actionGateway = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksManager);
      mockFetchSequence(
        jsonResponse({ token: "auth_token_123" }),
        jsonResponse({ id: 123, amount_cents: 10000, captured_amount: 0, currency: "SAR" }),
        jsonResponse({ message: "Insufficient funds" }, 400),
      );

      await expect(actionGateway.capturePayment({
        gatewayPaymentId: "123456789",
        amount: 50,
        currency: "SAR",
      })).rejects.toThrow(InsufficientFundsError);
    });

    it("aborts Paymob requests when the configured timeout is exceeded", async () => {
      const timeoutGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, timeoutMs: 1 },
        hooksManager,
      );
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(_input), init });
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }) as typeof fetch;

      await expect(timeoutGateway.createPayment(VALID_CREATE_PARAMS)).rejects.toThrow(NetworkError);
    });
  });

  describe("verifyWebhook", () => {
    it("fails closed when no HMAC secret is configured", () => {
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined } as PaymobConfig,
        hooksManager,
      );

      expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
    });

    it("allows unverified webhooks only when explicitly configured", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(true);
        expect(gatewayNoSecret.verifyWebhook({ arbitrary: "payload" })).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("refuses unverified webhooks outside explicit local/test environments", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("refuses unverified webhooks in production even when explicitly configured", () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const gatewayNoSecret = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, hmacSecret: undefined, allowUnverifiedWebhooks: true } as PaymobConfig,
        hooksManager,
      );

      try {
        expect(gatewayNoSecret.verifyWebhook(createMockWebhookPayload())).toBe(false);
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it("verifies a valid HMAC signature using a timing-safe comparison", () => {
      const payload = createMockWebhookPayload();
      const signature = signPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
      expect(gateway.verifyWebhook(payload, "invalid_signature")).toBe(false);
    });

    it("fails closed instead of throwing when HMAC input is not a string", () => {
      const payload = createMockWebhookPayload();

      expect(gateway.verifyWebhook(payload, ["not", "a", "string"] as unknown as string)).toBe(false);
    });

    it("matches Paymob's documented transaction HMAC field order", () => {
      const payload = createMockWebhookPayload();
      const dataString = (gateway as unknown as {
        buildHmacString(obj: PaymobWebhookPayload["obj"]): string;
      }).buildHmacString(payload.obj);

      expect(dataString).toBe(
        "100002024-12-31T12:00:00ZSARfalsefalse123456789123456truefalsefalsefalsetruefalse987654302852false2346MADAcardtrue",
      );
    });

    it("verifies card token callbacks with their separate HMAC fields", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      };
      const signature = signCardTokenPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
    });

    it("matches Paymob's documented card-token HMAC concatenation sample", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 8555026,
          token: "e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
          masked_pan: "xxxx-xxxx-xxxx-2346",
          merchant_id: 246628,
          card_subtype: "MasterCard",
          created_at: "2024-11-13T12:32:23.859982",
          email: "test@test.com",
          order_id: "264064419",
          user_added: false,
          next_payment_intention: "pi_test_2a9c29ead1734ce8ad09ae4936019992",
        },
      };
      const dataString = (gateway as unknown as {
        buildCardTokenHmacString(obj: PaymobCardTokenWebhookPayload["obj"]): string;
      }).buildCardTokenHmacString(payload.obj);

      expect(dataString).toBe(
        "MasterCard2024-11-13T12:32:23.859982test@test.com8555026xxxx-xxxx-xxxx-2346246628264064419e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
      );
    });

    it("verifies redirection callbacks with flat query-style fields", () => {
      const payload = {
        amount_cents: "10000",
        created_at: "2024-12-31T12:00:00Z",
        currency: "SAR",
        error_occured: "false",
        has_parent_transaction: "false",
        id: "123456789",
        integration_id: "123456",
        is_3d_secure: "true",
        is_auth: "false",
        is_capture: "false",
        is_refunded: "false",
        is_standalone_payment: "true",
        is_voided: "false",
        order: "987654",
        owner: "302852",
        pending: "false",
        source_data_pan: "2346",
        source_data_sub_type: "MADA",
        source_data_type: "card",
        success: "true",
        merchant_order_id: "payment_123",
      };
      const signature = signRedirectPayload(payload);

      expect(gateway.verifyWebhook(payload, signature)).toBe(true);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses successful payment webhook", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload());

      expect(event.id).toBe("123456789");
      expect(event.gateway).toBe("paymob");
      expect(event.gatewayPaymentId).toBe("123456789");
      expect(event.paymentId).toBe("order_abc123");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(100);
      expect(event.currency).toBe("SAR");
      expect(event.timestamp.toISOString()).toBe("2024-12-31T12:00:00.000Z");
    });

    it("parses processed callbacks with stringified Paymob numbers and booleans", () => {
      const payload = createMockWebhookPayload({
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        is_auth: "false",
        is_capture: "false",
        is_void: "false",
        is_refund: "false",
        is_standalone_payment: "true",
        has_parent_transaction: "false",
        error_occured: "false",
        is_3d_secure: "true",
        integration_id: "123456",
      } as Partial<PaymobWebhookPayload["obj"]>);

      const event = gateway.parseWebhookEvent(payload);

      expect(event.gatewayPaymentId).toBe("123456789");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(100);
    });

    it("prioritizes refund and void flags over success", () => {
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
      }));
      const currentRefundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_void: true,
      }));

      expect(refundEvent.status).toBe("refunded");
      expect(currentRefundEvent.status).toBe("refunded");
      expect(voidEvent.status).toBe("cancelled");
    });

    it("treats Paymob legacy action flags as authoritative even when current-state flags are false", () => {
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: true,
        is_refunded: false,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_void: true,
        is_voided: false,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.status).toBe("refunded");
      expect(voidEvent.status).toBe("cancelled");
    });

    it("does not treat failed refund or void action callbacks as completed states", () => {
      const refundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: false,
        is_refund: true,
        is_refunded: false,
      } as Partial<PaymobWebhookPayload["obj"]>));
      const voidEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: false,
        is_void: true,
        is_voided: false,
      } as Partial<PaymobWebhookPayload["obj"]>));

      expect(refundEvent.status).toBe("failed");
      expect(voidEvent.status).toBe("failed");
    });

    it("maps Paymob partial refund and partial capture fields", () => {
      const partialRefundEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_refund: false,
        is_refunded: true,
        amount_cents: 10000,
        refunded_amount_cents: 2500,
      }));
      const partialCaptureEvent = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        amount_cents: 10000,
        captured_amount: 5000,
        is_captured: true,
      }));

      expect(partialRefundEvent.status).toBe("partially_refunded");
      expect(partialCaptureEvent.status).toBe("partially_captured");
    });

    it("maps auth-only callbacks to authorized", () => {
      const event = gateway.parseWebhookEvent(createMockWebhookPayload({
        success: true,
        is_auth: true,
        is_capture: false,
      }));

      expect(event.status).toBe("authorized");
    });

    it("parses webhook amounts with the currency minor unit", () => {
      const omGateway = new PaymobGateway(
        { ...PAYMOB_TEST_CONFIG, region: "om" },
        hooksManager,
      );
      const event = omGateway.parseWebhookEvent(createMockWebhookPayload({
        amount_cents: 20125,
        currency: "OMR",
      }));

      expect(event.amount).toBe(20.125);
    });

    it("extracts paymentId from payment key claims extras before merchant_order_id", () => {
      const payload = createMockWebhookPayload({
        payment_key_claims: {
          extra: { paymentId: "payment_from_extra" },
        },
      });

      expect(gateway.parseWebhookEvent(payload).paymentId).toBe("payment_from_extra");
    });

    it("extracts paymentId from nested Paymob creation_extras", () => {
      const payload = createMockWebhookPayload({
        payment_key_claims: {
          extra: {
            creation_extras: { paymentId: "payment_from_creation_extras" },
          },
        },
      });

      expect(gateway.parseWebhookEvent(payload).paymentId).toBe("payment_from_creation_extras");
    });

    it("parses card token callbacks as setup events", () => {
      const payload: PaymobCardTokenWebhookPayload = {
        type: "TOKEN",
        obj: {
          id: 9988,
          token: "tok_saved_card_123",
          masked_pan: "512345xxxxxx2346",
          merchant_id: 302852,
          card_subtype: "MasterCard",
          created_at: "2024-12-31T12:00:00Z",
          email: "customer@example.com",
          order_id: "order_abc123",
          next_payment_intention: "pi_next_123",
        },
      };

      const event = gateway.parseWebhookEvent(payload);

      expect(event.status).toBe("setup_completed");
      expect(event.paymentId).toBeUndefined();
      expect(event.gatewayPaymentId).toBe("pi_next_123");
      expect(event.gatewayObjectId).toBe("9988");
      expect(event.gatewayToken).toBe("tok_saved_card_123");
    });

    it("parses redirection callbacks without treating gateway order IDs as internal IDs", () => {
      const payload = {
        id: "123456789",
        pending: "false",
        success: "true",
        amount_cents: "10000",
        currency: "SAR",
        created_at: "2024-12-31T12:00:00Z",
        merchant_order_id: "payment_123",
      };

      const event = gateway.parseWebhookEvent(payload);

      expect(event.type).toBe("TRANSACTION_RESPONSE");
      expect(event.paymentId).toBe("payment_123");
      expect(event.gatewayPaymentId).toBe("123456789");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(100);
    });

    it("rejects Paymob callbacks with invalid timestamps instead of using the current time", () => {
      expect(() => gateway.parseWebhookEvent(createMockWebhookPayload({
        created_at: "not-a-date",
      }))).toThrow(InvalidWebhookError);
    });
  });

  describe("Lifecycle Hooks", () => {
    it("executes beforeCreatePayment hook", async () => {
      let hookCalled = false;
      let hookGateway: string | undefined;
      let hookOperation: string | undefined;

      const hooksWithBefore = new HooksManager({
        beforeCreatePayment: async (ctx: HookContext<CreatePaymentParams>) => {
          hookCalled = true;
          hookGateway = ctx.gateway;
          hookOperation = ctx.operation;
          return { proceed: true };
        },
      });

      const gatewayWithHooks = new PaymobGateway(PAYMOB_TEST_CONFIG, hooksWithBefore);
      mockFetchSequence(jsonResponse({ id: "pi_test_123", client_secret: "csk_test_123" }));

      await gatewayWithHooks.createPayment(VALID_CREATE_PARAMS);

      expect(hookCalled).toBe(true);
      expect(hookGateway).toBe("paymob");
      expect(hookOperation).toBe("createPayment");
    });

    it("aborts void when hook returns proceed false", async () => {
      const hooksWithAbort = new HooksManager({
        onBefore: async () => ({ proceed: false, abortReason: "Void blocked by security check" }),
      });
      const gatewayWithAbort = new PaymobGateway(PAYMOB_ACTION_CONFIG, hooksWithAbort);

      await expect(
        gatewayWithAbort.voidPayment({ gatewayPaymentId: "test_id" }),
      ).rejects.toThrow("Void blocked by security check");
    });
  });
});
