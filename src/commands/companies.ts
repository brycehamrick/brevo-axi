import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  optionalInt,
  parseFlags,
  parseJsonFlag,
  requirePositional,
  requireString,
  requireConfirm,
  parseIntCsv,
  oneOf,
  type FlagDefinition,
} from "../lib/args.js";
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const COMPANIES_HELP = `brevo-axi companies - CRM companies

subcommands (read):
  companies list             companies with name and links
  companies get <id>         one company with attributes

subcommands (write, require --confirm):
  companies create           --name required
  companies update <id>      --name and/or --attr <json>
  companies delete <id>

note: companies list pages with --page (1-based), not --offset.

examples:
  brevo-axi companies list --limit 10
  brevo-axi companies create --name "Acme Inc" --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  limit: { type: "string" },
  page: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = { full: { type: "boolean" }, json: { type: "boolean" } };

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  attr: { type: "string" },
  contacts: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  attr: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = { confirm: { type: "boolean" }, json: { type: "boolean" } };

export async function companiesCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return companiesList(rest, ctx);
    case "get":
      return companiesGet(rest, ctx);
    case "create":
      return companiesCreate(rest, ctx);
    case "update":
      return companiesUpdate(rest, ctx);
    case "delete":
      return companiesDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: COMPANIES_HELP };
    default:
      throw new AxiError(
        `unknown companies subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi companies --help` to see list, get, create, update, delete"],
      );
  }
}

function companyRow(row: Record<string, unknown>): Record<string, unknown> {
  const attributes = asRecord(row["attributes"]);
  return compact({
    id: asString(row["id"]),
    name: asString(attributes?.["name"]),
    contacts: Array.isArray(row["linkedContactsIds"])
      ? (row["linkedContactsIds"] as unknown[]).map(String).join(",")
      : undefined,
    deals: Array.isArray(row["linkedDealsIds"])
      ? (row["linkedDealsIds"] as unknown[]).map(String).join(",")
      : undefined,
    created_at: asString(row["createdAt"])?.slice(0, 10),
  });
}

async function companiesList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi companies list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const page = optionalInt(values, "page", { min: 1, max: 10_000 }) ?? 1;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/companies", { query: { limit, page } });
  const rows = asRecordArray(payload?.["items"]);
  const pager = asRecord(payload?.["pager"]);
  const total = asNumber(pager?.["total"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    total,
    companies: rows.map(companyRow),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 companies exist";
    help.push('Run `brevo-axi companies create --name "..." --confirm` to create one');
  } else {
    help.push("Run `brevo-axi companies get <id>` for attributes");
    if (total !== undefined && page * limit < total) {
      help.push(`Page through with --page ${page + 1} (of ${total} total)`);
    }
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function companiesGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi companies get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const full = values["full"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", `/companies/${encodeURIComponent(id)}`);
  if (!payload) {
    return renderResult({ result: `company ${id} returned no data` }, json);
  }
  if (full) {
    return renderResult({ company: payload }, json);
  }
  return renderResult(
    {
      company: companyRow(payload),
      attributes: asRecord(asRecord(payload["attributes"])),
      help: [
        "Run `brevo-axi companies update <id> --attr '{...}' --confirm` to change attributes",
        "Run `brevo-axi companies get <id> --full` for the raw payload",
      ],
    },
    json,
  );
}

async function companiesCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi companies create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const name = requireString(values, "name", commandPath);
  const attr = parseJsonFlag(values, "attr");
  const contacts = parseIntCsv(values, "contacts", { min: 1, max: 1_000_000 });
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name) {
    throw new AxiError("companies create requires --name", "VALIDATION_ERROR");
  }

  const attributes: Record<string, unknown> = { name, ...attr };
  const body: Record<string, unknown> = { name, attributes };
  if (contacts.length > 0) body["linkedContactsIds"] = contacts;

  requireConfirm(values, commandPath, `create company "${name}"`);
  const payload = await ctx.client.request("POST", "/companies", { body });
  return renderResult(
    {
      created: compact({ id: payload ? payload["id"] : undefined, name }),
      help: ["Run `brevo-axi companies get <id>` to verify", "Run `brevo-axi deals create --company <id> ... --confirm` to attach deals"],
    },
    json,
  );
}

async function companiesUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi companies update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const name = requireString(values, "name", commandPath);
  const attr = parseJsonFlag(values, "attr");
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name && !attr) {
    throw new AxiError("companies update needs --name and/or --attr <json>", "VALIDATION_ERROR");
  }

  const attributes: Record<string, unknown> = {};
  if (name) attributes["name"] = name;
  Object.assign(attributes, attr ?? {});
  const body: Record<string, unknown> = { attributes };

  requireConfirm(values, commandPath, `update company ${id} with ${JSON.stringify(body)}`);
  await ctx.client.request("PATCH", `/companies/${encodeURIComponent(id)}`, { body });
  return renderResult(
    { updated: compact({ id, fields: Object.keys(body) }), help: [`Run \`brevo-axi companies get ${id}\` to verify`] },
    json,
  );
}

async function companiesDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi companies delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `permanently delete company ${id}`);
  await ctx.client.request("DELETE", `/companies/${encodeURIComponent(id)}`);
  return renderResult(
    { deleted: { company: id }, help: ["Run `brevo-axi companies list` to confirm"] },
    json,
  );
}
