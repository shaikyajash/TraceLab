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
  function           Utility that doesn't fit above

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
RULE 6 — EXTERNAL CRATE ADAPTERS
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
RULE 7 — RUST TRAIT DISPATCH (follow concrete implementations)
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
RULE 5 — TRACES (most critical section)
══════════════════════════════════════════════

Traces are the ONLY thing that drives the visual flow simulator. Without complete traces, the simulator shows nothing.

STEP 1 — For EVERY route_handler, trace execution from entry all the way to the final response.

  Think like a debugger stepping through the code:
    route_handler receives request
      → calls middleware / auth check
        → calls business_logic fn
          → calls validator
          → calls db_call  ← keep going
          → calls external_adapter  ← keep going
            → external service responds
          → returns result
        → business_logic returns
      → route_handler sends HTTP response  ← this is the end

  Every function visited in that walk = one step. Do NOT stop at any intermediate node.
  If a route internally calls another route, continue tracing through THAT route's
  full downstream chain too — all the way to its leaf nodes.

  Two paths are distinct if they visit DIFFERENT nodes:
    - match arms dispatching to different functions
    - if/else calling different components
    - Option/Result that short-circuits on None/Err
    - Path parameter dispatch (/{action} → different handler per value)
    - Auth role dispatch (admin vs user)
    - Cached vs uncached path

STEP 2 — Write one trace per distinct path. Most-specific FIRST, catch-alls LAST.

  Trace fields:
    route_id         route_handler node id
    label            human name including the distinguishing condition
    description      one line: what this path does and how it ends
    example_payload  JSON object (NOT a string) that triggers this exact path
    match            array of conditions (ALL must pass); [] = unconditional/catch-all
    steps            complete end-to-end list — see below

  STEPS — follow every edge until you hit a true leaf (no outgoing edges):
    step 1 : the route_handler itself
    step 2 : first node it calls
    step 3 : what that node calls
    ... keep going until the final db_call / external_http_call

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
  Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field

STEP 4 — Parametric traces: avoid combinatorial explosion.
  Do NOT write one trace per enum variant combination.
  Write ONE trace and use per-step "when" conditions:
    step_a runs when format=="json"
    step_b runs when format=="xml"
  At runtime, only matching steps execute.

STEP 5 — Required catch-all traces (LAST for each route):
  - "Deserialization failure" trace (match: []) for unknown enum values → 400
  - "Unauthorized / mismatch" trace (match: []) for wildcard _ arms → 401/403

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
  "match"           array    condition objects; [] for unconditional/catch-all
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
    {"id": "POST /items/{id}", "service": "<svc>", "kind": "route_handler", "name": "<Name>",
     "input": "<InputType>", "output": "<OutputType>", "mutates_state": true,
     "mutation_target": "<table>", "defined_in": "src/handlers.rs",
     "description": "<what it does>", "method": "POST", "path_pattern": "/items/{id}",
     "handler": "<module::fn>", "source_code": "<verbatim fn body>",
     "example_payload": "{\"field\":\"value\"}",
     "example_input": {"field": "value"}, "example_output": {"result": "value"}, "fields": null},
    {"id": "<middleware_id>", "service": "<svc>", "kind": "middleware", "name": "<Name>",
     "input": "Request", "output": "Request with <Ext> or <error>", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/auth.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null,
     "source_code": "<verbatim>", "example_payload": null,
     "example_input": {"headers": {"Authorization": "Bearer <token>"}}, "example_output": {"auth_type": "<type>", "user_id": "<id>"}, "fields": null},
    {"id": "<fn_name>", "service": "<svc>", "kind": "business_logic", "name": "<Name>",
     "input": "<type>", "output": "<type>", "mutates_state": false, "mutation_target": null,
     "defined_in": "src/domain.rs", "description": "<desc>", "method": null,
     "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"<input_field>": "<value>"}, "example_output": {"<output_field>": "<value>"}, "fields": null},
    {"id": "<validate_fn>", "service": "<svc>", "kind": "validator", "name": "<Name>",
     "input": "<type>", "output": "Result<(), <Err>>", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/validate.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"<field>": "<valid-value>"}, "example_output": null, "fields": null},
    {"id": "<db_fn>", "service": "<svc>", "kind": "db_call", "name": "<Name>",
     "input": "<params>", "output": "Result<<Record>>", "mutates_state": true,
     "mutation_target": "<table>", "defined_in": "src/store.rs", "description": "<SQL op>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null,
     "example_input": {"<param>": "<value>"}, "example_output": {"id": "<id>", "<field>": "<value>"}, "fields": null},
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
IMPORTANT: Set "traces": [] — do NOT generate traces in chunked mode. Traces will be generated separately after all chunks are merged, once the full call graph is available.
Still output a complete, valid JSON object for all other fields.

