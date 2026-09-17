# brevo-axi

AXI-compliant CLI for Brevo (ex-Sendinblue) — agent-ergonomic email, SMS,
marketing campaign, contact, and CRM operations over the Brevo v3 REST API.
Built against the [AXI](https://axi.md/) principles; listed in the
[AXI catalog](https://axi.md/).

```
$ brevo-axi
bin: ~/.local/bin/brevo-axi
description: Brevo marketing and messaging for agents - ...
auth: api-key
account: you@example.com
plan: free (298 credits)
contacts: 20 total
lists: 5 total
help[4]:
  Run `brevo-axi contacts list --limit 20` to browse contacts
  Run `brevo-axi campaigns list` to review marketing campaigns
  ...
```

## Install

```
npm install -g brevo-axi
```

Or run on demand: `npx -y brevo-axi@latest <command>`.

## Authentication

Generate a v3 API key at **Brevo > SMTP & API > API Keys**
(<https://app.brevo.com/settings/keys/api>) and export it:

```
export BREVO_API_KEY="xkeysib-..."
```

`BREVO_API_URL` optionally overrides the default base
`https://api.brevo.com/v3` (HTTPS only). The key is only ever read from the
environment — never from flags, files, or prompts — and is redacted from all
error output.

## Commands

| Group | What it covers |
| --- | --- |
| `account` | Authenticated account: email, plan, credits |
| `contacts list/get/stats`, `create/update/delete`, `import/export` | Contact management (email or id identifiers) |
| `lists list/get/contacts`, `create/update/delete/add/remove` | Contact lists with subscriber rollups |
| `folders`, `attributes`, `segments list` | Audience organization |
| `campaigns list/get`, `create/update/send/test/status/report/export/delete` | Email marketing campaigns with pre-computed stats |
| `email send/list/content/events/stats/scheduled/cancel/blocked` | Transactional email + audit (`--sandbox` validates without sending) |
| `templates list/get/send-test/create/update/delete` | Transactional templates |
| `sms send/stats/events` | Transactional SMS |
| `deals`, `companies`, `tasks`, `notes`, `pipelines` | Sales CRM |
| `senders`, `domains`, `webhooks` | Account configuration |
| `events track/list` | Custom tracking events |
| `processes list/get` | Background imports/exports |
| `api get/post/put/patch/delete <path>` | Raw v3 REST escape hatch |
| `setup hooks/status/remove` | Ambient session context for Claude Code / Codex / OpenCode |

Every command supports `--help`; data commands support `--json`.

## Examples

```
# Validate a send without delivering or spending credits
brevo-axi email send --to ada@example.com --subject "Welcome" \
    --template 3 --param '{"name":"Ada"}' --sandbox

# Actually send it
brevo-axi email send --to ada@example.com --subject "Welcome" \
    --template 3 --param '{"name":"Ada"}' --confirm

# Audit delivery
brevo-axi email events --event hard_bounce --days 3
brevo-axi email stats --days 30 --daily

# Audience work
brevo-axi contacts create --email ada@example.com \
    --attr '{"FIRSTNAME":"Ada"}' --lists 4 --confirm
brevo-axi lists add 4 --ids 25 --confirm

# Marketing
brevo-axi campaigns list --status draft
brevo-axi campaigns get 17        # "100 sent, 95 delivered (95%), 40 opened ..."
brevo-axi campaigns send 17 --confirm

# CRM
brevo-axi pipelines list          # stage names for deals
brevo-axi deals create --name "Pilot" --stage New --confirm
```

## Safety

- **Every mutation requires `--confirm`**, verified before any network
  request. One invocation, no remembered consent, no prompts.
- `email send --sandbox` uses Brevo's `X-Sib-Sandbox: drop` header: the
  request is validated, nothing is delivered, no credits are used — so it is
  the only write path that skips `--confirm`.
- Deletes say so explicitly (`folders delete` warns it destroys inner lists).
- Sending commands preview recipients and credit cost in the gate error.

## Output and exit codes

Compact [TOON](https://toonformat.dev/) by default; `--json` opt-in. Empty
results are explicit (`0 contacts matched`). Exit codes: `0` success, `2`
usage/validation/missing `--confirm` (stderr-free structured errors on
stdout), `1` runtime or API failure.

| AxiError code | Brevo signal |
| --- | --- |
| `VALIDATION_ERROR` | 400 `invalid_parameter` / `missing_parameter` / flag misuse |
| `AUTH_REQUIRED` | 401/403 |
| `PAYMENT_REQUIRED` | 402 `not_enough_credits` |
| `NOT_FOUND` | 404 `document_not_found` |
| `RATE_LIMITED` | 429 |
| `API_ERROR` | other 4xx/5xx |

## Not implemented (v1)

WhatsApp campaigns, SMS marketing campaigns, Conversations, eCommerce,
Loyalty, Wallet, master/sub-account (corporate) management, inbound parsing,
and blocked domains. Use the `api` escape hatch for those, and file an issue
if you need them as first-class commands.

## Development

```
npm install
npm run build        # tsc -> dist/ (committed; rebuild on change)
npm test             # vitest, fully mocked HTTP
npm run typecheck
```

Run locally with `node bin/brevo-axi.js`. Tests pass without credentials.

## License

MIT
