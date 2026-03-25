# TraceLab — Context

TraceLab is an AI-powered codebase scanner and interactive visual graph simulator for Rust services. It clones a Git repo, analyzes the source code with an LLM, produces a structured `.tracelab.json` file, and renders an interactive graph where you can simulate request flows through the system.

## Architecture

```
User → Landing Page (paste git URL)
         ↓
    /api/clone-and-scan
         ↓
    git clone --depth 1 → /tmp/tracelab-{slug}/
         ↓
    Scanner (src/lib/scanner.ts)
      - findCargoTomls → discovers Rust services
      - readServiceSource → reads all .rs files
         ↓
    LLM Analyzer (src/lib/claude.ts)
      - analyzeService() → sends source code + prompt to LLM
      - analyzeCrossService() → identifies inter-service calls
      - Supports: Claude, Gemini, OpenAI (configured via LLM_PROVIDER env)
         ↓
    Merger (src/lib/merger.ts)
      - Combines per-service results into single graph
      - Writes to: TraceLab/scans/{slug}.tracelab.json
         ↓
    Cleanup: deletes cloned repo from /tmp
         ↓
    Frontend loads the JSON → renders interactive graph + trace simulator
```

## The .tracelab.json Schema

This is the core output. Everything in the UI is driven by this file.

### Top-level structure

```json
{
  "meta": {
    "scanned_at": "ISO timestamp",
    "workspace_path": "path that was scanned",
    "services_found": ["service-id-1", "service-id-2"],
    "files_scanned": 42,
    "model": "gemini:gemini-2.5-flash"
  },
  "services": [...],
  "nodes": [...],
  "edges": [...],
  "mutations": [...],
  "cross_service_calls": [...],
  "external_packages": [...],
  "traces": [...]
}
```

### services

Each discovered service (typically one per Cargo.toml):

```json
{
  "id": "credential-manager",
  "kind": "service",
  "path": ".",
  "description": "Manages encrypted order credentials with chain-specific address derivation"
}
```

### nodes

Every meaningful component in the codebase. These become the boxes in the graph.

```json
{
  "id": "POST /credentials/{secret}",
  "service": "credential-manager",
  "kind": "route_handler",
  "name": "Credential Operations",
  "input": "JSON body with action field",
  "output": "JSON response (action-dependent)",
  "mutates_state": true,
  "mutation_target": "order_credentials table",
  "defined_in": "src/server/handlers.rs",
  "description": "Main endpoint dispatching based on action field and auth type",
  "method": "POST",
  "path_pattern": "/credentials/{secret}",
  "handler": "server::handlers::handle_credentials",
  "example_payload": "{\"action\": \"generate\", \"source_chain\": \"Bitcoin\", \"destination_chain\": \"Spark\"}",
  "source_code": "pub async fn handle_credentials(...) { ... }",
  "fields": null,
  "port": null
}
```

**Node kinds:**
| Kind | Color | What it represents |
|------|-------|--------------------|
| `route_handler` | Blue | HTTP endpoints — where data enters |
| `middleware` | Purple | Request interceptors (auth, logging, CORS) |
| `business_logic` | Green | Domain logic, handler orchestration |
| `validator` | Red/Orange | Input validation, constraint checks |
| `transformer` | Amber | Data shape changes (hashing, encryption, serialization) |
| `db_call` | Teal | Database operations (SELECT, INSERT, UPDATE) |
| `external_http_call` | — | Outbound HTTP to other services |
| `struct` / `enum` | — | Data carriers (filtered out in graph view) |
| `message_queue` | — | Async messaging |
| `function` | — | Utility functions |

Only `route_handler`, `middleware`, `business_logic`, `validator`, `transformer`, `db_call` are shown in the graph (core kinds).

### edges

Data flow connections between nodes. These become the lines in the graph.

```json
{
  "from": "auth_middleware",
  "to": "handle_generate_credentials",
  "payload": "Request + AuthType::Generate + GenerateRequest",
  "from_service": "credential-manager",
  "to_service": "credential-manager"
}
```

- `from`/`to` — node IDs
- `payload` — describes what data flows (type, shape, key fields)
- Include ALL edges, even conditional ones. Traces clarify which paths use which edges.

### mutations

Every write to persistent state.

```json
{
  "id": "mut_insert_creds",
  "service": "credential-manager",
  "kind": "mutation",
  "mutates": "order_credentials table (INSERT/upsert)",
  "via": "sqlx::query",
  "in_component": "db_insert_credentials",
  "defined_in": "src/credentials/store.rs"
}
```

### cross_service_calls

Inter-service communication (HTTP calls, shared DBs, message queues).

