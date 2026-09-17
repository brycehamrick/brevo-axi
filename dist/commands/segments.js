import { renderResult } from "../lib/output.js";
import { optionalInt, parseFlags } from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const SEGMENTS_HELP = `brevo-axi segments - list contact segments (read-only)

segments are dynamic selections defined in the Brevo UI; the v3 API can
list them but not create or edit them.

flags:
  --limit <n>      page size (default 20)
  --offset <n>     page offset
  --json           machine-readable JSON

examples:
  brevo-axi segments list`;
const LIST_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
export async function segmentsCommand(args, ctx) {
    const commandPath = "brevo-axi segments list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const limit = optionalInt(values, "limit", { min: 1, max: 50 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/contacts/segments", {
        query: { limit, offset },
    });
    // Brevo returns {} instead of {segments: []} when there are no segments.
    const rows = asRecordArray(payload?.["segments"]);
    const total = asNumber(payload?.["count"]) ?? rows.length;
    const out = {
        count: rows.length,
        total,
        segments: rows.map((row) => compact({
            id: row["id"],
            name: asString(row["name"]),
            contacts: asNumber(row["totalContacts"]),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 segments defined";
        help.push("Create segments in the Brevo UI (Contacts > Segments); the v3 API cannot create them");
    }
    else {
        help.push("Target a segment's contacts: contacts list --segment <id>");
    }
    out["help"] = help;
    return renderResult(out, json);
}
