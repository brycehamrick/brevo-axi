import { AxiError } from "axi-sdk-js";
import { redact, type BrevoConfig } from "../lib/env.js";

/**
 * Minimal REST client for the Brevo v3 API (https://api.brevo.com/v3).
 *
 * Auth is the `api-key` header. A explicit User-Agent is mandatory: Brevo sits
 * behind Cloudflare, which answers bare-node fetches on some paths with
 * HTTP 403 "error code: 1010". `X-Sib-Sandbox: drop` (used by
 * `brevo-axi email send --sandbox`) validates a request without delivering.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  /** Query params; undefined and empty-string values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body for POST/PUT/PATCH. */
  body?: unknown;
  timeoutMs?: number;
  /** Add X-Sib-Sandbox: drop so Brevo validates without side effects. */
  sandbox?: boolean;
}

export interface BrevoClient {
  /**
   * Perform one REST call and return the parsed JSON body. 204 responses and
   * empty bodies resolve to null. Structured errors throw AxiError.
   */
  request(method: string, path: string, opts?: RequestOptions): Promise<Record<string, unknown> | null>;
  config: BrevoConfig;
}

export interface BrevoClientDeps {
  fetchImpl?: FetchLike;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string> | undefined;
  body: unknown;
  headers: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createBrevoClient(
  config: BrevoConfig,
  deps: BrevoClientDeps = {},
): BrevoClient {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));

  async function request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Record<string, unknown> | null> {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    // Command code URL-encodes dynamic segments (emails, names), so percent
    // escapes are expected; traversal is blocked separately.
    if (!/^[a-zA-Z0-9/_{}.%-]*\/?$/.test(cleanPath) || cleanPath.includes("..")) {
      throw new AxiError(`invalid API path: ${path}`, "VALIDATION_ERROR");
    }
    const base = config.apiUrl.endsWith("/") ? config.apiUrl : `${config.apiUrl}/`;
    const url = new URL(`${base}${cleanPath}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value === undefined || value === "" || value === false) continue;
      url.searchParams.set(key, String(value));
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "brevo-axi (+https://github.com/brycehamrick/brevo-axi)",
    };
    if (config.apiKey) headers["api-key"] = config.apiKey;
    if (opts.sandbox) headers["X-Sib-Sandbox"] = "drop";

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (isAbort(error)) {
        throw new AxiError(
          `Brevo API request timed out after ${timeoutMs}ms (${method} ${path})`,
          "TIMEOUT",
          ["Retry, or narrow the request with filters"],
        );
      }
      throw new AxiError(
        `Network error reaching Brevo at ${config.apiUrl}: ${redact(String(error), config.apiKey)}`,
        "NETWORK_ERROR",
        ["Check your connection and BREVO_API_URL"],
      );
    }
    clearTimeout(timer);

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw httpError(response.status, bodyText, method, path, config);
    }
    if (bodyText.trim().length === 0) return null;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        // Some list endpoints return bare arrays; wrap for uniform handling.
        return { items: parsed };
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new AxiError(
        `Brevo API returned an unparseable response (${method} ${path}): ${bodyText.slice(0, 200)}`,
        "API_ERROR",
      );
    }
  }

  return { request, config };
}

export function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

interface BrevoErrorShape {
  code?: string;
  message?: string;
}

function parseErrorBody(bodyText: string): BrevoErrorShape {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const shape = parsed as BrevoErrorShape;
      if (typeof shape.code === "string" || typeof shape.message === "string") return shape;
    }
  } catch {
    // Cloudflare HTML error pages land here.
  }
  return {};
}

function httpError(
  status: number,
  bodyText: string,
  method: string,
  path: string,
  config: BrevoConfig,
): AxiError {
  const shape = parseErrorBody(bodyText);
  const code = shape.code ?? "";
  const message = redact(shape.message ?? bodyText.slice(0, 200), config.apiKey);
  const where = `${method} ${path}`;

  if (status === 400) {
    if (code === "missing_parameter" || code === "invalid_parameter" || code === "out_of_range" || code === "duplicate_parameter") {
      return new AxiError(`Brevo rejected ${where}: ${message} [${code}]`, "VALIDATION_ERROR", [
        "Check the command flags against `brevo-axi <command> --help`",
      ]);
    }
    return new AxiError(`Brevo rejected ${where}: ${message}${code ? ` [${code}]` : ""}`, "API_ERROR");
  }
  if (status === 401 || status === 403) {
    return new AxiError(
      `Brevo rejected authentication (HTTP ${status}) for ${where}: ${message}`,
      "AUTH_REQUIRED",
      [
        "Check BREVO_API_KEY (v3 key from Brevo > SMTP & API > API Keys)",
        "If the key is valid, the account may lack permission for this endpoint",
      ],
    );
  }
  if (status === 402) {
    return new AxiError(
      `Brevo account has insufficient credits (HTTP 402) for ${where}: ${message}`,
      "PAYMENT_REQUIRED",
      ["Add credits or upgrade the plan in Brevo billing"],
    );
  }
  if (status === 404) {
    return new AxiError(`Brevo resource not found (HTTP 404) for ${where}: ${message}`, "NOT_FOUND", [
      "Check the id/email argument against `brevo-axi` list output",
    ]);
  }
  if (status === 405) {
    return new AxiError(`Method not allowed (HTTP 405) for ${where}`, "VALIDATION_ERROR");
  }
  if (status === 429) {
    return new AxiError(
      `Brevo rate limit hit (HTTP 429) for ${where}`,
      "RATE_LIMITED",
      ["Wait for the rate-limit window to reset, then retry"],
    );
  }
  return new AxiError(
    `Brevo API HTTP ${status} for ${where}${message ? `: ${message}` : ""}`,
    "API_ERROR",
  );
}
