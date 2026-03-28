# TraceLab v2 — Complete Blueprint

## 1. Product Requirements Document

### 1.1 Problem Statement

TraceLab v1 grew organically. Each fix introduced new edge cases. The core problems:

1. **Static simulation**: output_cases return hardcoded templates. Changing `is_blacklisted` from `false` to `true` doesn't filter the order from the array — it just swaps a boolean in the template. Real code filters, counts, transforms. Our simulation doesn't.

2. **Chain data flow is fragile**: Every step must manually carry forward fields for downstream steps. Miss one and the chain breaks. `input_mapping` was bolted on to fix misaligned shapes but it's manual and error-prone.

3. **LLM output quality is inconsistent**: The prompts are 1200+ lines. GPT generates config fields in match conditions, stringified JSON in outputs, flattened structs, wrong nesting. We added validators to catch these, but we're patching symptoms.

4. **Single repo type assumption**: Originally built for HTTP servers. Background workers, CLI tools, and monitors were retrofitted — entry point detection, UI labels, and trace generation all had to be patched.

5. **Speed**: A 3-file repo takes 6+ minutes. Investor demos can't wait that long.

### 1.2 Goals

- **G1**: Simulation is a real execution engine, not pattern matching. Changing any input produces a computed output.
- **G2**: Any Rust repo works out of the box — servers, CLIs, monitors, libraries.
- **G3**: Scan completes in under 90 seconds for repos with < 20 source files.
- **G4**: Zero manual JSON fixing. The pipeline produces valid, simulatable JSON every time.
- **G5**: Investors can pick any repo, scan it, and simulate within 2 minutes.

### 1.3 Non-Goals

- Not a full Rust compiler or interpreter
- Not real execution with actual network/DB calls
- Not supporting non-Rust languages (for now)
- Not a general-purpose workflow engine

### 1.4 Target Users

- **Primary**: Investors evaluating the product (demo scenario)
- **Secondary**: Developers understanding unfamiliar Rust codebases
- **Tertiary**: Security auditors tracing data flow through services

### 1.5 Functional Requirements

#### FR1: Repo Scanning
- Accept git URL or local filesystem path
- Discover all Cargo.toml packages in workspace
- Read .rs files, strip test code, split large files at logical boundaries
- Resolve external crate types (serde enums, shared structs)

#### FR2: Architecture Extraction (LLM Phase 1)
- Extract nodes (functions, handlers, validators, DB calls, HTTP calls, structs, enums)
- Extract edges (call relationships)
- Extract mutations (DB writes, cache updates)
- Chunked by file size, parallel execution, persisted artifacts

#### FR3: Simulation Metadata (LLM Phase 2)
- Generate `compute` rules per node (replaces static output_cases)
- Generate `input_schema` per node with source-code error messages
- Parallel per entry point, validated, retried on failure

#### FR4: Trace Generation (LLM Phase 3)
- Generate execution traces per entry point
- Each distinct code path = separate trace
- `when` conditions for conditional steps
- `input_mapping` for shape transformation between steps

#### FR5: Deterministic Simulation
- Every input change produces a different output
- Nodes run `compute` rules that filter, transform, count, validate
- Arrays are processed element-by-element (filter blacklisted, classify by state)
- Error messages come from source code, not generic templates
- `when` conditions re-evaluated at runtime per step

#### FR6: Interactive UI
- Entry point selector (any node kind, not just route_handler)
- Input editor with path params (HTTP) or function args (non-HTTP)
- Step-by-step trace flow with I/O inspection
- "Run from step N" that recomputes downstream with edited input
- Breakpoints, resume, skip
- Graph visualization with node highlighting

### 1.6 Non-Functional Requirements

- **Determinism**: Same input always produces same output
- **Latency**: Scan < 90s for small repos, < 5min for large repos
- **Reliability**: No crash on malformed LLM output (validate + retry)
- **Fault tolerance**: Partial failures don't lose completed work (artifacts)

### 1.7 Constraints

- LLM provider: OpenAI GPT-5.4 exclusively
- Frontend: Next.js 16 + React 19 + Tailwind 4
- Graph rendering: @xyflow/react
- No backend database — all state in JSON files + localStorage

---

## 2. System Design

