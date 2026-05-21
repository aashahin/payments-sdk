import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HooksManager } from "../../hooks/hooks.manager";
import {
  InvalidRequestError,
  InvalidWebhookError,
  NetworkError,
  ResourceNotFoundError,
} from "../../errors";
import type { PaymentHooks } from "../../hooks/hooks.types";
import type { MoyasarConfig } from "../../types/config.types";
import { MoyasarGateway } from "./moyasar.gateway";

const CONFIG: MoyasarConfig = {
  secretKey: "sk_test_unit",
  webhookSecret: "webhook_secret",
};

const PAYMENT_ID = "760878ec-d1d3-5f72-9056-191683f55872";
const MISSING_PAYMENT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

const originalFetch = globalThis.fetch;

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function createGateway(
  config: MoyasarConfig = CONFIG,
  hooks: PaymentHooks = {},
): MoyasarGateway {
  return new MoyasarGateway(config, new HooksManager(hooks));
}

function paymentResponse(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: PAYMENT_ID,
    status: "paid",
    amount: 10000,
    fee: 250,
    currency: "SAR",
    refunded: 0,
    captured: 10000,
    amount_format: "100.00 SAR",
    fee_format: "2.50 SAR",
    refunded_format: "0.00 SAR",
    captured_format: "100.00 SAR",
    ip: "127.0.0.1",
    created_at: "2026-05-21T10:00:00Z",
    updated_at: "2026-05-21T10:00:00Z",
    refunded_at: null,
    captured_at: "2026-05-21T10:00:00Z",
    voided_at: null,
    description: "Payment",
    invoice_id: null,
    callback_url: "https://example.com/callback",
    metadata: {},
    source: {
      type: "token",
      transaction_url: null,
    },
    ...overrides,
  };
}

function mockFetchJson(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetchError(error: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    throw error;
  }) as typeof fetch;
}

function lastRequestBody(): Record<string, any> {
  const body = fetchCalls.at(-1)?.init?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string);
}

