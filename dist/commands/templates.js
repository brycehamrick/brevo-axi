import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, optionalInt, parseFlags, parseJsonFlag, requirePositional, requireString, requireConfirm, splitCsv, } from "../lib/args.js";
import { asRecord, asString, compact, asRecordArray } from "../lib/coerce.js";
import { snippet, truncateText, truncationHint } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
export const TEMPLATES_HELP = `brevo-axi templates - transactional email templates

subcommands (read):
  templates list                 active templates
  templates get <id>             one template with content preview

subcommands (write, require --confirm):
  templates create               --name --subject --sender-email --html
  templates update <id> --body   JSON patch (escape hatch)
  templates send-test <id>       render and send to --to
  templates delete <id>          only inactive templates can be deleted

examples:
  brevo-axi templates list
  brevo-axi templates get 3
  brevo-axi templates send-test 3 --to qa@example.com --confirm`;
const LIST_FLAGS = {
    limit: { type: "string" },
    offset: { type: "string" },
    json: { type: "boolean" },
};
const GET_FLAGS = { full: { type: "boolean" }, json: { type: "boolean" } };
const CREATE_FLAGS = {
    name: { type: "string" },
    subject: { type: "string" },
    "sender-name": { type: "string" },
    "sender-email": { type: "string" },
    html: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const UPDATE_FLAGS = {
    body: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const TEST_FLAGS = {
    to: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
export async function templatesCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return templatesList(rest, ctx);
        case "get":
            return templatesGet(rest, ctx);
        case "create":
            return templatesCreate(rest, ctx);
        case "update":
            return templatesUpdate(rest, ctx);
        case "send-test":
            return templatesTest(rest, ctx);
        case "delete":
            return templatesDelete(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: TEMPLATES_HELP };
        default:
            throw new AxiError(`unknown templates subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi templates --help` to see list, get, create, update, send-test, delete"]);
    }
}
async function templatesList(args, ctx) {
    const commandPath = "brevo-axi templates list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
    const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/smtp/templates", {
        query: { templateStatus: true, limit, offset, sort: "desc" },
    });
    const rows = asRecordArray(payload?.["templates"]);
    const total = payload ? payload["count"] : undefined;
    const out = {
        count: rows.length,
        total,
        templates: rows.map((row) => compact({
            id: row["id"],
            name: snippet(asString(row["name"]), 50),
            subject: snippet(asString(row["subject"]), 60),
            sender: asString(asRecord(row["sender"])?.["email"]),
            active: row["isActive"] === true,
            modified_at: asString(row["modifiedAt"])?.slice(0, 10),
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 active templates";
        help.push("Run `brevo-axi templates create --name ... --confirm` to create one");
    }
    else {
        help.push("Run `brevo-axi templates get <id>` for the content preview");
        help.push("Run `brevo-axi email send --template <id> --to ... --sandbox` to try it");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function templatesGet(args, ctx) {
    const commandPath = "brevo-axi templates get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const full = values["full"] === true;
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/smtp/templates/${encodeURIComponent(id)}`);
    if (!payload) {
        return renderResult({ result: `template ${id} returned no data` }, json);
    }
    if (full) {
        return renderResult({ template: payload }, json);
    }
    const html = asString(payload["htmlContent"]);
    const truncated = html !== undefined && html.length > 600;
    return renderResult({
        template: compact({
            id: payload["id"],
            name: asString(payload["name"]),
            subject: asString(payload["subject"]),
            sender: asString(asRecord(payload["sender"])?.["email"]),
            reply_to: asString(payload["replyTo"]),
            active: payload["isActive"] === true,
            test_sent: payload["testSent"] === true,
            html: html ? (truncated ? truncateText(html, 600).value : html) : undefined,
            modified_at: asString(payload["modifiedAt"]),
        }),
        help: [
            "Run `brevo-axi templates send-test <id> --to <email> --confirm` to preview by mail",
            "Run `brevo-axi templates get <id> --full` for the raw payload",
            ...truncationHint(truncated ? 1 : 0, commandPath),
        ].filter(Boolean),
    }, json);
}
async function templatesCreate(args, ctx) {
    const commandPath = "brevo-axi templates create";
    const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
    const name = requireString(values, "name", commandPath);
    const subject = requireString(values, "subject", commandPath);
    const senderName = requireString(values, "sender-name", commandPath);
    const senderEmail = requireString(values, "sender-email", commandPath);
    const html = requireString(values, "html", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name || !subject || !senderEmail || !html) {
        throw new AxiError("templates create requires --name, --subject, --sender-email, --html", "VALIDATION_ERROR");
    }
    requireConfirm(values, commandPath, `create template "${name}"`);
    const payload = await ctx.client.request("POST", "/smtp/templates", {
        body: {
            templateName: name,
            subject,
            sender: compact({ name: senderName, email: senderEmail }),
            htmlContent: html,
            isActive: true,
        },
    });
    return renderResult({
        created: compact({ id: payload ? payload["id"] : undefined, name, subject }),
        help: ["Run `brevo-axi templates send-test <id> --to <email> --confirm` to try it"],
    }, json);
}
async function templatesUpdate(args, ctx) {
    const commandPath = "brevo-axi templates update";
    const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const body = parseJsonFlag(values, "body");
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!body) {
        throw new AxiError("templates update requires --body <json> (the patch object)", "VALIDATION_ERROR", ['Example: --body \'{"subject":"New subject","htmlContent":"<p>Hi</p>"}\'']);
    }
    requireConfirm(values, commandPath, `patch template ${id} with ${JSON.stringify(body).slice(0, 200)}`);
    await ctx.client.request("PUT", `/smtp/templates/${encodeURIComponent(id)}`, { body });
    return renderResult({ updated: { id, fields: Object.keys(body) }, help: ["Run `brevo-axi templates get <id>` to verify"] }, json);
}
async function templatesTest(args, ctx) {
    const commandPath = "brevo-axi templates send-test";
    const { values, positionals } = parseFlags(args, commandPath, TEST_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const to = splitCsv(values["to"]);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (to.length === 0) {
        throw new AxiError("templates send-test requires --to <emails csv>", "VALIDATION_ERROR");
    }
    requireConfirm(values, commandPath, `send template ${id} as a test email to ${to.join(", ")}`);
    await ctx.client.request("POST", `/smtp/templates/${encodeURIComponent(id)}/sendTest`, {
        body: { emailTo: to },
    });
    return renderResult({ tested: { template: id, to }, help: ["Check the recipients' inbox for the rendered template"] }, json);
}
async function templatesDelete(args, ctx) {
    const commandPath = "brevo-axi templates delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const id = requirePositional(positionals, 0, "id", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `delete template ${id} (only inactive templates can be deleted)`);
    await ctx.client.request("DELETE", `/smtp/templates/${encodeURIComponent(id)}`);
    return renderResult({ deleted: { template: id }, help: ["Run `brevo-axi templates list` to confirm"] }, json);
}
