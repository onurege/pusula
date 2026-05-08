# Repository Guidelines

This file provides guidance to AI agents working with code in this repository.

## What this is

`enroute-rag` is the **DBA agent backend** — a knowledge layer over the Univera MSSQL database. It is consumed by:

1. **Claude Code (via MCP)** — for developer/DBA workflows: error diagnosis, ad-hoc SQL, report editing.
2. **Dashboard (via HTTP API)** — for end-user reporting; the dashboard's LLM calls (Gemini) ride on top of this server's tools.

This repo is **not** a UI. There is no Next.js, no React. Phase 1 is library + scripts only. MCP server and HTTP API arrive in later phases.

## Hard rules

- **READ ONLY against MSSQL.** The connection user must be `db_datareader`. `src/db.ts` enforces a second guard at the application layer — any query containing `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|GRANT|REVOKE|DENY` is rejected before it reaches the driver. Do not weaken or bypass this guard.
- **Limits are mandatory.** Every read uses a row cap (default 1000) and a timeout (default 30s). When LLMs generate SQL via this backend, the executor enforces these regardless of the SQL text.
- **No writes anywhere yet.** Report storage and any future write paths are out of scope until explicitly enabled.

## Source layout

```
src/
  db.ts          MSSQL pool + read-only guard + runReadOnly()
  dictionary.ts  KEYWORD_MAP, PREFIX_MAP, query → DB-key resolver
  types.ts       SchemaSnapshot, TableInfo, ForeignKey, RetrievalResult
  introspect.ts  sys.* queries → SchemaSnapshot (FK, indexes, ext_properties, samples)
  enrich.ts      Gemini-backed Turkish description draft for tables without MS_Description
  retrieve.ts    keyword scoring + FK 1-hop expansion + prompt formatter
  gemini.ts      thin wrapper: embed(), embedBatch(), generate()
scripts/
  schema-introspect.ts   → data/schema-v2.json
  schema-enrich.ts       → data/schema-v2.enriched.json
  test-retrieve.ts       CLI: query → top-k tables + FK neighbors + prompt context
data/
  seed/schema-v1.json    Frozen baseline imported from text-to-sql
  schema-v2.json         Generated, gitignored
  schema-v2.enriched.json Generated, gitignored
```

## Phase 1 scope (current)

The only goal right now is **the system learning the data**. No agent loop, no tool dispatch, no transports.

- `npm run schema:introspect` → DB-grade snapshot with FK graph
- `npm run schema:enrich` → fill missing table descriptions via Gemini
- `npm run test:retrieve "<query>"` → CLI smoke test for retrieval quality

Quality bar: a Turkish business question (e.g. "ödenmemiş Pernod Ricard faturaları") must surface the right top-10 tables with their FK neighbors. Until that is reliable, do not start Phase 2.

## What we deliberately do NOT use

- **LangChain / LangGraph** — abstraction overhead with no payoff at this scope; agent loop lives in Claude Code.
- **Vercel AI SDK** — same reason; the dashboard will call Gemini directly via HTTP API later.
- **Vector DB service** — `vectra` (local) is the planned default if/when embeddings get added; we may not need them at all if keyword + FK expansion is good enough.
- **ORM** — `sys.*` introspection is hand-written SQL; it is shorter and more transparent.

## Coding rules

- TypeScript strict, ES modules, Node 22+.
- No `any` without a comment justifying it.
- Keep `src/` framework-free — pure functions and async helpers. Side-effect entrypoints live in `scripts/`.
- New env vars go in `.env.example` with a one-line comment.
- Comments in code: English only, and only when the *why* is non-obvious.

## Commit rules

- Conventional commits: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `docs`, `chore(scope)`.
- Atomic commits — one logical change per commit.

## Pre-push checks

```bash
npm run typecheck
```

Run a retrieval smoke test against a real snapshot before committing changes to `retrieve.ts` or `dictionary.ts`.

## Future phases (not yet implemented)

- **Phase 2** — add embeddings + vector search if keyword retrieval is insufficient. Local `vectra` index in `data/vectors/`.
- **Phase 3** — MCP server (`@modelcontextprotocol/sdk`, stdio) exposing `retrieve_schema`, `run_sql`, `list_reports`, `get_report`, `save_report`.
- **Phase 4** — HTTP API for the dashboard (Hono or Fastify), same tools surfaced as REST.
- **Phase 5** — separate `apps/dashboard` Next.js project consuming the HTTP API.

When any later phase begins, this file moves to a "single source of truth" CLAUDE.md and AGENTS.md becomes the pointer (cf. multica's pattern).
