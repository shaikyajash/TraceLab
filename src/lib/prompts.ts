import { DiscoveredService } from './schema';
import { type ResolvedExternalType, formatExternalTypesForPrompt } from './external-types';

// ~4 chars per token.
// gpt-5.4: 1M context, 128k output, 500k TPM → ~1.6M chars input (~400k tokens) per chunk
// Gemini flash: 1M context → 400k chars is fine
// Claude: 200k context → no cap needed
export const SOURCE_CHAR_LIMITS: Record<string, number> = {
  openai: 1_600_000,
  gemini: 400_000,
  claude: Infinity,
};

export interface ChunkInfo {
  index: number; // 1-based
  total: number;
  allFileNames: string[];
}

export function buildPerServicePrompt(
  service: DiscoveredService,
  externalTypes?: ResolvedExternalType[],
  chunkInfo?: ChunkInfo,
): {
  system: string;
  user: string;
} {
  const fileList = service.rsFiles
    .map((f) => `--- FILE: ${f.relativePath} ---\n${f.content}\n--- END FILE ---`)
    .join('\n\n');

  const externalTypesContext = externalTypes?.length
    ? formatExternalTypesForPrompt(externalTypes)
    : '';

  const system = `You are a senior Rust code analyzer. Read the provided Rust source files and output a single JSON object describing the service architecture, data flow, and execution traces.

╔══════════════════════════════════════════════╗
║  OUTPUT RULE — NEVER VIOLATE                 ║
╚══════════════════════════════════════════════╝
1. Your ENTIRE response must be ONE raw JSON object.
2. First character: "{". Last character: "}".
3. No markdown fences, no prose, no // comments, no explanation outside the JSON.
4. Output the COMPLETE JSON. Never truncate or stop early.
5. All string values must use escaped quotes where needed. No JS-style comments inside JSON.

══════════════════════════════════════════════
RULE 1 — READ EVERYTHING, EXTRACT DEEPLY
══════════════════════════════════════════════

Read ALL files before writing any output. A shallow output (only route handlers and structs) is WRONG.

You MUST extract nodes for every layer:
  a) Every HTTP route handler in the router
  b) Every middleware (auth, logging, rate-limiting, CORS)
  c) Every function directly called by a handler (business logic layer)
  d) Every function those call in turn (validators, transformers, helpers)
  e) Every database function (sqlx, diesel, sea-orm, etc.)
  f) Every outbound HTTP call (reqwest, hyper client, ureq)
  g) Every enum involved in serde deserialization of request/response bodies
  h) Every adapter/wrapper struct that delegates to an external crate (see Rule 6)

If a handler calls handle_foo(), handle_foo is a node. If handle_foo calls validate_bar(), validate_bar is a node. Follow the full call chain.

══════════════════════════════════════════════
RULE 2 — NODE KINDS (use exact values)
══════════════════════════════════════════════

  route_handler      HTTP endpoint — id format: "METHOD /path/{param}"
  middleware         Request interceptor (auth, CORS, logging)
  business_logic     Domain logic / orchestration
  validator          Input/auth validation, constraint checks
  transformer        Data shape change (hashing, encryption, serialization)
  db_call            Database operation (SELECT, INSERT, UPDATE, DELETE)
  external_http_call Outbound HTTP to another service
  struct             Data-carrying struct
  enum               Enum (especially serde-deserialized ones)
  message_queue      Async messaging
  function           Utility / public API function / CLI command handler
  background_process Long-running loop or spawned task
                     (e.g. tokio::spawn loops, screening services, engine runners,
                      cron-style workers, status watchers, main() run loops)

  ENTRY POINTS — nodes that can be the starting point of a trace:
    - route_handler:      HTTP endpoints (most common for web services)
    - function:           Public API functions, CLI subcommand handlers, main() entry,
                          library entry points (pub fn), gRPC method handlers
    - business_logic:     Top-level orchestrators called from main() or external triggers
    - background_process: If the process has meaningful internal call chains worth tracing
    - message_queue:      Message/event consumers that trigger processing pipelines

  Not every service is an HTTP server. Identify the ACTUAL entry points:
    - HTTP server → route_handlers
    - CLI tool → function nodes for each subcommand
    - Library → function nodes for each public API method
    - Worker/daemon → business_logic or background_process for the main loop
    - gRPC/WebSocket → function nodes for each method/handler
    - Message consumer → message_queue nodes for each topic/handler

Id rules:
  - route_handler → "GET /health", "POST /api/items/{id}"
  - enum → "enum_TypeName"
  - others → function or struct name as-is

══════════════════════════════════════════════
RULE 3 — EDGES (call graph, not execution order)
══════════════════════════════════════════════

Create one edge per CALL relationship: "A calls B".

Constraints:
  1. Edges = call/invocation only. NOT sequential order.
     If handle_req() calls validate() and then process(), both edges originate from handle_req:
       handle_req → validate
       handle_req → process
     WRONG: validate → process  (they are siblings, not a sequence)
  2. DAG only — no cycles. A→B→C→A is forbidden.
  3. Include conditional edges (if A calls B only in one match arm, include A→B).
  4. Execution order lives in trace steps, not edges.
  5. A route_handler CAN call another route_handler (internal service calls, delegation patterns).
     When this happens, continue tracing through the called route's full downstream call chain too.

══════════════════════════════════════════════
RULE 4 — SERDE AWARENESS
══════════════════════════════════════════════

Serde attributes change how Rust types appear in JSON:
  #[serde(rename_all = "lowercase")]  → "MyVariant" serializes as "myvariant"
  #[serde(rename_all = "snake_case")] → "MyVariant" serializes as "my_variant"
  #[serde(rename_all = "camelCase")]  → "MyVariant" serializes as "myVariant"
  #[serde(rename = "foo")]            → that variant serializes as "foo"

Rules:
  - Create an enum node for EVERY enum used in request/response serde.
  - In the node's "fields" array, set each variant's "type" to its serde-serialized JSON string value.
  - In example_payload, use only serde-serialized values (never Rust variant names).
  - Unknown enum variant in request → serde fails → 400. This is a real execution path to trace.
  - Never guess variants. Use only what appears in source or EXTERNAL TYPE DEFINITIONS.

══════════════════════════════════════════════
RULE 5 — EXTERNAL CRATE ADAPTERS
══════════════════════════════════════════════

An "adapter" is a struct defined in this service that wraps a type from an external crate and
delegates method calls to it. These are NOT internal business logic — they are the boundary to
an external system.

How to identify them:
  - The struct holds a field of a type from an external crate (use some_crate::...)
  - Its impl block only delegates: self.inner.method(...).await or self.client.post(...)
  - It implements a local trait (Port/Provider pattern) that hides the external dependency

How to classify them:
  - kind: "external_http_call" if the external crate makes network calls (orderbook providers,
    HTTP clients, chain RPC clients, price feeds, oracle services, messaging SDKs)
  - kind: "db_call" if the external crate talks to a database
  - kind: "function" only if it is a pure in-process computation with no I/O

What to put in the node:
  - id: the adapter method being called, e.g. "PendingOrdersAdapter::get_pending_orders"
  - name: short label, e.g. "PendingOrdersAdapter"
  - description: "Delegates to <ExternalType> from crate <crate_name>. Returns <ReturnType>. This is the boundary to an external service — execution continues outside this codebase."
  - input/output: use the actual Rust types from the signature

CRITICAL — The call chain ends ONLY at the true external boundary (the line that calls an external crate).
  - If the adapter method calls other helper functions defined in THESE source files BEFORE hitting the
    external call, those helpers are NOT external. They are internal nodes and MUST be traced.
  - Only stop when you reach a line like: self.client.get(url).send().await or reqwest::get(...), etc.
  - Example: if adapter calls self.build_url() then self.client.post(url), the build_url() is an
    internal node that must be extracted. Only self.client.post(...) is the true external leaf.

Edges:
  - Add an edge from the internal function that calls the adapter → the adapter node
  - The adapter node has no outgoing edges (it is a leaf — execution leaves the codebase)

External packages:
  - Add an entry to external_packages for the external crate with its purpose

══════════════════════════════════════════════
RULE 6 — RUST TRAIT DISPATCH (follow concrete implementations)
══════════════════════════════════════════════

Rust code often calls methods on trait objects (Box<dyn Trait>, Arc<dyn Trait>, impl Trait).
The trace MUST follow through to the concrete struct implementation, not stop at the trait definition.

How to handle trait calls:
  1. When you see code like: self.provider.get_chains(), self.executor.call(), self.store.insert()
     where the field type is a trait → search ALL source files for:
       impl TraitName for ConcreteType { ... }
     blocks and trace through the concrete method body.
  2. Create a node for ConcreteType::method_name (NOT the trait itself).
  3. Continue tracing from inside the concrete method — follow ITS calls recursively.
  4. Only stop when you reach a true external crate call or a function with no source visible.
  5. If multiple concrete implementations exist (e.g. HttpProvider and MockProvider):
     - Extract nodes for ALL of them
     - Use "when" conditions in traces to select between them based on context

What NOT to do:
  - Do NOT create a node for the trait method signature itself
  - Do NOT stop at a function just because it returns a trait object or takes impl Trait
  - Do NOT skip tracing because a struct "looks like" an adapter — check its source_code first

Example of correct tracing:
  Code:  self.executor_provider.get_chains(base_url).await
  Trait: trait ExecutorProvider { async fn get_chains(&self, url: &str) -> Result<Vec<Chain>>; }
  Impl:  impl ExecutorProvider for HttpExecutorProvider { fn get_chains(...) { self.client.get(...).send()... }}
  CORRECT: create node HttpExecutorProvider::get_chains (external_http_call, leaf — uses reqwest)
  WRONG:   create node for ExecutorProvider::get_chains (trait method — not a real callable node)

══════════════════════════════════════════════
RULE 7 — NODE OUTPUT CASES (output_cases)
══════════════════════════════════════════════

output_cases are THE mechanism that makes the visual simulator work. There is NO runtime,
NO real server, NO database, NO HTTP calls during simulation. The ONLY data each step
receives is the previous step's output_case output. If step 3 doesn't include a field in
its output, step 4 CANNOT access it — it does not exist. The chain is a pure data pipeline:

  request body → step 1 output → step 2 output → step 3 output → ... → final output

╔══════════════════════════════════════════════════════════════════╗
║  THE SIMULATION CONTRACT                                         ║
║                                                                  ║
║  1. Each step's output is the ONLY input the next step receives  ║
║  2. There are no side channels — no globals, no shared state     ║
║  3. If a downstream step needs a field, EVERY step between the   ║
║     source and that step MUST carry it forward in their output   ║
║  4. output_cases define the complete data at each point — they   ║
║     are not summaries, they are the ACTUAL simulated payload     ║
╚══════════════════════════════════════════════════════════════════╝

WHEN TO ADD output_cases:
  Add output_cases on EVERY node that appears in a trace. This includes:
  - route_handler, middleware, business_logic, validator, transformer, function
  - db_call, external_http_call: return MOCK data via output_cases (there is no real DB/API)
  - background_process: if it appears as an entry point or step in a trace, it NEEDS output_cases
  - message_queue: same — if traced, it needs output_cases
  Add as many cases as the node's actual logic requires.
  SKIP only: struct, enum (they are type definitions, not executable steps)
  If a node truly always returns the same value regardless of input, use example_output.

  CRITICAL — external_http_call / db_call in simulation:
    There is NO real network, NO real database. These nodes MUST return mock data via output_cases.
    The mock data should be realistic: use the node's actual return type with plausible values.
    For a db_call that returns Vec<Order>, the success output_case should include actual mock orders.
    For an external_http_call that fetches data, the output_case IS the mock response.
    Different inputs should produce different mock outputs — use match conditions to distinguish.

╔══════════════════════════════════════════════════════════════════╗
║  CRITICAL — CHAIN-AWARE CONDITIONS                               ║
║                                                                  ║
║  output_cases are evaluated against the INPUT payload flowing    ║
║  INTO that node — which is the PREVIOUS step's OUTPUT, NOT the   ║
║  original request body.                                          ║
║                                                                  ║
║  Before writing output_cases for a node, ask:                    ║
║    "What does the UPSTREAM node output? What fields does         ║
║     THAT output have? My conditions must match THOSE fields."    ║
║                                                                  ║
║  Example chain:                                                  ║
║    route_handler outputs: {"action": "create", "data": {...}}    ║
║    → validator receives that, checks "action" field              ║
║    → validator outputs: {"ok": true, "data": {...}}              ║
║    → business_logic receives THAT, checks "ok" field             ║
║    → business_logic outputs: {"result": {...}} or {"error": ..}  ║
║    → db_call receives THAT, checks "result" field                ║
║                                                                  ║
║  WRONG: db_call checking {"field": "action", "op": "eq", ...}    ║
║         — "action" is in the request body, not in what db_call   ║
║           receives from business_logic                           ║
║  RIGHT: db_call checking {"field": "result", "op": "exists"}     ║
║         — "result" is what business_logic actually outputs       ║
╚══════════════════════════════════════════════════════════════════╝

FORMAT:
  "output_cases": [
    {
      "match": [{"field": "token", "op": "exists"}],
      "output": {"authorized": true, "user_id": "usr_123", "data": "...forwarded..."},
      "explanation": "Token present — authorized, continue chain"
    },
    {
      "match": [],
      "output": {"authorized": false, "status": 401},
      "explanation": "No token — rejected",
      "terminates": true
    }
  ]

  "terminates" field (boolean, optional):
    Set "terminates": true on any output_case that represents an error, rejection, or
    early return — e.g. auth failure (401/403), validation error (400), not-found (404).
    When the simulator hits a terminating output_case, it STOPS the chain at this node.
    Downstream steps are not executed. This prevents impossible flows like
    "auth rejected → business logic runs anyway → db call succeeds".

    Add terminates: true when:
      - middleware rejects (unauthorized, rate-limited)
      - validator fails (invalid input)
      - business_logic short-circuits on an error from upstream
      - db_call / external_http_call returns a fatal error
      - route_handler returns an error response
    Do NOT add terminates on success cases — they should continue the chain.

Rules:
  - Same condition ops as trace match: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field, eq_type
  - First case whose match passes wins. match: [] = unconditional catch-all. Put it LAST.
  - output value must be a PARSED JSON value (object, array, string, number, boolean, null).
    NEVER embed JSON as an escaped string like "{\"key\":\"val\"}". Use actual objects: {"key":"val"}.
    WRONG: "data": "{\"orders\":[{\"id\":\"1\"}]}"   ← string containing escaped JSON
    RIGHT: "data": {"orders": [{"id": "1"}]}          ← actual parsed JSON object
  - Keep output values realistic: use the node's actual return type fields, not placeholder strings.
  - STRICT STRUCT PARITY: output JSON must mirror the exact Rust struct nesting. If the code
    accesses order.create_order.create_id, the output must have {"create_order":{"create_id":"x"}},
    NOT a flattened {"create_id":"x"}. Look at source_code field access patterns to confirm nesting.
  - Success output_cases MUST carry forward enough fields for downstream nodes to evaluate
    THEIR conditions. If business_logic needs to check "authorized", then middleware's success
    output must include an "authorized" field.

HOW TO WRITE output_cases — MANDATORY PROCEDURE:

  There is NO runtime during simulation. Each step ONLY receives the previous step's output.
  If step 3 drops a field, step 4+ can NEVER access it. Plan the full pipeline first.

  PLAN STEP A — MAP DATA NEEDS: For each trace, list every step and note:
     - What fields does this node NEED from its input? (from source code)
     - What fields does this node PRODUCE? (from return type / source code)

  PLAN STEP B — BUILD THE PIPELINE: Walk the trace forward. For each step's success output:
     - Include its OWN produced fields
     - Include ALL fields that ANY later step needs but this step didn't produce
       (carry forward from input unchanged)
     If step 5 needs "url" from step 1, then steps 2, 3, and 4 MUST ALL include "url".

  PLAN STEP C — WRITE output_cases:

  1. LOOK UPSTREAM: What does the previous step's success output contain?
     → Match conditions MUST reference fields from THAT output, not the original request.

  2. LOOK DOWNSTREAM: What fields does the next step need?
     → Success output MUST include those fields.

  3. CARRY FORWARD: If ANY later step needs a field from earlier, pass it through.
     THIS IS THE #1 MISTAKE — step 3 drops a field, step 4 can't find it → chain breaks.
     When in doubt, include the field.

  4. WRITE SUCCESS CASE: match on upstream fields → output = own fields + carried fields.
  5. WRITE ERROR CASE(S): match on error/missing → output error + "terminates": true.
  6. WRITE CATCH-ALL (optional): match: [] → error + "terminates": true.

  SELF-CHECK: After writing all output_cases, walk each trace end-to-end:
     Take step 1's success output → does step 2's match reference those fields? ✓
     Take step 2's success output → does step 3's match reference those fields? ✓
     ... all the way to the last step. If any link breaks, fix it before moving on.

  CONCRETE EXAMPLE — 4-step chain:
    Step 1 (route_handler): receives request {"url": "...", "chains": [...]}
      output_case match: [{"field": "url", "op": "exists"}]
      output: {"ok": true, "url": "...", "chains": ["eth"]}          ← carries url + chains forward

    Step 2 (middleware): receives step 1's output
      output_case match: [{"field": "ok", "op": "eq", "value": true}, {"field": "url", "op": "exists"}]
      output: {"ok": true, "url": "...", "verified": true}           ← carries url forward, adds verified
      error case match: [{"field": "ok", "op": "eq", "value": false}]
      output: {"ok": false, "error": "upstream failed"}, terminates: true

    Step 3 (business_logic): receives step 2's output
      output_case match: [{"field": "ok", "op": "eq", "value": true}, {"field": "verified", "op": "eq", "value": true}]
      output: {"ok": true, "result": {"registered": true}}           ← uses fields from step 2
      error case match: [{"field": "ok", "op": "eq", "value": false}]
      output: {"ok": false, "error": "upstream failed"}, terminates: true

    Step 4 (db_call): receives step 3's output
      output_case match: [{"field": "ok", "op": "eq", "value": true}, {"field": "result", "op": "exists"}]
      output: {"ok": true, "stored": true}                           ← uses "result" from step 3
      error case match: [{"field": "ok", "op": "eq", "value": false}]
      output: {"ok": false, "error": "upstream failed"}, terminates: true

  KEY INSIGHT: If the user edits step 2's input and removes the "url" field, step 2's match
  fails → falls to catch-all → outputs {ok: false, error: ...} with terminates: true →
  chain STOPS at step 2. Steps 3 and 4 never run. This is correct behavior.

══════════════════════════════════════════════
RULE 8 — TRACES (most critical section)
══════════════════════════════════════════════

Traces are the ONLY thing that drives the visual flow simulator. Without complete traces, the simulator shows nothing.

STEP 1 — For EVERY entry point, trace execution from entry all the way to the final output.

  Entry points are NOT just HTTP route_handlers. Identify ALL of them:
    - HTTP server → every route_handler
    - CLI tool → every subcommand handler (function node)
    - Library → every public API method (function node)
    - Worker/daemon → the main processing loop (business_logic / background_process)
    - gRPC/WebSocket → every method handler (function node)
    - Message consumer → every topic handler (message_queue / function node)

  Think like a debugger stepping through the code:
    entry_point receives input (request body, CLI args, message payload, function args, config)
      → calls middleware / auth check (if any)
        → calls business_logic fn
          → calls validator
          → calls db_call  ← keep going (returns MOCK data)
          → calls external_http_call  ← keep going (returns MOCK response)
          → evaluates conditions / classifies results
          → returns result
        → business_logic returns
      → entry_point produces final output  ← this is the end

  Every function visited in that walk = one step. Do NOT stop at any intermediate node.
  If an entry point internally calls another entry point, continue tracing through
  its full downstream chain too — all the way to its leaf nodes.

  ══════════════════════════════════════════════
  MODELING NON-SERVER EXECUTION CONTEXTS
  ══════════════════════════════════════════════

  The simulation model is NOT limited to HTTP request/response. It is a UNIFIED EXECUTION
  MODEL that works for any code path. The key principle:

    input → step 1 → step 2 → ... → output
    (any change in input produces a predictable change in output)

  For scripts, cron jobs, background services, and monitors:

  A) ENTRY POINT INPUT = initial state
     For an HTTP handler: the request body
     For a cron job / monitor: the CONFIG + THRESHOLDS + MOCK EXTERNAL STATE
     For a CLI tool: the CLI arguments + flags
     For a message consumer: the message payload

     Example — Order Monitor:
       entry input: {"config": {"delay_threshold_s": 300}, "fetched_orders": [...mock orders...]}

     The "fetched_orders" are MOCK data that the simulator uses instead of calling a real API.
     The user can edit these mock values to test different scenarios.

  B) EXTERNAL CALLS = MOCK DATA SOURCES
     db_call and external_http_call nodes MUST return mock data via output_cases.
     The mock data is the "simulated external state" — it replaces the real DB/API.

     Example — fetch_pending_orders (external_http_call):
       input_schema: [{"field": "chain", "type": "string", "required": true}]
       output_cases:
         match [chain exists]: {"ok": true, "orders": [{"id": "order-1", "status": "pending", "age_s": 450}]}
         catch-all: {"ok": false, "error": "Failed to fetch orders"}

     The user can edit the mock orders to test different scenarios:
       - Change age_s to 100 → order is within threshold → no alert
       - Change age_s to 600 → order exceeds threshold → delayed alert
       - Remove orders array → fetch failure → error path

  C) EVALUATION / CLASSIFICATION STEPS
     Business logic that classifies results should produce CATEGORIZED outputs:

     Example — evaluate_orders (business_logic):
       input_schema: [{"field": "orders", "type": "array", "required": true},
                       {"field": "config.delay_threshold_s", "type": "number", "required": true}]
       output_cases:
         match [orders[0].age_s > threshold equivalent]:
           {"delayed": [{"id": "order-1", "age_s": 450}], "ok": [], "invalid": []}
         match [orders[0] exists, all within threshold]:
           {"delayed": [], "ok": [{"id": "order-1"}], "invalid": []}
         match [orders is empty array]:
           {"delayed": [], "ok": [], "invalid": [], "note": "No orders to evaluate"}
         catch-all:
           {"error": "Evaluation failed — invalid input"}, terminates: true

  D) EVERY PATH IS A TRACE
     A monitor that checks for delayed orders has MULTIPLE distinct paths:
       Trace 1: "Normal — all orders within threshold" → no alerts
       Trace 2: "Delayed orders detected" → alert generated
       Trace 3: "Fetch failure" → error logged
       Trace 4: "No pending orders" → idle / skip

     Each produces a DIFFERENT structured output. Not a generic log message.

  Two paths are distinct if they visit DIFFERENT nodes:
    - match arms dispatching to different functions
    - if/else calling different components
    - Option/Result that short-circuits on None/Err
    - Path parameter / CLI flag dispatch
    - Auth role dispatch (admin vs user)
    - Cached vs uncached path

STEP 2 — Write one trace per distinct path. Most-specific FIRST, catch-alls LAST.

  Trace fields:
    route_id         entry point node id (route_handler, function, business_logic, etc.)
    label            human name including the distinguishing condition
    description      one line: what this path does and how it ends
    example_payload  JSON object (NOT a string) that triggers this exact path
    match            array of conditions (ALL must pass); [] = unconditional/catch-all
    steps            complete end-to-end list — see below

  STEPS — follow every edge until you hit a true leaf (no outgoing edges):
    step 1 : the entry point itself (route_handler, function, business_logic, etc.)
    step 2 : first node it calls
    step 3 : what that node calls
    ... keep going until the final db_call / external_http_call / leaf function

    Self-check before finalizing: for every step, look at its outgoing edges.
    If any target is NOT already a later step, you stopped too early — add it.

  Step fields:
    node_id          id from the nodes array (must exist)
    edge_label       data flowing IN to this step ("" for first step)
    summary          what happens here and why — include condition evaluation result
    when             (optional) this step is skipped if condition is false

STEP 3 — Condition format (used in both "match" and "when"):
    {"field": "action",    "op": "eq",        "value": "create"}
    {"field": "role",      "op": "in",        "value": ["admin", "editor"]}
    {"field": "role",      "op": "not_in",    "value": ["admin"]}
    {"field": "token",     "op": "exists"}
    {"field": "token",     "op": "not_exists"}
    {"field": "src_chain", "op": "eq_field",  "value": "dst_chain"}
    {"field": "src_chain", "op": "neq_field", "value": "dst_chain"}
    {"field": "chains[0]", "op": "eq_type",   "value": "string"}
  Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field, eq_type

  FIELD ACCESS — dot notation and array indices are both supported:
    "chains[0].solver_id"  accesses the solver_id field of the first element of chains
    "chains[0]"            accesses the first element itself (useful with eq_type)
    "body.user.role"       deep nested access

  eq_type — USE THIS when a route accepts multiple payload formats that differ by element type,
  not just by field presence. Value is the JavaScript typeof string: "string", "number",
  "boolean", "object".

  CRITICAL — when to use eq_type vs not_exists:
    WRONG: use "chains[0].name not_exists" to detect legacy format.
           This also matches {"chains": [{}]} (empty object), causing the wrong trace to run.
    RIGHT: use "chains[0] eq_type string" to confirm the element itself is a primitive string.
           {"chains": ["ethereum"]} → chains[0] is "string" → matches legacy trace ✓
           {"chains": [{}]}        → chains[0] is "object" → falls through to catch-all ✓

  Common pattern — multi-format route (current object format vs legacy string format):
    Trace A (current format):  match: [{"field": "chains[0].solver_id", "op": "exists"}]
    Trace B (legacy format):   match: [{"field": "chains[0]", "op": "eq_type", "value": "string"}]
    Trace C (deserialization failure): match: []  ← catches anything else, e.g. [{}]

STEP 4 — Parametric traces: avoid combinatorial explosion.
  Do NOT write one trace per enum variant combination.
  Write ONE trace and use per-step "when" conditions:
    step_a runs when format=="json"
    step_b runs when format=="xml"
  At runtime, only matching steps execute.

STEP 5 — Exactly ONE catch-all trace per route (LAST):
  ONLY ONE trace per route may have match: [].
  Every other trace MUST have at least one match condition.
  Multiple match: [] traces are FORBIDDEN — the resolver picks the first one
  arbitrarily and the others become unreachable dead code.

  The single catch-all (match: []) = "deserialization failure / unknown input" → 400.

  Other error traces MUST have distinguishing conditions:
    - "Unauthorized" → match: [{"field": "token", "op": "not_exists"}]
    - "Unknown action" → match: [{"field": "action", "op": "not_in", "value": ["known1", "known2"]}]
    - "Wildcard mismatch" → use negated conditions from the specific traces

  WRONG (traces 2+3 unreachable):
    Trace 1: match: [{"field": "action", "op": "eq", "value": "create"}]
    Trace 2: match: []  ← "Unauthorized"
    Trace 3: match: []  ← "Deserialization failure"
  RIGHT:
    Trace 1: match: [{"field": "action", "op": "eq", "value": "create"}]
    Trace 2: match: [{"field": "token", "op": "not_exists"}]  ← "Unauthorized"
    Trace 3: match: []  ← single catch-all

STEP 6 — Path parameter dispatch:
  /{action} routes → trace per known action value using:
    {"field": "action", "op": "in", "value": ["initiate", "redeem", "refund"]}
  Add catch-all for unknown path param values.

══════════════════════════════════════════════
OUTPUT SCHEMA
══════════════════════════════════════════════

The output object must have exactly these top-level keys:
  service, nodes, edges, mutations, external_packages, traces

NODE — all fields required on every node (use null for optional fields with no value):
  "id"              string    unique stable id
  "service"         string    service name
  "kind"            string    one of the kind values from Rule 2
  "name"            string    short human-readable label
  "input"           string|null  input type signature
  "output"          string|null  output type signature
  "mutates_state"   boolean   true if writes to DB, file, or external state
  "mutation_target" string|null  table/resource name when mutates_state is true
  "defined_in"      string    source file path
  "description"     string    1-2 sentences describing behavior
  "method"          string|null  HTTP method (route_handler only, else null)
  "path_pattern"    string|null  URL pattern (route_handler only, else null)
  "handler"         string|null  handler fn path (route_handler only, else null)
  "source_code"     string|null  verbatim function or struct definition from source
  "example_payload" string|null  JSON string of a realistic request body (route_handler only)
  "example_input"   object|null  realistic example JSON of data flowing INTO this node (all kinds).
                                 Generate based on the function's input type and logic.
                                 null only if input type is () or the node takes no data.
  "example_output"  object|null  realistic example JSON of data flowing OUT of this node (all kinds).
                                 Generate based on the return type and source code logic.
                                 null only if return type is () or void.
  "fields"          array|null   enum: [{name, type:"serde-value"}]  struct: [{name, type}]  else: null
  "output_cases"    array|null   conditional outputs — see Rule 7. Add on every node whose output varies.
                                 null only if the node truly always returns the same value.
                                 Each entry: {"match": [...], "output": <value>, "explanation": "...", "terminates": bool}
                                 "terminates": true on error/rejection cases — stops the simulation chain.
                                 CONDITIONS MUST MATCH FIELDS FROM THE UPSTREAM NODE'S OUTPUT, not the request body.
                                 match: [] = unconditional catch-all (put last). First matching case wins.

EDGE:
  "from"         string   caller node id
  "to"           string   callee node id
  "payload"      string   what data flows (type name, shape, key fields)
  "from_service" string   service name
  "to_service"   string   service name

MUTATION:
  "id"           string   unique, prefix "mut_"
  "service"      string   service name
  "kind"         string   always "mutation"
  "mutates"      string   "table_name (INSERT ON CONFLICT)" style description
  "via"          string   "sqlx::query_as", "diesel", "fs::write", etc.
  "in_component" string   node id performing this mutation
  "defined_in"   string   source file path

EXTERNAL PACKAGE:
  "crate"            string    crate name
  "used_in_services" string[]  service names using it
  "purpose"          string    what this crate does in this service

TRACE:
  "route_id"        string   route_handler node id
  "label"           string   human name with distinguishing variant
  "description"     string   one line: path + outcome
  "example_payload" object   JSON object (not string) that triggers this path
  "match"           array    condition objects. MAX ONE trace per route may use []. All others MUST have conditions.
  "steps"           array    ordered step objects

STEP:
  "node_id"    string   must exist in nodes array
  "edge_label" string   data flowing in ("" for first step)
  "summary"    string   what happens + why, include condition results
  "when"       object   (optional) step skipped unless this condition passes

══════════════════════════════════════════════
EXAMPLE OUTPUT SHAPE (generic — replace all placeholders with real values)
══════════════════════════════════════════════

{
  "service": {"id": "<name>", "kind": "service", "path": "<path>", "description": "<desc>"},
  "nodes": [
EXAMPLE CHAIN FLOW (read top-to-bottom — each node's output becomes the next node's input):

    STEP 1: {"id": "POST /items/{id}", "kind": "route_handler", ...
     "output_cases": [
       {"match": [{"field": "name", "op": "exists"}],
        "output": {"ok": true, "name": "widget", "token": "Bearer abc"},
        "explanation": "Valid request body — forward name + token to middleware"},
       {"match": [],
        "output": {"ok": false, "error": "Missing required fields"},
        "explanation": "Invalid body", "terminates": true}
     ]}
       ↓ step 1 outputs: {"ok": true, "name": "widget", "token": "Bearer abc"}

    STEP 2: {"id": "auth_middleware", "kind": "middleware", ...
     "output_cases": [
       {"match": [{"field": "ok", "op": "eq", "value": true}, {"field": "token", "op": "exists"}],
        "output": {"ok": true, "authorized": true, "user_id": "usr_123", "name": "widget"},
        "explanation": "ok + token from step 1 → authorized. Carry 'name' forward for step 3."},
       {"match": [{"field": "ok", "op": "eq", "value": false}],
        "output": {"ok": false, "error": "Upstream rejected"},
        "explanation": "Step 1 already failed", "terminates": true},
       {"match": [],
        "output": {"ok": false, "authorized": false, "status": 401},
        "explanation": "No token in step 1 output", "terminates": true}
     ]}
       ↓ step 2 outputs: {"ok": true, "authorized": true, "user_id": "usr_123", "name": "widget"}

    STEP 3: {"id": "create_item", "kind": "business_logic", ...
     "output_cases": [
       {"match": [{"field": "ok", "op": "eq", "value": true}, {"field": "authorized", "op": "eq", "value": true}],
        "output": {"ok": true, "item": {"id": "item_1", "name": "widget", "owner": "usr_123"}},
        "explanation": "ok + authorized from step 2 → create item. Uses name + user_id from step 2."},
       {"match": [{"field": "authorized", "op": "eq", "value": false}],
        "output": {"ok": false, "error": "Unauthorized"},
        "explanation": "Step 2 rejected auth", "terminates": true},
       {"match": [],
        "output": {"ok": false, "error": "Unexpected input"},
        "explanation": "Catch-all", "terminates": true}
     ]}
       ↓ step 3 outputs: {"ok": true, "item": {"id": "item_1", "name": "widget", "owner": "usr_123"}}

    STEP 4: {"id": "insert_item_db", "kind": "db_call", ...
     "output_cases": [
       {"match": [{"field": "ok", "op": "eq", "value": true}, {"field": "item", "op": "exists"}],
        "output": {"ok": true, "stored": true, "id": "item_1"},
        "explanation": "ok + item from step 3 → INSERT into DB"},
       {"match": [{"field": "ok", "op": "eq", "value": false}],
        "output": {"ok": false, "error": "Upstream failed — skipped DB"},
        "explanation": "Step 3 failed", "terminates": true},
       {"match": [],
        "output": {"ok": false, "error": "DB insert failed"},
        "explanation": "Catch-all", "terminates": true}
     ]}

    KEY: If user edits step 2's input and removes "token", step 2 falls to catch-all →
    outputs {"ok": false, "authorized": false, "status": 401} with terminates: true →
    chain STOPS. Steps 3 and 4 never execute.

    The above is the PATTERN you must follow for every node in every trace.

    Full node definitions (replace all placeholders with real values from source code):

    {"id": "POST /items/{id}", "service": "<svc>", "kind": "route_handler", "name": "<Name>",
     "input": "<InputType>", "output": "<OutputType>", "mutates_state": true,
     "mutation_target": "<table>", "defined_in": "src/handlers.rs",
     "description": "<what it does>", "method": "POST", "path_pattern": "/items/{id}",
     "handler": "<module::fn>", "source_code": "<verbatim fn body>",
     "example_payload": "{\"name\":\"widget\"}",
     "example_input": {"name": "widget"}, "example_output": {"ok": true, "name": "widget"}, "fields": null,
     "output_cases": "... (see chain flow above)"},
    {"id": "<middleware_id>", "service": "<svc>", "kind": "middleware", "name": "<Name>",
     "input": "Request", "output": "Request + auth context or error", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/auth.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null,
     "source_code": "<verbatim>", "example_payload": null,
     "example_input": {"ok": true, "token": "Bearer abc"},
     "example_output": {"ok": true, "authorized": true, "user_id": "usr_123"}, "fields": null,
     "output_cases": "... (see chain flow above)"},
    {"id": "<fn_name>", "service": "<svc>", "kind": "business_logic", "name": "<Name>",
     "input": "<type>", "output": "<type>", "mutates_state": false, "mutation_target": null,
     "defined_in": "src/domain.rs", "description": "<desc>", "method": null,
     "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"ok": true, "authorized": true, "name": "widget"},
     "example_output": {"ok": true, "item": {"id": "item_1", "name": "widget"}}, "fields": null,
     "output_cases": "... (see chain flow above)"},
    {"id": "<validate_fn>", "service": "<svc>", "kind": "validator", "name": "<Name>",
     "input": "<type>", "output": "Result<(), <Err>>", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/validate.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"ok": true, "data": {"field": "value"}},
     "example_output": {"ok": true, "valid": true, "data": {"field": "value"}}, "fields": null,
     "output_cases": [
       {"match": [{"field": "ok", "op": "eq", "value": true}, {"field": "data.field", "op": "exists"}],
        "output": {"ok": true, "valid": true, "data": {"field": "value"}},
        "explanation": "ok from upstream + required field present → valid. Carry data forward."},
       {"match": [{"field": "ok", "op": "eq", "value": false}],
        "output": {"ok": false, "error": "Upstream failed"},
        "explanation": "Upstream failed", "terminates": true},
       {"match": [],
        "output": {"ok": false, "error": "Validation failed — missing field"},
        "explanation": "Missing required field", "terminates": true}
     ]},
    {"id": "<db_fn>", "service": "<svc>", "kind": "db_call", "name": "<Name>",
     "input": "<params>", "output": "Result<<Record>>", "mutates_state": true,
     "mutation_target": "<table>", "defined_in": "src/store.rs", "description": "<SQL op>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"ok": true, "item": {"id": "item_1", "name": "widget"}},
     "example_output": {"ok": true, "stored": true, "id": "item_1"}, "fields": null,
     "output_cases": [
       {"match": [{"field": "ok", "op": "eq", "value": true}, {"field": "item", "op": "exists"}],
        "output": {"ok": true, "stored": true, "id": "item_1"},
        "explanation": "ok from upstream + item data present → INSERT into DB"},
       {"match": [{"field": "ok", "op": "eq", "value": false}],
        "output": {"ok": false, "error": "Upstream failed — skipped DB"},
        "explanation": "Upstream failed", "terminates": true},
       {"match": [],
        "output": {"ok": false, "error": "DB operation failed"},
        "explanation": "Catch-all", "terminates": true}
     ]},
    {"id": "enum_<Name>", "service": "<svc>", "kind": "enum", "name": "<Name>",
     "input": null, "output": null, "mutates_state": false, "mutation_target": null,
     "defined_in": "src/types.rs",
     "description": "#[serde(rename_all=\"<rule>\")]. Unknown values fail serde.",
     "method": null, "path_pattern": null, "handler": null,
     "source_code": "<verbatim derive + serde attrs + variants>", "example_payload": null,
     "example_input": null, "example_output": null,
     "fields": [{"name": "<Variant>", "type": "\"<serde-value>\""}]}
  ],
  "edges": [
    {"from": "<caller>", "to": "<callee>", "payload": "<data flowing>",
     "from_service": "<svc>", "to_service": "<svc>"}
  ],
  "mutations": [
    {"id": "mut_<unique>", "service": "<svc>", "kind": "mutation",
     "mutates": "<table> (INSERT)", "via": "sqlx::query_as",
     "in_component": "<db_call_id>", "defined_in": "src/store.rs"}
  ],
  "external_packages": [
    {"crate": "<name>", "used_in_services": ["<svc>"], "purpose": "<what it does>"}
  ],
  "traces": [
    {
      "route_id": "POST /items/{id}",
      "label": "<Action> — <specific condition>",
      "description": "<one line: path + outcome>",
      "example_payload": {"<field>": "<value-that-triggers-this-path>"},
      "match": [
        {"field": "<field>", "op": "eq", "value": "<value>"},
        {"field": "<enum_field>", "op": "in", "value": ["<v1>", "<v2>"]}
      ],
      "steps": [
        {"node_id": "<id>", "edge_label": "", "summary": "<what + why>"},
        {"node_id": "<id>", "edge_label": "<data>", "summary": "<what + why>",
         "when": {"field": "<f>", "op": "eq", "value": "<v>"}}
      ]
    },
    {
      "route_id": "POST /items/{id}",
      "label": "Deserialization failure — invalid input",
      "description": "Unknown enum variant in body. serde fails → 400.",
      "example_payload": {"<field>": "<unknown-value>"},
      "match": [],
      "steps": [
        {"node_id": "POST /items/{id}", "edge_label": "",
         "summary": "serde_json deserialization fails on unknown variant → 400 Bad Request."}
      ]
    }
  ]
}`;

  const externalTypesSection = externalTypesContext
    ? `\n\nEXTERNAL TYPE DEFINITIONS\n${'─'.repeat(40)}\nThe following types are defined in external crates used by this service.\nUse ONLY these exact definitions for enum variants, struct fields, and serde behavior.\nDo NOT guess or invent anything not listed here.\n\n${externalTypesContext}`
    : '';

  const chunkHeader = chunkInfo
    ? `CHUNKED ANALYSIS — chunk ${chunkInfo.index} of ${chunkInfo.total}.
All files in this service: ${chunkInfo.allFileNames.join(', ')}
You are only seeing a SUBSET of files in this chunk. Extract only what is defined in these files.
Do NOT invent nodes or edges for files you cannot see. Other chunks will cover them.
IMPORTANT: Set "output_cases": null on ALL nodes — output_cases will be generated in a separate pass after all chunks are merged, when the full call graph is available.
IMPORTANT: Set "traces": [] — traces will also be generated separately after merging.
Still output a complete, valid JSON object for all other fields.

`
    : '';

  const user = `${chunkHeader}Analyze the Rust service "${service.name}" (path: "${service.path}").

BEFORE writing any output, do this analysis mentally:
  1. Read every file completely.
  2. Trace every call chain: entry points (route handlers, public functions, CLI handlers, main loops) → business logic → validators/transformers → db_calls.
  3. Identify every branch point in every entry point and handler (match arms, if/else, flags, Option/Result).
  4. List all enums used in serde deserialization and confirm their serde-serialized variant values.

THEN produce the complete JSON object. Do not truncate. Do not stop early.

${fileList}${externalTypesSection}`;

  return { system, user };
}

