import { DiscoveredService } from './schema';
import { type ResolvedExternalType, formatExternalTypesForPrompt } from './external-types';

export function buildPerServicePrompt(
  service: DiscoveredService,
  externalTypes?: ResolvedExternalType[],
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
RULE 5 — TRACES (invest the most effort here)
══════════════════════════════════════════════

Traces are pre-computed execution paths that drive a visual flow simulator. Quality matters.

STEP 1 — Find all distinct execution paths per route handler.
  Two paths are distinct if they visit DIFFERENT components. At every branch point ask:
  "Does this branch cause different components to be called?"
  Branch patterns to find:
    - match arms dispatching to different handler functions
    - if/else calling different components
    - boolean flags that gate component calls (needs_pk, is_admin, has_cache, etc.)
    - Option/Result checks that short-circuit when None/Err
    - Path parameter dispatch (/{action} where "initiate" vs "redeem" → different logic)
    - Enum field dispatch (each action/type value → different handler)
    - Auth role dispatch (admin vs user → different flow)
    - Cached vs uncached path

STEP 2 — Write traces. One per distinct path. Ordering: most-specific FIRST, catch-alls LAST.
  The trace engine tries traces in order; first one where ALL match conditions pass wins.

  Trace fields:
    route_id         route_handler node id
    label            human name including the distinguishing condition
    description      one line: what this path does and how it ends
    example_payload  JSON object (NOT a string) that triggers this exact path
    match            array of conditions (ALL must pass); [] = unconditional/catch-all
    steps            ordered component visits

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
     "example_payload": "{\"field\":\"value\"}", "fields": null},
    {"id": "<middleware_id>", "service": "<svc>", "kind": "middleware", "name": "<Name>",
     "input": "Request", "output": "Request with <Ext> or <error>", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/auth.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null,
     "source_code": "<verbatim>", "example_payload": null, "fields": null},
    {"id": "<fn_name>", "service": "<svc>", "kind": "business_logic", "name": "<Name>",
     "input": "<type>", "output": "<type>", "mutates_state": false, "mutation_target": null,
     "defined_in": "src/domain.rs", "description": "<desc>", "method": null,
     "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null, "fields": null},
    {"id": "<validate_fn>", "service": "<svc>", "kind": "validator", "name": "<Name>",
     "input": "<type>", "output": "Result<(), <Err>>", "mutates_state": false,
     "mutation_target": null, "defined_in": "src/validate.rs", "description": "<desc>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null, "fields": null},
    {"id": "<db_fn>", "service": "<svc>", "kind": "db_call", "name": "<Name>",
     "input": "<params>", "output": "Result<<Record>>", "mutates_state": true,
     "mutation_target": "<table>", "defined_in": "src/store.rs", "description": "<SQL op>",
     "method": null, "path_pattern": null, "handler": null, "source_code": "<verbatim>",
     "example_payload": null, "fields": null},
    {"id": "enum_<Name>", "service": "<svc>", "kind": "enum", "name": "<Name>",
     "input": null, "output": null, "mutates_state": false, "mutation_target": null,
     "defined_in": "src/types.rs",
     "description": "#[serde(rename_all=\"<rule>\")]. Unknown values fail serde.",
     "method": null, "path_pattern": null, "handler": null,
     "source_code": "<verbatim derive + serde attrs + variants>", "example_payload": null,
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

  const user = `Analyze the Rust service "${service.name}" (path: "${service.path}").

BEFORE writing any output, do this analysis mentally:
  1. Read every file completely.
  2. Trace every call chain: route handlers → business logic → validators/transformers → db_calls.
  3. Identify every branch point in every handler (match arms, if/else, flags, Option/Result).
  4. List all enums used in serde deserialization and confirm their serde-serialized variant values.

THEN produce the complete JSON object. Do not truncate. Do not stop early.

${fileList}${externalTypesSection}`;

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
