import type { BrevoClient, RecordedRequest } from "../src/api/client.js";
import type { CommandContext } from "../src/context.js";
import type { BrevoConfig } from "../src/lib/env.js";

export const TEST_CONFIG: BrevoConfig = {
  apiKey: "xkeysib-test",
  apiUrl: "https://api.brevo.com/v3/",
};

export interface Recorded {
  method: string;
  path: string;
  query: Record<string, string> | undefined;
  body: unknown;
  sandbox: boolean;
}

/**
 * Build a CommandContext whose client records every request and replays a
 * queued payload (default: empty object). No network access, ever.
 */
export function contextFor(
  payloads: Array<Record<string, unknown> | null> = [{}],
): { ctx: CommandContext; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const client: BrevoClient = {
    config: TEST_CONFIG,
    request: async (method, path, opts = {}) => {
      calls.push({
        method,
        path,
        query: opts.query as Record<string, string> | undefined,
        body: opts.body,
        sandbox: opts.sandbox === true,
      });
      const payload = payloads[Math.min(index++, payloads.length - 1)];
      return payload === null ? null : payload;
    },
  };
  return { ctx: { config: client.config, client }, calls };
}

export function unauthenticatedContext(): CommandContext {
  return {
    config: { apiUrl: "https://api.brevo.com/v3/" },
    client: {
      config: { apiUrl: "https://api.brevo.com/v3/" },
      request: async () => {
        throw new Error("unauthenticated context must not reach the network");
      },
    },
  };
}

export type { RecordedRequest };
