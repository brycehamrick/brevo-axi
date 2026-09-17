import { resolveConfig } from "./lib/env.js";
import { createBrevoClient } from "./api/client.js";
export function createCommandContext(deps = {}) {
    const config = resolveConfig();
    const client = createBrevoClient(config, deps);
    return { config, client };
}
let cached;
export function getCommandContext() {
    cached ??= createCommandContext();
    return cached;
}
