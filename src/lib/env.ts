import { AxiError } from "axi-sdk-js";

export const DEFAULT_API_URL = "https://api.brevo.com/v3";

export interface BrevoConfig {
  /** v3 API key sent as the `api-key` header. */
  apiKey?: string;
  /** HTTPS-only REST base URL. */
  apiUrl: string;
}

/**
 * Validate a user-supplied API base URL. HTTPS only, no embedded credentials,
 * query, or fragment - no localhost exception, because Brevo's v3 API is a
 * public hosted endpoint.
 */
export function validateApiUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AxiError(
      `BREVO_API_URL is not a valid URL: ${redact(raw)}`,
      "VALIDATION_ERROR",
      ["Set BREVO_API_URL=https://api.brevo.com/v3 (default) or another https:// URL"],
    );
  }
  if (parsed.protocol !== "https:") {
    throw new AxiError(
      `BREVO_API_URL must use HTTPS, got protocol ${parsed.protocol}`,
      "VALIDATION_ERROR",
      ["The Brevo v3 API base is https://api.brevo.com/v3"],
    );
  }
  if (parsed.username || parsed.password) {
    throw new AxiError(
      "BREVO_API_URL must not contain embedded credentials",
      "VALIDATION_ERROR",
      ["Pass the API key via the BREVO_API_KEY environment variable instead"],
    );
  }
  if (parsed.search || parsed.hash) {
    throw new AxiError(
      "BREVO_API_URL must not contain query parameters or fragments",
      "VALIDATION_ERROR",
    );
  }
  return parsed.toString();
}

/** Redact anything that looks like a Brevo credential from error text. */
export function redact(text: string, secret?: string): string {
  let out = text.replace(/\bxkeysib-[A-Za-z0-9_-]{8,}\b/g, "***");
  out = out.replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{20,})\b/g, "Bearer ***");
  out = out.replace(/\bapi-key['"]?\s*[:=]\s*['"]?([A-Za-z0-9._~+/=-]{20,})/gi, "api-key: ***");
  if (secret && secret.length >= 4) {
    out = out.split(secret).join("***");
  }
  return out;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): BrevoConfig {
  const rawUrl = env["BREVO_API_URL"]?.trim() || DEFAULT_API_URL;
  const apiUrl = validateApiUrl(rawUrl);
  const apiKey = env["BREVO_API_KEY"]?.trim() || undefined;
  if (apiKey !== undefined && apiKey.length === 0) {
    throw new AxiError(
      "BREVO_API_KEY is set but empty",
      "VALIDATION_ERROR",
      ["Export a real v3 API key (xkeysib-...) from Brevo > SMTP & API > API Keys"],
    );
  }
  return { apiKey, apiUrl };
}
