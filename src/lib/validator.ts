import { PerServiceResult } from "./schema";
import { ResolvedExternalType } from "./external-types";

export interface ValidationError {
  severity: "error" | "warning";
  category: "structure" | "reference" | "trace" | "serde" | "completeness";
  message: string;
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  repairInstructions: string;
}

// ─── Node validation ─────────────────────────────────────────────────

const VALID_KINDS = new Set([
  "route_handler",
  "middleware",
  "business_logic",
  "validator",
  "transformer",
  "db_call",
  "external_http_call",
  "struct",
  "enum",
  "message_queue",
  "function",
]);

function validateNodes(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    const p = `nodes[${i}]`;

    if (!node.id) {
      errors.push({ severity: "error", category: "structure", message: `Node at index ${i} has no id`, path: p });
      continue;
    }

    if (idSet.has(node.id)) {
      errors.push({ severity: "error", category: "structure", message: `Duplicate node id: "${node.id}"`, path: p });
    }
    idSet.add(node.id);

    if (!node.kind || !VALID_KINDS.has(node.kind)) {
      errors.push({ severity: "error", category: "structure", message: `Node "${node.id}" has invalid kind: "${node.kind}"`, path: `${p}.kind` });
    }

    if (!node.name) {
      errors.push({ severity: "warning", category: "structure", message: `Node "${node.id}" has no name`, path: `${p}.name` });
    }

    if (!node.defined_in && node.kind !== "enum" && node.kind !== "struct") {
      errors.push({ severity: "warning", category: "structure", message: `Node "${node.id}" has no defined_in`, path: `${p}.defined_in` });
    }
  }

  return errors;
}

// ─── Edge validation ─────────────────────────────────────────────────

function validateEdges(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(result.nodes.map((n) => n.id));

  for (let i = 0; i < result.edges.length; i++) {
    const edge = result.edges[i];
    const p = `edges[${i}]`;

    if (!nodeIds.has(edge.from)) {
      errors.push({
        severity: "error",
        category: "reference",
        message: `Edge from "${edge.from}" → "${edge.to}": source node "${edge.from}" does not exist in nodes array`,
        path: `${p}.from`,
      });
    }

    if (!nodeIds.has(edge.to)) {
      errors.push({
        severity: "error",
        category: "reference",
        message: `Edge from "${edge.from}" → "${edge.to}": target node "${edge.to}" does not exist in nodes array`,
        path: `${p}.to`,
      });
    }
  }

  return errors;
}

// ─── Trace validation ────────────────────────────────────────────────

function validateTraces(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];
  const nodeIds = new Set(result.nodes.map((n) => n.id));
  const routeHandlerIds = new Set(
    result.nodes.filter((n) => n.kind === "route_handler").map((n) => n.id),
  );

  // Build edge lookup: "from|to" → true
  const edgeSet = new Set(result.edges.map((e) => `${e.from}|${e.to}`));

  for (let t = 0; t < traces.length; t++) {
    const trace = traces[t];
    const p = `traces[${t}]`;

    if (!routeHandlerIds.has(trace.route_id)) {
      errors.push({
        severity: "error",
        category: "trace",
        message: `Trace "${trace.label}" has route_id "${trace.route_id}" which is not a route_handler node`,
        path: `${p}.route_id`,
      });
    }

    if (!trace.steps || trace.steps.length === 0) {
      errors.push({
        severity: "error",
        category: "trace",
        message: `Trace "${trace.label}" has no steps`,
        path: `${p}.steps`,
      });
      continue;
    }

    for (let s = 0; s < trace.steps.length; s++) {
      const step = trace.steps[s];

      if (!nodeIds.has(step.node_id)) {
        errors.push({
          severity: "error",
          category: "trace",
          message: `Trace "${trace.label}" step ${s} references node "${step.node_id}" which does not exist`,
          path: `${p}.steps[${s}].node_id`,
        });
      }

      // Check consecutive step pairs have matching edges
      if (s > 0) {
        const prevNodeId = trace.steps[s - 1].node_id;
        const currNodeId = step.node_id;
        const edgeKey = `${prevNodeId}|${currNodeId}`;

        if (!edgeSet.has(edgeKey)) {
          errors.push({
            severity: "error",
            category: "trace",
            message: `Trace "${trace.label}" step ${s - 1}→${s}: no edge exists from "${prevNodeId}" to "${currNodeId}". Add this edge to the edges array.`,
            path: `${p}.steps[${s}]`,
          });
        }
      }

      if (!step.summary || step.summary.length < 5) {
        errors.push({
          severity: "warning",
          category: "trace",
          message: `Trace "${trace.label}" step ${s} has a very short or empty summary`,
          path: `${p}.steps[${s}].summary`,
        });
      }
    }
  }

  return errors;
}

// ─── Mutation validation ─────────────────────────────────────────────

