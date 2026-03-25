import { DiscoveredService } from "./schema";
import {
  type ResolvedExternalType,
  formatExternalTypesForPrompt,
} from "./external-types";

export function buildPerServicePrompt(
  service: DiscoveredService,
  externalTypes?: ResolvedExternalType[],
): {
  system: string;
  user: string;
} {
  const fileList = service.rsFiles
    .map(
      (f) => `--- FILE: ${f.relativePath} ---\n${f.content}\n--- END FILE ---`,
    )
    .join("\n\n");

  const externalTypesContext = externalTypes?.length
    ? formatExternalTypesForPrompt(externalTypes)
    : "";

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
  id            — unique, stable identifier (for route_handlers use "METHOD /path" e.g. "POST /credentials/{secret}")
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

For every call relationship between components, create an edge:
  from / to          — node ids
  payload            — describe what data flows across this edge (type, shape, key fields)
  from_service / to_service — service names

Include ALL edges, including conditional ones. If component A calls B only sometimes (e.g. based on a match arm), still include the edge — the traces section will clarify which paths use which edges.

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
- #[serde(rename_all = "lowercase")] → JSON values are all-lowercase: "bitcoin" not "Bitcoin"
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
  e.g. if ChainType has #[serde(rename_all = "lowercase")], use "bitcoin" not "Bitcoin".
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
- Chain/network type dispatch (e.g. Bitcoin vs EVM vs Zcash use different key derivation)
- Batch vs single-item processing paths
- Cached vs uncached paths (cache hit skips computation)
- Auth role dispatch (admin vs user vs anonymous see different flows)

For each trace:
  route_id        — the route_handler node id
  label           — human-readable name including the branch variant, e.g. "Generate (UTXO chains)" not just "Generate"
  description     — one-line explaining what this specific path does end-to-end AND how it differs from other paths for the same route
  example_payload — minimal JSON that triggers this path. Use real enum/type values for branching fields. Use "<placeholder>" for opaque data (hashes, tokens, IDs).
  steps           — ordered array of { node_id, edge_label, summary }:
    - node_id: the component visited
    - edge_label: the data flowing in (empty string for the first step)
    - summary: what happens here AND why this branch was taken. Include the condition evaluation.
      GOOD: "EVM chains don't require private keys → needs_private_key=false, skips keypair generation"
      BAD:  "Checks if private key is needed"

TRACE RULES:
- Every consecutive pair (steps[i].node_id → steps[i+1].node_id) MUST have a matching edge in the edges array.
- If a path is shorter (skips components), the trace is shorter. That's the whole point.
- If a path hits the SAME components but with different data, it does NOT need a separate trace (same execution path).
- Simple endpoints with no branching (health checks, version endpoints) get exactly one trace.
- Order traces from most common/happy path first.
- DESERIALIZATION FAILURES: If a route_handler deserializes the request body via serde
  (e.g. serde_json::from_value, Json<T> extractor) and the body could contain an enum field
  with an unknown/invalid value, add a trace for "Invalid request — deserialization failure".
  This trace is short (typically: middleware → route_handler → 400 response) because the
  handler's match on deserialization result hits the Err(_) arm immediately.
- WILDCARD MATCH ARMS: If the route_handler has a wildcard _ => arm (e.g. for auth/action
  mismatch), that is a distinct trace (typically "Unauthorized — mismatch").

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
      "label": "Human-readable flow name including branch variant",
      "description": "One-line: what this path does end-to-end and how it differs from siblings",
      "example_payload": {"action": "generate", "source_chain": "Bitcoin"},
      "steps": [
        {
          "node_id": "component node_id visited at this step",
          "edge_label": "data flowing into this step (empty string for the first step)",
          "summary": "What happens here + why this branch was taken. Include condition evaluation."
        }
      ]
    }
  ]
}`;

  const externalTypesSection = externalTypesContext
    ? `\n\n═══════════════════════════════════════════\nEXTERNAL TYPE DEFINITIONS (resolved from dependency crates)\n═══════════════════════════════════════════\n\nThe following types are used in this service but defined in external crates.\nUse these EXACT definitions for enum variants, struct fields, and serde behavior.\nDo NOT guess variants — only use what is listed here.\n\n${externalTypesContext}`
    : "";

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
    .map(
      (s) =>
        `Service: ${s.serviceName}\nComponents: ${JSON.stringify(s.nodes, null, 2)}`,
    )
    .join("\n\n---\n\n");

  const user = `These are the services in the workspace: ${serviceNames.join(", ")}

Here are the component summaries for each service:

${summaryText}

Identify all cross-service calls and shared data patterns.`;

  return { system, user };
}
