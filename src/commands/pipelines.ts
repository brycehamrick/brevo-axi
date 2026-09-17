import { AxiError } from "axi-sdk-js";
import type { AxiRenderable } from "../lib/output.js";
import { renderResult } from "../lib/output.js";
import {
  forbidExtraPositionals,
  parseFlags,
  requirePositional,
  type FlagDefinition,
} from "../lib/args.js";
import { asRecordArray, asString, compact } from "../lib/coerce.js";
import { requireApiKey } from "../lib/auth.js";
import type { CommandContext } from "../context.js";

export const PIPELINES_HELP = `brevo-axi pipelines - CRM deal pipelines (read-only)

pipelines are configured in the Brevo CRM UI; use their stage names in
\`deals create --stage\` and \`deals list --stage\`.

subcommands:
  pipelines list              every pipeline with its stages
  pipelines get <name>        one pipeline's stage list

examples:
  brevo-axi pipelines list
  brevo-axi pipelines get "Sales pipeline"`;

const LIST_FLAGS: Record<string, FlagDefinition> = { json: { type: "boolean" } };

export async function pipelinesCommand(args: string[], ctx: CommandContext): Promise<AxiRenderable> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub !== "list" && sub !== "get") {
    if (sub === undefined || sub === "--help" || sub === "help") {
      return { help_text: PIPELINES_HELP };
    }
    throw new AxiError(
      `unknown pipelines subcommand: ${sub}`,
      "VALIDATION_ERROR",
      ["Run `brevo-axi pipelines --help` to see list, get"],
    );
  }
  const commandPath = `brevo-axi pipelines ${sub}`;
  const { values, positionals } = parseFlags(rest, commandPath, LIST_FLAGS);
  const json = values["json"] === true;
  requireApiKey(ctx, commandPath);

  const payload = await ctx.client.request("GET", "/crm/pipeline/details/all");
  const pipelines = asRecordArray(payload?.["items"]);

  if (sub === "get") {
    const name = requirePositional(positionals, 0, "name", commandPath);
    forbidExtraPositionals(positionals, 1, commandPath);
    const match = pipelines.find(
      (row) => asString(row["pipeline_name"]) === name || asString(row["pipeline"]) === name,
    );
    if (!match) {
      throw new AxiError(`no pipeline named "${name}"`, "NOT_FOUND", [
        "Run `brevo-axi pipelines list` to see pipeline names",
      ]);
    }
    const stages = asRecordArray(match["stages"]);
    return renderResult(
      {
        pipeline: compact({
          id: asString(match["pipeline"]),
          name: asString(match["pipeline_name"]),
          stage_count: stages.length,
        }),
        stages: stages.map((stage) =>
          compact({
            id: asString(stage["id"]) ?? asString(stage["stage"]),
            name: asString(stage["name"]) ?? asString(stage["stage_name"]),
            win_probability: stage["winProbability"],
          }),
        ),
        help: [
          'Use a stage name: deals create --name "..." --stage "<stage name>" --confirm',
        ],
      },
      json,
    );
  }

  const out: Record<string, unknown> = {
    count: pipelines.length,
    pipelines: pipelines.map((row) => {
      const stages = asRecordArray(row["stages"]);
      return compact({
        name: asString(row["pipeline_name"]) ?? asString(row["pipeline"]),
        stages: stages.length,
        stage_names: stages
          .map((stage) => asString(stage["name"]) ?? asString(stage["stage_name"]))
          .filter(Boolean)
          .slice(0, 8),
      });
    }),
  };
  const help: string[] = [];
  if (pipelines.length === 0) {
    out["result"] = "0 pipelines configured (create them in the Brevo CRM UI)";
  } else {
    help.push('Run `brevo-axi pipelines get "<name>"` for the full stage list');
  }
  out["help"] = help;
  return renderResult(out, json);
}
