# TraceLab - Codebase Architecture & AI Context

@AGENTS.md

## What TraceLab Is

TraceLab is a **visual code analysis and simulation tool** for Rust microservices. It:
1. Scans Rust repos (git clone or local path)
2. Uses LLMs to extract architecture (nodes, edges, traces)
3. Renders interactive call graphs in the browser
4. Lets users **simulate execution flows** by editing inputs at any step

## The Core Problem We're Solving

The simulation must be **input-driven and deterministic**. When a user changes any input value at any step, the entire downstream chain must react — different outputs, different paths, different errors. No static responses.

## Architecture

### 3-Phase Pipeline (`src/lib/claude.ts`)

```
Phase 1: Structure → nodes, edges, mutations (chunked, parallel)
Phase 2: Output Cases + Input Schemas (per entry point, parallel)
Phase 3: Traces (per entry point, parallel)
```

Each phase persists intermediate artifacts (`src/lib/artifacts.ts`) for fault tolerance and retryability.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/prompts.ts` | All LLM prompts (structure, output_cases, traces) |
| `src/lib/claude.ts` | 3-phase pipeline orchestration with validation + retry |
| `src/lib/simulation.ts` | Runtime simulation engine (resolveNodeOutput, adaptInput, mergeInputIntoOutput) |
| `src/lib/trace-resolver.ts` | Trace selection by match conditions |
| `src/lib/conditions.ts` | Condition evaluation (eq, neq, in, exists, eq_type, etc.) |
| `src/lib/validator.ts` | JSON validation (structure, chains, config fields, stringified JSON, schema alignment) |
| `src/lib/scanner.ts` | Rust file discovery, test stripping, large file splitting |
| `src/lib/schema.ts` | TypeScript types for the entire JSON schema |
| `src/lib/merger.ts` | Final JSON aggregation and output |
| `src/lib/artifacts.ts` | Intermediate artifact persistence |
| `src/app/page.tsx` | Main UI: simulation state, runSimulation, rerunFromStep |
| `src/components/Sidebar.tsx` | Sidebar UI: entry point selection, input editing, trace flow |
| `src/app/api/clone-and-scan/route.ts` | API endpoint for scanning repos |

### Schema (`src/lib/schema.ts`)

The `.tracelab.json` output has:
- **nodes**: ComponentNode[] — each function/handler/validator in the code
- **edges**: PayloadEdge[] — call relationships
- **traces**: RouteTrace[] — execution paths from entry points
- **output_cases**: per-node conditional outputs for simulation
- **input_schema**: per-node input validation rules
- **input_mapping**: per-trace-step field extraction from upstream output

### Simulation Engine (`src/lib/simulation.ts`)

Each step runs:
1. `adaptInput()` — transforms prev output to match this node's expected input shape (uses input_mapping, input_schema, or deep search)
2. `validateInputSchema()` — checks required fields, types, patterns, enums (only terminates if error_status is set = source-derived)
3. `output_cases` evaluation — first matching case wins, with partial match fallback
4. `mergeInputIntoOutput()` — replaces template values with actual user input values (including arrays)
5. `when` conditions — evaluated at runtime against current payload, not initial request

## Critical Rules for Any AI Working on This

### Simulation Must Be Input-Driven
- Every change in input MUST produce a different output
- output_cases return static templates but `mergeInputIntoOutput` injects actual user values
- Arrays from user input REPLACE template arrays (not ignored)
- `when` conditions are evaluated at RUNTIME per step, not pre-filtered

### Chain Awareness
- Each node's output flows as the next node's input
- `input_mapping` on trace steps extracts specific fields from upstream output
- `adaptInput()` auto-searches for fields the node needs using `deepFind()`
- output_cases must match fields from UPSTREAM output, not original request

### Struct Parity
- Output JSON must mirror exact Rust struct nesting
- Never flatten `create_order.create_id` to just `create_id`
- Never embed JSON as escaped strings (`"{\"key\":\"val\"}"`)

### Match Conditions
- Never reference config/internal fields (client, timeout, settings, interval, cache)
- Only reference data fields from upstream output (ok, orders, status, create_order)
- entry point nodes (step 0) match on the user's input directly

### Validation
- `input_schema` with `error_status` = source-derived, terminates on failure
- `input_schema` without `error_status` = auto-derived, falls through to output_cases
- Config fields in match conditions are flagged as errors
- Stringified JSON in outputs is flagged as errors
- Schema misalignment (upstream output missing downstream's required fields) is flagged

### Non-Server Support
- Not just HTTP servers — CLI tools, cron jobs, monitors, libraries
- Entry points: route_handler, function, business_logic, background_process, message_queue
- `db_call` and `external_http_call` return MOCK data via output_cases
- Background processes need traces and output_cases too

## Known Limitation: Static Output Cases

output_cases return **static templates** merged with user input. They cannot:
- Count array elements dynamically
- Filter arrays based on conditions
- Compute derived values

This means `skipped_blacklisted: 1` is always `1` regardless of how many orders are blacklisted. The `mergeInputIntoOutput` replaces matching field values but doesn't run computation logic.

**Future work**: Add a `compute` field to nodes that runs actual JavaScript logic on the input to produce dynamic outputs (like filtering blacklisted orders from an array).

## Running the App

```bash
npm run dev          # Dev server on :3000
npx tsc --noEmit     # Type check
npx next build       # Production build
```

Scan a repo:
```bash
curl -X POST http://localhost:3000/api/clone-and-scan \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/org/repo", "forceRescan": true}'
```
