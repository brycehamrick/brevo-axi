import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, oneOf, parseFlags, requirePositional, requireString, requireConfirm, splitCsv, } from "../lib/args.js";
import { asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const WEBHOOKS_HELP = `brevo-axi webhooks - event webhooks for transactional and marketing activity

subcommands (read):
  webhooks list                grouped by type (--type transactional|marketing)
  webhooks get <id>            one webhook's config

subcommands (write, require --confirm):
  webhooks create              --url --events <csv> [--type ...] [--description]
  webhooks update <id>         --url and/or --events <csv>
  webhooks delete <id>

event names: sent, hardBounce, softBounce, blocked, spam, delivered, request,
click, invalid, deferred, opened, uniqueOpened, unsubscribed, listAddition,
contactUpdated, contactDeleted, inboundEmailProcessed, reply

examples:
  brevo-axi webhooks list
  brevo-axi webhooks create --url https://example.com/hook \\
      --events delivered,hardBounce,spam --confirm`;
const LIST_FLAGS = {
    type: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = { json: { type: "boolean" } };
const CREATE_FLAGS = {
    url: { type: "string" },
    events: { type: "string" },
    type: { type: "string" },
    description: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const UPDATE_FLAGS = {
    url: { type: "string" },
    events: { type: "string" },
    description: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
const WEBHOOK_EVENTS = [
    "sent",
    "hardBounce",
    "softBounce",
    "blocked",
    "spam",
    "delivered",
    "request",
    "click",
    "invalid",
    "deferred",
    "opened",
    "uniqueOpened",
    "unsubscribed",
    "listAddition",
    "contactUpdated",
    "contactDeleted",
    "inboundEmailProcessed",
    "reply",
];
function requireValidEvents(raw, commandPath) {
    const events = splitCsv(raw);
    if (events.length === 0) {
        throw new AxiError(`${commandPath} requires --events <csv>`, "VALIDATION_ERROR", [
            `Valid events: ${WEBHOOK_EVENTS.join(", ")}`,
        ]);
    }
    for (const event of events) {
        if (!WEBHOOK_EVENTS.includes(event)) {
            throw new AxiError(`unknown webhook event: ${event}`, "VALIDATION_ERROR", [
                `Valid events: ${WEBHOOK_EVENTS.join(", ")}`,
            ]);
        }
    }
    return events;
}
export async function webhooksCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return webhooksList(rest, ctx);
        case "get":
            return webhooksGet(rest, ctx);
        case "create":
            return webhooksCreate(rest, ctx);
        case "update":
            return webhooksUpdate(rest, ctx);
        case "delete":
            return webhooksDelete(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: WEBHOOKS_HELP };
        default:
            throw new AxiError(`unknown webhooks subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi webhooks --help` to see list, get, create, update, delete"]);
    }
}
async function webhooksList(args, ctx) {
    const commandPath = "brevo-axi webhooks list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const type = oneOf(values, "type", ["transactional", "marketing", "inbound"]);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/webhooks", { query: { type } });
    const all = asRecordArray(payload?.["webhooks"]);
    const rows = type ? all.filter((row) => asString(row["type"]) === type) : all;
    const out = {
        count: rows.length,
        webhooks: rows.map((row) => compact({
            id: row["id"],
            url: asString(row["url"]),
            type: asString(row["type"]),
            events: Array.isArray(row["events"])
                ? row["events"].map(String).join(",")
                : undefined,
            description: asString(row["description"]),
            modified_at: asString(row["modifiedAt"])?.slice(0, 10),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = type ? `0 ${type} webhooks` : "0 webhooks configured";
        help.push("Run `brevo-axi webhooks create --url ... --events ... --confirm` to add one");
    }
    else {
        help.push("Run `brevo-axi webhooks get <id>` for the full configuration");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function webhooksGet(args, ctx) {
    const commandPath = "brevo-axi webhooks get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/webhooks/${encodeURIComponent(id)}`);
    if (!payload) {
        return renderResult({ result: `webhook ${id} returned no data` }, json);
    }
    return renderResult({
        webhook: compact({
            id: payload["id"],
            url: asString(payload["url"]),
            type: asString(payload["type"]),
            events: Array.isArray(payload["events"])
                ? payload["events"].map(String).join(",")
                : undefined,
            description: asString(payload["description"]),
            created_at: asString(payload["createdAt"]),
            modified_at: asString(payload["modifiedAt"]),
        }),
        help: [
            "Run `brevo-axi webhooks update <id> --events <csv> --confirm` to change events",
        ],
    }, json);
}
async function webhooksCreate(args, ctx) {
    const commandPath = "brevo-axi webhooks create";
    const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
    const url = requireString(values, "url", commandPath);
    const type = oneOf(values, "type", ["transactional", "marketing"]) ?? "transactional";
    const description = requireString(values, "description", commandPath);
    const events = requireValidEvents(values["events"], commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!url || !/^https:\/\/.+/.test(url)) {
        throw new AxiError("webhooks create requires --url <https URL>", "VALIDATION_ERROR");
    }
    const body = { url, events, type };
    if (description)
        body["description"] = description;
    requireConfirm(values, commandPath, `create ${type} webhook ${url} for ${events.join(",")}`);
    const payload = await ctx.client.request("POST", "/webhooks", { body });
    return renderResult({
        created: compact({ id: payload ? payload["id"] : undefined, url, type, events }),
        help: ["Run `brevo-axi webhooks get <id>` to verify"],
    }, json);
}
async function webhooksUpdate(args, ctx) {
    const commandPath = "brevo-axi webhooks update";
    const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const url = requireString(values, "url", commandPath);
    const description = requireString(values, "description", commandPath);
    const rawEvents = values["events"];
    const events = rawEvents === undefined ? undefined : requireValidEvents(rawEvents, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!url && events === undefined && !description) {
        throw new AxiError("webhooks update needs at least one of --url, --events, --description", "VALIDATION_ERROR");
    }
    const body = {};
    if (url)
        body["url"] = url;
    if (events !== undefined)
        body["events"] = events;
    if (description)
        body["description"] = description;
    requireConfirm(values, commandPath, `update webhook ${id} with ${JSON.stringify(body)}`);
    await ctx.client.request("PUT", `/webhooks/${encodeURIComponent(id)}`, { body });
    return renderResult({ updated: compact({ id, fields: Object.keys(body) }), help: [`Run \`brevo-axi webhooks get ${id}\` to verify`] }, json);
}
async function webhooksDelete(args, ctx) {
    const commandPath = "brevo-axi webhooks delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `delete webhook ${id}`);
    await ctx.client.request("DELETE", `/webhooks/${encodeURIComponent(id)}`);
    return renderResult({ deleted: { webhook: id }, help: ["Run `brevo-axi webhooks list` to confirm"] }, json);
}
