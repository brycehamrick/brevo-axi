import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, oneOf, optionalInt, parseFlags, requirePositional, requireString, splitCsv, } from "../lib/args.js";
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { snippet, truncateText, truncationHint } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
export const EMAIL_HELP = `brevo-axi email - transactional email: send, audit, statistics

subcommands:
  email send                    send one transactional email
  email list                    sent-email log (needs --email, --message-id, or --template)
  email content <uuid>          rendered content of a sent email
  email events                  raw event log: delivered, opened, bounced...
  email stats                   aggregated stats (--daily for per-day rows)
  email scheduled <id>          status of a scheduled batch/message
  email cancel <id>             cancel a scheduled send (--confirm)
  email blocked                 blocklisted recipients; unblock <email> (--confirm)

send flags:
  --to <csv>            recipient emails (first gets the mail; more as cc rows)
  --subject <text>
  --html <text> | --text <text> | --template <id>   content source (one)
  --sender-name/--sender-email   override the Brevo default sender
  --reply-to, --param <json>, --tag, --scheduled-at <iso>, --attach <json>
  --sandbox             validate the request WITHOUT sending (no credits, no mail)
  --confirm             required to actually send (skipped when --sandbox)

stats flags:
  --days <n>            lookback window (default 7; max 90 with --start/--end)
  --start/--end <date>  explicit YYYY-MM-DD range
  --daily               per-day rows instead of one aggregate
  --tag                 filter by tag

examples:
  brevo-axi email send --to ada@example.com --subject "Welcome" \\
      --template 3 --param '{"name":"Ada"}' --sandbox
  brevo-axi email send --to ada@example.com --subject "Hi" --text "Hello" --confirm
  brevo-axi email events --event hard_bounce --days 3
  brevo-axi email stats --days 30 --daily`;
