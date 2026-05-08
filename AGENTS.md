# Repository Guidelines

This file provides guidance to AI agents working with code in this repository.

## What this is

`enroute-rag` is a monorepo with **one knowledge core** consumed by **two transports** and rendered by **one dashboard**:

- **packages/core** — schema RAG, read-only SQL runner, report storage, Gemini wrapper. Pure TypeScript, framework-free.
- **apps/mcp** — stdio MCP server. Claude Code connects here for DBA-style flows (error diagnosis, ad-hoc SQL, report editing).
- **apps/api** — HTTP REST (Hono). The dashboard and any other web client talk to this. Generation endpoints (`/api/reports/generate`) call Gemini server-side.
- **apps/dashboard** — Next.js 16 + Tailwind 4. End-user UI: list reports, ask for a new one in Turkish, view detail and re-run.

The same `retrieve_schema` and `run_sql` logic backs both transports — there is no duplication of business logic across MCP and HTTP.

## Hard rules

- **READ ONLY against MSSQL.** Connection user must be `db_datareader`. `packages/core/src/db.ts` rejects any query containing `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|GRANT|REVOKE|DENY` before it reaches the driver. Do not weaken or bypass this guard.
- **Limits are mandatory.** Every read enforces a row cap (default 1000) and a timeout (default 30s) regardless of the SQL text.
- **No writes to MSSQL anywhere yet.** Report storage uses the local filesystem (`data/reports/`). When/if write paths land, they go through a separate writable user on a separate code path, not by relaxing the guard.

## Source layout

```
packages/core/src/
  db.ts          MSSQL pool + read-only guard + runReadOnly()
  dictionary.ts  KEYWORD_MAP, PREFIX_MAP, query → DB-key resolver
  types.ts       SchemaSnapshot, TableInfo, ForeignKey, RetrievalResult, Report
  introspect.ts  sys.* queries → SchemaSnapshot (FK, indexes, ext_properties, samples)
  enrich.ts      Gemini-backed Turkish description draft for tables without MS_Description
  retrieve.ts    keyword scoring + FK 1-hop expansion + prompt formatter
  reports.ts     filesystem-based report CRUD (meta.json + query.sql + runs/)
  snapshot.ts    cached snapshot loader (used by all transports)
  gemini.ts      thin wrapper: embed(), embedBatch(), generate()

apps/mcp/src/server.ts  6 tools exposed via stdio
apps/api/src/server.ts  Hono REST surface

apps/dashboard/
  app/page.tsx                        Reports list
  app/reports/[id]/page.tsx           Report detail (SQL + brief + result table)
  app/reports/new/page.tsx            Generate flow (prompt → retrieve → SQL → run → brief)
  app/schema/page.tsx                 Schema browser (interactive retrieve)
  components/result-table.tsx         Numeric-aware tabular renderer
  lib/api.ts                          REST client typed against the API surface

scripts/                  schema-introspect, schema-enrich, test-retrieve (tsx)
data/seed/schema-v1.json  Frozen baseline imported from text-to-sql, committed
data/schema-v2*.json      Generated, gitignored
data/reports/<id>/        meta.json + query.sql + brief.md + runs/latest.json
```

## Next.js 16 caveat

`apps/dashboard` runs Next.js 16 + React 19 + Tailwind 4. **This is not the Next.js you know.** Before writing any dashboard code, read the relevant guide in `apps/dashboard/node_modules/next/dist/docs/`. APIs, conventions, and file structure may all differ from older training data. Heed deprecation notices.

## Phases

- **Phase 1 — Knowledge core** (`schema-v2.json` + retrieve). DONE. CLI smoke tests via `npm run test:retrieve`.
- **Phase 2 — Transports + dashboard MVP** (MCP, HTTP, Next.js list/detail/new). DONE.
- **Phase 3 — Embedding + hybrid retrieval.** Add Gemini text-embedding-004 vectors per table description, hnswlib/vectra index, hybrid keyword + vector + FK expansion. Triggered when keyword retrieval misses semantic queries (e.g. "ödenmemiş" → vade/tahsilat tables).
- **Phase 4 — Auth, audit, write paths.** When the pilot expands beyond a demo audience.

## Coding rules

- TypeScript strict, ES modules, Node 22+.
- No `any` without a comment justifying it.
- Keep `packages/core` framework-free — pure functions and async helpers. Side-effect entrypoints live in `scripts/` and `apps/*`.
- New env vars go in `.env.example` with a one-line comment.
- Comments in code: English only, and only when the *why* is non-obvious.
- Workspace dependencies use the `*` version specifier (e.g. `"@enroute/core": "*"`); never duplicate a dependency that already lives in `packages/core`.

## Commit rules

- Conventional commits: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `docs`, `chore(scope)`.
- Atomic commits — one logical change per commit.

## Pre-push checks

```bash
npm run typecheck         # core + mcp + api
( cd apps/dashboard && npx tsc --noEmit )   # dashboard
```

Run a retrieval smoke test against a real snapshot before committing changes to `retrieve.ts`, `dictionary.ts`, or any prompt template in `enrich.ts` / `apps/api/src/server.ts`.
