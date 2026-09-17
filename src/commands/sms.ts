import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  oneOf,
  optionalInt,
  parseFlags,
  requireString,
  requireConfirm,
  type FlagDefinition,
} from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const SMS_HELP = `brevo-axi sms - transactional SMS

subcommands:
  sms send            send one SMS (--confirm; consumes SMS credits)
  sms stats           aggregated sending stats (--daily for per-day rows)
  sms events          raw event log: delivered, hard_bounces...

send flags:
  --to <number>       mobile number with country code, e.g. +33612345678
  --text <message>    message body (160 chars = 1 credit segment)
  --sender <name>     sender name (max 11 alphanumeric / 15 numeric chars)
  --tag, --param <json> optional

examples:
  brevo-axi sms send --to +33612345678 --text "Your code is 1234" --confirm
  brevo-axi sms stats --days 7
  brevo-axi sms events --event hard_bounces`;

const SEND_FLAGS: Record<string, FlagDefinition> = {
  to: { type: "string" },
  text: { type: "string" },
  sender: { type: "string" },
  tag: { type: "string" },
  param: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const STATS_FLAGS: Record<string, FlagDefinition> = {
  days: { type: "string" },
  start: { type: "string" },
  end: { type: "string" },
  tag: { type: "string" },
  daily: { type: "boolean" },
  json: { type: "boolean" },
};

const EVENT_FLAGS: Record<string, FlagDefinition> = {
  event: { type: "string" },
  phone: { type: "string" },
  tag: { type: "string" },
  days: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  json: { type: "boolean" },
};

const SMS_EVENTS = [
  "request",
  "delivered",
  "hard_bounces",
  "soft_bounces",
  "blocked",
  "unsubscribed",
  "rejected",
  "error",
] as const;

export async function smsCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "send":
      return smsSend(rest, ctx);
    case "stats":
      return smsStats(rest, ctx);
    case "events":
      return smsEvents(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: SMS_HELP };
    default:
      throw new AxiError(
        `unknown sms subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi sms --help` to see send, stats, events"],
      );
  }
}

async function smsSend(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi sms send";
  const { values } = parseFlags(args, commandPath, SEND_FLAGS);
  const to = requireString(values, "to", commandPath);
  const text = requireString(values, "text", commandPath);
  const sender = requireString(values, "sender", commandPath);
  const tag = requireString(values, "tag", commandPath);
  const param = requireString(values, "param", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  if (!to || !text) {
    throw new AxiError("sms send requires --to and --text", "VALIDATION_ERROR", [
      'Example: sms send --to +33612345678 --text "Code 1234" --confirm',
    ]);
  }
  const digits = to.replace(/[^\d]/g, "");
  if (digits.length < 6 || digits.length > 15) {
    throw new AxiError(
      `--to must be a mobile number with country code (6-15 digits), got: ${to}`,
      "VALIDATION_ERROR",
    );
  }
  let params: Record<string, unknown> | undefined;
  if (param) {
    try {
      const parsed: unknown = JSON.parse(param);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        params = parsed as Record<string, unknown>;
      }
    } catch {
      throw new AxiError("--param must be a JSON object", "VALIDATION_ERROR");
    }
  }

  const body: Record<string, unknown> = { recipient: to, content: text, type: "transactional" };
  if (sender) body["sender"] = sender;
  if (tag) body["tag"] = tag;
  if (params) body["params"] = params;

  requireConfirm(
    values,
    commandPath,
    `send SMS to ${to} (${text.length} chars \u2248 ${Math.max(1, Math.ceil(text.length / 160))} credit segment(s))`,
  );

  const payload = await ctx.client.request("POST", "/transactionalSMS/send", { body });
  return renderResult(
    {
      sent: compact({
        to,
        message_id: payload ? asString(payload["messageId"]) ?? asString(payload["reference"]) : undefined,
        segments: Math.max(1, Math.ceil(text.length / 160)),
      }),
      help: [
        "Run `brevo-axi sms events --phone " + to + "` to track delivery",
        "Run `brevo-axi sms stats --days 1` for today's rollup",
      ],
    },
    json,
  );
}

