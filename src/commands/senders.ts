import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  parseFlags,
  parseJsonFlag,
  requirePositional,
  requireString,
  requireConfirm,
  oneOf,
  optionalInt,
  type FlagDefinition,
} from "../lib/args.js";
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const SENDERS_HELP = `brevo-axi senders - sender identities (email senders)

subcommands (read):
  senders list                senders with activation state

subcommands (write, require --confirm):
  senders create              --name --email (needs OTP validation afterwards)
  senders update <id>         --name and/or --email
  senders validate <id> --otp <code>   confirm the OTP Brevo emailed
  senders delete <id>

examples:
  brevo-axi senders list
  brevo-axi senders create --name Product --email product@example.com --confirm
  brevo-axi senders validate 7 --otp 123456 --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = { json: { type: "boolean" } };

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  email: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  email: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const VALIDATE_FLAGS: Record<string, FlagDefinition> = {
  otp: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = { confirm: { type: "boolean" }, json: { type: "boolean" } };

export async function sendersCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return sendersList(rest, ctx);
    case "create":
      return sendersCreate(rest, ctx);
    case "update":
      return sendersUpdate(rest, ctx);
    case "validate":
      return sendersValidate(rest, ctx);
    case "delete":
      return sendersDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: SENDERS_HELP };
    default:
      throw new AxiError(
        `unknown senders subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi senders --help` to see list, create, update, validate, delete"],
      );
  }
}

export async function sendersList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi senders list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/senders");
  const rows = asRecordArray(payload?.["senders"]);
  const active = rows.filter((row) => row["active"] === true).length;
  const out: Record<string, unknown> = {
    count: rows.length,
    breakdown: rows.length > 0 ? `${active} active, ${rows.length - active} inactive` : undefined,
    senders: rows.map((row) =>
      compact({
        id: row["id"],
        name: asString(row["name"]),
        email: asString(row["email"]),
        active: row["active"] === true,
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 senders configured";
    help.push("Run `brevo-axi senders create --name ... --email ... --confirm` to create one");
  } else {
    help.push("Run `brevo-axi senders validate <id> --otp <code> --confirm` after creating");
    help.push("Run `brevo-axi domains list` for authenticated sender domains");
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function sendersCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi senders create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const name = requireString(values, "name", commandPath);
  const email = requireString(values, "email", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name || !email) {
    throw new AxiError("senders create requires --name and --email", "VALIDATION_ERROR");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AxiError(`--email is not a valid address: ${email}`, "VALIDATION_ERROR");
  }
  requireConfirm(values, commandPath, `create sender "${name}" <${email}> (Brevo emails an OTP to validate it)`);
  const payload = await ctx.client.request("POST", "/senders", {
    body: { name, email },
  });
  return renderResult(
    {
      created: compact({ id: payload ? payload["id"] : undefined, name, email }),
      help: [
        "Brevo emails an OTP code to the address; validate with",
        `\`brevo-axi senders validate <id> --otp <code> --confirm\``,
      ],
    },
    json,
  );
}

async function sendersUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi senders update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const name = requireString(values, "name", commandPath);
  const email = requireString(values, "email", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name && !email) {
    throw new AxiError("senders update needs --name and/or --email", "VALIDATION_ERROR");
  }
  const body: Record<string, unknown> = {};
  if (name) body["name"] = name;
  if (email) body["email"] = email;
  requireConfirm(values, commandPath, `update sender ${id} with ${JSON.stringify(body)}`);
  await ctx.client.request("PUT", `/senders/${encodeURIComponent(id)}`, { body });
  return renderResult(
    { updated: compact({ id, name, email }), help: ["Run `brevo-axi senders list` to verify"] },
    json,
  );
}

async function sendersValidate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi senders validate";
  const { values, positionals } = parseFlags(args, commandPath, VALIDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const otp = requireString(values, "otp", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!otp || !/^\d{4,8}$/.test(otp)) {
    throw new AxiError("senders validate requires --otp <numeric code from Brevo's email>", "VALIDATION_ERROR");
  }
  requireConfirm(values, commandPath, `validate sender ${id} with OTP ${otp}`);
  await ctx.client.request("PUT", `/senders/${encodeURIComponent(id)}/validate`, {
    body: { otp: Number(otp) },
  });
  return renderResult(
    { validated: { sender: id }, help: ["Run `brevo-axi senders list` to confirm it is active"] },
    json,
  );
}

async function sendersDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi senders delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `delete sender ${id}`);
  await ctx.client.request("DELETE", `/senders/${encodeURIComponent(id)}`);
  return renderResult(
    { deleted: { sender: id }, help: ["Run `brevo-axi senders list` to confirm"] },
    json,
  );
}