```json
{
  "id": "call_orderbook_api",
  "kind": "cross_service_call",
  "from_service": "credential-manager",
  "to_service": "orderbook",
  "via": "reqwest::post",
  "endpoint": "/api/orders",
  "payload_in": "OrderRequest",
  "payload_out": "OrderResponse",
  "defined_in": "src/client.rs"
}
```

### external_packages

Notable crate dependencies.

```json
{
  "crate": "sqlx",
  "used_in_services": ["credential-manager"],
  "purpose": "Async PostgreSQL driver for credential storage"
}
```

### traces (most important)

Pre-computed execution paths through the service. These power the trace simulator in the UI. **This is what makes TraceLab useful** — users pick a trace from a dropdown and see exactly which components light up.

```json
{
  "route_id": "POST /credentials/{secret}",
  "label": "Generate (UTXO chains)",
  "description": "Full flow with keypair generation and address derivation for Bitcoin/Litecoin/Spark/Zcash",
  "example_payload": {
    "action": "generate",
    "source_chain": "Bitcoin",
    "destination_chain": "Spark"
  },
  "steps": [
    {
      "node_id": "POST /credentials/{secret}",
      "edge_label": "",
      "summary": "Deserializes CredentialRequest with action='generate'"
    },
    {
      "node_id": "auth_middleware",
      "edge_label": "HTTP Request with path secret",
      "summary": "Validates path secret → injects AuthType::Generate"
    },
    {
      "node_id": "handle_generate_credentials",
      "edge_label": "Request + AuthType::Generate + GenerateRequest",
      "summary": "Extracts source_chain, destination_chain, optional secret_hash"
    }
  ]
}
```

**Trace fields:**

- `route_id` — which route_handler this trace starts from
- `label` — human-readable name **including the branch variant** (e.g. "Generate (UTXO chains)" not just "Generate")
- `description` — what this path does AND how it differs from other traces for the same route
- `example_payload` — minimal JSON that triggers this path. Use real values for branching fields, `<placeholder>` for opaque data
- `steps` — ordered array where each step is a component visit:
  - `node_id` — the component being executed
  - `edge_label` — what data flows into this step (empty for the first step)
  - `summary` — what happens here AND why this branch was taken (include condition evaluation)

**Two traces are "distinct" when they visit DIFFERENT sets of components.** If the same components run but with different data, that's NOT a separate trace.

## The Prompt (src/lib/prompts.ts)

The prompt is the core product. It instructs the LLM to:

1. **Extract components** — every function, handler, validator, transformer, DB call as a node
2. **Map data flow** — every call relationship as an edge with payload descriptions
3. **Record mutations** — every DB write with mechanism and target
4. **Detect branching** — the critical part. The prompt lists 10+ common branching patterns:
   - match on action/type enums
   - if/else dispatching to different functions
   - boolean flags gating components
   - Option/Result checks that skip processing
   - Type-dependent dispatch
   - Feature flags, config-driven branches
   - Chain/network type dispatch
   - Batch vs single-item paths
   - Cached vs uncached paths
   - Auth role dispatch
5. **Generate traces** — one per distinct execution path, with step-by-step summaries explaining the conditions

## Frontend

- **Landing page** — paste a Git URL, click "Scan & Visualize". Shows streaming progress.
- **Graph canvas** — pannable/zoomable, nodes laid out by topological depth, animated dashed edges
- **Sidebar** — trace picker dropdown (lists all precomputed traces by label), collapsible payload editor, trace flow visualization
- **Trace simulation** — pick a trace → nodes light up sequentially, edges glow, sidebar shows step-by-step cards with summaries
- **Inspector** — click any node to see kind, defined_in, input/output, mutates_state, connections

## File Structure

```
src/
  app/
    page.tsx              — main UI (landing + graph + sidebar)
    api/
      clone-and-scan/     — git clone + scan pipeline
      load-graph/         — load .tracelab.json from disk
      scan/               — scan a local workspace path
      simulate/           — LLM-powered simulation (legacy, replaced by precomputed traces)
  lib/
    prompts.ts            — THE PROMPT (core product)
    scanner.ts            — service discovery + file reading
    claude.ts             — LLM analysis orchestration
    llm.ts                — LLM provider abstraction (Claude/Gemini/OpenAI)
    merger.ts             — combines results, writes .tracelab.json to scans/
    schema.ts             — TypeScript types for the entire JSON schema
    simulation.ts         — legacy LLM simulation (replaced by traces)
    simulation-prompts.ts — legacy simulation prompts
scans/
  *.tracelab.json         — cached scan results (one per repo)
```

## Environment

```env
LLM_PROVIDER=gemini          # "claude", "gemini", or "openai"
ANTHROPIC_API_KEY=            # required if claude
GEMINI_API_KEY=               # required if gemini
OPENAI_API_KEY=               # required if openai
```
