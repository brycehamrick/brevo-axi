import { resolveConfig, type BrevoConfig } from "./lib/env.js";
import { createBrevoClient, type BrevoClient, type BrevoClientDeps } from "./api/client.js";

/**
 * Shared command context. Commands receive it lazily so `--help` and version
 * probing never construct a client. Tests construct their own with an
 * injected fetch implementation.
 */

export interface CommandContext {
  config: BrevoConfig;
  client: BrevoClient;
}

export function createCommandContext(deps: BrevoClientDeps = {}): CommandContext {
  const config = resolveConfig();
  const client = createBrevoClient(config, deps);
  return { config, client };
}

let cached: CommandContext | undefined;

export function getCommandContext(): CommandContext {
  cached ??= createCommandContext();
  return cached;
}