const SEND_FLAGS = {
    to: { type: "string" },
    subject: { type: "string" },
    html: { type: "string" },
    text: { type: "string" },
    template: { type: "string" },
    "sender-name": { type: "string" },
    "sender-email": { type: "string" },
    "reply-to": { type: "string" },
    param: { type: "string" },
    tag: { type: "string" },
    "scheduled-at": { type: "string" },
    attach: { type: "string" },
    sandbox: { type: "boolean" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const LIST_FLAGS = {
    email: { type: "string" },
    "message-id": { type: "string" },
    template: { type: "string" },
    "start-date": { type: "string" },
    "end-date": { type: "string" },
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
const CONTENT_FLAGS = { full: { type: "boolean" }, json: { type: "boolean" } };
const EVENT_FLAGS = {
    event: { type: "string" },
    email: { type: "string" },
    "message-id": { type: "string" },
    template: { type: "string" },
    tag: { type: "string" },
    days: { type: "string" },
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
const STATS_FLAGS = {
    days: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    tag: { type: "string" },
    daily: { type: "boolean" },
    json: { type: "boolean" },
};
const SCHEDULED_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
const CANCEL_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
const BLOCKED_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    "start-date": { type: "string" },
    "end-date": { type: "string" },
    json: { type: "boolean" },
};
const UNBLOCK_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
const EMAIL_EVENTS = [
    "request",
    "delivered",
    "opened",
    "click",
    "hard_bounce",
    "soft_bounce",
    "blocked",
    "spam",
    "invalid",
    "deferred",
    "unsubscribed",
    "error",
    "queued_for_retry",
    "complaint",
];
export async function emailCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "send":
            return emailSend(rest, ctx);
        case "list":
            return emailList(rest, ctx);
        case "content":
            return emailContent(rest, ctx);
        case "events":
            return emailEvents(rest, ctx);
        case "stats":
            return emailStats(rest, ctx);
        case "scheduled":
            return emailScheduled(rest, ctx);
        case "cancel":
            return emailCancel(rest, ctx);
        case "blocked":
            return rest[0] === "unblock" ? emailUnblock(rest.slice(1), ctx) : emailBlocked(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: EMAIL_HELP };
        default:
            throw new AxiError(`unknown email subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi email --help` to see send, list, content, events, stats, scheduled, cancel, blocked"]);
    }
}
async function emailSend(args, ctx) {
    const commandPath = "brevo-axi email send";
    const { values } = parseFlags(args, commandPath, SEND_FLAGS);
    const to = splitCsv(values["to"]);
    const subject = requireString(values, "subject", commandPath);
    const html = requireString(values, "html", commandPath);
    const text = requireString(values, "text", commandPath);
    const template = optionalInt(values, "template", { min: 1, max: 1_000_000 });
    const senderName = requireString(values, "sender-name", commandPath);
    const senderEmail = requireString(values, "sender-email", commandPath);
    const replyTo = requireString(values, "reply-to", commandPath);
    const tag = requireString(values, "tag", commandPath);
    const scheduledAt = requireString(values, "scheduled-at", commandPath);
    const attachRaw = requireString(values, "attach", commandPath);
    const sandbox = values["sandbox"] === true;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (to.length === 0) {
        throw new AxiError("email send requires --to <email or csv>", "VALIDATION_ERROR");
    }
    for (const address of to) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
            throw new AxiError(`--to contains an invalid address: ${address}`, "VALIDATION_ERROR");
        }
    }
    const sources = [html, text, template].filter((v) => v !== undefined).length;
    if (sources !== 1) {
        throw new AxiError("email send needs exactly one content source: --html, --text, or --template", "VALIDATION_ERROR");
    }
    let params;
    if (values["param"] !== undefined) {
        const rawParam = values["param"];
        try {
            const parsed = JSON.parse(rawParam);
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                params = parsed;
            }
        }
        catch {
            throw new AxiError("--param must be a JSON object", "VALIDATION_ERROR");
        }
    }
    let attachment;
    if (attachRaw) {
        try {
            attachment = splitCsv(attachRaw).map((url) => ({ url }));
        }
        catch {
            throw new AxiError("--attach must be url(s)", "VALIDATION_ERROR");
        }
    }
    const body = {
        to: to.map((email) => ({ email })),
        subject: subject ?? "(no subject)",
    };
    if (html)
        body["htmlContent"] = html;
    if (text)
        body["textContent"] = text;
    if (template !== undefined)
        body["templateId"] = template;
    if (replyTo)
        body["replyTo"] = { email: replyTo };
    if (tag)
        body["tags"] = [tag];
    if (params)
        body["params"] = params;
    if (attachment)
        body["attachment"] = attachment;
    if (scheduledAt)
        body["scheduledAt"] = scheduledAt;
    // Gate first (AXI: mutations verified before any network call), then
    // resolve the default sender only when the request will actually run.
    if (!sandbox && values["confirm"] !== true) {
        throw new AxiError("email send requires --confirm (or --sandbox to validate without sending)", "VALIDATION_ERROR", [
            `Would send "${subject ?? "(no subject)"}" to ${to.join(", ")}`,
            "Rerun with --confirm to send, or add --sandbox to validate the request only",
        ]);
    }
    if (senderName || senderEmail) {
        body["sender"] = compact({ name: senderName, email: senderEmail });
    }
    else if (template === undefined) {
        // Brevo requires a sender for raw sends; default to the first active one.
        const senders = await ctx.client.request("GET", "/senders");
        const active = asRecordArray(senders?.["senders"]).find((row) => row["active"] === true);
        const email_ = asString(active?.["email"]);
        if (!email_) {
            throw new AxiError("no active sender on this account and none provided", "VALIDATION_ERROR", [
                "Pass --sender-name/--sender-email, or create a sender:",
                "Run `brevo-axi senders create --name ... --email ... --confirm`",
            ]);
        }
        body["sender"] = compact({ name: asString(active?.["name"]), email: email_ });
    }
    const payload = await ctx.client.request("POST", "/smtp/email", { body, sandbox });
    return renderResult({
        [sandbox ? "validated" : "sent"]: compact({
            to,
            subject: subject ?? "(no subject)",
            template: template ?? undefined,
            message_id: payload ? asString(payload["messageId"]) : undefined,
            scheduled_at: scheduledAt,
            sandbox: sandbox || undefined,
        }),
        help: sandbox
            ? ["Request validated (nothing sent, no credits used)", "Rerun with --confirm and without --sandbox to send"]
            : [
                "Run `brevo-axi email events --message-id <id>` to track delivery",
                "Run `brevo-axi email stats --days 1` for today's rollup",
            ],
    }, json);
}
async function emailList(args, ctx) {
    const commandPath = "brevo-axi email list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const email = requireString(values, "email", commandPath);
    const messageId = requireString(values, "message-id", commandPath);
    const template = optionalInt(values, "template", { min: 1, max: 1_000_000 });
    const startDate = requireString(values, "start-date", commandPath);
    const endDate = requireString(values, "end-date", commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!email && !messageId && template === undefined) {
        throw new AxiError("email list requires at least one filter: --email, --message-id, or --template", "VALIDATION_ERROR", ["Brevo refuses unfiltered transactional log queries"]);
    }
    const payload = await ctx.client.request("GET", "/smtp/emails", {
        query: {
            email,
            messageId,
            templateId: template,
            startDate,
            endDate,
            limit,
            offset,
            sort: "desc",
        },
    });
    const rows = asRecordArray(payload?.["emails"]);
    const count = asNumber(payload?.["count"]);
    const out = {
        count: rows.length,
        total: count,
        emails: rows.map((row) => compact({
            message_id: asString(row["messageId"]),
            template_id: asNumber(row["templateId"]),
            subject: snippet(asString(row["subject"]), 60),
            to: Array.isArray(row["to"])
                ? row["to"]
                    .map((entry) => (typeof entry === "string" ? entry : asRecord(entry)?.["email"]))
                    .filter(Boolean)
                    .slice(0, 3)
                : undefined,
            events: Array.isArray(row["event"])
                ? row["event"]
                    .map((e) => (typeof e === "string" ? e : undefined))
                    .filter(Boolean)
                : undefined,
            date: asString(row["date"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 sent emails matched the filters";
        help.push("Widen the date range or drop filters");
    }
    else {
        help.push("Run `brevo-axi email content <uuid>` for a rendered email body");
        if (offset > 0 || rows.length === limit) {
            help.push(`Page through with --offset ${offset + rows.length}`);
        }
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function emailContent(args, ctx) {
    const commandPath = "brevo-axi email content";
    const { values, positionals } = parseFlags(args, commandPath, CONTENT_FLAGS);
    const uuid = requirePositional(positionals, 0, "uuid", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const full = values["full"] === true;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/smtp/emails/${encodeURIComponent(uuid)}`);
    if (!payload) {
        return renderResult({ result: `email ${uuid} returned no content` }, json);
    }
    if (full) {
        return renderResult({ email: payload }, json);
    }
    let truncatedFields = 0;
    const bodyOut = {};
    for (const key of ["subject", "htmlContent", "textContent"]) {
        const value = asString(payload[key]);
        if (value === undefined)
            continue;
        if (value.length > 800) {
            bodyOut[key === "htmlContent" ? "html" : key === "textContent" ? "text" : key] =
                truncateText(value, 800).value;
            truncatedFields += 1;
        }
        else {
            bodyOut[key === "htmlContent" ? "html" : key === "textContent" ? "text" : key] = value;
        }
    }
    return renderResult({
        email: bodyOut,
        help: [
            "Run `brevo-axi email content <uuid> --full` for the complete raw payload",
            ...truncationHint(truncatedFields, commandPath),
        ].filter(Boolean),
    }, json);
}
async function emailEvents(args, ctx) {
    const commandPath = "brevo-axi email events";
    const { values } = parseFlags(args, commandPath, EVENT_FLAGS);
    const event = oneOf(values, "event", EMAIL_EVENTS);
    const email = requireString(values, "email", commandPath);
    const messageId = requireString(values, "message-id", commandPath);
    const template = optionalInt(values, "template", { min: 1, max: 1_000_000 });
    const tag = requireString(values, "tag", commandPath);
    const days = optionalInt(values, "days", { min: 1, max: 90 }) ?? 7;
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/smtp/statistics/events", {
        query: {
            event,
            email,
            messageId,
            templateId: template,
            tags: tag,
            days,
            limit,
            offset,
            sort: "desc",
        },
    });
    const rows = asRecordArray(payload?.["events"]);
    const counts = new Map();
    for (const row of rows) {
        const name = asString(row["event"]);
        if (name)
            counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const breakdown = [...counts.entries()].map(([name, n]) => `${n} ${name}`).join(", ");
    const out = {
        count: rows.length,
        breakdown: breakdown || undefined,
        events: rows.map((row) => compact({
            date: asString(row["date"]),
            event: asString(row["event"]),
            email: asString(row["email"]),
            subject: snippet(asString(row["subject"]), 50),
            message_id: asString(row["messageId"]),
            reason: snippet(asString(row["reason"]), 80),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 events in the window";
        help.push("Increase --days or drop filters");
    }
    else {
        if (rows.length === limit) {
            help.push(`More may exist \u2014 page with --offset ${offset + rows.length} or raise --limit`);
        }
        help.push("Run `brevo-axi email stats --days " + days + "` for the aggregate view");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function emailStats(args, ctx) {
    const commandPath = "brevo-axi email stats";
    const { values } = parseFlags(args, commandPath, STATS_FLAGS);
    const days = optionalInt(values, "days", { min: 1, max: 90 }) ?? 7;
    const start = requireString(values, "start", commandPath);
    const end = requireString(values, "end", commandPath);
    const tag = requireString(values, "tag", commandPath);
    const daily = values["daily"] === true;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const query = {
        days: start ? undefined : days,
        startDate: start,
        endDate: end,
        tag,
    };
    if (daily) {
        const payload = await ctx.client.request("GET", "/smtp/statistics/reports", { query: { ...query, limit: 60, sort: "desc" } });
        const rows = asRecordArray(payload?.["reports"]);
        const totals = rows.reduce((acc, row) => ({
            requests: acc.requests + (asNumber(row["requests"]) ?? 0),
            delivered: acc.delivered + (asNumber(row["delivered"]) ?? 0),
            opens: acc.opens + (asNumber(row["opens"]) ?? 0),
            clicks: acc.clicks + (asNumber(row["clicks"]) ?? 0),
        }), { requests: 0, delivered: 0, opens: 0, clicks: 0 });
        const out = {
            days: rows.length,
            totals: `${totals.requests} requests, ${totals.delivered} delivered, ${totals.opens} opens, ${totals.clicks} clicks`,
            reports: rows.map((row) => compact({
                date: asString(row["date"]),
                requests: asNumber(row["requests"]),
                delivered: asNumber(row["delivered"]),
                opens: asNumber(row["opens"]),
                clicks: asNumber(row["clicks"]),
                hard_bounces: asNumber(row["hardBounces"]),
                spam: asNumber(row["spamReports"]),
                invalid: asNumber(row["invalid"]),
            })),
        };
        if (rows.length === 0)
            out["result"] = "0 daily reports in the window";
        out["help"] = ["Run `brevo-axi email events --days <n>` for raw events"];
        return renderResult(out, json);
    }
    const payload = await ctx.client.request("GET", "/smtp/statistics/aggregatedReport", { query });
    if (!payload) {
        return renderResult({ result: "no statistics returned for the window" }, json);
    }
    const requests = asNumber(payload["requests"]) ?? 0;
    const delivered = asNumber(payload["delivered"]) ?? 0;
    return renderResult({
        range: asString(payload["range"]),
        summary: `${requests} requests, ${delivered} delivered, ${asNumber(payload["opens"]) ?? 0} opens, ${asNumber(payload["clicks"]) ?? 0} clicks`,
        stats: compact({
            requests,
            delivered,
            hard_bounces: asNumber(payload["hardBounces"]),
            soft_bounces: asNumber(payload["softBounces"]),
            opens: asNumber(payload["opens"]),
            unique_opens: asNumber(payload["uniqueOpens"]),
            clicks: asNumber(payload["clicks"]),
            unique_clicks: asNumber(payload["uniqueClicks"]),
            spam_reports: asNumber(payload["spamReports"]),
            blocked: asNumber(payload["blocked"]),
            invalid: asNumber(payload["invalid"]),
            unsubscribed: asNumber(payload["unsubscribed"]),
        }),
        help: [
            "Run `brevo-axi email stats --daily` for per-day rows",
            "Run `brevo-axi email events --event hard_bounce` to inspect failures",
        ],
    }, json);
}
async function emailScheduled(args, ctx) {
    const commandPath = "brevo-axi email scheduled";
    const { values, positionals } = parseFlags(args, commandPath, SCHEDULED_FLAGS);
    const identifier = requirePositional(positionals, 0, "batchOrMessageId", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/smtp/emailStatus/${encodeURIComponent(identifier)}`, {
        query: { limit, offset, sort: "desc" },
    });
    const rows = asRecordArray(payload?.["emails"]);
    const out = {
        identifier,
        count: rows.length,
        emails: rows.map((row) => compact({
            message_id: asString(row["messageId"]),
            status: asString(row["status"]),
            scheduled_at: asString(row["scheduledAt"]),
            subject: snippet(asString(row["subject"]), 60),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 scheduled emails for this batch/message id";
    }
    else {
        help.push("Run `brevo-axi email cancel <id> --confirm` to cancel scheduled sends");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function emailCancel(args, ctx) {
    const commandPath = "brevo-axi email cancel";
    const { values, positionals } = parseFlags(args, commandPath, CANCEL_FLAGS);
    const identifier = requirePositional(positionals, 0, "batchOrMessageId", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (values["confirm"] !== true) {
        throw new AxiError("email cancel requires --confirm", "VALIDATION_ERROR", [
            `Would cancel scheduled emails for ${identifier}`,
            "Rerun with --confirm to cancel",
        ]);
    }
    await ctx.client.request("DELETE", `/smtp/email/${encodeURIComponent(identifier)}`);
    return renderResult({ canceled: { identifier }, help: ["Run `brevo-axi email scheduled <id>` to verify"] }, json);
}
async function emailBlocked(args, ctx) {
    const commandPath = "brevo-axi email blocked";
    const { values } = parseFlags(args, commandPath, BLOCKED_FLAGS);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const startDate = requireString(values, "start-date", commandPath);
    const endDate = requireString(values, "end-date", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/smtp/blockedContacts", {
        query: { limit, offset, startDate, endDate },
    });
    const rows = asRecordArray(payload?.["contacts"]);
    const count = asNumber(payload?.["count"]);
    const out = {
        count: rows.length,
        total: count,
        blocked: rows.map((row) => compact({
            email: asString(row["email"]),
            reason: snippet(asString(row["reason"]) ?? asString(row["reasonType"]), 60),
            blocked_at: asString(row["blockedAt"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 blocked transactional contacts";
    }
    else {
        help.push("Run `brevo-axi email blocked unblock <email> --confirm` to unblock one");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function emailUnblock(args, ctx) {
    const commandPath = "brevo-axi email blocked unblock";
    const { values, positionals } = parseFlags(args, commandPath, UNBLOCK_FLAGS);
    const email = requirePositional(positionals, 0, "email", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (values["confirm"] !== true) {
        throw new AxiError("email blocked unblock requires --confirm", "VALIDATION_ERROR", [
            `Would unblock ${email} and resubscribe them to transactional email`,
            "Rerun with --confirm to apply",
        ]);
    }
    await ctx.client.request("DELETE", `/smtp/blockedContacts/${encodeURIComponent(email)}`);
    return renderResult({ unblocked: { email }, help: ["Run `brevo-axi email blocked` to verify"] }, json);
}
