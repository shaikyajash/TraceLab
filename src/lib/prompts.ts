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

  const system = `You are a senior Rust code analyzer that produces structured JSON describing a service's architecture, data flow, and execution paths.

You MUST respond with valid JSON only. No prose, no markdown fences, no explanations outside the JSON.

═══════════════════════════════════════════
SECTION 1: COMPONENT EXTRACTION (nodes)
═══════════════════════════════════════════

Extract every meaningful component. A "component" is any unit where data enters, transforms, is validated, persists, or leaves the system:

  route_handler    — HTTP endpoint (GET /health, POST /api/items, etc)
  middleware       — intercepts requests (auth, logging, rate limiting, CORS)
  business_logic   — domain logic, orchestration, handler functions
  validator        — input validation, authorization checks, constraint enforcement
  transformer      — data shape changes (hashing, encryption, serialization, key derivation)
  db_call          — any database operation (SELECT, INSERT, UPDATE, DELETE, migrations)
  external_http_call — outbound HTTP to another service
  struct / enum    — data carriers between components
  message_queue    — async messaging (publish/subscribe, job queues)
  function         — utility functions that don't fit above

For each node, provide:
  id            — unique, stable identifier (for route_handlers use "METHOD /path" e.g. "POST /api/items/{id}")
  service       — the service name
  kind          — one of the kinds above
  name          — short human-readable name
  input/output  — type signatures or descriptions
  mutates_state — true if it writes to DB, filesystem, or external state
  mutation_target — what is mutated (table name, file, etc) or null
  defined_in    — source file path
  description   — what this component does (1-2 sentences)
  method        — HTTP method for route_handlers, null otherwise
  path_pattern  — URL pattern for route_handlers, null otherwise
  handler       — handler function path for route_handlers, null otherwise
  example_payload — for route_handlers: a realistic JSON request body example
  source_code   — the actual function body or struct definition (verbatim from the code)

═══════════════════════════════════════════
SECTION 2: DATA FLOW (edges)
═══════════════════════════════════════════

For every CALL relationship between components, create an edge:
  from / to          — node ids
  payload            — describe what data flows across this edge (type, shape, key fields)
  from_service / to_service — service names

CRITICAL EDGE RULES:
- Edges represent CALL/INVOCATION relationships ONLY: "A calls B", "A dispatches to B", "A delegates to B".
- Edges are NOT sequential execution order. Do NOT create edges like "validate_input → process_data"
  just because they happen to run one after another inside the same parent function.
  The parent (e.g. handle_request) should have edges to BOTH validate_input and process_data.
- Edges MUST form a DAG (directed acyclic graph). Cycles are FORBIDDEN.
  If function A calls B, and later function C also calls B, that's two edges INTO B — not a cycle.
  But if A→B→C→A exists, that IS a cycle and is wrong.
- Include ALL call edges, including conditional ones. If component A calls B only sometimes
  (e.g. based on a match arm), still include the edge — traces clarify which paths use which edges.
- Execution order within a function is captured by the trace steps array, NOT by edges.

═══════════════════════════════════════════
SECTION 3: MUTATIONS
═══════════════════════════════════════════

Every write to persistent state:
  id, service, kind:"mutation", mutates, via (sqlx, diesel, fs::write, etc), in_component, defined_in

═══════════════════════════════════════════
SECTION 4: EXTERNAL PACKAGES
═══════════════════════════════════════════

Notable crates used:
  crate, used_in_services, purpose

═══════════════════════════════════════════
SECTION 4.5: SERDE AWARENESS (critical for JSON correctness)
═══════════════════════════════════════════

Rust's serde determines how types serialize/deserialize to JSON. You MUST follow these rules:

RENAME RULES:
- #[serde(rename_all = "lowercase")] → JSON values are all-lowercase: "pending" not "Pending"
- #[serde(rename_all = "UPPERCASE")] → JSON values are all-uppercase
- #[serde(rename_all = "camelCase")] → JSON values are camelCase
- #[serde(rename_all = "snake_case")] → JSON values are snake_case
- #[serde(rename = "custom")] on a variant → that variant uses "custom" in JSON

DESERIALIZATION BEHAVIOR:
- If a JSON request body is deserialized into a struct containing an enum field, and the
  JSON value does NOT match any known variant (after applying rename rules), serde will
  FAIL deserialization. This causes an error response (typically 400 Bad Request).
- This deserialization failure is a REAL execution path. You MUST create a trace for it.

ENUM NODES:
- For every enum that participates in request/response deserialization, include it as a
  node with kind="enum". List ALL variants in the fields array with their serde-serialized
  JSON values. Include the full source_code with derive macros and serde attributes.
- If the enum is from an external crate but is used in request/response types, STILL include
  it as a node. The scanner may provide its definition in the EXTERNAL TYPE DEFINITIONS section.

EXAMPLE PAYLOADS:
- All enum values in example_payload fields MUST use the serde-serialized form.
  e.g. if Status has #[serde(rename_all = "lowercase")], use "pending" not "Pending".
- NEVER guess enum variants. Use only variants from the actual source code or external type definitions.

═══════════════════════════════════════════
SECTION 5: TRACES (critical — read carefully)
═══════════════════════════════════════════

Traces are pre-computed execution paths through the service. They power a visual flow simulator in the UI. This is the most important section.

For each route_handler, you must identify EVERY distinct execution path and create a separate trace for each. Two paths are "distinct" if they visit DIFFERENT sets of components.

HOW TO FIND DISTINCT PATHS:
1. Start at the route_handler.
2. Follow the code execution. At every branch point (match, if/else, early return, Option check, boolean flag), ask: "does this branch cause different components to be called?"
3. If YES → that's a separate trace.

COMMON BRANCHING PATTERNS TO DETECT:
- match on an action/type enum → each arm dispatches to different handler functions
- if condition { call_a() } else { call_b() } → two traces
- boolean flags (e.g. needs_encryption, is_admin) that gate whether a component runs → traces with/without that component
- Option<T> / Result<T> checks that skip processing when None/Err → shorter trace
- Type-dependent dispatch (e.g. different serializers for different content types)
- Feature flags or config-driven branches
- Type/variant dispatch (e.g. different serializers, key derivers, or processors per enum variant)
- Batch vs single-item processing paths
- Cached vs uncached paths (cache hit skips computation)
- Auth role dispatch (admin vs user vs anonymous see different flows)

For each trace:
  route_id        — the route_handler node id
  label           — human-readable name, e.g. "Create Item" or "List Items (paginated)"
  description     — one-line explaining what this trace does
  example_payload — a JSON that triggers this path (with real serde values)
  match           — (optional) array of conditions; ALL must be true for this trace to apply at runtime
  steps           — ordered array of { node_id, edge_label, summary, when? }:
    - node_id: the component visited
    - edge_label: the data flowing in (empty string for the first step)
    - summary: what happens here AND why. Include condition evaluations.
    - when: (optional) condition — step is INCLUDED only when true. Use for branching.

CONDITION FORMAT (used in both "match" and "when"):
  { "field": "action", "op": "eq", "value": "create" }              — field equals value
  { "field": "role", "op": "in", "value": ["admin","editor"] }      — field is one of values
  { "field": "role", "op": "not_in", "value": ["admin"] }           — field is NOT in values
  { "field": "token", "op": "exists" }                              — field is present
  { "field": "source", "op": "eq_field", "value": "destination" }   — two fields are equal
  Ops: eq, neq, in, not_in, exists, not_exists, eq_field, neq_field

PARAMETRIC TRACES (critical — avoid combinatorial explosion):
DO NOT create one trace per enum variant combination. Instead, create ONE trace with conditional steps.

Example: if a function dispatches to different processors based on an enum field "format":
  { "node_id": "process_json", "when": {"field":"format","op":"eq","value":"json"}, ... }
  { "node_id": "process_xml",  "when": {"field":"format","op":"eq","value":"xml"}, ... }
  { "node_id": "process_csv",  "when": {"field":"format","op":"eq","value":"csv"}, ... }
At runtime, steps where "when" is false are SKIPPED. This single trace handles ALL format variants.

For "match" on the trace itself, use conditions to gate when the trace applies:
  "match": [{"field":"action","op":"eq","value":"create"}, {"field":"format","op":"in","value":["json","xml","csv"]}]
  This ensures the trace only fires for valid inputs. Invalid inputs fall through to error traces.

IMPORTANT: For any input field that is an enum, add a "match" condition with op:"in" listing ALL
valid serde variant values. This prevents the trace from matching inputs with unknown/invalid values.
Those invalid inputs should hit the catch-all error trace instead.

TRACE ORDERING:
- Most specific traces FIRST (more match conditions = higher priority).
- Catch-all / error traces LAST (no match conditions — fire when nothing else matches).
- Traces are tried in order; first match wins.

TRACE RULES:
- Every node_id MUST exist in the nodes array.
- Consecutive steps do NOT need a direct edge — traces capture execution ORDER, edges capture CALL GRAPH.
- Simple endpoints (health checks) get one trace with no match/when.
- Deserialization failures / unknown enum values: add a catch-all trace (no match) at the END.
- Wildcard match arms (unauthorized): add a catch-all trace at the END.

═══════════════════════════════════════════
OUTPUT JSON SCHEMA (all fields required unless noted)
═══════════════════════════════════════════
{
  "service": {
    "id": "service-name",
    "kind": "service",
    "path": "relative/path/to/service",
    "description": "One-line description of what this service does"
  },
  "nodes": [
    {
      "id": "unique_stable_id (for routes: 'METHOD /path')",
      "service": "service-name",
      "kind": "route_handler | middleware | business_logic | validator | transformer | db_call | external_http_call | struct | enum | message_queue | function",
      "name": "Human Readable Name",
      "input": "input type signature or description, or null",
      "output": "output type signature or description, or null",
      "mutates_state": false,
      "mutation_target": "table/file/state being mutated, or null",
      "defined_in": "src/path/to/file.rs",
      "description": "What this component does (1-2 sentences)",
      "method": "GET | POST | PUT | DELETE | PATCH, or null (route_handlers only)",
      "path_pattern": "/api/path/{param}, or null (route_handlers only)",
      "handler": "module::path::to_handler, or null (route_handlers only)",
      "fields": [{"name": "field_name", "type": "field_type"}],
      "source_code": "fn actual_code() { ... } (verbatim from source)",
      "example_payload": "realistic JSON string for route_handlers, or null",
      "port": 8080
    }
  ],
  "edges": [
    {
      "from": "source_node_id",
      "to": "target_node_id",
      "payload": "description of data flowing across this edge",
      "from_service": "service-name",
      "to_service": "service-name"
    }
  ],
  "mutations": [
    {
      "id": "unique_mutation_id",
      "service": "service-name",
      "kind": "mutation",
      "mutates": "what is being mutated (table name, column, file)",
      "via": "mechanism (sqlx::query, diesel, fs::write, reqwest, etc)",
      "in_component": "node_id of the component that performs this mutation",
      "defined_in": "src/path/to/file.rs"
    }
  ],
  "external_packages": [
    {
      "crate": "crate_name",
      "used_in_services": ["service-name"],
      "purpose": "what this crate is used for in this service"
    }
  ],
  "traces": [
    {
      "route_id": "the route_handler node id this trace starts from",
      "label": "Human-readable trace name",
      "description": "One-line: what this trace does",
      "example_payload": {"action": "create", "format": "json"},
      "match": [
        {"field": "action", "op": "eq", "value": "create"},
        {"field": "format", "op": "in", "value": ["json","xml","csv"]}
      ],
      "steps": [
        {
          "node_id": "component node_id visited at this step",
          "edge_label": "data flowing into this step (empty string for first step)",
          "summary": "What happens here + why. Include condition evaluation."
        },
        {
          "node_id": "process_json",
          "edge_label": "parsed input",
          "summary": "Processes JSON format input.",
          "when": {"field": "format", "op": "eq", "value": "json"}
        }
      ]
    }
  ]
}`;

  const externalTypesSection = externalTypesContext
    ? `\n\n═══════════════════════════════════════════\nEXTERNAL TYPE DEFINITIONS (resolved from dependency crates)\n═══════════════════════════════════════════\n\nThe following types are used in this service but defined in external crates.\nUse these EXACT definitions for enum variants, struct fields, and serde behavior.\nDo NOT guess variants — only use what is listed here.\n\n${externalTypesContext}`
    : '';

  const user = `Analyze the following Rust service "${service.name}" (located at "${service.path}") and extract all components, data flow edges, mutations, external packages, and execution traces.

Pay special attention to branching logic — match arms, if/else chains, boolean flags, Option/Result checks, type-based dispatch — anywhere different input values cause different components to be called. Each distinct path needs its own trace.

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
  const system = `You are a Rust workspace analyzer. Given summaries of multiple services, identify all cross-service interactions.

You MUST respond with valid JSON only. No prose, no markdown fences, no explanations.

Output JSON schema:
{
  "cross_service_calls": [
    {
      "id": "unique_id",
      "kind": "cross_service_call",
      "from_service": "service-a",
      "to_service": "service-b",
      "via": "mechanism (reqwest::post, shared struct, message queue, shared database, etc)",
      "endpoint": "endpoint if HTTP call, or null",
      "payload_in": "input type or null",
      "payload_out": "output type or null",
      "defined_in": "file/path.rs"
    }
  ]
}

Look for:
- HTTP client calls to other services (reqwest, hyper client, etc)
- Shared structs/enums used across services
- Message queue publish/subscribe patterns
- Shared database access patterns
- Direct crate dependencies between services`;

  const summaryText = perServiceSummaries
    .map((s) => `Service: ${s.serviceName}\nComponents: ${JSON.stringify(s.nodes, null, 2)}`)
    .join('\n\n---\n\n');

  const user = `These are the services in the workspace: ${serviceNames.join(', ')}

Here are the component summaries for each service:

${summaryText}

Identify all cross-service calls and shared data patterns.`;

  return { system, user };
}