### 2.1 High-Level Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐
│   Scanner    │────▶│  LLM Pipeline │────▶│   Merger      │────▶│  .tracelab │
│  (discover,  │     │  (3 phases,   │     │  (aggregate,  │     │   .json    │
│   read, split)│    │   parallel)   │     │   validate)   │     │            │
└─────────────┘     └──────────────┘     └──────────────┘     └────────────┘
                                                                       │
                                                                       ▼
                                                              ┌────────────────┐
                                                              │  Simulation    │
                                                              │  Engine        │
                                                              │  (compute,     │
                                                              │   validate,    │
                                                              │   transform)   │
                                                              └────────────────┘
                                                                       │
                                                                       ▼
                                                              ┌────────────────┐
                                                              │  React UI      │
                                                              │  (graph, trace,│
                                                              │   edit, debug) │
                                                              └────────────────┘
```

### 2.2 The Compute Model (replaces static output_cases)

This is the single biggest change. Instead of:

```json
"output_cases": [
  {"match": [{"field": "orders[0]", "op": "exists"}], "output": {"orders": [HARDCODED], "count": 1}}
]
```

We have:

```json
"compute": {
  "filter": {
    "source": "orders",
    "condition": {"field": "create_order.additional_data.is_blacklisted", "op": "neq", "value": true},
    "output_field": "filtered_orders"
  },
  "count": {
    "source": "orders",
    "output_field": "total_count"
  },
  "count_filtered": {
    "source": "filtered_orders",
    "output_field": "passed_count"
  },
  "derive": {
    "skipped_count": "total_count - passed_count"
  },
  "output": {
    "ok": true,
    "orders": "$filtered_orders",
    "skipped_blacklisted": "$skipped_count",
    "classified": {}
  },
  "on_empty": {
    "condition": {"field": "filtered_orders", "op": "eq", "value": []},
    "output": {"ok": true, "orders": [], "skipped_blacklisted": "$skipped_count", "note": "All orders filtered out"}
  },
  "on_error": {
    "output": {"ok": false, "error": "Failed to filter orders"},
    "terminates": true
  }
}
```

**Compute operations:**

| Operation | What it does | Example |
|-----------|-------------|---------|
| `filter` | Filter array by condition | Remove blacklisted orders |
| `map` | Transform each element | Extract create_id from each order |
| `find` | Find first matching element | Get the order with specific ID |
| `count` | Count elements | How many orders passed |
| `group_by` | Group by field value | Classify orders by state |
| `derive` | Compute from other values | `skipped = total - passed` |
| `select` | Pick specific fields | Extract only create_order + source_swap |
| `exists_check` | Boolean check | Does the field exist? |
| `compare` | Compare two fields | `filled_amount == amount` |
| `lookup` | Find in another array/map | Match order_id in tracking cache |

`$field_name` references computed intermediate values. The engine processes operations in order and builds the output.

### 2.3 Data Flow

```
User Input (JSON in textarea)
  │
  ▼
resolveTrace() — select which trace based on match conditions
  │
  ▼
For each step in trace:
  │
  ├─ evaluate when condition against CURRENT payload → skip if false
  │
  ├─ adaptInput() — transform prev output to this node's expected shape
  │   ├─ explicit input_mapping (highest priority)
  │   ├─ input_schema field matching
  │   └─ deepFind fallback
  │
  ├─ validateInputSchema() — check required fields, types, patterns
  │   └─ terminates with source-code error if error_status set
  │
  ├─ runCompute() — NEW: execute compute rules on input
  │   ├─ filter, map, count, group_by, derive, etc.
  │   └─ produces dynamic output based on actual input data
  │
  ├─ fallback: output_cases (legacy) → mergeInputIntoOutput
  │
  └─ output flows to next step