`
    : '';

  const user = `${chunkHeader}Analyze the Rust service "${service.name}" (path: "${service.path}").

BEFORE writing any output, do this analysis mentally:
  1. Read every file completely.
  2. Trace every call chain: route handlers → business logic → validators/transformers → db_calls.
  3. Identify every branch point in every handler (match arms, if/else, flags, Option/Result).
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

STEP 1 — Build the full call tree for EVERY route_handler node:
  Start at the route_handler. Follow every edge outward recursively.
  Every reachable node IS a step. Do not stop at business_logic — keep following edges to db_calls, validators, etc.

  Self-check before finalizing each trace: for every step, look at its outgoing edges in the EDGES list.
  If any edge target is NOT already a later step, you stopped too early — add it.
  A trace is complete only when every step's outgoing edges are accounted for as later steps or conditional branches.

STEP 2 — Write one trace per distinct execution path.
  Distinct = different nodes visited due to a branch:
    - match arms dispatching to different functions
    - if/else calling different components
    - Option/Result that short-circuits on None/Err
    - Path parameter dispatch (/{action} → different handler per value)
    - Auth role dispatch
  Look at the source_code of EVERY node to identify all branch points — not just the route handler.
  Ordering: most-specific (has match conditions) FIRST, catch-all (match: []) LAST.

STEPS — THE #1 RULE:
  step 1: the route_handler itself
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
  Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field

STEP 4 — Parametric traces: avoid combinatorial explosion.
  Do NOT write one trace per enum variant combination.
  Write ONE trace and use per-step "when" conditions:
    step_a runs when format=="json"
    step_b runs when format=="xml"
  At runtime, only matching steps execute.

STEP 5 — Required catch-all traces (LAST for each route):
  - "Deserialization failure" trace (match: []) for unknown enum values → 400
  - "Unauthorized / mismatch" trace (match: []) for wildcard _ arms → 401/403

STEP 6 — Path parameter dispatch:
  /{action} routes → trace per known action value using:
    {"field": "action", "op": "in", "value": ["initiate", "redeem", "refund"]}
  Add catch-all for unknown path param values.

Trace fields:
  route_id         route_handler node id
  label            short name with distinguishing condition
  description      one line: what this path does and how it ends
  example_payload  JSON object (not string) that triggers this path
  match            condition array; [] = catch-all
  steps            complete ordered list (see above)

Step fields:
  node_id     id from the nodes list (must exist)
  edge_label  data flowing in ("" for step 1)
  summary     what happens here and why, including condition evaluation result
  when        (optional) skip this step if condition fails

Condition format: {"field": "x", "op": "eq", "value": "y"}
Valid ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field`}`;

  const routeHandlers = nodes.filter((n) => n.kind === 'route_handler');
  const otherNodes = nodes.filter((n) => n.kind !== 'route_handler');

  const formatNode = (n: (typeof nodes)[0]) =>
    `[${n.kind}] id="${n.id}" name="${n.name}"\n  desc: ${n.description}${n.source_code ? `\n  source:\n${n.source_code}` : ''}${n.example_payload ? `\n  example_payload: ${n.example_payload}` : ''}`;

  const nodesSummary = [...routeHandlers.map(formatNode), ...otherNodes.map(formatNode)].join(
    '\n\n',
  );

  const edgesSummary = edges.map((e) => `  ${e.from} → ${e.to}  (${e.payload})`).join('\n');

  const user = `Generate all execution traces for service "${serviceName}".

BEFORE writing any output, do this analysis mentally:
  1. For each route_handler, follow its outgoing edges recursively to build the full reachable node set.
  2. Identify every branch point in every node's source_code (match arms, if/else, Option/Result paths).
  3. For each distinct execution path, list the exact sequence of node_ids from entry to leaf.
  4. Self-check: for every step in each trace, look at its outgoing edges in EDGES. If any target is NOT a later step, you stopped too early — add it.

NODES:
${nodesSummary}

EDGES (call graph):
${edgesSummary}

Using the source_code and edges above, trace every route_handler through its full call chain. Return the JSON object with a "traces" array.`;

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
