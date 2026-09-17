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
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const CAMPAIGNS_HELP = `brevo-axi campaigns - manage email marketing campaigns

subcommands (read):
  campaigns list                 campaigns with status
  campaigns get <id>             one campaign with pre-computed statistics

subcommands (write, require --confirm):
  campaigns create               minimal create: name, subject, sender, content, lists
  campaigns update <id> --body   full JSON patch (escape hatch)
  campaigns send <id>            send immediately to the whole audience
  campaigns test <id>            send a test email (max 50/day)
  campaigns status <id>          change status (pause/resume/archive)
  campaigns report <id>          email the campaign report
  campaigns export <id>          export recipients (background job)
  campaigns delete <id>

list flags:
  --status <s>        draft|queued|inReview|suspended|sent|archive
  --limit/--offset    paging

create flags:
  --name --subject --sender-name --sender-email
  --html <text> | --html-url <url> | --template <id>   content source (one)
  --lists <csv>       recipient list ids (required)
  --scheduled-at <iso>, --reply-to, --tag, --utm-campaign optional

examples:
  brevo-axi campaigns list --status draft
  brevo-axi campaigns get 17
  brevo-axi campaigns create --name "Launch" --subject "We ship" \\
      --sender-name Product --sender-email product@example.com \\
      --template 3 --lists 4 --confirm
  brevo-axi campaigns send 17 --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  status: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = {
  full: { type: "boolean" },
  json: { type: "boolean" },
};

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  subject: { type: "string" },
  "sender-name": { type: "string" },
  "sender-email": { type: "string" },
  html: { type: "string" },
  "html-url": { type: "string" },
  template: { type: "string" },
  lists: { type: "string" },
  "scheduled-at": { type: "string" },
  "reply-to": { type: "string" },
  tag: { type: "string" },
  "utm-campaign": { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  body: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const SEND_DELETE_FLAGS: Record<string, FlagDefinition> = {
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const TEST_FLAGS: Record<string, FlagDefinition> = {
  to: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const STATUS_FLAGS: Record<string, FlagDefinition> = {
  status: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const REPORT_FLAGS: Record<string, FlagDefinition> = {
  to: { type: "string" },
  body: { type: "string" },
  language: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const EXPORT_FLAGS: Record<string, FlagDefinition> = {
  "recipients-type": { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const CAMPAIGN_STATUSES = [
  "draft",
  "queued",
  "inReview",
  "suspended",
  "sent",
  "archive",
] as const;

const STATUS_TARGETS = [
  "draft",
  "queued",
  "inReview",
  "suspended",
  "sent",
  "archive",
  "replicateTemplate",
] as const;

export async function campaignsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return campaignsList(rest, ctx);
    case "get":
      return campaignsGet(rest, ctx);
    case "create":
      return campaignsCreate(rest, ctx);
    case "update":
      return campaignsUpdate(rest, ctx);
    case "send":
      return campaignsSend(rest, ctx);
    case "test":
      return campaignsTest(rest, ctx);
    case "status":
      return campaignsStatus(rest, ctx);
    case "report":
      return campaignsReport(rest, ctx);
    case "export":
      return campaignsExport(rest, ctx);
    case "delete":
      return campaignsDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: CAMPAIGNS_HELP };
    default:
      throw new AxiError(
        `unknown campaigns subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi campaigns --help` to see list, get, create, update, send, test, status, report, export, delete"],
      );
  }
}

async function campaignsList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const status = oneOf(values, "status", CAMPAIGN_STATUSES);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/emailCampaigns", {
    query: {
      status,
      limit,
      offset,
      statistics: "summary",
      excludeHtmlContent: true,
    },
  });
  const rows = asRecordArray(payload?.["campaigns"]);
  const total = asNumber(payload?.["count"]);
  const sent = rows.filter((row) => asString(row["status"]) === "sent").length;
  const drafts = rows.filter((row) => asString(row["status"]) === "draft").length;
  const out: Record<string, unknown> = {
    count: rows.length,
    total,
    breakdown: rows.length > 0 ? `${drafts} draft, ${sent} sent` : undefined,
    campaigns: rows.map((row) => {
      const sender = asRecord(row["sender"]);
      return compact({
        id: row["id"],
        name: snippet(asString(row["name"]), 50),
        subject: snippet(asString(row["subject"]), 60),
        status: asString(row["status"]),
        sender: asString(sender?.["email"]),
        created_at: asString(row["createdAt"])?.slice(0, 10),
      });
    }),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = status ? `0 campaigns with status ${status}` : "0 campaigns exist";
    help.push("Run `brevo-axi campaigns create --name ... --confirm` to create one");
  } else {
    help.push("Run `brevo-axi campaigns get <id>` for statistics");
    if (offset > 0 || rows.length === limit) {
      help.push(`Page through with --offset ${offset + rows.length}`);
    }
  }
  out["help"] = help;
  return renderResult(out, json);
}

/** Pre-computed campaign statistics summary (AXI principle 4). */
function statsSummary(stats: Record<string, unknown>): string | undefined {
  const delivered = asNumber(stats["delivered"]);
  if (delivered === undefined) return undefined;
  const sent = asNumber(stats["sent"]) ?? delivered;
  const opened = asNumber(stats["uniqueOpens"]) ?? 0;
  const clicked = asNumber(stats["uniqueClicks"]) ?? 0;
  const bounced = (asNumber(stats["hardBounces"]) ?? 0) + (asNumber(stats["softBounces"]) ?? 0);
  const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");
  return (
    `${sent} sent, ${delivered} delivered (${pct(delivered, sent)}), ` +
    `${opened} opened (${pct(opened, delivered)}), ${clicked} clicked, ${bounced} bounced`
  );
}

async function campaignsGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const full = values["full"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", `/emailCampaigns/${encodeURIComponent(id)}`, {
    query: { statistics: "summary" },
  });
  if (!payload) {
    return renderResult({ result: `campaign ${id} returned no data` }, json);
  }
  if (full) {
    return renderResult({ campaign: payload }, json);
  }
  const stats = asRecord(payload["statistics"]);
  const sender = asRecord(payload["sender"]);
  const recipients = asRecord(payload["recipients"]);
  return renderResult(
    {
      campaign: compact({
        id: payload["id"],
        name: asString(payload["name"]),
        subject: asString(payload["subject"]),
        status: asString(payload["status"]),
        sender: asString(sender?.["email"]),
        audience: recipients?.["listIds"],
        scheduled_at: asString(payload["scheduledAt"]),
        modified_at: asString(payload["modifiedAt"]),
        stats: stats ? statsSummary(stats) : "not sent yet",
      }),
      help: [
        "Run `brevo-axi campaigns send <id> --confirm` to deliver it",
        "Run `brevo-axi campaigns test <id> --to <email> --confirm` for a test send",
        "Run `brevo-axi campaigns get <id> --full` for the raw payload",
      ],
    },
    json,
  );
}

async function campaignsCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const name = requireString(values, "name", commandPath);
  const subject = requireString(values, "subject", commandPath);
  const senderName = requireString(values, "sender-name", commandPath);
  const senderEmail = requireString(values, "sender-email", commandPath);
  const html = requireString(values, "html", commandPath);
  const htmlUrl = requireString(values, "html-url", commandPath);
  const template = optionalInt(values, "template", { min: 1, max: 1_000_000 });
  const listIds = parseIntCsv(values, "lists", { min: 1, max: 1_000_000 });
  const scheduledAt = requireString(values, "scheduled-at", commandPath);
  const replyTo = requireString(values, "reply-to", commandPath);
  const tag = requireString(values, "tag", commandPath);
  const utmCampaign = requireString(values, "utm-campaign", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  if (!name || !subject || !senderName || !senderEmail) {
    throw new AxiError(
      "campaigns create requires --name, --subject, --sender-name, --sender-email",
      "VALIDATION_ERROR",
      [`Run \`${commandPath} --help\` for usage`],
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new AxiError(`--sender-email is not a valid address: ${senderEmail}`, "VALIDATION_ERROR");
  }
  const sources = [html, htmlUrl, template].filter((v) => v !== undefined).length;
  if (sources !== 1) {
    throw new AxiError(
      "campaigns create needs exactly one content source: --html, --html-url, or --template",
      "VALIDATION_ERROR",
    );
  }
  if (listIds.length === 0) {
    throw new AxiError("campaigns create requires --lists <csv> (recipient list ids)", "VALIDATION_ERROR", [
      "Run `brevo-axi lists list` to see list ids",
    ]);
  }

  const body: Record<string, unknown> = {
    name,
    subject,
    sender: { name: senderName, email: senderEmail },
    recipients: { listIds },
  };
  if (html) body["htmlContent"] = html;
  if (htmlUrl) body["htmlUrl"] = htmlUrl;
  if (template !== undefined) body["templateId"] = template;
  if (scheduledAt) body["scheduledAt"] = scheduledAt;
  if (replyTo) body["replyTo"] = replyTo;
  if (tag) body["tag"] = tag;
  if (utmCampaign) body["utmCampaign"] = utmCampaign;

  requireConfirm(
    values,
    commandPath,
    `create campaign "${name}" to lists ${listIds.join(",")} (${listIds.length} list${listIds.length > 1 ? "s" : ""})`,
  );
  const payload = await ctx.client.request("POST", "/emailCampaigns", { body });
  return renderResult(
    {
      created: compact({ id: payload ? payload["id"] : undefined, name, subject, lists: listIds }),
      help: [
        "Run `brevo-axi campaigns test <id> --to <email> --confirm` for a test send",
        "Run `brevo-axi campaigns send <id> --confirm` to deliver to the audience",
      ],
    },
    json,
  );
}