```

### 2.4 State Management

- **No server state**: All data in `.tracelab.json` files
- **Client state**: React useState/useRef for simulation
- **Refs for callbacks**: `traceStepsRef`, `resolvedStepDefsRef`, `traceVisibleRef` avoid stale closures
- **Artifacts**: Intermediate JSON files in `scans/.artifacts-{slug}/` for crash recovery

### 2.5 Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| Scanner | File not found | Skip file, log warning |
| LLM | Malformed JSON | Auto-fix prompt, retry |
| LLM | Schema violation | Repair prompt with errors, retry (max 2) |
| LLM | Connection error | Retry (artifact already saved for completed work) |
| Simulation | Missing field | Source-code error if `error_status` set, else fall through |
| Simulation | No output_case match | Diagnostic showing which conditions failed |
| Simulation | No compute rules | Fall back to output_cases → example_output → passthrough |
| UI | Invalid JSON in editor | Catch, show error, don't crash |

---

## 3. Codebase Structure

```
src/
├── app/
│   ├── page.tsx                 # Main UI — simulation state, graph, sidebar orchestration
│   ├── layout.tsx               # Root layout
│   └── api/
│       ├── clone-and-scan/
│       │   └── route.ts         # POST endpoint — git clone + scan pipeline
│       └── scan-local/
│           └── route.ts         # NEW: POST endpoint — scan local path
│
├── components/
│   ├── Sidebar.tsx              # Left panel — entry selection, input editor, trace flow
│   ├── GraphCanvas.tsx          # Right panel — node graph visualization
│   ├── TraceFlow.tsx            # Floating trace widget (optional)
│   └── ui/                      # shadcn components
│
├── lib/
│   ├── pipeline/
│   │   ├── scanner.ts           # File discovery, test stripping, splitting
│   │   ├── orchestrator.ts      # 3-phase pipeline orchestration (was claude.ts)
│   │   ├── phase1-structure.ts  # Phase 1: node/edge extraction
│   │   ├── phase2-compute.ts   # Phase 2: compute rules + input schemas
│   │   ├── phase3-traces.ts     # Phase 3: trace generation
│   │   ├── artifacts.ts         # Intermediate artifact persistence
│   │   └── merger.ts            # Final JSON aggregation
│   │
│   ├── simulation/
│   │   ├── engine.ts            # Main resolveNodeOutput + compute execution
│   │   ├── compute.ts           # NEW: filter, map, count, group_by, derive operations
│   │   ├── conditions.ts        # Condition evaluation (eq, exists, eq_type, etc.)
│   │   ├── adapt.ts             # adaptInput, applyInputMapping, deepFind
│   │   ├── merge.ts             # mergeInputIntoOutput
│   │   └── validate.ts          # input_schema validation
│   │
│   ├── prompts/
│   │   ├── structure.ts         # Phase 1 prompt
│   │   ├── compute.ts           # Phase 2 prompt (compute rules)
│   │   ├── traces.ts            # Phase 3 prompt
│   │   ├── cross-service.ts     # Cross-service analysis prompt
│   │   └── repair.ts            # Generic repair prompt builder
│   │
│   ├── validation/
│   │   ├── validator.ts         # Main validation orchestrator
│   │   ├── structure.ts         # Node, edge, DAG validation
│   │   ├── traces.ts            # Trace validation
│   │   ├── compute.ts           # Compute rule validation
│   │   ├── alignment.ts         # Schema alignment checks
│   │   └── banned-fields.ts     # Config field detection
│   │
│   ├── llm.ts                   # LLM abstraction (OpenAI)
│   ├── schema.ts                # TypeScript types
│   ├── trace-resolver.ts        # Trace selection by match conditions
│   ├── external-types.ts        # Serde enum resolution
│   └── layout.ts                # Graph layout algorithms
│
├── types/
│   └── index.ts                 # Re-exports + UI types
│
└── constants/
    ├── node.ts                  # Node colors, kinds, labels
    ├── canvas.ts                # Graph constants
    ├── sidebar.ts               # Sidebar constants
    └── storage.ts               # localStorage keys
```

### 3.1 Schema: Compute Rules

```typescript
interface ComputeRule {
  /** Operation type */
  op: 'filter' | 'map' | 'find' | 'count' | 'group_by' | 'derive' | 'select' | 'exists_check' | 'compare' | 'lookup';

  /** Source field (dot-notation path into input) */
  source?: string;

  /** Condition for filter/find operations */
  condition?: StepCondition;

  /** Field to group by (for group_by) */
  group_field?: string;

  /** Fields to select (for select/map) */
  fields?: string[];

  /** Expression for derive (e.g. "total - passed") */
  expression?: string;

  /** Where to store the result (used as $variable in output template) */
  output_field: string;
}

interface NodeCompute {
  /** Ordered list of compute operations */
  steps: ComputeRule[];

  /** Output template with $variable references */
  output: Record<string, unknown>;

  /** Output when the main condition produces empty/zero result */
  on_empty?: {
    condition: StepCondition;
    output: Record<string, unknown>;
  };

  /** Error output when compute fails */
  on_error?: {
    output: Record<string, unknown>;
    terminates: boolean;
  };
}
```

### 3.2 Schema: ComponentNode (updated)

```typescript
interface ComponentNode {
  id: string;
  service: string;
  kind: NodeKind;
  name: string;
  input?: string;
  output?: string;
  // ... existing fields ...

