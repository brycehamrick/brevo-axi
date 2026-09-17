import { renderResult } from "../lib/output.js";
import { parseFlags } from "../lib/args.js";
import { compact, asRecord, asRecordArray, asString } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const ACCOUNT_HELP = `brevo-axi account - Brevo account details

shows the authenticated account: email, name, company, plan, and credits.

flags:
  --json    machine-readable JSON instead of TOON

examples:
  brevo-axi account`;
const FLAGS = { json: { type: "boolean" } };
export async function accountCommand(args, ctx) {
    const commandPath = "brevo-axi account";
    const { values } = parseFlags(args, commandPath, FLAGS);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/account");
    if (!payload) {
        return renderResult({ result: "no account data returned" }, json);
    }
    const plan = asRecordArray(payload["plan"]).map((entry) => compact({
        type: asString(entry["type"]),
        credits: entry["credits"],
        credits_type: asString(entry["creditsType"]),
    }));
    const prefs = asRecord(payload["dateTimePreferences"]);
    const address = asRecord(payload["address"]);
    return renderResult({
        account: compact({
            email: asString(payload["email"]),
            name: [asString(payload["firstName"]), asString(payload["lastName"])]
                .filter(Boolean)
                .join(" ") || undefined,
            company: asString(payload["companyName"]),
            timezone: asString(prefs?.["timezone"]),
            country: asString(address?.["country"]),
            marketing_automation: payload["marketingAutomation"] === undefined
                ? undefined
                : asRecord(payload["marketingAutomation"])?.["enabled"] === true,
            plan,
        }),
        help: [
            "Run `brevo-axi contacts list` to browse the audience",
            "Run `brevo-axi email stats --days 7` for recent sending activity",
        ],
    }, json);
}
