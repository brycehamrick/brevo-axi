import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  oneOf,
  optionalInt,
  parseIntCsv,
  parseFlags,
  parseJsonFlag,
  requirePositional,
  requireString,
  requireConfirm,
  splitCsv,
  type FlagDefinition,
} from "../lib/args.js";
import { compact, asNumber, asRecord, asRecordArray, asString } from "../lib/coerce.js";
import { snippet, truncateText, truncationHint } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const CONTACTS_HELP = `brevo-axi contacts - manage Brevo contacts

subcommands (read):
  contacts list                     page contacts with optional filters
  contacts get <identifier>         one contact: attributes, lists, blacklists
  contacts stats <identifier>       email campaign statistics for a contact

subcommands (write, require --confirm):
  contacts create                   --email plus attributes and list links
  contacts update <identifier>      patch attributes, link/unlink lists
  contacts delete <identifier>      permanently delete
  contacts import                   bulk import (JSON body escape hatch)
  contacts export                   bulk export (JSON body escape hatch)

identifier: a contact id, email, phone, ext_id... auto-detected; override with
  --identifier-type email_id|contact_id|phone_id|ext_id|whatsapp_id|landline_number_id

list flags:
  --limit <n>            page size (default 20, max 100)
  --offset <n>           0-based page offset
  --filter <text>        prefix search on email
  --lists <csv>          only contacts in these list ids
  --ids <csv>            only these contact ids
  --segment <id>         only contacts in this segment
  --modified-since <iso> e.g. 2026-01-01T00:00:00Z
  --sort asc|desc        by creation date

create flags:
  --email <addr>         required
  --attr <json>          contact attributes, e.g. '{"FIRSTNAME":"Ada"}'
  --lists <csv>          list ids to link
  --update-existing      update instead of erroring when the email exists
  --confirm              required to create

update flags:
  --attr <json>          attributes to merge
  --lists <csv>          list ids to link
  --unlink-lists <csv>   list ids to unlink
  --confirm              required to update

examples:
  brevo-axi contacts list --limit 10
  brevo-axi contacts get ada@example.com
  brevo-axi contacts create --email ada@example.com --attr '{"FIRSTNAME":"Ada"}' --lists 4 --confirm
  brevo-axi contacts update ada@example.com --attr '{"LASTNAME":"Lovelace"}' --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  limit: { type: "string" },
  offset: { type: "string" },
  filter: { type: "string" },
  lists: { type: "string" },
  ids: { type: "string" },
  segment: { type: "string" },
  "modified-since": { type: "string" },
  sort: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = {
  "identifier-type": { type: "string" },
  full: { type: "boolean" },
  json: { type: "boolean" },
};

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  email: { type: "string" },
  attr: { type: "string" },
  lists: { type: "string" },
  "update-existing": { type: "boolean" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  "identifier-type": { type: "string" },
  attr: { type: "string" },
  lists: { type: "string" },
  "unlink-lists": { type: "string" },
  "email-blacklist": { type: "boolean" },
  "sms-blacklist": { type: "boolean" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = {
  "identifier-type": { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const BODY_FLAGS: Record<string, FlagDefinition> = {
  body: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const IDENTIFIER_TYPES = [
  "email_id",
  "contact_id",
  "phone_id",
  "ext_id",
  "whatsapp_id",
  "landline_number_id",
] as const;

export async function contactsCommand(
  args: string[],
  ctx: CommandContext,
): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return contactsList(rest, ctx);
    case "get":
      return contactsGet(rest, ctx);
    case "stats":
      return contactsStats(rest, ctx);
    case "create":
      return contactsCreate(rest, ctx);
    case "update":
      return contactsUpdate(rest, ctx);
    case "delete":
      return contactsDelete(rest, ctx);
    case "import":
      return contactsImport(rest, ctx);
    case "export":
      return contactsExport(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: CONTACTS_HELP };
    default:
      throw new AxiError(
        `unknown contacts subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi contacts --help` to see list, get, stats, create, update, delete, import, export"],
      );
  }
}

/** Contacts default to email identifiers; bare digits mean contact_id. */
function identifierTypeFor(identifier: string, override: string | undefined): string {
  if (override) return override;
  return /^\d+$/.test(identifier) ? "contact_id" : "email_id";
}

async function contactsList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const sort = oneOf(values, "sort", ["asc", "desc"] as const);
  const filter = requireString(values, "filter", commandPath);
  const listIds = splitCsv(values["lists"] as string | undefined);
  const ids = splitCsv(values["ids"] as string | undefined);
  const segment = requireString(values, "segment", commandPath);
  const modifiedSince = requireString(values, "modified-since", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/contacts", {
    query: {
      limit,
      offset,
      sort,
      filter,
      listIds: listIds.length > 0 ? listIds.join(",") : undefined,
      ids: ids.length > 0 ? ids.join(",") : undefined,
      segmentId: segment,
      modifiedSince,
    },
  });

  const rows = asRecordArray(payload?.["contacts"]);
  const total = asNumber(payload?.["count"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    total,
    contacts: rows.map((row) =>
      compact({
        id: row["id"],
        email: asString(row["email"]),
        email_blacklisted: row["emailBlacklisted"] === true,
        created_at: asString(row["createdAt"]),
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 contacts matched";
    help.push("Drop filters, or run `brevo-axi contacts create --email ... --confirm` to add one");
  } else {
    const firstEmail = asString(rows[0]?.["email"]) ?? String(rows[0]?.["id"] ?? "");
    help.push(`Run \`brevo-axi contacts get ${firstEmail}\` for full attributes`);
    if (offset > 0 || rows.length === limit) {
      help.push(`Page through with --offset ${offset + rows.length} (currently offset ${offset})`);
    }
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function contactsGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const identifier = requirePositional(positionals, 0, "identifier", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const identifierType = oneOf(values, "identifier-type", IDENTIFIER_TYPES);
  const full = values["full"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request(
    "GET",
    `/contacts/${encodeURIComponent(identifier)}`,
    { query: { identifierType: identifierTypeFor(identifier, identifierType) } },
  );
  if (!payload) {
    return renderResult({ result: `contact ${identifier} returned no data` }, json);
  }

  if (full) {
    return renderResult({ contact: payload }, json);
  }

  const attributes = asRecord(payload["attributes"]);
  const attrOut: Record<string, unknown> = {};
  let truncatedFields = 0;
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (typeof value === "string") {
      if (value.length > 120) {
        attrOut[key] = truncateText(value, 120).value;
        truncatedFields += 1;
      } else {
        attrOut[key] = value;
      }
    } else {
      attrOut[key] = value;
    }
  }

  return renderResult(
    {
      contact: compact({
        id: payload["id"],
        email: asString(payload["email"]),
        created_at: asString(payload["createdAt"]),
        modified_at: asString(payload["modifiedAt"]),
        email_blacklisted: payload["emailBlacklisted"] === true,
        sms_blacklisted: payload["smsBlacklisted"] === true,
        lists: payload["listIds"],
        attributes: Object.keys(attrOut).length > 0 ? attrOut : undefined,
      }),
      help: [
        "Run `brevo-axi contacts update <identifier> --attr '{...}' --confirm` to change attributes",
        "Run `brevo-axi contacts get <identifier> --full` for the raw payload",
        ...truncationHint(truncatedFields, commandPath),
      ].filter(Boolean),
    },
    json,
  );
}

