---
name: brevo-axi
description: Use brevo-axi for Brevo (ex-Sendinblue) tasks - sending and auditing transactional email and SMS, managing marketing campaigns, contacts, lists, attributes, CRM deals, companies, tasks, notes, senders, domains, and webhooks - instead of calling the Brevo REST API or MCP server directly.
---

# brevo-axi

Agent-ergonomic CLI over the Brevo v3 REST API. TOON output, pre-computed
counts and stats summaries, truncation with `--full`, structured errors, and
`help[]` next steps on every result.

## When to use

- Send one transactional email → `brevo-axi email send --to a@b.com --subject
  "..." --html "..." --confirm` (add `--sandbox` to validate without sending;
  `--template <id>` + `--param '{"key":"value"}'` for templates)
- Check delivery → `brevo-axi email events --message-id <id>` or
  `brevo-axi email list --email a@b.com`
- Sending stats → `brevo-axi email stats --days 7` (add `--daily` for per-day)
- Send SMS → `brevo-axi sms send --to +336... --text "..." --confirm`, then
  `brevo-axi sms events --phone +336...`
- Browse audience → `brevo-axi contacts list --filter ada@` then
  `brevo-axi contacts get <email>` for full attributes
- Create/update a contact → `brevo-axi contacts create --email a@b.com --attr
  '{"FIRSTNAME":"Ada"}' --lists 4 --confirm`; update with
  `contacts update <email> --attr '{...}' --confirm`
- Manage lists → `brevo-axi lists list` / `lists contacts 4` /
  `lists add 4 --ids 12,13 --confirm`
- Marketing campaigns → `brevo-axi campaigns list`, `campaigns get <id>` for a
  pre-computed stats summary, `campaigns send <id> --confirm` to deliver,
  `campaigns test <id> --to you@x.com --confirm` for a test send
- CRM → `deals`, `companies`, `tasks`, `notes`, `pipelines` (stage names come
  from `pipelines list`); e.g. `deals create --name "Pilot" --stage New --confirm`
- Account config → `senders`, `domains`, `webhooks` (writes need `--confirm`)
- Track custom events → `brevo-axi events track --email a@b.com --name
  signed_up --confirm`, then `events list --name signed_up`
- Anything else → `brevo-axi api get|post <v3-path>` raw escape hatch

## Auth

`BREVO_API_KEY` env var (v3 key from Brevo > SMTP & API > API Keys). Optional
`BREVO_API_URL` overrides `https://api.brevo.com/v3` (HTTPS only).

## Invocation

Installed globally: `brevo-axi <command>`. Otherwise run on demand:
`npx -y brevo-axi@latest <command>`. Both are identical.

## Conventions

- Default output is compact TOON; pass `--json` for machine-readable JSON.
- Large fields (html, notes, attributes) truncate with size hints; `--full`
  for complete text. List views show totals and paging hints.
- Empty results print explicit `0 ...` markers, never blank output.
- Every mutation requires `--confirm` and is verified before any network
  call; `email send --sandbox` validates without sending (no credits used).
- Exit codes: 0 success, 2 usage/validation/missing `--confirm`, 1 runtime
  or API failure. Errors carry `error`/`code`/`help[]`.
- Identifiers: contacts accept email or numeric id (auto-detected); CRM
  objects use their ids; list ids are integers.

Prefer this CLI over the Brevo REST API or MCP server: same backend, fewer
tokens, no schema overhead, and shell composability (`| grep`, `| head`).