async function campaignsUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const body = parseJsonFlag(values, "body");
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!body) {
    throw new AxiError(
      'campaigns update requires --body <json> (the patch object)',
      "VALIDATION_ERROR",
      ['Example: --body \'{"subject":"New subject"}\''],
    );
  }
  requireConfirm(values, commandPath, `patch campaign ${id} with ${JSON.stringify(body)}`);
  await ctx.client.request("PUT", `/emailCampaigns/${encodeURIComponent(id)}`, { body });
  return renderResult(
    { updated: { id, fields: Object.keys(body) }, help: ["Run `brevo-axi campaigns get <id>` to verify"] },
    json,
  );
}

async function campaignsSend(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns send";
  const { values, positionals } = parseFlags(args, commandPath, SEND_DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(
    values,
    commandPath,
    `send campaign ${id} IMMEDIATELY to its entire audience (consumes email credits)`,
  );
  await ctx.client.request("POST", `/emailCampaigns/${encodeURIComponent(id)}/sendNow`);
  return renderResult(
    {
      sent: { campaign: id },
      help: [
        "Run `brevo-axi campaigns get <id>` later to read the statistics",
        "Run `brevo-axi email events --event opened --days 7` for raw delivery events",
      ],
    },
    json,
  );
}

async function campaignsTest(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns test";
  const { values, positionals } = parseFlags(args, commandPath, TEST_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const to = splitCsv(values["to"] as string | undefined);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (to.length === 0) {
    throw new AxiError("campaigns test requires --to <emails csv>", "VALIDATION_ERROR", [
      "Leave --to empty to use the account test list (max 50 test sends/day)",
    ]);
  }
  requireConfirm(values, commandPath, `send a test of campaign ${id} to ${to.join(", ")}`);
  await ctx.client.request("POST", `/emailCampaigns/${encodeURIComponent(id)}/sendTest`, {
    body: { emailTo: to },
  });
  return renderResult(
    { tested: { campaign: id, to }, help: ["Run `brevo-axi campaigns get <id>` for campaign details"] },
    json,
  );
}

async function campaignsStatus(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns status";
  const { values, positionals } = parseFlags(args, commandPath, STATUS_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const status = oneOf(values, "status", STATUS_TARGETS);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!status) {
    throw new AxiError(
      `campaigns status requires --status (${STATUS_TARGETS.join("|")})`,
      "VALIDATION_ERROR",
    );
  }
  requireConfirm(values, commandPath, `change campaign ${id} status to ${status}`);
  await ctx.client.request("PUT", `/emailCampaigns/${encodeURIComponent(id)}/status`, {
    body: { status },
  });
  return renderResult(
    {
      status: { campaign: id, status },
      help: [
        "suspended pauses a scheduled campaign (draft resumes it)",
        "Run `brevo-axi campaigns get <id>` to verify",
      ],
    },
    json,
  );
}

async function campaignsReport(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns report";
  const { values, positionals } = parseFlags(args, commandPath, REPORT_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const to = splitCsv(values["to"] as string | undefined);
  const body = requireString(values, "body", commandPath);
  const language = oneOf(values, "language", ["en", "fr", "es", "de", "it", "pt"] as const) ?? "en";
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (to.length === 0) {
    throw new AxiError("campaigns report requires --to <emails csv>", "VALIDATION_ERROR");
  }
  requireConfirm(values, commandPath, `email the campaign ${id} report to ${to.join(", ")}`);
  const payloadBody: Record<string, unknown> = { email: { to } };
  if (body) payloadBody["email"] = { to, body };
  payloadBody["language"] = language;
  await ctx.client.request("POST", `/emailCampaigns/${encodeURIComponent(id)}/sendReport`, {
    body: payloadBody,
  });
  return renderResult(
    { report_sent: { campaign: id, to }, help: ["Check the recipients' inbox for the report"] },
    json,
  );
}

async function campaignsExport(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns export";
  const { values, positionals } = parseFlags(args, commandPath, EXPORT_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const recipientsType = oneOf(values, "recipients-type", [
    "all",
    "delivered",
    "opened",
    "clicked",
    "softBounces",
    "hardBounces",
    "unsubscribed",
  ] as const) ?? "all";
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `export ${recipientsType} recipients of campaign ${id}`);
  const payload = await ctx.client.request(
    "POST",
    `/emailCampaigns/${encodeURIComponent(id)}/exportRecipients`,
    { body: { recipientsType } },
  );
  return renderResult(
    {
      export: compact({
        campaign: id,
        recipients_type: recipientsType,
        process_id: payload ? payload["processId"] : undefined,
      }),
      help: ["Run `brevo-axi processes get <process_id>` to watch the export"],
    },
    json,
  );
}

async function campaignsDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi campaigns delete";
  const { values, positionals } = parseFlags(args, commandPath, SEND_DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `permanently delete campaign ${id}`);
  await ctx.client.request("DELETE", `/emailCampaigns/${encodeURIComponent(id)}`);
  return renderResult(
    { deleted: { campaign: id }, help: ["Run `brevo-axi campaigns list` to confirm"] },
    json,
  );
}