async function contactsStats(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts stats";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const identifier = requirePositional(positionals, 0, "identifier", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const identifierType = oneOf(values, "identifier-type", IDENTIFIER_TYPES);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request(
    "GET",
    `/contacts/${encodeURIComponent(identifier)}/campaignStats`,
    { query: { identifierType: identifierTypeFor(identifier, identifierType) } },
  );
  const stats = asRecordArray(payload?.["statistics"]);
  const out: Record<string, unknown> = {
    contact: identifier,
    campaigns: stats.map((row) =>
      compact({
        campaign_id: row["campaignId"],
        campaign_name: snippet(asString(row["campaignName"]), 60),
        sent: asNumber(row["messagesSent"]),
        delivered: asNumber(row["delivered"]),
        opened: asNumber(row["opened"]),
        clicked: asNumber(row["clicked"]),
        hard_bounces: asNumber(row["hardBounces"]),
        soft_bounces: asNumber(row["softBounces"]),
        unsubscribed: asNumber(row["unsubscribed"]),
      }),
    ),
  };
  if (stats.length === 0) {
    out["result"] = "0 campaign statistics recorded for this contact";
  }
  out["help"] = [
    "Run `brevo-axi campaigns list` to see the campaigns themselves",
    "Run `brevo-axi contacts get <identifier>` for contact attributes",
  ];
  return renderResult(out, json);
}

async function contactsCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const email = requireString(values, "email", commandPath);
  if (!email) {
    throw new AxiError("contacts create requires --email", "VALIDATION_ERROR", [
      'Example: contacts create --email ada@example.com --attr \'{"FIRSTNAME":"Ada"}\' --confirm',
    ]);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AxiError(`--email is not a valid address: ${email}`, "VALIDATION_ERROR");
  }
  const attributes = parseJsonFlag(values, "attr");
  const listIds = parseIntCsv(values, "lists", { min: 1, max: 1_000_000 });
  const updateExisting = values["update-existing"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const body: Record<string, unknown> = { email, updateEnabled: updateExisting };
  if (attributes) body["attributes"] = attributes;
  if (listIds.length > 0) body["listIds"] = listIds;

  requireConfirm(
    values,
    commandPath,
    `create contact ${email}${listIds.length > 0 ? ` in lists ${listIds.join(",")}` : ""}`,
  );

  const payload = await ctx.client.request("POST", "/contacts", { body });
  const id = payload ? (payload["id"] ?? payload["contactId"]) : undefined;
  return renderResult(
    {
      created: compact({
        email,
        id,
        lists: listIds.length > 0 ? listIds : undefined,
        note:
          updateExisting || id === undefined
            ? "existing contact updated (no new id returned)"
            : undefined,
      }),
      help: [
        "Run `brevo-axi contacts get " + email + "` to verify",
        "Run `brevo-axi lists list` to manage list membership",
      ],
    },
    json,
  );
}