function lastRequestBodyOrUndefined(): unknown {
  const body = fetchCalls.at(-1)?.init?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MoyasarGateway", () => {
  describe("createPayment", () => {
    it("maps capture false to Moyasar source.manual for token payments", async () => {
      mockFetchJson(paymentResponse({ status: "authorized", captured: 0 }));

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        capture: false,
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      const body = lastRequestBody();
      expect(body.amount).toBe(10000);
      expect(body.callback_url).toBe("https://example.com/callback");
      expect(body.source).toEqual({
        type: "token",
        token: "token_test_123",
        manual: true,
      });
    });

    it("rejects raw credit card sources before sending cardholder data to the backend API", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          moyasarSource: {
            type: "creditcard",
            name: "Saleh Ali",
            number: "4111111111111111",
            month: 12,
            year: 2029,
            cvc: "123",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("lets manualCapture override capture false", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 50,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        capture: false,
        moyasarSource: {
          type: "token",
          token: "token_test_123",
          manualCapture: false,
        },
      });

      expect(lastRequestBody().source.manual).toBe(false);
    });

    it("requires callbackUrl for token payments", async () => {
      await expect(
        createGateway().createPayment({
          amount: 10,
          currency: "SAR",
          moyasarSource: {
            type: "token",
            token: "token_test_123",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("requires a Moyasar source before making an API request", async () => {
      await expect(
        createGateway().createPayment({
          amount: 10,
          currency: "SAR",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("marks API-successful failed payments as unsuccessful", async () => {
      mockFetchJson(
        paymentResponse({
          status: "failed",
          source: {
            type: "token",
            message: "Declined",
            transaction_url: null,
          },
        }),
        201,
      );

      const result = await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        callbackUrl: "https://example.com/callback",
        moyasarSource: {
          type: "token",
          token: "token_test_123",
        },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
    });

    it("does not require callbackUrl for STC Pay and returns OTP nextAction", async () => {
      mockFetchJson(
        paymentResponse({
          status: "initiated",
          captured: 0,
          source: {
            type: "stcpay",
            transaction_url: "https://api.moyasar.com/stc/otp",
          },
        }),
      );

      const result = await createGateway().createPayment({
        amount: 75,
        currency: "SAR",
        moyasarSource: {
          type: "stcpay",
          mobile: "0512345678",
        },
      });

      const body = lastRequestBody();
      expect(body.callback_url).toBeUndefined();
      expect(result.redirectUrl).toBeUndefined();
      expect(result.nextAction).toEqual({
        type: "stcpay_otp",
        transactionUrl: "https://api.moyasar.com/stc/otp",
        method: "POST",
        parameter: "otp_value",
      });
    });

    it("accepts Moyasar's documented local STC Pay mobile number without plus prefix", async () => {
      mockFetchJson(
        paymentResponse({
          status: "initiated",
          captured: 0,
          source: {
            type: "stcpay",
            transaction_url: "https://api.moyasar.com/stc/otp",
          },
        }),
      );

      await createGateway().createPayment({
        amount: 75,
        currency: "SAR",
        moyasarSource: {
          type: "stcpay",
          mobile: "966512345678",
        },
      });

      expect(lastRequestBody().source.mobile).toBe("966512345678");
    });

    it("rejects metadata that cannot be represented safely in Moyasar metadata", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata: {
            nested: { id: "not-supported" },
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-string metadata values before sending the request", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata: {
            customerId: 123,
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("validates final metadata after adding order correlation keys", async () => {
      const metadata: Record<string, string> = {};
      for (let index = 0; index < 29; index += 1) {
        metadata[`key${index}`] = `value${index}`;
      }

      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          orderId: "order_123",
          moyasarSource: {
            type: "stcpay",
            mobile: "0512345678",
          },
          metadata,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("uses currency minor units for create response mapping", async () => {
      mockFetchJson(
        paymentResponse({
          amount: 1234,
          fee: 12,
          captured: 1234,
          refunded: 0,
          currency: "KWD",
        }),
      );

      const result = await createGateway().createPayment({
        amount: 1.234,
        currency: "KWD",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
      });

      expect(lastRequestBody().amount).toBe(1234);
      expect(result.amount).toBe(1.234);
      expect(result.fee).toBe(0.012);
      expect(result.capturedAmount).toBe(1.234);
    });

    it("maps decrypted Apple Pay fields to Moyasar API names", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        moyasarSource: {
          type: "applepay",
          dpan: "4111111111111111",
          month: 12,
          year: 2029,
          cryptogram: "cryptogram",
          deviceId: "device123",
          lastFour: "1111",
          eci: "05",
        },
      });

      expect(lastRequestBody().source).toEqual({
        type: "applepay",
        number: "4111111111111111",
        month: 12,
        year: 2029,
        cryptogram: "cryptogram",
        device_id: "device123",
        last_four: "1111",
        eci: "05",
      });
    });

    it("forwards documented Moyasar split and AFT fields", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        idempotencyKey: "a1168bd1-47a4-4b97-8a50-dd5caaccacf2",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        splits: [
          {
            amount: 5000,
            recipient_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            reference: "split_1",
            fee_source: true,
          },
        ],
        recipient: {
          first_name: "Saleh",
          last_name: "Ali",
          address: "Riyadh",
        },
        sender: {
          account: {
            funds_source: "01",
            number: "123456789",
          },
          first_name: "Sara",
          last_name: "Ali",
          address: "Riyadh",
          country_code: "SA",
          id_type: "NTID",
          id: "1234567890",
          phone_number: "0512345678",
        },
      });

      const body = lastRequestBody();
      expect(body.given_id).toBe("a1168bd1-47a4-4b97-8a50-dd5caaccacf2");
      expect(body.splits).toEqual([
        {
          amount: 5000,
          recipient_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          reference: "split_1",
          fee_source: true,
        },
      ]);
      expect(body.recipient.first_name).toBe("Saleh");
      expect(body.sender.account.funds_source).toBe("01");
    });

    it("copies orderId into Moyasar metadata for webhook correlation", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        orderId: "order_123",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        metadata: {
          customerId: "customer_456",
        },
      });

      expect(lastRequestBody().metadata).toEqual({
        customerId: "customer_456",
        orderId: "order_123",
        paymentId: "order_123",
      });
    });

    it("does not overwrite explicit metadata order correlation fields", async () => {
      mockFetchJson(paymentResponse());

      await createGateway().createPayment({
        amount: 100,
        currency: "SAR",
        orderId: "order_123",
        moyasarSource: {
          type: "applepay",
          token: "encrypted_token",
        },
        metadata: {
          orderId: "external_order",
          paymentId: "payment_789",
        },
      });

      expect(lastRequestBody().metadata).toEqual({
        orderId: "external_order",
        paymentId: "payment_789",
      });
    });

    it("requires Moyasar idempotencyKey to be a UUID", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          idempotencyKey: "order_123",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects legacy tokenId values that do not match Moyasar token format", async () => {
      await expect(
        createGateway().createPayment({
          amount: 100,
          currency: "SAR",
          callbackUrl: "https://example.com/callback",
          tokenId: "bad_token",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects amounts below one minor unit", async () => {
      await expect(
        createGateway().createPayment({
          amount: 0.001,
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects amounts with unsupported currency precision", async () => {
      await expect(
        createGateway().createPayment({
          amount: 1.235,
          currency: "SAR",
          moyasarSource: {
            type: "applepay",
            token: "encrypted_token",
          },
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("capturePayment and refundPayment", () => {
    it("uses provided currency minor units for partial capture", async () => {
      mockFetchJson(paymentResponse({ currency: "KWD", amount: 1234, captured: 1234 }));

      await createGateway().capturePayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 1.234,
        currency: "KWD",
      });

      expect(fetchCalls[0]?.url).toBe(
        `https://api.moyasar.com/v1/payments/${PAYMENT_ID}/capture`,
      );
      expect(lastRequestBody().amount).toBe(1234);
    });

    it("requires currency for partial captures instead of defaulting to SAR", async () => {
      await expect(
        createGateway().capturePayment({
          gatewayPaymentId: PAYMENT_ID,
          amount: 1.234,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("omits request body for full capture", async () => {
      mockFetchJson(paymentResponse({ status: "captured" }));

      await createGateway().capturePayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(lastRequestBodyOrUndefined()).toBeUndefined();
    });

    it("maps refund totals using response currency minor units", async () => {
      mockFetchJson(
        paymentResponse({
          status: "refunded",
          currency: "KWD",
          amount: 1234,
          refunded: 1234,
          refunded_at: "2026-05-21T10:05:00Z",
        }),
      );

      const result = await createGateway().refundPayment({
        gatewayPaymentId: PAYMENT_ID,
        amount: 1.234,
        currency: "KWD",
      });

      expect(lastRequestBody().amount).toBe(1234);
      expect(result.status).toBe("completed");
      expect(result.totalRefunded).toBe(1.234);
      expect(result.refundedAt).toEqual(new Date("2026-05-21T10:05:00Z"));
    });

    it("requires currency for partial refunds instead of defaulting to SAR", async () => {
      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
          amount: 1.234,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("omits request body for full refund", async () => {
      mockFetchJson(paymentResponse({ status: "refunded" }));

      await createGateway().refundPayment({
        gatewayPaymentId: PAYMENT_ID,
      });

      expect(lastRequestBodyOrUndefined()).toBeUndefined();
    });

    it("keeps Moyasar validation error details when error fields are not arrays", async () => {
      mockFetchJson(
        {
          type: "invalid_request_error",
          message: "Invalid request",
          errors: {
            amount: "must be a positive integer",
          },
        },
        400,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toThrow("amount: must be a positive integer");
    });

    it("maps Moyasar documented invalid_request errors to InvalidRequestError", async () => {
      mockFetchJson(
        {
          type: "invalid_request",
          message: "Invalid request",
          errors: {
            amount: ["must be positive"],
          },
        },
        400,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);
    });

    it("maps Moyasar not-found responses to ResourceNotFoundError", async () => {
      mockFetchJson(
        {
          type: "record_not_found",
          message: "Payment was not found",
          errors: null,
        },
        404,
      );

      await expect(
        createGateway().refundPayment({
          gatewayPaymentId: MISSING_PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });

  describe("confirmStcPayOtp", () => {
    it("posts otp_value to the Moyasar STC Pay transaction URL", async () => {
      const transactionUrl =
        "https://api.moyasar.com/v1/stc_pays/6187b1f9-ihn2-457b-a8bc-e2j5c808ff94/proceed?otp_token=abc";
      mockFetchJson(
        paymentResponse({
          status: "paid",
          source: {
            type: "stcpay",
            transaction_url: transactionUrl,
          },
        }),
      );

      const result = await createGateway().confirmStcPayOtp({
        transactionUrl,
        otpValue: "123456",
      });

      expect(fetchCalls[0]?.url).toBe(transactionUrl);
      expect(fetchCalls[0]?.init?.headers).not.toHaveProperty("Authorization");
      expect(lastRequestBody()).toEqual({ otp_value: "123456" });
      expect(result.status).toBe("paid");
    });

    it("runs global lifecycle hooks for OTP confirmation", async () => {
      const transactionUrl =
        "https://api.moyasar.com/v1/stc_pays/6187b1f9-ihn2-457b-a8bc-e2j5c808ff94/proceed?otp_token=abc";
      const operations: string[] = [];
      mockFetchJson(
        paymentResponse({
          status: "paid",
          source: {
            type: "stcpay",
            transaction_url: transactionUrl,
          },
        }),
      );

      await createGateway(CONFIG, {
        onBefore: (ctx) => {
          operations.push(`before:${ctx.operation}`);
          return { proceed: true };
        },
        onAfter: (ctx) => {
          operations.push(`after:${ctx.operation}`);
          return { proceed: true };
        },
      }).confirmStcPayOtp({
        transactionUrl,
        otpValue: "123456",
      });

      expect(operations).toEqual([
        "before:confirmStcPayOtp",
        "after:confirmStcPayOtp",
      ]);
    });

    it("rejects non-Moyasar STC Pay transaction URLs", async () => {
      await expect(
        createGateway().confirmStcPayOtp({
          transactionUrl: "https://example.com/v1/stc_pays/abc/proceed",
          otpValue: "123456",
        }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });
  });

  describe("getPayment", () => {
    it("validates gatewayPaymentId before fetching", async () => {
      await expect(
        createGateway().getPayment({ gatewayPaymentId: "" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("rejects non-UUID Moyasar payment IDs before making API requests", async () => {
      await expect(
        createGateway().getPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().capturePayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().refundPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      await expect(
        createGateway().voidPayment({ gatewayPaymentId: "pay_123" }),
      ).rejects.toBeInstanceOf(InvalidRequestError);

      expect(fetchCalls).toHaveLength(0);
    });

    it("maps fetch failures to NetworkError", async () => {
      mockFetchError(new Error("offline"));

      await expect(
        createGateway().getPayment({ gatewayPaymentId: PAYMENT_ID }),
      ).rejects.toBeInstanceOf(NetworkError);
    });

    it("aborts requests that exceed the configured timeout", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        throw new Error("unreachable");
      }) as typeof fetch;

      await expect(
        createGateway({ ...CONFIG, timeoutMs: 1 }).getPayment({
          gatewayPaymentId: PAYMENT_ID,
        }),
      ).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe("webhooks", () => {
    it("fails closed when webhookSecret is not configured", () => {
      const gateway = createGateway({ secretKey: "sk_test_unit" });

      expect(
        gateway.verifyWebhook({
          secret_token: "anything",
        }),
      ).toBe(false);
    });

    it("verifies secret_token exactly", () => {
      const gateway = createGateway();

      expect(gateway.verifyWebhook({ secret_token: "webhook_secret" })).toBe(true);
      expect(gateway.verifyWebhook({ secret_token: "wrong" })).toBe(false);
      expect(gateway.verifyWebhook({})).toBe(false);
      expect(gateway.verifyWebhook(null)).toBe(false);
    });

    it("rejects malformed webhook payloads during parsing", () => {
      expect(() => createGateway().parseWebhookEvent({})).toThrow(
        InvalidWebhookError,
      );
    });

    it("parses Moyasar underscore event names and currency minor units", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 1234,
          currency: "KWD",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_paid");
      expect(event.status).toBe("paid");
      expect(event.amount).toBe(1.234);
      expect(event.paymentId).toBe("internal_123");
      expect(event.gatewayPaymentId).toBe(PAYMENT_ID);
    });

    it("falls back to metadata.orderId when paymentId is absent", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_paid",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "paid",
          amount: 10000,
          currency: "SAR",
          metadata: {
            orderId: "order_123",
          },
        },
      });

      expect(event.paymentId).toBe("order_123");
    });

    it("maps Moyasar abandoned webhooks to failed status", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_abandoned",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "abandoned",
          amount: 10000,
          currency: "SAR",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_abandoned");
      expect(event.status).toBe("failed");
    });

    it("normalizes Moyasar's documented failed webhook event spelling", () => {
      const event = createGateway().parseWebhookEvent({
        id: "wh_123",
        type: "payment_faild",
        secret_token: "webhook_secret",
        created_at: "2026-05-21T10:00:00Z",
        data: {
          id: PAYMENT_ID,
          status: "failed",
          amount: 10000,
          currency: "SAR",
          metadata: {
            paymentId: "internal_123",
          },
        },
      });

      expect(event.type).toBe("payment_failed");
      expect(event.status).toBe("failed");
    });
  });
});