  /** NEW: Compute rules for dynamic simulation */
  compute?: NodeCompute;

  /** LEGACY: Static output cases (fallback if no compute) */
  output_cases?: NodeOutputCase[];

  /** Input validation */
  input_schema?: InputFieldSchema[];
}
```

---

## 4. Execution Model

### 4.1 End-to-End Pipeline

```
1. User submits repo URL/path
2. Scanner discovers services, reads files, strips tests, splits large files
3. Phase 1 (parallel chunks):
   - Each chunk → LLM → nodes + edges + mutations
   - Validate → retry if errors → persist artifact
   - Merge all chunks
4. Phase 2 (parallel per entry point):
   - Each subgraph → LLM → compute rules + input_schemas
   - Validate → retry → persist artifact
   - Attach to nodes
5. Phase 3 (parallel per entry point):
   - Each subgraph → LLM → traces
   - Validate → retry → persist artifact
   - Collect all traces
6. Merge → write .tracelab.json
7. UI loads JSON → graph renders → simulation ready
```

### 4.2 Parallelization

| Phase | Unit of Work | Concurrency | Bottleneck |
|-------|-------------|-------------|------------|
| Phase 1 | File chunk (~100K chars) | 3 concurrent | LLM rate limit |
| Phase 2 | Entry point subgraph | 3 concurrent | LLM rate limit |
| Phase 3 | Entry point subgraph | 3 concurrent | LLM rate limit |
| Cross-service | All services | 1 (small) | Single LLM call |

### 4.3 Input-Driven Simulation

The compute engine processes operations in order:

```
Input: {orders: [{create_order: {additional_data: {is_blacklisted: true}}, ...}, {create_order: {additional_data: {is_blacklisted: false}}, ...}]}

Step 1 (filter): source=orders, condition=is_blacklisted neq true → filtered_orders = [order2]
Step 2 (count): source=orders → total_count = 2
Step 3 (count): source=filtered_orders → passed_count = 1
Step 4 (derive): skipped_count = total_count - passed_count = 1

Output: {ok: true, orders: [order2], skipped_blacklisted: 1, total: 2}
```

Change `is_blacklisted` on order2 to `true`:
```
Step 1 (filter): → filtered_orders = []
Step 2 (count): → total_count = 2
Step 3 (count): → passed_count = 0
Step 4 (derive): → skipped_count = 2

Output: {ok: true, orders: [], skipped_blacklisted: 2, total: 2}
```

Every input change produces a different, computed output.

---

## 5. Master Prompt

### 5.1 Context Injection

The prompt system has 3 levels:

1. **System prompt**: Role, output rules, JSON format requirements
2. **Domain context**: Source code, external types, previously extracted nodes/edges
3. **Task-specific rules**: What to generate, validation criteria, self-check steps

### 5.2 Phase 2 Prompt (Compute Rules) — The Critical One

```
You are generating compute rules for a deterministic simulation engine.

There is NO runtime, NO real server, NO database, NO HTTP calls during simulation.
Each step ONLY receives the previous step's output. The compute rules you generate
will be EXECUTED as operations on the actual input data.

OUTPUT: One raw JSON object with:
{
  "compute": {
    "<node_id>": {
      "steps": [...compute operations...],
      "output": {...template with $variables...},
      "on_empty": {...},
      "on_error": {...}
    }
  },
  "input_schemas": {
    "<node_id>": [...field schemas...]
  }
}

COMPUTE OPERATIONS:
- filter: Remove elements from array by condition
- map: Transform each element (select fields, rename)
- find: Get first matching element
- count: Count array elements
- group_by: Split array into groups by field value
- derive: Compute from other results (arithmetic, concatenation)
- select: Pick specific fields from object
- exists_check: Boolean — does field exist?
- compare: Compare two field values

RULES:
1. Look at the node's source_code. What does it actually DO to the data?
   - If it filters: use filter operation
   - If it counts: use count operation
   - If it classifies: use group_by operation
   - If it validates: use exists_check + compare
2. The output template uses $variable_name to reference computed values
3. Operations execute in order — later ops can reference earlier results
4. Error messages must come from the source code (grep for Err, bail!, error!)
5. Struct nesting must match Rust types exactly

