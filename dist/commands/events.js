import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { optionalInt, parseFlags, parseJsonFlag, requireString, requireConfirm, } from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const EVENTS_HELP = `brevo-axi events - custom contact events (Brevo Tracker)

subcommands:
  events track                record one event (--confirm)
  events list                 recent events with filters

track flags:
  --email <addr> or --contact <id>   who did it (one required)
  --name <event-name>                required, e.g. "cart_abandoned"
  --date <iso>, --props <json>       optional context

examples:
  brevo-axi events track --email ada@example.com --name cart_abandoned --confirm
  brevo-axi events list --name cart_abandoned --days 7`;
const TRACK_FLAGS = {
    email: { type: "string" },
    contact: { type: "string" },
    name: { type: "string" },
    date: { type: "string" },
    props: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const LIST_FLAGS = {
    name: { type: "string" },
    email: { type: "string" },
    contact: { type: "string" },
    days: { type: "string" },
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
export async function eventsCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "track":
            return eventsTrack(rest, ctx);
        case "list":
            return eventsList(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: EVENTS_HELP };
        default:
            throw new AxiError(`unknown events subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi events --help` to see track, list"]);
    }
}
async function eventsTrack(args, ctx) {
    const commandPath = "brevo-axi events track";
    const { values } = parseFlags(args, commandPath, TRACK_FLAGS);
    const email = requireString(values, "email", commandPath);
    const contact = requireString(values, "contact", commandPath);
    const name = requireString(values, "name", commandPath);
    const date = requireString(values, "date", commandPath);
    const props = parseJsonFlag(values, "props");
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!email && !contact) {
        throw new AxiError("events track requires --email or --contact", "VALIDATION_ERROR");
    }
    if (!name) {
        throw new AxiError("events track requires --name <event-name>", "VALIDATION_ERROR");
    }
    const body = {
        event_name: name,
        identifiers: email ? { email_id: email } : { contact_id: Number(contact) },
    };
    if (date)
        body["event_date"] = date;
    if (props)
        body["event_properties"] = props;
    requireConfirm(values, commandPath, `track event "${name}" for ${email ?? `contact ${contact}`}`);
    await ctx.client.request("POST", "/events", { body });
    return renderResult({
        tracked: compact({ name, email, contact_id: contact }),
        help: [
            "Run `brevo-axi events list --name <name>` to see recorded events",
            "Automation workflows keyed on this event will fire in Brevo",
        ],
    }, json);
}
async function eventsList(args, ctx) {
    const commandPath = "brevo-axi events list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const name = requireString(values, "name", commandPath);
    const email = requireString(values, "email", commandPath);
    const contact = requireString(values, "contact", commandPath);
    const days = optionalInt(values, "days", { min: 1, max: 90 }) ?? 7;
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const payload = await ctx.client.request("GET", "/events", {
        query: {
            event_name: name,
            contact_id: contact,
            startDate: start,
            endDate: end,
            limit,
            offset,
        },
    });
    const rows = asRecordArray(payload?.["events"]);
    const total = asNumber(payload?.["count"]);
    const out = {
        count: rows.length,
        total,
        events: rows.map((row) => compact({
            contact_id: row["contact_id"],
            name: asString(row["event_name"]),
            date: asString(row["event_date"]),
            props: row["event_properties"] !== undefined
                ? JSON.stringify(row["event_properties"]).slice(0, 120)
                : undefined,
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 events in the window";
        help.push("Increase --days or drop filters");
    }
    else {
        help.push("Run `brevo-axi contacts get <contact_id>` for who triggered them");
    }
    out["help"] = help;
    return renderResult(out, json);
}