function validateMutations(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(result.nodes.map((n) => n.id));

  for (let i = 0; i < result.mutations.length; i++) {
    const mut = result.mutations[i];
    const p = `mutations[${i}]`;

    if (!nodeIds.has(mut.in_component)) {
      errors.push({
        severity: "error",
        category: "reference",
        message: `Mutation "${mut.id}" references in_component "${mut.in_component}" which does not exist in nodes`,
        path: `${p}.in_component`,
      });
    }
  }

  return errors;
}

// ─── Serde value validation ──────────────────────────────────────────

function validateSerdeValues(
  result: PerServiceResult,
  externalTypes: ResolvedExternalType[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Build lookup of type name → valid JSON values
  const validValues = new Map<string, Set<string>>();
  for (const ext of externalTypes) {
    if (ext.serdeVariants) {
      validValues.set(
        ext.typeName,
        new Set(ext.serdeVariants.map((v) => v.jsonValue)),
      );
    }
  }

  if (validValues.size === 0) return errors;

  // Check example_payloads in nodes
  for (const node of result.nodes) {
    if (!node.example_payload) continue;
    try {
      const payload =
        typeof node.example_payload === "string"
          ? JSON.parse(node.example_payload)
          : node.example_payload;
      checkPayloadValues(payload, validValues, errors, `node "${node.id}".example_payload`);
    } catch {
      /* not valid JSON, skip */
    }
  }

  // Check example_payloads in traces
  for (const trace of result.traces ?? []) {
    if (!trace.example_payload) continue;
    checkPayloadValues(
      trace.example_payload,
      validValues,
      errors,
      `trace "${trace.label}".example_payload`,
    );
  }

  return errors;
}

/**
 * Check if any values in a payload match known enum type field names
 * and have invalid values.
 */
function checkPayloadValues(
  payload: Record<string, unknown>,
  validValues: Map<string, Set<string>>,
  errors: ValidationError[],
  context: string,
): void {
  if (typeof payload !== "object" || payload === null) return;

  // Heuristic: field names that likely correspond to known enum types
  // e.g. "source_chain" → ChainType, "action" → CredentialAction
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string") continue;

    // Try to match field name to a type
    for (const [typeName, validSet] of validValues) {
      const typeNameLower = typeName.toLowerCase();
      const keyLower = key.toLowerCase().replace(/_/g, "");

      // Match "source_chain" → "chaintype", "action" → "credentialaction", etc.
      if (
        keyLower.includes(typeNameLower.replace("type", "")) ||
        typeNameLower.includes(keyLower)
      ) {
        if (!validSet.has(value)) {
          errors.push({
            severity: "warning",
            category: "serde",
            message: `${context}: field "${key}" has value "${value}" which may not be a valid ${typeName} variant. Valid values: ${Array.from(validSet).join(", ")}`,
            path: context,
          });
        }
      }
    }
  }
}

// ─── Completeness checks ─────────────────────────────────────────────

function validateCompleteness(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];

  // Every route_handler should have at least one trace
  const routeHandlers = result.nodes.filter((n) => n.kind === "route_handler");
  const tracedRoutes = new Set(traces.map((t) => t.route_id));

  for (const rh of routeHandlers) {
    if (!tracedRoutes.has(rh.id)) {
      errors.push({
        severity: "warning",
        category: "completeness",
        message: `Route handler "${rh.id}" has no traces. Every route_handler should have at least one trace.`,
        path: `node "${rh.id}"`,
      });
    }
  }

  // Check that match arms in route_handlers with source_code are covered by traces
  for (const rh of routeHandlers) {
    if (!rh.source_code) continue;

    // Count match arms (rough heuristic)
    const matchArms = (rh.source_code.match(/=>\s*\{/g) || []).length;
    const wildcardArms = (rh.source_code.match(/_\s*=>/g) || []).length;
    const totalArms = matchArms + wildcardArms;

    const routeTraces = traces.filter((t) => t.route_id === rh.id);

    if (totalArms > 0 && routeTraces.length < totalArms) {
      errors.push({
        severity: "warning",
        category: "completeness",
        message: `Route handler "${rh.id}" has ~${totalArms} match arms but only ${routeTraces.length} traces. Each distinct code path should have its own trace.`,
        path: `node "${rh.id}"`,
      });
    }
  }

  return errors;
}

// ─── Main entry point ────────────────────────────────────────────────

export function validatePerServiceResult(
  result: PerServiceResult,
  externalTypes?: ResolvedExternalType[],
): ValidationResult {
  const errors: ValidationError[] = [
    ...validateNodes(result),
    ...validateEdges(result),
    ...validateTraces(result),
    ...validateMutations(result),
    ...validateSerdeValues(result, externalTypes ?? []),
    ...validateCompleteness(result),
  ];

  const criticalErrors = errors.filter((e) => e.severity === "error");

  const repairInstructions = errors.length > 0
    ? errors
        .map((e, i) => `${i + 1}. [${e.severity.toUpperCase()}] ${e.category}: ${e.message}`)
        .join("\n")
    : "";

  return {
    valid: criticalErrors.length === 0,
    errors,
    repairInstructions,
  };
}