export function buildTracesOnlyPrompt(
  serviceName: string,
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    description: string;
    source_code?: string | null;
    example_payload?: string | null;
  }>,
  edges: Array<{ from: string; to: string; payload: string }>,
): { system: string; user: string } {
  const system = `You are a Rust code analyzer generating execution traces for a visual flow simulator.

OUTPUT RULE: Your ENTIRE response must be ONE raw JSON object.
First character: "{". Last character: "}". No markdown, no prose, no comments.

Output shape:
{
  "traces": [ ...trace objects... ]
}

${`══════════════════════════════════════════════
TRACE RULES
══════════════════════════════════════════════

STEP 1 — Build the full call tree for EVERY entry point node:
  Entry points = route_handler, public function, CLI handler, main loop, message consumer.
  Not just HTTP routes — identify ALL nodes that are the starting point of a call chain.
  Start at the entry point. Follow every edge outward recursively.
  Every reachable node IS a step. Do not stop at business_logic — keep following edges to db_calls, validators, etc.

  Self-check before finalizing each trace: for every step, look at its outgoing edges in the EDGES list.
  If any edge target is NOT already a later step, you stopped too early — add it.
  A trace is complete only when every step's outgoing edges are accounted for as later steps or conditional branches.

STEP 2 — Write one trace per distinct execution path.
  Distinct = different nodes visited due to a branch:
    - match arms dispatching to different functions
    - if/else calling different components
    - Option/Result that short-circuits on None/Err
    - Path parameter / CLI flag / input variant dispatch
    - Auth role dispatch
  Look at the source_code of EVERY node to identify all branch points — not just the entry point.
  Ordering: most-specific (has match conditions) FIRST, catch-all (match: []) LAST.

STEPS — THE #1 RULE:
  step 1: the entry point itself (route_handler, function, business_logic, etc.)
  step 2+: every node it calls, then every node those call, until leaf nodes (no outgoing edges)
  Cross-check: for each step's node_id, find its outgoing edges — those targets must also be steps.

STEP 3 — Condition format (used in both "match" and "when"):
  {"field": "action",    "op": "eq",        "value": "create"}
  {"field": "role",      "op": "in",        "value": ["admin", "editor"]}
  {"field": "role",      "op": "not_in",    "value": ["admin"]}
  {"field": "token",     "op": "exists"}
  {"field": "token",     "op": "not_exists"}
  {"field": "src_chain", "op": "eq_field",  "value": "dst_chain"}
  {"field": "src_chain", "op": "neq_field", "value": "dst_chain"}
  {"field": "chains[0]", "op": "eq_type",   "value": "string"}
  Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field, eq_type

  FIELD ACCESS — dot notation and array indices both supported:
    "chains[0].solver_id" → first element's solver_id field
    "chains[0]"           → first element itself (use with eq_type)

  eq_type — use when a route accepts multiple payload formats that differ by element type.
  Value is the JavaScript typeof string: "string", "number", "boolean", "object".

  CRITICAL — when to use eq_type vs not_exists:
    WRONG: "chains[0].solver_id not_exists" to mean "legacy format"
           — also matches {"chains": [{}]}, sending the wrong trace
    RIGHT: "chains[0] eq_type string" confirms the element is a primitive string
           {"chains": ["ethereum"]} → string → legacy ✓
           {"chains": [{}]}        → object → falls to catch-all ✓

  Multi-format pattern:
    current format trace:  match: [{"field": "chains[0].solver_id", "op": "exists"}]
    legacy format trace:   match: [{"field": "chains[0]", "op": "eq_type", "value": "string"}]
    deserialization catch: match: []

STEP 4 — Parametric traces: avoid combinatorial explosion.
  Do NOT write one trace per enum variant combination.
  Write ONE trace and use per-step "when" conditions:
    step_a runs when format=="json"
    step_b runs when format=="xml"
  At runtime, only matching steps execute.

STEP 5 — Exactly ONE catch-all trace per route (LAST):
  ONLY ONE trace per route may have match: [].
  Every other trace MUST have at least one match condition.
  Multiple match: [] traces are FORBIDDEN — the resolver picks the first one
  arbitrarily and the others become unreachable.

  The single catch-all (match: []) = "deserialization failure / unknown input" → 400.
  Other error traces MUST have distinguishing conditions:
    - "Unauthorized" → match: [{"field": "token", "op": "not_exists"}]
    - "Unknown action" → match: [{"field": "action", "op": "not_in", "value": [...known...]}]

STEP 6 — Path parameter dispatch:
  /{action} routes → trace per known action value using:
    {"field": "action", "op": "in", "value": ["initiate", "redeem", "refund"]}
  Add catch-all for unknown path param values.

Trace fields:
  route_id         entry point node id (route_handler, function, business_logic, etc.)
  label            short name with distinguishing condition
  description      one line: what this path does and how it ends
  example_payload  JSON object (not string) that triggers this path
  match            condition array. MAX ONE trace per entry may use []. All others MUST have conditions.
  steps            complete ordered list (see above)

Step fields:
  node_id     id from the nodes list (must exist)
  edge_label  data flowing in ("" for step 1)
  summary     what happens here and why, including condition evaluation result
  when        (optional) skip this step if condition fails

Condition format: {"field": "x", "op": "eq", "value": "y"}
Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field, eq_type`}`;

  // Entry points: nodes with outgoing edges but no incoming edges, or known entry kinds
  const incomingNodes = new Set(edges.map((e) => e.to));
  const ENTRY_KINDS = new Set(['route_handler', 'background_process']);
  const entryPoints = nodes.filter(
    (n) =>
      ENTRY_KINDS.has(n.kind) || (!incomingNodes.has(n.id) && edges.some((e) => e.from === n.id)),
  );
  const entryIds = new Set(entryPoints.map((n) => n.id));
  const otherNodes = nodes.filter((n) => !entryIds.has(n.id));

  const formatNode = (n: (typeof nodes)[0]) =>
    `[${n.kind}] id="${n.id}" name="${n.name}"\n  desc: ${n.description}${n.source_code ? `\n  source:\n${n.source_code}` : ''}${n.example_payload ? `\n  example_payload: ${n.example_payload}` : ''}`;

  const nodesSummary = [
    '── ENTRY POINTS (create traces for these) ──',
    ...entryPoints.map(formatNode),
    '',
    '── OTHER NODES (referenced in traces as downstream steps) ──',
    ...otherNodes.map(formatNode),
  ].join('\n\n');

  const edgesSummary = edges.map((e) => `  ${e.from} → ${e.to}  (${e.payload})`).join('\n');

  const user = `Generate all execution traces for service "${serviceName}".

BEFORE writing any output, do this analysis mentally:
  1. For each ENTRY POINT (listed first below), follow its outgoing edges recursively to build the full reachable node set.
  2. Identify every branch point in every node's source_code (match arms, if/else, Option/Result paths).
  3. For each distinct execution path, list the exact sequence of node_ids from entry to leaf.
  4. Self-check: for every step in each trace, look at its outgoing edges in EDGES. If any target is NOT a later step, you stopped too early — add it.

Entry points are NOT just HTTP route_handlers — they include any node that starts a call chain
(public functions, CLI handlers, background processes, message consumers, etc.).

NODES:
${nodesSummary}

EDGES (call graph):
${edgesSummary}

Using the source_code and edges above, trace every entry point through its full call chain. Return the JSON object with a "traces" array.`;

  return { system, user };
}

