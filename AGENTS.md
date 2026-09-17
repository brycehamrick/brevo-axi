# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`brevo-axi` is an AXI-compliant CLI over the Brevo (ex-Sendinblue) v3 REST
API (`https://api.brevo.com/v3`). It is listed in the [AXI catalog]
(https://axi.md/). Keep the AXI principles in mind for every change:

1. TOON output by default, `--json` opt-in
2. 3-4 field list schemas by default
3. Truncate with size hints, `--full` escape hatch
4. Pre-computed aggregates (counts, subscriber rollups, stats summaries)
5. Definitive empty states ("0 results")
6. Structured errors on stdout; exit 2 usage / 1 runtime; unknown flags fail
   loud; never prompt
7. Ambient context via `setup hooks`, opt-in only
8. No-args home view is live content, not help
9. `help[]` next-step suggestions after output
10. Every command has a concise `--help`

## Hard rules

- **Never commit secrets.** `BREVO_API_KEY` stays in the environment. Tests
  must pass with no credentials set. Never echo the key or real account data
  into files, tests, or examples.
- **No real account data in tests or fixtures.** Use generic addresses
  (`a@b.com`) and placeholder names only.
- **Commit `dist/` with every source change.** The build output ships in the
  repo so clone-and-run and GitHub installs need no build step; after editing
  `src/`, run `npm run build` and commit `dist/` in the same change.
- **Network access lives in `src/api/client.ts` only.** Commands receive an
  injected client; tests pass a fake. Do not call `fetch` from command code.
- **Mutations require `--confirm`, verified before any network call** —
  including lookups the mutation needs. A test must exist for each gate
  proving no client call happens without it. Exception: `email send
  --sandbox` (X-Sib-Sandbox: drop) validates without side effects.
- **Exit codes:** `VALIDATION_ERROR` (and only it) maps to exit 2; everything
  else is 1. The SDK's `exitCodeForError` owns this — do not hand-roll it.
- **Token scrubbing:** every error path must pass through `redact()`.
- **The client always sends a User-Agent** — Brevo sits behind Cloudflare,
  which blocks bare-node fetches on some paths (HTTP 403 "error code: 1010").

## Layout

```
bin/brevo-axi.js     entrypoint; fast-path version probe, then dist/
src/lib/             args (strict parseArgs), env (config + redaction),
                     output (--json + empty states), truncate, coerce, auth
src/api/client.ts    REST client: fetch, timeouts, error mapping, sandbox
src/commands/        one file per command family
src/index.ts         runAxiCli registration
test/                vitest, fully mocked HTTP (helpers.ts fake client)
skills/brevo-axi/    installable agent skill (SKILL.md)
```

## Commands

```
npm run build       # tsc -> dist/ (committed to the repo; rebuild on change)
npm test            # vitest run
npm run typecheck
```

Run the CLI locally with `node bin/brevo-axi.js` (after `npm run build`).
Live smoke testing uses read-only commands plus `email send --sandbox`;
never run mutation commands against a real account in CI or agent sessions.

## Conventions

- Brevo response shapes vary: some list endpoints return bare arrays (the
  client wraps them as `{items}`), `{}` when empty (`segments`), or paged
  `{items, pager}` (CRM). Normalize defensively via `lib/coerce.ts`.
- Contacts address by email or numeric id — `identifierTypeFor()` picks
  `email_id` vs `contact_id`; CRM objects use string ids; lists use integers.
- Companies page with `page`, most others with `offset`.
- New commands: add the module under `src/commands/`, register it in
  `src/index.ts` (commands + COMMAND_HELP), and extend `skills/brevo-axi/
  SKILL.md` + README when the surface changes.
