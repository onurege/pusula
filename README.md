# enroute-rag

DBA agent backend for the Univera MSSQL database. Schema RAG + read-only SQL runner. Designed to be consumed by Claude Code (MCP) and a separate reporting dashboard (HTTP API). No UI in this repo.

> **Phase 1 only.** Library + scripts. MCP server, HTTP API, and dashboard land in later phases.

## Setup

```bash
cp .env.example .env
# fill in MSSQL_* (use a db_datareader user) and GEMINI_API_KEY
npm install
```

## Workflow

```bash
# 1. Pull a structural snapshot from MSSQL (FK graph, columns, indexes, descriptions)
npm run schema:introspect

# 2. Backfill missing table descriptions via Gemini (uses sample rows + FK context)
INTROSPECT_SAMPLE_ROWS=5 npm run schema:introspect   # if you want sample data in step 2
ENRICH_LIMIT=20 npm run schema:enrich                # try a small batch first

# 3. Smoke-test retrieval quality
npm run test:retrieve "ödenmemiş Pernod Ricard faturaları"
```

## Outputs

- `data/schema-v2.json` — structural snapshot (gitignored, regenerable)
- `data/schema-v2.enriched.json` — same + LLM-drafted Turkish descriptions (gitignored)
- `data/seed/schema-v1.json` — frozen baseline imported from `text-to-sql`, committed

## Read-only guarantee

The MSSQL connection user must be `db_datareader`. On top of that, `src/db.ts` rejects any query containing `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|EXEC|GRANT|REVOKE|DENY` before it reaches the driver. Every read also has a row cap (default 1000) and a 30s timeout.

See [AGENTS.md](AGENTS.md) for repository conventions and phase plan.