/**
 * Phase 2 prompt: generate chain-aware output_cases for all nodes.
 * Runs AFTER structure extraction (phase 1) when the full call graph is available.
 */
export function buildOutputCasesPrompt(
  serviceName: string,
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    description: string;
    input?: string | null;
    output?: string | null;
    source_code?: string | null;
  }>,
  edges: Array<{ from: string; to: string; payload: string }>,
): { system: string; user: string } {
  const system = `You are generating output_cases for a visual flow simulator. There is NO runtime —
each step ONLY receives the previous step's output. If step 3 doesn't include a field, step 4 can
NEVER access it. output_cases define the COMPLETE simulated payload at each point in the chain.

OUTPUT RULE: Your ENTIRE response must be ONE raw JSON object.
First character: "{". Last character: "}". No markdown, no prose, no comments.

Output shape:
{
  "output_cases": {
    "<node_id>": [
      {
        "match": [{"field": "<f>", "op": "<op>", "value": "<v>"}],
        "output": { ... },
        "explanation": "...",
        "terminates": false
      },
      {
        "match": [],
        "output": {"ok": false, "error": "..."},
        "explanation": "catch-all",
        "terminates": true
      }
    ]
  },
  "input_schemas": {
    "<node_id>": [
      {"field": "url", "type": "string", "required": true, "description": "executor URL", "pattern": "^https?://"},
      {"field": "chains", "type": "array", "required": true, "description": "chain list"},
      {"field": "chains[0].name", "type": "string", "required": true, "description": "chain name"},
      {"field": "action", "type": "string", "required": false, "enum": ["create", "update", "delete"]}
    ]
  }
}

Both maps use node ids as keys.
"output_cases" values = arrays of output_case objects.
"input_schemas" values = arrays of field validation rules.
Only include nodes that appear in call chains (skip struct and enum only).

══════════════════════════════════════════════
INPUT SCHEMA — DETERMINISTIC VALIDATION
══════════════════════════════════════════════

input_schema runs BEFORE output_cases. It validates the input structurally and returns
the EXACT error message the real code would produce. The simulation must behave
identically to the actual source code — not with generic messages.

Field schema properties:
  field          string   dot-notation path: "url", "chains[0].name", "headers.Authorization"
  type           string   expected JS typeof: "string", "number", "boolean", "object", "array"
  required       boolean  if true, simulation terminates with an error when missing
  description    string   human-readable label (e.g. "executor URL")
  pattern        string   (optional) regex for string validation (e.g. "^https?://", "^[0-9a-f]{64}$")
  enum           array    (optional) list of allowed string values
  error_message  string   EXACT error string from source code — copied verbatim from the Rust source.
                          This is what the user sees in the simulation. NOT a generic message.
  error_status   number|string  HTTP status code or error variant (e.g. 400, 422, "BAD_REQUEST")

╔══════════════════════════════════════════════════════════════════╗
║  ERROR MESSAGES MUST COME FROM THE SOURCE CODE                   ║
║                                                                  ║
║  Search the node's source_code for error strings:                ║
║    Err(eyre!("..."))                                             ║
║    return Err(Response::error("...", StatusCode::BAD_REQUEST))   ║
║    bail!("...")                                                  ║
║    anyhow!("...")                                                ║
║    StatusCode::UNPROCESSABLE_ENTITY                              ║
║    panic!("...")                                                 ║
║                                                                  ║
║  Copy those strings VERBATIM into error_message.                 ║
║  Copy the status code into error_status.                         ║
║                                                                  ║
║  WRONG: error_message: "Missing required field: chains"          ║
║  RIGHT: error_message: "At least one chain must be provided"     ║
║         error_status: 400                                        ║
║                                                                  ║
║  WRONG: error_message: "Invalid value for action"                ║
║  RIGHT: error_message: "Invalid request format: missing field    ║
║         'chains' at line 1 column 30"                            ║
║         error_status: 422                                        ║
╚══════════════════════════════════════════════════════════════════╝

HOW TO WRITE input_schema:
  1. Read the node's source_code — find every validation check, guard clause, early return
  2. For each check, extract: what field is checked, what type/format, what error is returned
  3. Create one InputFieldSchema entry per check:
     - field: the field being validated
     - type: from the Rust type (String → "string", Vec<> → "array", bool → "boolean", etc.)
     - required: true if the code errors when it's missing
     - error_message: the EXACT error string from the source (Err("..."), bail!("..."), etc.)
     - error_status: the HTTP status code or error kind from the source
     - pattern: if the code validates format (regex, hex, URL, etc.)
     - enum: if the code checks against a known set of values
  4. IMPORTANT: input_schema fields must match what the PREVIOUS step outputs,
     not the original request body (same chain-awareness as output_cases)
  5. If no source_code is available, omit error_message (generic fallback will be used)

══════════════════════════════════════════════
THE SIMULATION CONTRACT
══════════════════════════════════════════════

1. Each step's output is the ONLY input the next step receives.
2. There are no side channels — no globals, no shared state, no real HTTP calls.
3. If a downstream step needs a field, EVERY step between the source and that step
   MUST carry it forward in their success output.
4. output_cases define the ACTUAL simulated payload — they are not summaries.

╔══════════════════════════════════════════════════════════════════╗
║  STRICT SCHEMA PARITY — ZERO TOLERANCE FOR STRUCTURE CHANGES    ║
║                                                                  ║
║  output_cases MUST match the EXACT Rust struct shape:            ║
║                                                                  ║
║  If the Rust code defines:                                       ║
║    struct MatchedOrderVerbose {                                   ║
║      create_order: CreateOrder { create_id, additional_data }    ║
║      source_swap: SingleSwap { chain, ... }                      ║
║    }                                                             ║
║                                                                  ║
║  Then the output_case output MUST be:                            ║
║    {"create_order": {"create_id": "x", "additional_data": {}},  ║
║     "source_swap": {"chain": "ethereum", ...}}                   ║
║                                                                  ║
║  NEVER flatten to: {"create_id": "x", "chain": "ethereum"}      ║
║  NEVER rename: {"order": {...}} when the field is "create_order" ║
║  NEVER omit nesting: {"additional_data": {...}} without wrapper  ║
║                                                                  ║
║  The JSON shape must be a 1:1 mirror of the Rust struct.         ║
║  Look at the node's source_code for the actual field access      ║
║  patterns (e.g. order.create_order.create_id) and preserve       ║
║  that exact nesting in the output.                               ║
║                                                                  ║
║  UPSTREAM → DOWNSTREAM SCHEMA ALIGNMENT:                         ║
║  Before writing a node's output_cases, check what the NEXT       ║
║  node's input_schema expects. If it expects "create_order" as    ║
║  an object, your output MUST contain "create_order" as an object.║
║  If there is a mismatch, fix the OUTPUT to match downstream      ║
║  expectations. NEVER modify input_schema to fit wrong outputs.   ║
╚══════════════════════════════════════════════════════════════════╝

══════════════════════════════════════════════
HOW TO WRITE output_cases
══════════════════════════════════════════════

UNIFIED EXECUTION MODEL — applies to ALL node kinds equally:
  route_handler, function, business_logic → process input, return structured result
  middleware, validator → gate/transform input, pass or reject
  db_call → return MOCK stored data (no real DB). Use realistic example records.
  external_http_call → return MOCK API response (no real network). Use realistic payloads.
  background_process → if traced, process input state (config + mock data), return categorized results
  message_queue → process message payload, return acknowledgment or error

  db_call / external_http_call are DATA SOURCES in simulation:
    Their output_cases ARE the mock data. Different match conditions = different mock scenarios.
    Example: a fetch_orders node could return 3 orders in one case, 0 in another, error in a third.
    The user edits the input to select which scenario runs.

STEP A — For each call chain (entry point → ... → leaf), map what each node:
  - NEEDS as input (from source code / function signature)
  - PRODUCES as output (from return type / source code)

STEP B — Walk each chain forward. For each node's success output, include:
  - Its OWN produced fields
  - ALL fields that ANY later node in the chain needs (carry forward from input)

STEP C — Write output_cases:
  1. MATCH ON UPSTREAM: Conditions reference fields from the PREVIOUS step's output.
  2. OUTPUT FOR DOWNSTREAM: Success output includes fields the NEXT step needs.
  3. CARRY FORWARD: If step 5 needs "url" from step 1, steps 2-4 must all include "url".
  4. ERROR CASES: Add "terminates": true on rejection/error outputs. The simulator
     stops the chain there (e.g. auth failure, validation error, not-found).
  5. CATCH-ALL: Optional match: [] as last case with "terminates": true.

══════════════════════════════════════════════
CONDITION FORMAT
══════════════════════════════════════════════

{"field": "ok", "op": "eq", "value": true}
Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field, eq_type

══════════════════════════════════════════════
SELF-CHECK
══════════════════════════════════════════════

After writing all output_cases, walk each call chain:
  Take entry's success output → does step 2's match reference those fields? ✓
  Take step 2's success output → does step 3's match reference those fields? ✓
  ... all the way to the leaf. If any link breaks, fix it.`;

  const SKIP_KINDS = new Set(['struct', 'enum']);
  const relevantNodes = nodes.filter((n) => !SKIP_KINDS.has(n.kind));

  // Build adjacency for chain analysis
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  // Find entry points (nodes with outgoing edges but no incoming, or known entry kinds)
  const incomingNodes = new Set(edges.map((e) => e.to));
  const ENTRY_KINDS = new Set(['route_handler', 'background_process']);
  const entryPoints = nodes.filter(
    (n) =>
      ENTRY_KINDS.has(n.kind) || (!incomingNodes.has(n.id) && edges.some((e) => e.from === n.id)),
  );

  // Build chain descriptions for each entry point
  function getChain(startId: string): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adj.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return order;
  }

  const chains = entryPoints.map((ep) => {
    const chain = getChain(ep.id);
    return `  ${ep.id}:\n    ${chain.join(' → ')}`;
  });

  const formatNode = (n: (typeof nodes)[0]) =>
    `[${n.kind}] id="${n.id}" name="${n.name}"${n.input ? ` input=${n.input}` : ''}${n.output ? ` output=${n.output}` : ''}\n  desc: ${n.description}${n.source_code ? `\n  source:\n${n.source_code}` : ''}`;

  const nodesSummary = relevantNodes.map(formatNode).join('\n\n');
  const edgesSummary = edges.map((e) => `  ${e.from} → ${e.to}  (${e.payload})`).join('\n');

  const user = `Generate output_cases for all nodes in service "${serviceName}".

CALL CHAINS (entry point → downstream nodes):
${chains.join('\n')}

For each chain above, plan the data pipeline BEFORE writing output_cases:
  1. What does the entry point receive? (request body, CLI args, message payload)
  2. What does each step need from its input? What does it produce?
  3. What fields must be carried forward so later steps can access them?

NODES:
${nodesSummary}

EDGES:
${edgesSummary}

Return the JSON object with output_cases and input_schemas for every node that appears in a chain.
Do NOT include struct or enum nodes (type definitions only).
DO include background_process, message_queue — they are executable and need output_cases.`;

  return { system, user };
}

