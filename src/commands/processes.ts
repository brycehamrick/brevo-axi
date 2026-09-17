import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  optionalInt,
  parseFlags,
  requirePositional,
  type FlagDefinition,
} from "../lib/args.js";
import { asNumber, asRecordArray, asString, compact } from "../lib/coerce.js";
import { snippet } from "../lib/truncate.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const PROCESSES_HELP = `brevo-axi processes - background jobs (imports, exports)

subcommands:
  processes list              recent background processes
  processes get <id>          one process's status

examples:
  brevo-axi processes list
  brevo-axi processes get 128`;

const LIST_FLAGS: Record<string, FlagDefinition> = {
  limit: { type: "string" },
  offset: { type: "string" },
  json: { type: "boolean" },
};

const GET_FLAGS: Record<string, FlagDefinition> = { json: { type: "boolean" } };

export async function processesCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return processesList(rest, ctx);
    case "get":
      return processesGet(rest, ctx);
    case undefined:
    case "--help":
    case "help":
      return { help_text: PROCESSES_HELP };
    default:
      throw new AxiError(
        `unknown processes subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `brevo-axi processes --help` to see list, get"],
      );
  }
}

async function processesList(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi processes list";
  const { values } = parseFlags(args, commandPath, LIST_FLAGS);
  const limit = optionalInt(values, "limit", { min: 1, max: 100 }) ?? 20;
  const offset = optionalInt(values, "offset", { min: 0, max: 1_000_000 }) ?? 0;
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/processes", { query: { limit, offset, sort: "desc" } });
  const rows = asRecordArray(payload?.["processes"]);
  const total = asNumber(payload?.["count"]);
  const done = rows.filter(
    (row) => asString(row["status"]) === "done" || asString(row["status"]) === "completed",
  ).length;
  const out: Record<string, unknown> = {
    count: rows.length,
    total,
    breakdown: rows.length > 0 ? `${done} done, ${rows.length - done} running` : undefined,
    processes: rows.map((row) =>
      compact({
        id: row["id"],
        status: asString(row["status"]),
        name: snippet(asString(row["name"]), 60),
        started_at: asString(row["startedAt"]),
      }),
    ),
  };
  const help: string[] = [];
  if (rows.length === 0) {
    out["result"] = "0 background processes";
  } else {
    help.push("Run `brevo-axi processes get <id>` for details");
  }
  out["help"] = help;
  return renderResult(out, json);
}

async function processesGet(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const commandPath = "brevo-axi processes get";
  const { values, positionals } = parseFlags(args, commandPath, GET_FLAGS);
  const id = requirePositional(positionals, 0, "id", commandPath);
  forbidExtraPositionals(positionals, 1, commandPath);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", `/processes/${encodeURIComponent(id)}`);
  if (!payload) {
    return renderResult({ result: `process ${id} returned no data` }, json);
  }
  return renderResult(
    {
      process: payload,
      help: [
        payload["status"] === "done"
          ? "This job finished; check its output (e.g. export email or imported counts)"
          : "Still running; re-check with the same command in a moment",
      ],
    },
    json,
  );
}
