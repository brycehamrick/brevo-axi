import { runAxiCli } from "axi-sdk-js";
import type { AxiRenderable } from "./lib/output.js";
import { VERSION } from "./version.js";
import { getCommandContext, type CommandContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { accountCommand, ACCOUNT_HELP } from "./commands/account.js";
import { contactsCommand, CONTACTS_HELP } from "./commands/contacts.js";
import { listsCommand, LISTS_HELP } from "./commands/lists.js";
import { foldersCommand, FOLDERS_HELP } from "./commands/folders.js";
import { attributesCommand, ATTRIBUTES_HELP } from "./commands/attributes.js";
import { segmentsCommand, SEGMENTS_HELP } from "./commands/segments.js";
import { campaignsCommand, CAMPAIGNS_HELP } from "./commands/campaigns.js";
import { emailCommand, EMAIL_HELP } from "./commands/email.js";
import { templatesCommand, TEMPLATES_HELP } from "./commands/templates.js";
import { smsCommand, SMS_HELP } from "./commands/sms.js";
import { dealsCommand, DEALS_HELP } from "./commands/deals.js";
import { companiesCommand, COMPANIES_HELP } from "./commands/companies.js";
import { tasksCommand, TASKS_HELP } from "./commands/tasks.js";
import { notesCommand, NOTES_HELP } from "./commands/notes.js";
import { pipelinesCommand, PIPELINES_HELP } from "./commands/pipelines.js";
import { sendersCommand, SENDERS_HELP } from "./commands/senders.js";
import { domainsCommand, DOMAINS_HELP } from "./commands/domains.js";
import { webhooksCommand, WEBHOOKS_HELP } from "./commands/webhooks.js";
import { eventsCommand, EVENTS_HELP } from "./commands/events.js";
import { processesCommand, PROCESSES_HELP } from "./commands/processes.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Brevo marketing and messaging for agents - contacts, lists, campaigns, transactional email and SMS, CRM deals, senders, and webhooks over the Brevo v3 API";

const TOP_LEVEL_HELP = `brevo-axi - ${DESCRIPTION}

commands:
  account                 authenticated account: email, plan, credits
  contacts ...            list, get, create, update, delete, import, export
  lists ...               contact lists: counts, members, add/remove
  folders ...             group lists into folders
  attributes ...          contact attributes (create category/text/...)
  segments list           dynamic segments (read-only)
  campaigns ...           email marketing campaigns (send needs --confirm)
  email ...               transactional email: send, log, events, stats
  templates ...           transactional templates: list, get, send-test
  sms ...                 transactional SMS: send, stats, events
  deals ...               CRM deals (pipelines: \`pipelines list\`)
  companies ...           CRM companies
  tasks ...               CRM tasks and task types
  notes ...               CRM notes on contacts and deals
  pipelines ...           CRM pipelines and stages (read-only)
  senders ...             sender identities
  domains ...             authenticated sender domains
  webhooks ...            event webhooks
  events ...              custom tracking events
  processes ...           background imports/exports
  api ...                 raw v3 REST escape hatch
  setup hooks|status      install ambient session context

global flags: --help, -v/--version, update (self-update)

auth: BREVO_API_KEY env var (v3 key from Brevo > SMTP & API > API Keys).
BREVO_API_URL overrides the default base https://api.brevo.com/v3 (HTTPS only).

all writes require --confirm; \`email send --sandbox\` validates without sending.

run \`brevo-axi <command> --help\` for a command reference.`;

interface HelpEntry {
  help: string;
}

const COMMAND_HELP: Record<string, HelpEntry> = {
  account: { help: ACCOUNT_HELP },
  contacts: { help: CONTACTS_HELP },
  lists: { help: LISTS_HELP },
  folders: { help: FOLDERS_HELP },
  attributes: { help: ATTRIBUTES_HELP },
  segments: { help: SEGMENTS_HELP },
  campaigns: { help: CAMPAIGNS_HELP },
  email: { help: EMAIL_HELP },
  templates: { help: TEMPLATES_HELP },
  sms: { help: SMS_HELP },
  deals: { help: DEALS_HELP },
  companies: { help: COMPANIES_HELP },
  tasks: { help: TASKS_HELP },
  notes: { help: NOTES_HELP },
  pipelines: { help: PIPELINES_HELP },
  senders: { help: SENDERS_HELP },
  domains: { help: DOMAINS_HELP },
  webhooks: { help: WEBHOOKS_HELP },
  events: { help: EVENTS_HELP },
  processes: { help: PROCESSES_HELP },
  api: { help: API_HELP },
  setup: { help: SETUP_HELP },
};

type Command = (args: string[], ctx: CommandContext) => Promise<AxiRenderable>;

function withContext(command: Command): (args: string[]) => Promise<AxiRenderable> {
  return (args: string[]) => command(args, getCommandContext());
}

export async function main(): Promise<void> {
  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_LEVEL_HELP,
    getCommandHelp: (command: string) => COMMAND_HELP[command]?.help ?? null,
    home: withContext(homeCommand),
    commands: {
      account: withContext(accountCommand),
      contacts: withContext(contactsCommand),
      lists: withContext(listsCommand),
      folders: withContext(foldersCommand),
      attributes: withContext(attributesCommand),
      segments: withContext(segmentsCommand),
      campaigns: withContext(campaignsCommand),
      email: withContext(emailCommand),
      templates: withContext(templatesCommand),
      sms: withContext(smsCommand),
      deals: withContext(dealsCommand),
      companies: withContext(companiesCommand),
      tasks: withContext(tasksCommand),
      notes: withContext(notesCommand),
      pipelines: withContext(pipelinesCommand),
      senders: withContext(sendersCommand),
      domains: withContext(domainsCommand),
      webhooks: withContext(webhooksCommand),
      events: withContext(eventsCommand),
      processes: withContext(processesCommand),
      api: withContext(apiCommand),
      setup: (args: string[]) => setupCommand(args),
    },
  });
}

// Direct execution (node dist/index.js) instead of the bin wrapper.
if (process.argv[1]?.endsWith("index.js")) {
  await main();
}