async function smsStats(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi sms stats";
  const { values } = parseFlags(args, commandPath, STATS_FLAGS);
  const days = optionalInt(values, "days", { min: 1, max: 90 }) ?? 7;
  const start = requireString(values, "start", commandPath);
  const end = requireString(values, "end", commandPath);
  const tag = requireString(values, "tag", commandPath);
  const daily = values["daily"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const query = { days: start ? undefined : days, startDate: start, endDate: end, tag };
  const path = daily ? "/transactionalSMS/statistics/reports" : "/transactionalSMS/statistics/aggregatedReport";
  const payload = await ctx.client.request("GET", path, { query: daily ? { ...query, sort: "desc" } : query });

  if (daily) {
    const rows = asRecordArray(payload?.["reports"]);
    const out: Record<string, unknown> = {
      days: rows.length,
      reports: rows.map((row) =>
        compact({
          date: asString(row["date"]),
          requests: asNumber(row["requests"]),
          delivered: asNumber(row["delivered"]),
          hard_bounces: asNumber(row["hardBounces"]),
          soft_bounces: asNumber(row["softBounces"]),
          blocked: asNumber(row["blocked"]),
          unsubscribed: asNumber(row["unsubscribed"]),
          rejected: asNumber(row["rejected"]),
        }),
      ),
    };
    if (rows.length === 0) out["result"] = "0 daily SMS reports in the window";
    out["help"] = ["Run `brevo-axi sms events --days <n>` for raw events"];
    return renderResult(out, json);
  }

  if (!payload) {
    return renderResult({ result: "no SMS statistics returned for the window" }, json);
  }
  const requests = asNumber(payload["requests"]) ?? 0;
  const delivered = asNumber(payload["delivered"]) ?? 0;
  return renderResult(
    {
      range: asString(payload["range"]),
      summary: `${requests} requests, ${delivered} delivered, ${asNumber(payload["hardBounces"]) ?? 0} hard bounces`,
      stats: compact({
        requests,
        delivered,
        hard_bounces: asNumber(payload["hardBounces"]),
        soft_bounces: asNumber(payload["softBounces"]),
        blocked: asNumber(payload["blocked"]),
        unsubscribed: asNumber(payload["unsubscribed"]),
        rejected: asNumber(payload["rejected"]),
      }),
      help: [
        "Run `brevo-axi sms stats --daily` for per-day rows",
        "Run `brevo-axi sms events --event hard_bounces` to inspect failures",
      ],
    },
    json,
  );
}

async function smsEvents(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi sms events";
  const { values } = parseFlags(args, commandPath, EVENT_FLAGS);
  const event = oneOf(values, "event", SMS_EVENTS);
  const phone = requireString(values, "phone", commandPath);
  const tag = requireString(values, "tag", commandPath);
  const days = optionalInt(values, "days", { min: 1, max: 90 }) ?? 7;
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/transactionalSMS/statistics/events", {
    query: { event, phoneNumber: phone, tags: tag, days, limit, offset, sort: "desc" },
  });
  const rows = asRecordArray(payload?.["events"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    events: rows.map((row) =>
      compact({
        date: asString(row["date"]),
        event: asString(row["event"]),
        phone: asString(row["phoneNumber"]),
        message_id: asString(row["messageId"]),
        reason: snippet(asString(row["reason"]), 80),
        tag: asString(row["tag"]),
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 SMS events in the window";
    help.push("Increase --days or drop filters; SMS may not be enabled on this account");
  } else if (rows.length === limit) {
    help.push(`More may exist \u2014 page with --offset ${offset + rows.length} or raise --limit`);
  }
  out["help"] = help;
  return renderResult(out, json);
}