export function buildCrossServicePrompt(
  serviceNames: string[],
  perServiceSummaries: Array<{
    serviceName: string;
    nodes: Array<{ id: string; kind: string; name: string }>;
  }>,
): { system: string; user: string } {
  const system = `You are a Rust workspace analyzer. Identify all cross-service interactions.

OUTPUT RULE: ONE raw JSON object only. First character "{", last character "}". No markdown, no prose, no comments. Complete output — do not truncate.

Output shape:
{
  "cross_service_calls": [
    {
      "id": "<unique_id>",
      "kind": "cross_service_call",
      "from_service": "<service-a>",
      "to_service": "<service-b>",
      "via": "<reqwest::post or shared_db or message_queue or shared_struct>",
      "endpoint": "<url path or null>",
      "payload_in": "<InputType or null>",
      "payload_out": "<OutputType or null>",
      "defined_in": "<src/path/file.rs>"
    }
  ]
}

Look for:
  - HTTP client calls (reqwest, hyper, ureq) to URLs matching another service's routes
  - Shared structs/enums from a common crate used by multiple services
  - Message queue publish/subscribe patterns between services
  - Shared database tables accessed by multiple services
  - Direct crate dependencies (service-a imports service-b as a lib)`;

  const summaryText = perServiceSummaries
    .map((s) => `Service: ${s.serviceName}\nComponents: ${JSON.stringify(s.nodes, null, 2)}`)
    .join('\n\n---\n\n');

  const user = `Services in this workspace: ${serviceNames.join(', ')}

Component summaries:

${summaryText}

Identify all cross-service calls and shared data patterns. Return the complete JSON object.`;

  return { system, user };
}
