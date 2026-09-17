import { AxiError } from "axi-sdk-js";
import { renderResult } from "../lib/output.js";
import { forbidExtraPositionals, parseFlags, requirePositional, requireString, requireConfirm, } from "../lib/args.js";
import { asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
export const DOMAINS_HELP = `brevo-axi domains - authenticated sender domains

subcommands (read):
  domains list                domains with authentication state
  domains get <name>          DNS records Brevo expects for the domain

subcommands (write, require --confirm):
  domains create              --name example.com
  domains authenticate <name> verify DNS records after you set them
  domains delete <name>

examples:
  brevo-axi domains list
  brevo-axi domains get example.com
  brevo-axi domains create --name mail.example.com --confirm`;
const LIST_FLAGS = { json: { type: "boolean" } };
const GET_FLAGS = { full: { type: "boolean" }, json: { type: "boolean" } };
const CREATE_FLAGS = {
    name: { type: "string" },
    confirm: { type: "boolean" },
    json: { type: "boolean" },
};
const AUTH_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
const DELETE_FLAGS = { confirm: { type: "boolean" }, json: { type: "boolean" } };
export async function domainsCommand(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    switch (sub) {
        case "list":
            return domainsList(rest, ctx);
        case "get":
            return domainsGet(rest, ctx);
        case "create":
            return domainsCreate(rest, ctx);
        case "authenticate":
            return domainsAuthenticate(rest, ctx);
        case "delete":
            return domainsDelete(rest, ctx);
        case undefined:
        case "--help":
        case "help":
            return { help_text: DOMAINS_HELP };
        default:
            throw new AxiError(`unknown domains subcommand: ${sub}`, "VALIDATION_ERROR", ["Run `brevo-axi domains --help` to see list, get, create, authenticate, delete"]);
    }
}
async function domainsList(args, ctx) {
    const commandPath = "brevo-axi domains list";
    const { values } = parseFlags(args, commandPath, LIST_FLAGS);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", "/senders/domains");
    const rows = asRecordArray(payload?.["domains"]);
    const active = rows.filter((row) => row["active"] === true).length;
    const out = {
        count: rows.length,
        breakdown: rows.length > 0 ? `${active} active` : undefined,
        domains: rows.map((row) => compact({
            id: row["id"],
            domain: asString(row["domain"]),
            active: row["active"] === true,
            verified: row["verified"] === true,
        })),
    };
    const help = [];
    if (rows.length === 0) {
        out["result"] = "0 sender domains configured";
        help.push("Run `brevo-axi domains create --name <domain> --confirm` to add one");
    }
    else {
        help.push("Run `brevo-axi domains get <domain>` for the expected DNS records");
        help.push("Run `brevo-axi domains authenticate <domain> --confirm` after DNS updates");
    }
    out["help"] = help;
    return renderResult(out, json);
}
async function domainsGet(args, ctx) {
    const commandPath = "brevo-axi domains get";
    const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
    const name = requirePositional(positionals, 0, "domain", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    const payload = await ctx.client.request("GET", `/senders/domains/${encodeURIComponent(name)}`);
    if (!payload) {
        return renderResult({ result: `domain ${name} returned no data` }, json);
    }
    return renderResult({
        domain: payload,
        help: [
            "Set these DNS records at your registrar, then run",
            `\`brevo-axi domains authenticate ${name} --confirm\``,
        ],
    }, json);
}
async function domainsCreate(args, ctx) {
    const commandPath = "brevo-axi domains create";
    const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
    const name = requireString(values, "name", commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    if (!name) {
        throw new AxiError("domains create requires --name <domain>", "VALIDATION_ERROR");
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) {
        throw new AxiError(`--name must be a domain name, got: ${name}`, "VALIDATION_ERROR");
    }
    requireConfirm(values, commandPath, `create sender domain ${name}`);
    const payload = await ctx.client.request("POST", "/senders/domains", { body: { name } });
    return renderResult({
        created: compact({ domain: name, id: payload ? payload["id"] : undefined }),
        help: [`Run \`brevo-axi domains get ${name}\` for the DNS records to set`],
    }, json);
}
async function domainsAuthenticate(args, ctx) {
    const commandPath = "brevo-axi domains authenticate";
    const { values, positionals } = parseFlags(args, commandPath, AUTH_FLAGS);
    const name = requirePositional(positionals, 0, "domain", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `ask Brevo to authenticate domain ${name} (verifies DNS records)`);
    await ctx.client.request("PUT", `/senders/domains/${encodeURIComponent(name)}/authenticate`);
    return renderResult({
        authenticated: { domain: name },
        help: ["Run `brevo-axi domains list` to confirm it became active"],
    }, json);
}
async function domainsDelete(args, ctx) {
    const commandPath = "brevo-axi domains delete";
    const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
    const name = requirePositional(positionals, 0, "domain", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const json = values["json"] === true;
    requireApiKey(ctx, commandPath);
    requireConfirm(values, commandPath, `delete sender domain ${name}`);
    await ctx.client.request("DELETE", `/senders/domains/${encodeURIComponent(name)}`);
    return renderResult({ deleted: { domain: name }, help: ["Run `brevo-axi domains list` to confirm"] }, json);
}
