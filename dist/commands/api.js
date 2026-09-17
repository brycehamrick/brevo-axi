import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, oneOf, parseFlags, parseJsonFlag, requirePositional, requireConfirm, splitCsv, } from "../lib/args.js";
import { requireApiKey } from "../lib/auth.js";
export const API_HELP = `brevo-axi api - raw v3 REST escape hatch

usage:
  api get <path> [--query k=v,k2=v2]
  api post|put|patch|delete <path> [--body <json>]     (require --confirm)

<path> is relative to https://api.brevo.com/v3, e.g. contacts/lists/4.
Use this when a command does not exist yet; file an issue for common paths.

examples:
  brevo-axi api get account
  brevo-axi api get contacts/folders/2/lists
  brevo-axi api post smtp/email --body '{"to":[{"email":"a@b.com"}],"subject":"Hi","textContent":"Hi"}' --confirm`;
const GET_FLAGS = {
    query: { type: "string" },
    json: { type: "boolean" },
};
const WRITE_FLAGS = {
    body: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const METHODS = ["get", "post", "put", "patch", "delete"];
export async function apiCommand(args, ctx) {
    const method = oneOf({ method: args[0] }, "method", METHODS);
    if (!method) {
        return { help_text: API_HELP };
    }
    const rest = args.slice(1);
    const commandPath = `brevo-axi api ${method}`;
    const flags = method === "get" ? GET_FLAGS : WRITE_FLAGS;
    const { values, positionals } = parseFlags(rest, commandPath, flags);
    const path = requirePositional(positionals, 0, "path", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!/^[a-zA-Z0-9/_{}.-]+\/?$/.test(path) || path.includes("..")) {
        throw new AxiError(`path must be relative to the v3 base (letters, digits, /, -, _, .), got: ${path}`, "VALIDATION_ERROR", ["Example: contacts/lists/4"]);
    }
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    let query;
    if (values["query"] !== undefined) {
        query = {};
        for (const pair of splitCsv(values["query"])) {
            const [key, value] = pair.split("=");
            if (!key || value === undefined) {
                throw new AxiError(`--query entries must be key=value, got: ${pair}`, "VALIDATION_ERROR");
            }
            query[key] = value;
        }
    }
    let body;
    if (method !== "get" && method !== "delete") {
        body = parseJsonFlag(values, "body");
        if (!body) {
            throw new AxiError(`api ${method} requires --body <json>`, "VALIDATION_ERROR");
        }
    }
    if (method !== "get") {
        requireConfirm(values, commandPath, `${method.toUpperCase()} /${cleanPath}${body ? ` with ${JSON.stringify(body).slice(0, 160)}` : ""}`);
    }
    const payload = await ctx.client.request(method.toUpperCase(), `/${cleanPath}`, { query, body });
    const out = {
        request: `${method.toUpperCase()} /${cleanPath}`,
        response: payload ?? { result: "empty response (204)" },
    };
    out["help"] = [
        "Find endpoints: https://developers.brevo.com/reference/overview",
        "Prefer a dedicated command when one exists (`brevo-axi --help`)",
    ];
    return renderResult(out, json);
}
