import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, optionalInt, parseFlags, parseJsonFlag, requirePositional, requireString, requireConfirm, parseIntCsv, } from "../lib/args.js";
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const DEALS_HELP = `brevo-axi deals - CRM deals

subcommands (read):
  deals list                 deals with name, stage, company, value
  deals get <id>             one deal with attributes and links

subcommands (write, require --confirm):
  deals create               --name required; --stage/--company/--contacts optional
  deals update <id>          --name, --attr <json>, --company, --contacts
  deals delete <id>

list flags:
  --name <text>         filter by deal name (prefix match)
  --stage <name>        filter by pipeline stage name (see \`pipelines list\`)
  --pipeline <name>     filter by pipeline name
  --limit/--offset      paging

examples:
  brevo-axi deals list --limit 10
  brevo-axi deals create --name "New pilot" --stage New --confirm
  brevo-axi deals update 9 --attr '{"deal_value":2500}' --confirm`;
const LIST_FLAGS = {
    name: { type: "string" },
    stage: { type: "string" },
    pipeline: { type: "string" },
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = { full: { type: "boolean" }, json: { type: "boolean" } };
const CREATE_FLAGS = {
    name: { type: "string" },
    stage: { type: "string" },
    attr: { type: "string" },
    company: { type: "string" },
    contacts: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const UPDATE_FLAGS = {
    name: { type: "string" },
    attr: { type: "string" },
    company: { type: "string" },
    contacts: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
export async function dealsCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return dealsList(rest, ctx);
        case "get":
            return dealsGet(rest, ctx);
        case "create":
            return dealsCreate(rest, ctx);
        case "update":
            return dealsUpdate(rest, ctx);
        case "delete":
            return dealsDelete(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: DEALS_HELP };
        default:
            throw new AxiError(`unknown deals subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi deals --help` to see list, get, create, update, delete"]);
    }
}
export function dealRow(row) {
    const attributes = asRecord(row["attributes"]);
    return compact({
        id: asString(row["id"]),
        name: asString(attributes?.["deal_name"]),
        stage: asString(attributes?.["deal_stage"]),
        company: Array.isArray(row["linkedCompaniesIds"])
            ? row["linkedCompaniesIds"].map(String).join(",")
            : undefined,
        contacts: Array.isArray(row["linkedContactsIds"])
            ? row["linkedContactsIds"].map(String).join(",")
            : undefined,
        created_at: asString(row["createdAt"])?.slice(0, 10),
    });
}
async function dealsList(args, ctx) {
    const commandPath = "brevo-axi deals list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const name = requireString(values, "name", commandPath);
    const stage = requireString(values, "stage", commandPath);
    const pipeline = requireString(values, "pipeline", commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/crm/deals", {
        query: {
            "filters[attributes.deal_name]": name,
            "filters[attributes.deal_stage]": stage,
            "filters[attributes.pipeline]": pipeline,
            limit,
            offset,
        },
    });
    const rows = asRecordArray(payload?.["items"]);
    const pager = asRecord(payload?.["pager"]);
    const total = asNumber(pager?.["total"]);
    const out = {
        count: rows.length,
        total,
        deals: rows.map(dealRow),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = stage || name || pipeline ? "0 deals matched the filters" : "0 deals exist";
        help.push('Run `brevo-axi deals create --name "..." --confirm` to create one');
    }
    else {
        help.push("Run `brevo-axi deals get <id>` for full attributes");
        help.push("Run `brevo-axi pipelines list` to see valid stage names");
        if (total !== undefined && offset + rows.length < total) {
            help.push(`Page through with --offset ${offset + rows.length} (of ${total} total)`);
        }
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function dealsGet(args, ctx) {
    const commandPath = "brevo-axi deals get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const full = values["full"] === true;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/crm/deals/${encodeURIComponent(id)}`);
    if (!payload) {
        return renderResult({ result: `deal ${id} returned no data` }, json);
    }
    if (full) {
        return renderResult({ deal: payload }, json);
    }
    return renderResult({
        deal: dealRow(payload),
        attributes: asRecord(asRecord(payload["attributes"])),
        help: [
            "Run `brevo-axi deals update <id> --attr '{...}' --confirm` to change attributes",
            "Run `brevo-axi deals get <id> --full` for the raw payload",
        ],
    }, json);
}
async function dealsCreate(args, ctx) {
    const commandPath = "brevo-axi deals create";
    const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
    const name = requireString(values, "name", commandPath);
    const stage = requireString(values, "stage", commandPath);
    const attr = parseJsonFlag(values, "attr");
    const company = requireString(values, "company", commandPath);
    const contacts = parseIntCsv(values, "contacts", { min: 1, max: 1_000_000 });
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name) {
        throw new AxiError("deals create requires --name", "VALIDATION_ERROR");
    }
    const attributes = { deal_name: name, ...(stage ? { deal_stage: stage } : {}), ...attr };
    const body = { name, attributes };
    if (company)
        body["linkedCompaniesIds"] = [company];
    if (contacts.length > 0)
        body["linkedContactsIds"] = contacts;
    requireConfirm(values, commandPath, `create deal "${name}"${stage ? ` in stage ${stage}` : ""}`);
    const payload = await ctx.client.request("POST", "/crm/deals", { body });
    return renderResult({
        created: compact({ id: payload ? payload["id"] : undefined, name, stage }),
        help: [
            "Run `brevo-axi deals get <id>` to verify",
            "Run `brevo-axi pipelines list` to see valid stages",
        ],
    }, json);
}
async function dealsUpdate(args, ctx) {
    const commandPath = "brevo-axi deals update";
    const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const name = requireString(values, "name", commandPath);
    const attr = parseJsonFlag(values, "attr");
    const stage = requireString(values, "stage", commandPath);
    const company = requireString(values, "company", commandPath);
    const contacts = parseIntCsv(values, "contacts", { min: 1, max: 1_000_000 });
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name && !attr && !stage && !company && contacts.length === 0) {
        throw new AxiError("deals update needs at least one of --name, --stage, --attr, --company, --contacts", "VALIDATION_ERROR");
    }
    const attributes = {};
    if (name)
        attributes["deal_name"] = name;
    if (stage)
        attributes["deal_stage"] = stage;
    Object.assign(attributes, attr ?? {});
    const body = {};
    if (Object.keys(attributes).length > 0) {
        body["name"] = name ?? undefined;
        body["attributes"] = attributes;
    }
    if (company)
        body["linkedCompaniesIds"] = [company];
    if (contacts.length > 0)
        body["linkedContactsIds"] = contacts;
    requireConfirm(values, commandPath, `update deal ${id} with ${JSON.stringify(body)}`);
    await ctx.client.request("PATCH", `/crm/deals/${encodeURIComponent(id)}`, { body });
    return renderResult({ updated: compact({ id, fields: Object.keys(body) }), help: [`Run \`brevo-axi deals get ${id}\` to verify`] }, json);
}
async function dealsDelete(args, ctx) {
    const commandPath = "brevo-axi deals delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `permanently delete deal ${id}`);
    await ctx.client.request("DELETE", `/crm/deals/${encodeURIComponent(id)}`);
    return renderResult({ deleted: { deal: id }, help: ["Run `brevo-axi deals list` to confirm"] }, json);
}