async function contactsUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const identifier = requirePositional(positionals, 0, "identifier", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const identifierType = oneOf(values, "identifier-type", IDENTIFIER_TYPES);
  const attributes = parseJsonFlag(values, "attr");
  const listIds = parseIntCsv(values, "lists", { min: 1, max: 1_000_000 });
  const unlinkListIds = parseIntCsv(values, "unlink-lists", { min: 1, max: 1_000_000 });
  const emailBlacklist = values["email-blacklist"] === true;
  const smsBlacklist = values["sms-blacklist"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  if (!attributes && listIds.length === 0 && unlinkListIds.length === 0 && !emailBlacklist && !smsBlacklist) {
    throw new AxiError(
      "contacts update needs at least one of --attr, --lists, --unlink-lists, --email-blacklist, --sms-blacklist",
      "VALIDATION_ERROR",
      [`Run \`${commandPath} --help\` for usage`],
    );
  }

  const body: Record<string, unknown> = {};
  if (attributes) body["attributes"] = attributes;
  if (listIds.length > 0) body["listIds"] = listIds;
  if (unlinkListIds.length > 0) body["unlinkListIds"] = unlinkListIds;
  if (emailBlacklist) body["emailBlacklisted"] = true;
  if (smsBlacklist) body["smsBlacklisted"] = true;

  const type = identifierTypeFor(identifier, identifierType);
  requireConfirm(
    values,
    commandPath,
    `update contact ${identifier} (${type}) with ${JSON.stringify(body)}`,
  );

  await ctx.client.request("PUT", `/contacts/${encodeURIComponent(identifier)}`, {
    query: { identifierType: type },
    body,
  });
  return renderResult(
    {
      updated: compact({ identifier, lists: listIds.length > 0 ? listIds : undefined, unlink_lists: unlinkListIds.length > 0 ? unlinkListIds : undefined }),
      help: [`Run \`brevo-axi contacts get ${identifier}\` to verify`],
    },
    json,
  );
}

async function contactsDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const identifier = requirePositional(positionals, 0, "identifier", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const identifierType = oneOf(values, "identifier-type", IDENTIFIER_TYPES);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const type = identifierTypeFor(identifier, identifierType);
  requireConfirm(values, commandPath, `permanently delete contact ${identifier} (${type})`);

  await ctx.client.request("DELETE", `/contacts/${encodeURIComponent(identifier)}`, {
    query: { identifierType: type },
  });
  return renderResult(
    {
      deleted: { identifier },
      help: ["Run `brevo-axi contacts list` to confirm the remaining set"],
    },
    json,
  );
}

async function contactsImport(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts import";
  const { values } = parseFlags(args, commandPath, BODY_FLAGS);
  const json = values["json"] === true;
  const body = parseJsonFlag(values, "body");
  requireApiKey(ctx, commandPath);
  if (!body) {
    throw new AxiError(
      "contacts import requires --body <json> (the import request: fileUrl, fileBody, or jsonBody plus listIds)",
      "VALIDATION_ERROR",
      ['Example: --body \'{"jsonBody":[{"email":"a@b.com"}],"listIds":[4]}\''],
    );
  }
  requireConfirm(values, commandPath, `start a contact import with ${JSON.stringify(body).slice(0, 200)}`);
  const payload = await ctx.client.request("POST", "/contacts/import", { body });
  return renderResult(
    {
      import: compact({
        process_id: payload ? payload["processId"] : undefined,
        note: "track completion with `brevo-axi processes get <process_id>`",
      }),
      help: ["Run `brevo-axi processes list` for background job status"],
    },
    json,
  );
}

async function contactsExport(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi contacts export";
  const { values } = parseFlags(args, commandPath, BODY_FLAGS);
  const json = values["json"] === true;
  const body = parseJsonFlag(values, "body");
  requireApiKey(ctx, commandPath);
  if (!body) {
    throw new AxiError(
      "contacts export requires --body <json> (optional export filters; {} exports everyone)",
      "VALIDATION_ERROR",
      ['Example: --body \'{"exportAttributes":["EMAIL","FIRSTNAME"]}\''],
    );
  }
  requireConfirm(values, commandPath, "queue a contact export (result emailed to the account owner)");
  const payload = await ctx.client.request("POST", "/contacts/export", { body });
  return renderResult(
    {
      export: compact({
        process_id: payload ? payload["processId"] : undefined,
        note: "Brevo emails the export link to the account owner when ready",
      }),
      help: ["Run `brevo-axi processes get <process_id>` to check progress"],
    },
    json,
  );
}
