import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, optionalInt, parseFlags, requirePositional, requireString, requireConfirm, oneOf, } from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const FOLDERS_HELP = `brevo-axi folders - organize contact lists into folders

subcommands (read):
  folders list                 all folders with subscriber rollups
  folders get <id>             one folder's details

subcommands (write, require --confirm):
  folders create --name <n>
  folders update <id> --name <n>
  folders delete <id>          deletes the folder AND all lists inside it

examples:
  brevo-axi folders list
  brevo-axi folders create --name "Marketing 2026" --confirm`;
const LIST_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    sort: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = { json: { type: "boolean" } };
const NAME_FLAGS = {
    name: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
export async function foldersCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return foldersList(rest, ctx);
        case "get":
            return foldersGet(rest, ctx);
        case "create":
            return foldersCreate(rest, ctx);
        case "update":
            return foldersUpdate(rest, ctx);
        case "delete":
            return foldersDelete(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: FOLDERS_HELP };
        default:
            throw new AxiError(`unknown folders subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi folders --help` to see list, get, create, update, delete"]);
    }
}
async function foldersList(args, ctx) {
    const commandPath = "brevo-axi folders list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const limit = optionalInt(values, "limit", { min: 1, max: 50 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const sort = oneOf(values, "sort", ["asc", "desc"]);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/contacts/folders", {
        query: { limit, offset, sort },
    });
    const rows = asRecordArray(payload?.["folders"]);
    const total = asNumber(payload?.["count"]);
    const out = {
        count: rows.length,
        total,
        folders: rows.map((row) => compact({
            id: row["id"],
            name: asString(row["name"]),
            subscribers: asNumber(row["totalSubscribers"]),
            blacklisted: asNumber(row["totalBlacklisted"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 folders exist";
        help.push('Run `brevo-axi folders create --name "..." --confirm` to create one');
    }
    else {
        help.push("Run `brevo-axi lists create --name ... --folder <id> --confirm` to add lists to a folder");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function foldersGet(args, ctx) {
    const commandPath = "brevo-axi folders get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/contacts/folders/${encodeURIComponent(id)}`);
    if (!payload) {
        return renderResult({ result: `folder ${id} returned no data` }, json);
    }
    return renderResult({
        folder: compact({
            id: payload["id"],
            name: asString(payload["name"]),
            total_subscribers: asNumber(payload["totalSubscribers"]),
            unique_subscribers: asNumber(payload["uniqueSubscribers"]),
            blacklisted: asNumber(payload["totalBlacklisted"]),
        }),
        help: [
            "Run `brevo-axi lists list` to see which lists sit in folders",
        ],
    }, json);
}
async function foldersCreate(args, ctx) {
    const commandPath = "brevo-axi folders create";
    const { values } = parseFlags(args, commandPath, NAME_FLAGS);
    const name = requireString(values, "name", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name) {
        throw new AxiError("folders create requires --name", "VALIDATION_ERROR");
    }
    requireConfirm(values, commandPath, `create folder "${name}"`);
    const payload = await ctx.client.request("POST", "/contacts/folders", { body: { name } });
    return renderResult({
        created: compact({ id: payload ? payload["id"] : undefined, name }),
        help: ["Run `brevo-axi lists create --name ... --folder <id> --confirm` to fill it"],
    }, json);
}
async function foldersUpdate(args, ctx) {
    const commandPath = "brevo-axi folders update";
    const { values, positionals } = parseFlags(args, commandPath, NAME_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const name = requireString(values, "name", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name) {
        throw new AxiError("folders update requires --name", "VALIDATION_ERROR");
    }
    requireConfirm(values, commandPath, `rename folder ${id} to "${name}"`);
    await ctx.client.request("PUT", `/contacts/folders/${encodeURIComponent(id)}`, { body: { name } });
    return renderResult({ updated: { id, name }, help: ["Run `brevo-axi folders get <id>` to verify"] }, json);
}
async function foldersDelete(args, ctx) {
    const commandPath = "brevo-axi folders delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `delete folder ${id} AND every list inside it (irreversible)`);
    await ctx.client.request("DELETE", `/contacts/folders/${encodeURIComponent(id)}`);
    return renderResult({ deleted: { id }, help: ["Run `brevo-axi folders list` to confirm the remaining set"] }, json);
}
