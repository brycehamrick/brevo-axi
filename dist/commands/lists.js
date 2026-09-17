import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, optionalInt, parseIntCsv, parseFlags, requirePositional, requireString, requireConfirm, oneOf, } from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const LISTS_HELP = `brevo-axi lists - manage contact lists

subcommands (read):
  lists list                   all lists with subscriber counts
  lists get <id>               one list: counts, folder, creation
  lists contacts <id>          contacts in a list (paged)

subcommands (write, require --confirm):
  lists create --name <n>      optionally inside --folder <id>
  lists update <id>            rename and/or move to a folder
  lists delete <id>            delete the list (contacts are not deleted)
  lists add <id> --ids <csv>   link existing contacts by id
  lists remove <id> --ids <csv> unlink contacts by id

examples:
  brevo-axi lists list
  brevo-axi lists contacts 4 --limit 10
  brevo-axi lists create --name "Newsletter" --folder 2 --confirm
  brevo-axi lists add 4 --ids 12,13 --confirm`;
const LIST_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    sort: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = { json: { type: "boolean" } };
const CONTACTS_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    "modified-since": { type: "string" },
    sort: { type: "string" },
    json: { type: "boolean" },
};
const CREATE_FLAGS = {
    name: { type: "string" },
    folder: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const UPDATE_FLAGS = {
    name: { type: "string" },
    folder: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const MEMBERSHIP_FLAGS = {
    ids: { type: "string" },
    emails: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
export async function listsCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return listsList(rest, ctx);
        case "get":
            return listsGet(rest, ctx);
        case "contacts":
            return listsContacts(rest, ctx);
        case "create":
            return listsCreate(rest, ctx);
        case "update":
            return listsUpdate(rest, ctx);
        case "delete":
            return listsDelete(rest, ctx);
        case "add":
            return listsMembership("add", rest, ctx);
        case "remove":
            return listsMembership("remove", rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: LISTS_HELP };
        default:
            throw new AxiError(`unknown lists subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi lists --help` to see list, get, contacts, create, update, delete, add, remove"]);
    }
}
async function listsList(args, ctx) {
    const commandPath = "brevo-axi lists list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const limit = optionalInt(values, "limit", { min: 1, max: 50 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const sort = oneOf(values, "sort", ["asc", "desc"]);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/contacts/lists", {
        query: { limit, offset, sort },
    });
    const rows = asRecordArray(payload?.["lists"]);
    const total = asNumber(payload?.["count"]);
    const subscribers = rows.reduce((sum, row) => sum + (asNumber(row["totalSubscribers"]) ?? 0), 0);
    const out = {
        count: rows.length,
        total,
        total_subscribers: rows.length > 0 ? subscribers : 0,
        lists: rows.map((row) => compact({
            id: row["id"],
            name: asString(row["name"]),
            subscribers: asNumber(row["totalSubscribers"]),
            blacklisted: asNumber(row["totalBlacklisted"]),
            folder: asNumber(row["folderId"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 lists exist";
        help.push('Run `brevo-axi lists create --name "..." --confirm` to create one');
    }
    else {
        help.push("Run `brevo-axi lists contacts <id>` to see members");
        if (offset > 0 || rows.length === limit) {
            help.push(`Page through with --offset ${offset + rows.length}`);
        }
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function listsGet(args, ctx) {
    const commandPath = "brevo-axi lists get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/contacts/lists/${encodeURIComponent(id)}`);
    if (!payload) {
        return renderResult({ result: `list ${id} returned no data` }, json);
    }
    return renderResult({
        list: compact({
            id: payload["id"],
            name: asString(payload["name"]),
            subscribers: asNumber(payload["totalSubscribers"]),
            unique_subscribers: asNumber(payload["uniqueSubscribers"]),
            blacklisted: asNumber(payload["totalBlacklisted"]),
            folder: asNumber(payload["folderId"]),
            created_at: asString(payload["createdAt"]),
            dynamic: payload["dynamicList"] === true,
        }),
        help: [
            "Run `brevo-axi lists contacts <id>` to see members",
            "Run `brevo-axi lists add <id> --ids <csv> --confirm` to link contacts",
        ],
    }, json);
}
async function listsContacts(args, ctx) {
    const commandPath = "brevo-axi lists contacts";
    const { values, positionals } = parseFlags(args, commandPath, CONTACTS_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const modifiedSince = requireString(values, "modified-since", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/contacts/lists/${encodeURIComponent(id)}/contacts`, { query: { limit, offset, modifiedSince } });
    const rows = asRecordArray(payload?.["contacts"]);
    const count = asNumber(payload?.["count"]);
    const out = {
        list: id,
        count: rows.length,
        total: count,
        contacts: rows.map((row) => compact({
            id: row["id"],
            email: asString(row["email"]),
            email_blacklisted: row["emailBlacklisted"] === true,
            created_at: asString(row["createdAt"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 contacts in this list";
        help.push("Run `brevo-axi lists add <id> --ids <csv> --confirm` to link contacts");
    }
    else {
        if (offset > 0 || rows.length === limit) {
            help.push(`Page through with --offset ${offset + rows.length}`);
        }
        help.push("Run `brevo-axi contacts get <email>` for full attributes");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function listsCreate(args, ctx) {
    const commandPath = "brevo-axi lists create";
    const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
    const name = requireString(values, "name", commandPath);
    if (!name) {
        throw new AxiError("lists create requires --name", "VALIDATION_ERROR", [
            'Example: lists create --name "Newsletter" --confirm',
        ]);
    }
    const folder = optionalInt(values, "folder", { min: 1, max: 1_000_000 });
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `create list "${name}"${folder ? ` in folder ${folder}` : ""}`);
    const body = { name };
    if (folder !== undefined)
        body["folderId"] = folder;
    const payload = await ctx.client.request("POST", "/contacts/lists", { body });
    return renderResult({
        created: compact({ id: payload ? payload["id"] : undefined, name, folder }),
        help: [
            "Run `brevo-axi lists add <id> --ids <csv> --confirm` to populate it",
            "Run `brevo-axi contacts create --email ... --lists <id> --confirm` to add new contacts",
        ],
    }, json);
}
async function listsUpdate(args, ctx) {
    const commandPath = "brevo-axi lists update";
    const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const name = requireString(values, "name", commandPath);
    const folder = optionalInt(values, "folder", { min: 1, max: 1_000_000 });
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name && folder === undefined) {
        throw new AxiError("lists update needs --name and/or --folder", "VALIDATION_ERROR");
    }
    const body = {};
    if (name)
        body["name"] = name;
    if (folder !== undefined)
        body["folderId"] = folder;
    requireConfirm(values, commandPath, `update list ${id} with ${JSON.stringify(body)}`);
    await ctx.client.request("PUT", `/contacts/lists/${encodeURIComponent(id)}`, { body });
    return renderResult({
        updated: compact({ id, name, folder }),
        help: ["Run `brevo-axi lists get <id>` to verify"],
    }, json);
}
async function listsDelete(args, ctx) {
    const commandPath = "brevo-axi lists delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `delete list ${id} (contacts survive, but their list membership is lost)`);
    await ctx.client.request("DELETE", `/contacts/lists/${encodeURIComponent(id)}`);
    return renderResult({
        deleted: { id },
        help: ["Run `brevo-axi lists list` to confirm the remaining set"],
    }, json);
}
async function listsMembership(action, args, ctx) {
    const commandPath = `brevo-axi lists ${action}`;
    const { values, positionals } = parseFlags(args, commandPath, MEMBERSHIP_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const ids = parseIntCsv(values, "ids", { min: 1, max: 1_000_000 });
    const emails = values["emails"]?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (ids.length === 0 && emails.length === 0) {
        throw new AxiError(`lists ${action} requires --ids <csv> or --emails <csv>`, "VALIDATION_ERROR", [
            `Example: lists ${action} 4 --ids 12,13 --confirm`,
        ]);
    }
    const body = {};
    if (ids.length > 0)
        body["ids"] = ids;
    if (emails.length > 0)
        body["emails"] = emails;
    requireConfirm(values, commandPath, `${action} ${ids.length > 0 ? `ids ${ids.join(",")}` : emails.length} ${ids.length > 0 ? "contacts" : "contacts by email"} ${action === "add" ? "to" : "from"} list ${id}`);
    const payload = await ctx.client.request("POST", `/contacts/lists/${encodeURIComponent(id)}/contacts/${action}`, { body });
    return renderResult({
        [action === "add" ? "added" : "removed"]: compact({
            list: id,
            ids: ids.length > 0 ? ids : undefined,
            emails: emails.length > 0 ? emails : undefined,
            payload: payload && Object.keys(payload).length > 0 ? payload : undefined,
        }),
        help: [`Run \`brevo-axi lists contacts ${id}\` to verify`],
    }, json);
}