SELF-CHECK:
For each node, verify:
- Does the compute produce a DIFFERENT output when input changes?
- Does the output carry forward all fields downstream nodes need?
- Are $variable references all defined by earlier compute steps?
```

### 5.3 Guardrails

- **No config in conditions**: Validator rejects match on client, timeout, settings, interval, cache
- **No stringified JSON**: Validator rejects escaped JSON strings in outputs
- **No flattened structs**: Validator checks struct nesting matches source_code field access
- **Schema alignment**: Validator checks upstream output contains downstream's required fields
- **Retry with errors**: Each phase runs validate → repair loop (max 2 retries)

### 5.4 Validation Rules

Each phase's output is validated before persisting:

**Phase 1**: Nodes have required fields, edges reference existing nodes, no cycles, valid kinds
**Phase 2**: Compute steps have valid ops, output templates reference defined variables, input_schema fields have types
**Phase 3**: Traces reference existing nodes, steps are reachable via edges, max one catch-all per entry

---

## 6. Failure Modes & Safeguards

| Failure | Impact | Prevention |
|---------|--------|-----------|
| LLM returns truncated JSON | Phase fails | JSON-fix retry prompt |
| LLM generates config fields in conditions | Simulation breaks | Banned field validator + repair |
| LLM flattens struct nesting | Chain misalignment | Struct parity validator + repair |
| LLM embeds JSON as strings | Fields unreachable | Stringified JSON detector + auto-parse |
| Large repo exceeds token limit | Phase 1 fails | File splitting + chunking |
| LLM connection timeout | Phase incomplete | Artifact persistence, skip on retry |
| User edits invalid JSON in UI | Crash | try-catch in all JSON.parse |
| when conditions pre-filtered | Edits don't change path | Runtime evaluation per step |
| Array merge drops user values | Input changes ignored | Arrays from input replace template |
| No entry points detected | No traces, no simulation | Detect by outgoing edges + known kinds |

---

## 7. Build Strategy

### 7.1 Order of Implementation

```
Week 1: Foundation
├─ 1. Compute engine (src/lib/simulation/compute.ts)
│     This unblocks everything. Without dynamic compute, simulation is useless.
├─ 2. Updated schema (add NodeCompute to schema.ts)
├─ 3. Engine integration (resolveNodeOutput uses compute before output_cases)
└─ 4. Manual test: write compute rules for order-monitor by hand, verify in UI

Week 2: Pipeline
├─ 5. Phase 2 prompt rewrite (generate compute rules instead of output_cases)
├─ 6. Compute validator (validate operations, variable references)
├─ 7. Local path scanning (skip git clone for local repos)
└─ 8. Scan order-monitor from local path, verify compute rules work

Week 3: Polish
├─ 9. Per-order-state traces (separate trace for HardFail, UserInitiated, etc.)
├─ 10. UI: show compute operations in step inspector
├─ 11. Performance: ensure < 90s scan for small repos
└─ 12. Test with investor repos (solver-engine, order-credentials, integrator-api)

Week 4: Harden
├─ 13. Edge case testing (empty arrays, null fields, missing nodes)
├─ 14. Error message accuracy (compare with actual Rust error strings)
├─ 15. Demo prep (happy path + failure scenarios)
└─ 16. Documentation update
```

### 7.2 What Comes First

**Compute engine** is the critical path. Everything else (prompts, validators, UI) is incremental improvement on v1. But without compute, the simulation is fundamentally limited to static templates.

### 7.3 Key Tradeoffs

| Decision | Tradeoff | Reasoning |
|----------|----------|-----------|
| Compute over output_cases | More complex engine, but dynamic outputs | Static templates can't filter/count/transform |
| Keep output_cases as fallback | Backwards compatible | Existing JSONs still work |
| OpenAI only | No provider flexibility | Investor demo needs one reliable provider |
| Artifacts on disk | Disk I/O, cleanup needed | Crash recovery worth the cost |
| Runtime when evaluation | Slightly slower per step | Required for input-driven simulation |
| deepFind auto-adapt | May find wrong field in deep nesting | Better than chain breaking on missing field |

### 7.4 What I Would Build First

If I had one day: the compute engine + manual JSON for order-monitor.
If I had one week: compute engine + Phase 2 prompt + local scanning.
If I had one month: full v2 with all traces, UI polish, and hardening.

The compute engine is a ~300 line file that processes operations on JSON data. It's self-contained, testable, and immediately makes every simulation dynamic. Everything else amplifies its impact.
