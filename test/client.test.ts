import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  createBrevoClient,
  isAbort,
  type RecordedRequest,
} from "../src/api/client.js";
import { resolveConfig, validateApiUrl, redact } from "../src/lib/env.js";
import type { BrevoConfig } from "../src/lib/env.js";

const CONFIG: BrevoConfig = {
  apiKey: "xkeysib-test-key-1234567890",
  apiUrl: "https://api.brevo.com/v3",
};

function recordingClient(
  responder: (req: RecordedRequest) => { status: number; body: string } | { status: number },
) {
  const calls: RecordedRequest[] = [];
  const client = createBrevoClient(CONFIG, {
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const query: Record<string, string> = {};
      for (const [key, value] of parsed.searchParams.entries()) query[key] = value;
      const req: RecordedRequest = {
        method: init.method ?? "GET",
        path: parsed.pathname.replace(/^\/v3/, ""),
        query,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(req);
      const result = responder(req);
      return new Response("body" in result ? result.body : null, {
        status: result.status,
      });
    },
  });
  return { client, calls };
}

describe("client", () => {
  it("joins paths onto the /v3 base without losing it", async () => {
    const { client, calls } = recordingClient(() => ({ status: 200, body: "{}" }));
    await client.request("GET", "/account");
    expect(calls[0]?.path).toBe("/account");
  });

  it("sends api-key, user-agent, and json headers", async () => {
    const { client, calls } = recordingClient(() => ({ status: 200, body: "{}" }));
    await client.request("GET", "/contacts");
    const headers = calls[0]?.headers ?? {};
    expect(headers["api-key"]).toBe(CONFIG.apiKey);
    expect(headers["user-agent"]).toMatch(/^brevo-axi/);
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sets query params and drops empty ones", async () => {
    const { client, calls } = recordingClient(() => ({ status: 200, body: "{}" }));
    await client.request("GET", "/contacts", {
      query: { limit: 10, offset: 0, filter: undefined, segment: "" },
    });
    const query = calls[0]?.query ?? {};
    expect(query["limit"]).toBe("10");
    expect(query["offset"]).toBe("0");
    expect(Object.keys(query)).toEqual(["limit", "offset"]);
  });

  it("adds the X-Sib-Sandbox header in sandbox mode", async () => {
    const { client, calls } = recordingClient(() => ({
      status: 201,
      body: '{"messageId":"m1"}',
    }));
    await client.request("POST", "/smtp/email", { body: {}, sandbox: true });
    expect(calls[0]?.headers["X-Sib-Sandbox"]).toBe("drop");
  });

  it("returns null for 204 and empty bodies", async () => {
    const { client } = recordingClient(() => ({ status: 204 }));
    expect(await client.request("DELETE", "/contacts/1")).toBeNull();
  });

  it("wraps bare array responses as {items}", async () => {
    const { client } = recordingClient(() => ({
      status: 200,
      body: '[{"id":"a"},{"id":"b"}]',
    }));
    const payload = await client.request("GET", "/crm/notes");
    expect(payload).toEqual({ items: [{ id: "a" }, { id: "b" }] });
  });

  it("rejects path traversal", async () => {
    const { client } = recordingClient(() => ({ status: 200, body: "{}" }));
    await expect(client.request("GET", "/../account")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("maps Brevo error codes to AxiError codes", async () => {
    const cases: Array<[number, string, string]> = [
      [400, '{"code":"invalid_parameter","message":"bad"}', "VALIDATION_ERROR"],
      [400, '{"code":"missing_parameter","message":"missing"}', "VALIDATION_ERROR"],
      [401, '{"code":"unauthorized","message":"key"}', "AUTH_REQUIRED"],
      [402, '{"code":"not_enough_credits","message":"credits"}', "PAYMENT_REQUIRED"],
      [403, '{"message":"denied"}', "AUTH_REQUIRED"],
      [404, '{"code":"document_not_found","message":"gone"}', "NOT_FOUND"],
      [429, '{"message":"slow down"}', "RATE_LIMITED"],
      [500, '{"message":"boom"}', "API_ERROR"],
    ];
    for (const [status, body, code] of cases) {
      const { client } = recordingClient(() => ({ status, body }));
      await expect(client.request("GET", "/contacts")).rejects.toMatchObject({ code });
    }
  });

  it("redacts the api key from error text", async () => {
    const { client } = recordingClient(() => ({
      status: 400,
      body: `{"code":"invalid_parameter","message":"key ${CONFIG.apiKey} leaked"}`,
    }));
    const error = await client.request("GET", "/contacts").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AxiError);
    expect(String((error as Error).message)).not.toContain(CONFIG.apiKey);
  });

  it("maps aborts to TIMEOUT and network failures to NETWORK_ERROR", async () => {
    const aborting = createBrevoClient(CONFIG, {
      fetchImpl: async () => {
        throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      },
    });
    await expect(aborting.request("GET", "/contacts")).rejects.toMatchObject({ code: "TIMEOUT" });

    const offline = createBrevoClient(CONFIG, {
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    await expect(offline.request("GET", "/contacts")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("detects abort-shaped errors from other runtimes", () => {
    expect(isAbort(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbort(new Error("fetch failed"))).toBe(false);
  });
});

describe("env", () => {
  it("rejects non-https API URLs", () => {
    expect(() => validateApiUrl("http://api.brevo.com/v3")).toThrow(AxiError);
    expect(() => validateApiUrl("https://user:pass@api.brevo.com/v3")).toThrow(AxiError);
    expect(() => validateApiUrl("https://api.brevo.com/v3?x=1")).toThrow(AxiError);
    expect(validateApiUrl("https://api.brevo.com/v3")).toBe("https://api.brevo.com/v3");
  });

  it("reads BREVO_API_KEY and BREVO_API_URL from the environment", () => {
    const config = resolveConfig({ BREVO_API_KEY: "xkeysib-zzz", BREVO_API_URL: "https://api.brevo.com/v3" });
    expect(config.apiKey).toBe("xkeysib-zzz");
    expect(config.apiUrl).toBe("https://api.brevo.com/v3");
  });

  it("defaults to the public API base without a key", () => {
    const config = resolveConfig({});
    expect(config.apiKey).toBeUndefined();
    expect(config.apiUrl).toBe("https://api.brevo.com/v3");
  });

  it("redacts xkeysib-style keys in free text", () => {
    expect(redact("leaked xkeysib-abc123def456 here")).not.toContain("xkeysib-abc123def456");
    expect(redact("Bearer supersecrettokenvalue123456")).not.toContain("supersecrettokenvalue");
  });
});
