import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  oneOf,
  parseFlags,
  parseJsonFlag,
  requirePositional,
  requireString,
  requireConfirm,
  type FlagDefinition,
} from "../lib/args.js";
import { asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const ATTRIBUTES_HELP = `brevo-axi attributes - manage contact attributes

subcommands (read):
  attributes list              every attribute with type and category

subcommands (write, require --confirm):
  attributes create <name> --type <t>
      t is text|date|float|boolean|category|multiple-choice
      category/multiple-choice need --options <csv>
  attributes update <name>     --value (category label) and/or --options <csv>
  attributes delete <name>

attribute names are UPPER_SNAKE by convention (FIRSTNAME, JOB_TITLE).
Use --attr '{"NAME":value}' on contacts create/update to set them.

examples:
  brevo-axi attributes list
  brevo-axi attributes create TEAM --type category --options "Sales,Support" --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = { json: { type: "boolean" } };

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  type: { type: "string" },
  options: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  value: { type: "string" },
  options: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = { confirm: { type: "boolean" }, json: { type: "boolean" } };

const ATTRIBUTE_TYPES = ["text", "date", "float", "boolean", "category", "multiple-choice"] as const;

export async function attributesCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return attributesList(rest, ctx);
    case "create":
      return attributesCreate(rest, ctx);
    case "update":
      return attributesUpdate(rest, ctx);
    case "delete":
      return attributesDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: ATTRIBUTES_HELP };
    default:
      throw new AxiError(
        `unknown attributes subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi attributes --help` to see list, create, update, delete"],
      );
  }
}

async function attributesList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi attributes list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/contacts/attributes");
  const rows = asRecordArray(payload?.["attributes"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    attributes: rows.map((row) =>
      compact({
        name: asString(row["name"]),
        type: asString(row["type"]),
        category: asString(row["category"]),
        calculated: asString(row["calculatedValue"]),
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 attributes defined";
  } else {
    help.push("Set them per contact: contacts update <id> --attr '{\"NAME\":\"value\"}' --confirm");
  }
  out["help"] = help;
  return renderResult(out, json);
}

function optionsBody(values: Record<string, unknown>): Array<{ value: string }> | undefined {
  const raw = values["options"] as string | undefined;
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((value) => ({ value }));
}

async function attributesCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi attributes create";
  const { values, positionals } = parseFlags(args, commandPath, CREATE_FLAGS);
  const name = requirePositional(positionals, 0, "name", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const type = oneOf(values, "type", ATTRIBUTE_TYPES);
  if (!type) {
    throw new AxiError(
      `attributes create requires --type (${ATTRIBUTE_TYPES.join("|")})`,
      "VALIDATION_ERROR",
    );
  }
  const enumeration = optionsBody(values);
  if ((type === "category" || type === "multiple-choice") && !enumeration) {
    throw new AxiError(`--type ${type} requires --options <csv>`, "VALIDATION_ERROR", [
      'Example: attributes create TEAM --type category --options "Sales,Support" --confirm',
    ]);
  }
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const body: Record<string, unknown> = { type };
  if (enumeration) body["enumeration"] = enumeration;
  const category = "normal";
  const path = `/contacts/attributes/${category}/${encodeURIComponent(name)}`;

  requireConfirm(values, commandPath, `create ${type} attribute ${name}${enumeration ? " with options" : ""}`);
  await ctx.client.request("POST", path, { body });
  return renderResult(
    {
      created: compact({ name, type, options: enumeration }),
      help: [
        `Run \`brevo-axi contacts update <id> --attr '{"${name}":"value"}' --confirm\` to use it`,
      ],
    },
    json,
  );
}

async function attributesUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi attributes update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const name = requirePositional(positionals, 0, "name", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const value = requireString(values, "value", commandPath);
  const enumeration = optionsBody(values);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!value && !enumeration) {
    throw new AxiError("attributes update needs --value (new category label) and/or --options <csv>", "VALIDATION_ERROR");
  }
  const body: Record<string, unknown> = {};
  if (value) body["value"] = value;
  if (enumeration) body["enumeration"] = enumeration;
  requireConfirm(values, commandPath, `update attribute ${name} with ${JSON.stringify(body)}`);
  await ctx.client.request("PUT", `/contacts/attributes/normal/${encodeURIComponent(name)}`, { body });
  return renderResult(
    { updated: compact({ name, value, options: enumeration }), help: ["Run `brevo-axi attributes list` to verify"] },
    json,
  );
}

async function attributesDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi attributes delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const name = requirePositional(positionals, 0, "name", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `delete attribute ${name} (its values are lost on every contact)`);
  await ctx.client.request("DELETE", `/contacts/attributes/normal/${encodeURIComponent(name)}`);
  return renderResult(
    { deleted: { name }, help: ["Run `brevo-axi attributes list` to confirm"] },
    json,
  );
}
