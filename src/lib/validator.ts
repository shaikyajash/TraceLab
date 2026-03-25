import { PerServiceResult } from './schema';
import { ResolvedExternalType } from './external-types';

export interface ValidationError {
  severity: 'error' | 'warning';
  category: 'structure' | 'reference' | 'trace' | 'serde' | 'completeness';
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
  'route_handler',
  'middleware',
  'business_logic',
  'validator',
  'transformer',
  'db_call',
  'external_http_call',
  'struct',
  'enum',
  'message_queue',
  'function',
]);

function validateNodes(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const idSet = new Set<string>();

  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    const p = `nodes[${i}]`;

    if (!node.id) {
      errors.push({
        severity: 'error',
        category: 'structure',
        message: `Node at index ${i} has no id`,
        path: p,
      });
      continue;
    }

    if (idSet.has(node.id)) {
      errors.push({
        severity: 'error',
        category: 'structure',
        message: `Duplicate node id: "${node.id}"`,
        path: p,
      });
    }
    idSet.add(node.id);

    if (!node.kind || !VALID_KINDS.has(node.kind)) {
      errors.push({
        severity: 'error',
        category: 'structure',
        message: `Node "${node.id}" has invalid kind: "${node.kind}"`,
        path: `${p}.kind`,
      });
    }

    if (!node.name) {
      errors.push({
        severity: 'warning',
        category: 'structure',
        message: `Node "${node.id}" has no name`,
        path: `${p}.name`,
      });
    }

    if (!node.defined_in && node.kind !== 'enum' && node.kind !== 'struct') {
      errors.push({
        severity: 'warning',
        category: 'structure',
        message: `Node "${node.id}" has no defined_in`,
        path: `${p}.defined_in`,
      });
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
        severity: 'error',
        category: 'reference',
        message: `Edge from "${edge.from}" → "${edge.to}": source node "${edge.from}" does not exist in nodes array`,
        path: `${p}.from`,
      });
    }

    if (!nodeIds.has(edge.to)) {
      errors.push({
        severity: 'error',
        category: 'reference',
        message: `Edge from "${edge.from}" → "${edge.to}": target node "${edge.to}" does not exist in nodes array`,
        path: `${p}.to`,
      });
    }

    if (edge.from === edge.to) {
      errors.push({
        severity: 'error',
        category: 'structure',
        message: `Edge "${edge.from}" → "${edge.to}" is a self-loop. Edges must not be self-referential.`,
        path: `${p}`,
      });
    }
  }

  // DAG check: detect cycles
  const adj = new Map<string, string[]>();
  for (const e of result.edges) {
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const n of result.nodes) color.set(n.id, WHITE);

  function dfs(u: string, path: string[]): string[] | null {
    color.set(u, GRAY);
    path.push(u);
    for (const v of adj.get(u) || []) {
      if (color.get(v) === GRAY) {
        const ci = path.indexOf(v);
        return path.slice(ci).concat(v);
      }
      if (color.get(v) === WHITE) {
        const r = dfs(v, path);
        if (r) return r;
      }
    }
    path.pop();
    color.set(u, BLACK);
    return null;
  }

  for (const n of result.nodes) {
    if (color.get(n.id) === WHITE) {
      const cycle = dfs(n.id, []);
      if (cycle) {
        errors.push({
          severity: 'error',
          category: 'structure',
          message: `Edges contain a cycle: ${cycle.join(' → ')}. Edges must form a DAG. Remove the edge that creates the back-reference.`,
          path: 'edges',
        });
        break; // report one cycle only
      }
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
    result.nodes.filter((n) => n.kind === 'route_handler').map((n) => n.id),
  );

  // Build reachability set from each route_handler via BFS
  const adj = new Map<string, string[]>();
  for (const e of result.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  function reachableFrom(startId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startId];
    visited.add(startId);
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      for (const next of adj.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  }

  for (let t = 0; t < traces.length; t++) {
    const trace = traces[t];
    const p = `traces[${t}]`;

    if (!routeHandlerIds.has(trace.route_id)) {
      errors.push({
        severity: 'error',
        category: 'trace',
        message: `Trace "${trace.label}" has route_id "${trace.route_id}" which is not a route_handler node`,
        path: `${p}.route_id`,
      });
    }

    if (!trace.steps || trace.steps.length === 0) {
      errors.push({
        severity: 'error',
        category: 'trace',
        message: `Trace "${trace.label}" has no steps`,
        path: `${p}.steps`,
      });
      continue;
    }

    // Compute reachable nodes from this trace's entry points
    // (the route_handler and any middleware that precedes it)
    const reachable = reachableFrom(trace.route_id);
    // Also add nodes reachable from the first step (e.g. middleware)
    if (trace.steps.length > 0 && trace.steps[0].node_id !== trace.route_id) {
      for (const id of reachableFrom(trace.steps[0].node_id)) {
        reachable.add(id);
      }
    }

    for (let s = 0; s < trace.steps.length; s++) {
      const step = trace.steps[s];

      if (!nodeIds.has(step.node_id)) {
        errors.push({
          severity: 'error',
          category: 'trace',
          message: `Trace "${trace.label}" step ${s} references node "${step.node_id}" which does not exist`,
          path: `${p}.steps[${s}].node_id`,
        });
      } else if (s > 0 && !reachable.has(step.node_id)) {
        errors.push({
          severity: 'warning',
          category: 'trace',
          message: `Trace "${trace.label}" step ${s} node "${step.node_id}" is not reachable from route_handler "${trace.route_id}" via edges`,
          path: `${p}.steps[${s}].node_id`,
        });
      }

      if (!step.summary || step.summary.length < 5) {
        errors.push({
          severity: 'warning',
          category: 'trace',
          message: `Trace "${trace.label}" step ${s} has a very short or empty summary`,
          path: `${p}.steps[${s}].summary`,
        });
      }

      // Validate "when" condition structure
      if (step.when) {
        const condErrors = validateCondition(step.when, `${p}.steps[${s}].when`);
        errors.push(...condErrors);
      }
    }

    // Validate "match" condition structure
    if (trace.match) {
      for (let m = 0; m < trace.match.length; m++) {
        const condErrors = validateCondition(trace.match[m], `${p}.match[${m}]`);
        errors.push(...condErrors);
      }
    }
  }

  return errors;
}

const VALID_OPS = new Set([
  'eq',
  'neq',
  'in',
  'not_in',
  'exists',
  'not_exists',
  'eq_field',
  'neq_field',
]);

function validateCondition(cond: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof cond !== 'object' || cond === null) {
    errors.push({
      severity: 'error',
      category: 'trace',
      message: `Condition at ${path} is not an object`,
      path,
    });
    return errors;
  }
  const c = cond as Record<string, unknown>;
  if (!c.field || typeof c.field !== 'string') {
    errors.push({
      severity: 'error',
      category: 'trace',
      message: `Condition at ${path} missing "field" string`,
      path,
    });
  }
  if (!c.op || !VALID_OPS.has(c.op as string)) {
    errors.push({
      severity: 'error',
      category: 'trace',
      message: `Condition at ${path} has invalid op "${c.op}". Valid: ${Array.from(VALID_OPS).join(', ')}`,
      path,
    });
  }
  if ((c.op === 'in' || c.op === 'not_in') && !Array.isArray(c.value)) {
    errors.push({
      severity: 'error',
      category: 'trace',
      message: `Condition at ${path} with op "${c.op}" requires value to be an array`,
      path,
    });
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
        severity: 'error',
        category: 'reference',
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
      validValues.set(ext.typeName, new Set(ext.serdeVariants.map((v) => v.jsonValue)));
    }
  }

  if (validValues.size === 0) return errors;

  // Check example_payloads in nodes
  for (const node of result.nodes) {
    if (!node.example_payload) continue;
    try {
      const payload =
        typeof node.example_payload === 'string'
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
  if (typeof payload !== 'object' || payload === null) return;

  // Heuristic: field names that likely correspond to known enum types
  // e.g. "source_chain" → ChainType, "action" → CredentialAction
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') continue;

    // Try to match field name to a type
    for (const [typeName, validSet] of validValues) {
      const typeNameLower = typeName.toLowerCase();
      const keyLower = key.toLowerCase().replace(/_/g, '');

      // Match "source_chain" → "chaintype", "action" → "credentialaction", etc.
      if (
        keyLower.includes(typeNameLower.replace('type', '')) ||
        typeNameLower.includes(keyLower)
      ) {
        if (!validSet.has(value)) {
          errors.push({
            severity: 'warning',
            category: 'serde',
            message: `${context}: field "${key}" has value "${value}" which may not be a valid ${typeName} variant. Valid values: ${Array.from(validSet).join(', ')}`,
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
  const routeHandlers = result.nodes.filter((n) => n.kind === 'route_handler');
  const tracedRoutes = new Set(traces.map((t) => t.route_id));

  for (const rh of routeHandlers) {
    if (!tracedRoutes.has(rh.id)) {
      errors.push({
        severity: 'warning',
        category: 'completeness',
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
        severity: 'warning',
        category: 'completeness',
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

  const criticalErrors = errors.filter((e) => e.severity === 'error');

  const repairInstructions =
    errors.length > 0
      ? errors
          .map((e, i) => `${i + 1}. [${e.severity.toUpperCase()}] ${e.category}: ${e.message}`)
          .join('\n')
      : '';

  return {
    valid: criticalErrors.length === 0,
    errors,
    repairInstructions,
  };
}
