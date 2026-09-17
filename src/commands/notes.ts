import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  optionalInt,
  parseFlags,
  requirePositional,
  requireString,
  requireConfirm,
  type FlagDefinition,
} from "../lib/args.js";
import { asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { truncateText, truncationHint } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const NOTES_HELP = `brevo-axi notes - CRM notes on contacts and deals

subcommands (read):
  notes list                 notes with entity and date
  notes get <id>             one note with body

subcommands (write, require --confirm):
  notes create               --body <text> plus --contact and/or --deal
  notes update <id>          --body <text>
  notes delete <id>

examples:
  brevo-axi notes list --limit 10
  brevo-axi notes create --body "Called, left voicemail" --contact 24 --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  limit: { type: "string" },
  offset: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = { full: { type: "boolean" }, json: { type: "boolean" } };

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  body: { type: "string" },
  contact: { type: "string" },
  deal: { type: "string" },
  company: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  body: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = { confirm: { type: "boolean" }, json: { type: "boolean" } };

export async function notesCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return notesList(rest, ctx);
    case "get":
      return notesGet(rest, ctx);
    case "create":
      return notesCreate(rest, ctx);
    case "update":
      return notesUpdate(rest, ctx);
    case "delete":
      return notesDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: NOTES_HELP };
    default:
      throw new AxiError(
        `unknown notes subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi notes --help` to see list, get, create, update, delete"],
      );
  }
}

async function notesList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi notes list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/crm/notes", {
    query: { limit, offset, sort: "desc" },
  });
  const rows = asRecordArray(payload?.["items"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    notes: rows.map((row) =>
      compact({
        id: asString(row["id"]),
        text: truncateText(asString(row["text"]) ?? asString(row["body"]) ?? "", 100).value || undefined,
        contact: asString(row["contactId"]),
        deal: asString(row["dealId"]),
        company: asString(row["companyId"]),
        date: asString(row["date"])?.slice(0, 10) ?? asString(row["createdAt"])?.slice(0, 10),
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 notes exist";
    help.push('Run `brevo-axi notes create --body "..." --contact <id> --confirm` to add one');
  } else {
    help.push("Run `brevo-axi notes get <id>` for the full body");
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function notesGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi notes get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const full = values["full"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", `/crm/notes/${encodeURIComponent(id)}`);
  if (!payload) {
    return renderResult({ result: `note ${id} returned no data` }, json);
  }
  if (full) {
    return renderResult({ note: payload }, json);
  }
  const text = asString(payload["text"]) ?? asString(payload["body"]) ?? "";
  const truncated = text.length > 1000;
  return renderResult(
    {
      note: compact({
        id: asString(payload["id"]),
        contact: asString(payload["contactId"]),
        deal: asString(payload["dealId"]),
        company: asString(payload["companyId"]),
        date: asString(payload["date"]),
        text: truncated ? truncateText(text, 1000).value : text,
      }),
      help: [
        "Run `brevo-axi notes update <id> --body ... --confirm` to edit",
        ...truncationHint(truncated ? 1 : 0, commandPath),
      ].filter(Boolean),
    },
    json,
  );
}

async function notesCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi notes create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const body = requireString(values, "body", commandPath);
  const contact = requireString(values, "contact", commandPath);
  const deal = requireString(values, "deal", commandPath);
  const company = requireString(values, "company", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!body) {
    throw new AxiError("notes create requires --body <text>", "VALIDATION_ERROR");
  }
  if (!contact && !deal && !company) {
    throw new AxiError(
      "notes create requires at least one link: --contact, --deal, or --company",
      "VALIDATION_ERROR",
    );
  }

  const requestBody: Record<string, unknown> = { text: body };
  if (contact) requestBody["contactId"] = Number(contact);
  if (deal) requestBody["dealId"] = deal;
  if (company) requestBody["companyId"] = company;

  requireConfirm(values, commandPath, `create a note linked to ${[contact && `contact ${contact}`, deal && `deal ${deal}`, company && `company ${company}`].filter(Boolean).join(", ")}`);
  const payload = await ctx.client.request("POST", "/crm/notes", { body: requestBody });
  return renderResult(
    {
      created: compact({ id: payload ? payload["id"] : undefined }),
      help: ["Run `brevo-axi notes list` to see it"],
    },
    json,
  );
}

async function notesUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi notes update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const body = requireString(values, "body", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!body) {
    throw new AxiError("notes update requires --body <text>", "VALIDATION_ERROR");
  }
  requireConfirm(values, commandPath, `replace note ${id} text`);
  await ctx.client.request("PATCH", `/crm/notes/${encodeURIComponent(id)}`, { body: { text: body } });
  return renderResult(
    { updated: { id }, help: [`Run \`brevo-axi notes get ${id}\` to verify`] },
    json,
  );
}

async function notesDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi notes delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `permanently delete note ${id}`);
  await ctx.client.request("DELETE", `/crm/notes/${encodeURIComponent(id)}`);
  return renderResult(
    { deleted: { note: id }, help: ["Run `brevo-axi notes list` to confirm"] },
    json,
  );
}
