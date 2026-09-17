import { asNumber, asRecordArray, asString } from "../lib/coerce.js";
/**
 * AXI principles 7, 8, 9: the no-argument home view is live content, not
 * help. Unauthenticated runs make zero network calls; authenticated runs make
 * exactly three cheap calls (account, contacts count, lists count) and degrade
 * gracefully when any of them fails.
 */
export async function homeCommand(_args, ctx) {
    const authed = ctx.config.apiKey !== undefined;
    const out = {
        auth: authed ? "api-key" : "none",
    };
    if (!authed) {
        out["setup"] = "export BREVO_API_KEY=xkeysib-... (Brevo > SMTP & API > API Keys)";
        out["commands"] =
            "account contacts lists folders attributes segments campaigns email templates sms deals companies tasks notes pipelines senders domains webhooks events processes api setup";
        out["help"] = [
            "Run `brevo-axi --help` for the command list",
            "Export BREVO_API_KEY to unlock live data",
            "Run `brevo-axi setup hooks` for ambient context in every session",
        ];
        return out;
    }
    try {
        const account = await ctx.client.request("GET", "/account", { timeoutMs: 10_000 });
        if (account) {
            const plan = asRecordArray(account["plan"]);
            const first = plan[0];
            out["account"] = asString(account["email"]) ?? "unknown";
            out["plan"] = first
                ? `${asString(first["type"]) ?? "unknown"} (${asNumber(first["credits"]) ?? 0} credits)`
                : "none";
        }
    }
    catch {
        out["account"] = "unavailable (run `brevo-axi account` to see the error)";
    }
    try {
        const contacts = await ctx.client.request("GET", "/contacts", {
            query: { limit: 1, offset: 0 },
            timeoutMs: 10_000,
        });
        out["contacts"] = contacts ? `${asNumber(contacts["count"]) ?? 0} total` : "0 total";
    }
    catch {
        out["contacts"] = "unknown (run `brevo-axi contacts list`)";
    }
    try {
        const lists = await ctx.client.request("GET", "/contacts/lists", {
            query: { limit: 1, offset: 0 },
            timeoutMs: 10_000,
        });
        out["lists"] = lists ? `${asNumber(lists["count"]) ?? 0} total` : "0 total";
    }
    catch {
        out["lists"] = "unknown (run `brevo-axi lists list`)";
    }
    out["commands"] =
        "account contacts lists folders attributes segments campaigns email templates sms deals companies tasks notes pipelines senders domains webhooks events processes api setup";
    out["help"] = [
        'Run `brevo-axi contacts list --limit 20` to browse contacts',
        'Run `brevo-axi campaigns list` to review marketing campaigns',
        'Run `brevo-axi email send --to a@b.com --subject "..." --html "..." --sandbox` to validate a send',
        "Run `brevo-axi <command> --help` for any command reference",
    ];
    return out;
}
