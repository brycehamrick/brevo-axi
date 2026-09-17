import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  oneOf,
  optionalInt,
  parseFlags,
  requirePositional,
  requireString,
  requireConfirm,
  splitCsv,
  type FlagDefinition,
} from "../lib/args.js";
import { asNumber, asRecord, asRecordArray, asString, compact } from "../lib/coerce.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const TASKS_HELP = `brevo-axi tasks - CRM tasks

subcommands (read):
  tasks list                 tasks filtered by --status/--type/--assignee
  tasks types                available task type ids (needed for create)
  tasks get <id>             one task with notes

subcommands (write, require --confirm):
  tasks create               --name --type <typeId> --date <YYYY-MM-DD>
  tasks update <id>          --name, --done, --date, --notes...
  tasks delete <id>

examples:
  brevo-axi tasks types
  brevo-axi tasks list --status done
  brevo-axi tasks create --name "Follow up" --type 4 --date 2026-09-20 --confirm`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  status: { type: "string" },
  type: { type: "string" },
  assignee: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = { full: { type: "boolean" }, json: { type: "boolean" } };

const TYPES_FLAGS: Record<string, FlagDefinition> = { json: { type: "boolean" } };

const CREATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  type: { type: "string" },
  date: { type: "string" },
  notes: { type: "string" },
  assignee: { type: "string" },
  contacts: { type: "string" },
  deals: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const UPDATE_FLAGS: Record<string, FlagDefinition> = {
  name: { type: "string" },
  done: { type: "boolean" },
  date: { type: "string" },
  notes: { type: "string" },
  confirm: { type: "boolean" },
  json: { type: "boolean" },
};

const DELETE_FLAGS: Record<string, FlagDefinition> = { confirm: { type: "boolean" }, json: { type: "boolean" } };

export async function tasksCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return tasksList(rest, ctx);
    case "types":
      return tasksTypes(rest, ctx);
    case "get":
      return tasksGet(rest, ctx);
    case "create":
      return tasksCreate(rest, ctx);
    case "update":
      return tasksUpdate(rest, ctx);
    case "delete":
      return tasksDelete(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: TASKS_HELP };
    default:
      throw new AxiError(
        `unknown tasks subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi tasks --help` to see list, types, get, create, update, delete"],
      );
  }
}

function taskRow(row: Record<string, unknown>): Record<string, unknown> {
  return compact({
    id: asString(row["id"]),
    name: snippet(asString(row["name"]), 60),
    type_id: asString(row["taskTypeId"]) ?? asString(row["tasktypeId"]),
    date: asString(row["date"]),
    status: row["done"] === true ? "done" : row["status"] === "done" ? "done" : asString(row["status"]) ?? "open",
    assignee: asString(row["assignToId"]),
  });
}

async function tasksList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const status = oneOf(values, "status", ["done", "not-done"] as const) ?? requireString(values, "status", commandPath);
  const type = requireString(values, "type", commandPath);
  const assignee = requireString(values, "assignee", commandPath);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/crm/tasks", {
    query: {
      "filter[status]": status,
      "filter[type]": type,
      "filter[assignTo]": assignee,
      limit,
      offset,
      sort: "desc",
    },
  });
  const rows = asRecordArray(payload?.["items"]);
  const pager = asRecord(payload?.["pager"]);
  const total = asNumber(pager?.["total"]);
  const done = rows.filter((row) => row["done"] === true).length;
  const out: Record<string, unknown> = {
    count: rows.length,
    total,
    breakdown: rows.length > 0 ? `${done} done, ${rows.length - done} open` : undefined,
    tasks: rows.map(taskRow),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 tasks matched";
    help.push("Run `brevo-axi tasks create --name ... --type <id> --date ... --confirm` to create one");
  } else {
    help.push("Run `brevo-axi tasks get <id>` for details");
    if (total !== undefined && offset + rows.length < total) {
      help.push(`Page through with --offset ${offset + rows.length} (of ${total} total)`);
    }
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function tasksTypes(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks types";
  const { values } = parseFlags(args, commandPath, TYPES_FLAGS);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/crm/tasktypes");
  const rows = asRecordArray(payload?.["items"]);
  const out: Record<string, unknown> = {
    count: rows.length,
    types: rows.map((row) => compact({ id: asString(row["id"]), title: asString(row["title"]) })),
  };
  if (rows.length === 0) out["result"] = "0 task types defined";
  out["help"] = ["Use the id in `tasks create --type <id>`"];
  return renderResult(out, json);
}

async function tasksGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const full = values["full"] === true;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", `/crm/tasks/${encodeURIComponent(id)}`);
  if (!payload) {
    return renderResult({ result: `task ${id} returned no data` }, json);
  }
  if (full) {
    return renderResult({ task: payload }, json);
  }
  return renderResult(
    {
      task: taskRow(payload),
      notes: snippet(asString(payload["notes"]), 300),
      help: [
        "Run `brevo-axi tasks update <id> --done --confirm` to complete it",
        "Run `brevo-axi tasks get <id> --full` for the raw payload",
      ],
    },
    json,
  );
}

async function tasksCreate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks create";
  const { values } = parseFlags(args, commandPath, CREATE_FLAGS);
  const name = requireString(values, "name", commandPath);
  const type = requireString(values, "type", commandPath);
  const date = requireString(values, "date", commandPath);
  const notes = requireString(values, "notes", commandPath);
  const assignee = requireString(values, "assignee", commandPath);
  const contacts = splitCsv(values["contacts"] as string | undefined);
  const deals = splitCsv(values["deals"] as string | undefined);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name || !type || !date) {
    throw new AxiError(
      "tasks create requires --name, --type <typeId>, --date <YYYY-MM-DD>",
      "VALIDATION_ERROR",
      ["Run `brevo-axi tasks types` to list type ids"],
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AxiError(`--date must be YYYY-MM-DD, got: ${date}`, "VALIDATION_ERROR");
  }

  const body: Record<string, unknown> = { name, taskTypeId: type, date };
  if (notes) body["notes"] = notes;
  if (assignee) body["assignToId"] = assignee;
  if (contacts.length > 0) body["contactsIds"] = contacts.map(Number).filter((n) => Number.isInteger(n));
  if (deals.length > 0) body["dealsIds"] = deals;

  requireConfirm(values, commandPath, `create task "${name}" on ${date}`);
  const payload = await ctx.client.request("POST", "/crm/tasks", { body });
  return renderResult(
    {
      created: compact({ id: payload ? payload["id"] : undefined, name, date }),
      help: ["Run `brevo-axi tasks get <id>` to verify"],
    },
    json,
  );
}

async function tasksUpdate(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks update";
  const { values, positionals } = parseFlags(args, commandPath, UPDATE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const name = requireString(values, "name", commandPath);
  const done = values["done"] === true;
  const date = requireString(values, "date", commandPath);
  const notes = requireString(values, "notes", commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  if (!name && !done && !date && !notes) {
    throw new AxiError("tasks update needs at least one of --name, --done, --date, --notes", "VALIDATION_ERROR");
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AxiError(`--date must be YYYY-MM-DD, got: ${date}`, "VALIDATION_ERROR");
  }

  const body: Record<string, unknown> = {};
  if (name) body["name"] = name;
  if (done) body["done"] = true;
  if (date) body["date"] = date;
  if (notes) body["notes"] = notes;

  requireConfirm(values, commandPath, `update task ${id} with ${JSON.stringify(body)}`);
  await ctx.client.request("PATCH", `/crm/tasks/${encodeURIComponent(id)}`, { body });
  return renderResult(
    { updated: compact({ id, fields: Object.keys(body) }), help: [`Run \`brevo-axi tasks get ${id}\` to verify`] },
    json,
  );
}

async function tasksDelete(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi tasks delete";
  const { values, positionals } = parseFlags(args, commandPath, DELETE_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);
  requireConfirm(values, commandPath, `permanently delete task ${id}`);
  await ctx.client.request("DELETE", `/crm/tasks/${encodeURIComponent(id)}`);
  return renderResult(
    { deleted: { task: id }, help: ["Run `brevo-axi tasks list` to confirm"] },
    json,
  );
}
