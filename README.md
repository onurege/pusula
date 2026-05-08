# enroute-rag

DBA agent backend + reporting dashboard over the Univera MSSQL database.

```
                ┌────────────────────────────────────┐
                │         packages/core              │
                │  schema RAG · read-only SQL        │
                │  reports CRUD · gemini wrapper     │
                └──────────────────┬─────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
        apps/mcp           apps/api            apps/dashboard
        stdio MCP          Hono REST           Next.js 16 UI
        Claude Code        :8080               :3000
                                   │
                                   ▼
                          MSSQL Univera (RO)
                          data/reports/<id>/  (filesystem)
```

Two consumers, one core. Claude Code connects via MCP for developer/DBA flows
(error diagnosis, ad-hoc SQL, report editing). End-users open the dashboard,
type a Turkish business question, and the LLM picks the right tables, writes
SQL, runs it, and saves a report with an AI brief.

## Setup

```bash
cp .env.example .env
# fill in MSSQL_* (db_datareader user) and GEMINI_API_KEY
npm install

# 1. Pull a structural snapshot from MSSQL (FK graph + sample rows)
npm run schema:introspect

# 2. Backfill missing table descriptions via Gemini (uses sample rows + FK context)
npm run schema:enrich       # ENRICH_LIMIT=20 for a pilot batch

# 3. Smoke-test retrieval quality from the CLI
npm run test:retrieve "ödenmemiş Pernod Ricard faturalar"
```

## Run

```bash
# HTTP API (port 8080)
npm run api:start

# Dashboard (port 3000) — in another terminal
npm run dashboard:dev

# MCP server (stdio) — usually launched by Claude Code, see docs/claude_desktop_config.example.json
npm run mcp:start
```

## Workspace layout

```
packages/core/      schema RAG, sql runner, report storage, gemini client
apps/mcp/           stdio MCP server — exposes 6 tools to Claude Code
apps/api/           HTTP REST (Hono + node-server) — same tools as JSON
apps/dashboard/     Next.js 16 + Tailwind 4 — list, new-report, schema browser
scripts/            schema-introspect, schema-enrich, test-retrieve (tsx CLI)
data/seed/          frozen baseline imported from text-to-sql (committed)
data/schema-v2*.json gitignored, regenerable
data/reports/<id>/  meta.json + query.sql + brief.md + runs/latest.json
```

## Read-only guarantee

Three layers of defence:

1. The MSSQL connection user is `db_datareader`.
2. `packages/core/src/db.ts` rejects any query containing
   `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|GRANT|REVOKE|DENY`
   before the driver sees it.
3. Every read has a row cap (default 1000) and a 30s timeout, enforced by the
   runner regardless of the SQL text.

Enabling writes (saving reports, audit logs) means a separate writable user
on a separate connection, on a separate code path — not a bypass of these
guards.

## API surface

```
POST /api/retrieve          { query, topK }                  → top-k tables + FK + prompt context
POST /api/run-sql           { query, limit, timeoutMs }      → row data
GET  /api/reports                                             → list
GET  /api/reports/:id                                         → meta + sql + brief + latest run
POST /api/reports           { name, sql, brief, ... }         → save (or update if `id`)
POST /api/reports/:id/run   ?limit=                           → run + persist snapshot
POST /api/reports/generate  { prompt, save }                  → retrieve → SQL → run → brief → optional save
```

## MCP tools (for Claude Code)

`retrieve_schema`, `run_sql`, `list_reports`, `get_report`, `save_report`, `run_report`.
See [docs/claude_desktop_config.example.json](docs/claude_desktop_config.example.json) for wiring.

See [AGENTS.md](AGENTS.md) for repository conventions and the phase plan.
