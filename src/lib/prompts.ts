import { DiscoveredService } from "./schema";

export function buildPerServicePrompt(service: DiscoveredService): {
  system: string;
  user: string;
} {
  const fileList = service.rsFiles
    .map(
      (f) => `--- FILE: ${f.relativePath} ---\n${f.content}\n--- END FILE ---`,
    )
    .join("\n\n");

  const system = `You are a Rust code analyzer. You analyze Rust source code and extract structured information about components, data flow, routes, mutations, and external dependencies.

You MUST respond with valid JSON only. No prose, no markdown fences, no explanations. Just the JSON object.

A "component" is any place in the code where something meaningful happens to data:
- Route handlers: where data enters the system
- Transformers: where data changes shape or value
- Validators: where data is accepted or rejected
- Middleware: where data is intercepted and modified
- Business logic: where domain rules are applied
- DB calls: where data mutates persistent state
- External HTTP calls: where data leaves the service boundary
- Structs/Enums: data carriers between components
- Message queue operations: where data crosses service boundary async

Output JSON schema:
{
  "service": {
    "id": "service-name",
    "kind": "service",
    "path": "relative/path",
    "description": "One-line description of what this service does"
  },
  "nodes": [
    {
      "id": "unique_id",
      "service": "service-name",
      "kind": "route_handler|transformer|validator|middleware|business_logic|db_call|external_http_call|struct|enum|message_queue|function",
      "name": "human readable name",
      "input": "input type or null",
      "output": "output type or null",
      "mutates_state": true/false,
      "mutation_target": "what is mutated or null",
      "defined_in": "file/path.rs",
      "description": "what this component does",
      "method": "HTTP method if route_handler, or null",
      "path_pattern": "URL path if route_handler, or null",
      "handler": "handler function path if route_handler, or null",
      "fields": [{"name": "field_name", "type": "field_type"}], // only for struct/enum
      "source_code": "the actual Rust source code of this component (function body, struct definition, etc)",
      "example_payload": "a realistic JSON example of the input this component accepts (for route_handlers, include a full request body example)",
      "port": 8080 // port number if this is a route_handler and the port is known, or null
    }
  ],
  "edges": [
    {
      "from": "node_id",
      "to": "node_id",
      "payload": "type being passed",
      "from_service": "service-name",
      "to_service": "service-name"
    }
  ],
  "mutations": [
    {
      "id": "unique_mutation_id",
      "service": "service-name",
      "kind": "mutation",
      "mutates": "what is being mutated",
      "via": "mechanism (e.g. sqlx::query, diesel, etc)",
      "in_component": "which component does this mutation",
      "defined_in": "file/path.rs"
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
      "label": "short label like 'Generate Credentials' or 'Retrieve Credentials'",
      "description": "one-line description of what this specific flow does end-to-end",
      "example_payload": {"action": "Generate", "source_chain": "Bitcoin"},
      "steps": [
        {
          "node_id": "the component node id visited in this step",
          "edge_label": "label on the edge that leads to this node (empty for the first step)",
          "summary": "what happens at this step (e.g. 'Validates secret and injects AuthType::Generate')"
        }
      ]
    }
  ]
}

IMPORTANT — traces:
- For EACH route_handler, generate one trace per distinct code path / action variant.
  e.g. if a route dispatches based on an "action" field, create separate traces for each action (Generate, Retrieve, Update, etc).
- Each trace must list the EXACT sequence of node_ids the request flows through, in order, following the edges.
- Include a realistic example_payload that would trigger this specific path.
- The steps must be a valid walk through the edges you defined — every consecutive pair (steps[i].node_id -> steps[i+1].node_id) must have a corresponding edge.
- For simple routes with only one path (like health checks), just create one trace.`;

  const user = `Analyze the following Rust service "${service.name}" (located at "${service.path}") and extract all components, routes, payloads, mutations, and external packages.

${fileList}`;

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
