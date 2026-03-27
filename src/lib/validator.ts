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
  'background_process',
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
  // Build reachability set from each entry point via BFS
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

    if (!nodeIds.has(trace.route_id)) {
      errors.push({
        severity: 'error',
        category: 'trace',
        message: `Trace "${trace.label}" has route_id "${trace.route_id}" which does not exist in nodes`,
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
          message: `Trace "${trace.label}" step ${s} node "${step.node_id}" is not reachable from entry "${trace.route_id}" via edges`,
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
  'eq_type',
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

  // Every entry point (route_handler, or any node kind used as trace entry) should have traces
  const ENTRY_POINT_KINDS = new Set([
    'route_handler',
    'function',
    'business_logic',
    'background_process',
  ]);
  const entryPoints = result.nodes.filter((n) => ENTRY_POINT_KINDS.has(n.kind));
  const tracedEntries = new Set(traces.map((t) => t.route_id));

  for (const ep of entryPoints) {
    if (!tracedEntries.has(ep.id)) {
      if (ep.kind === 'route_handler') {
        errors.push({
          severity: 'warning',
          category: 'completeness',
          message: `Entry point "${ep.id}" (${ep.kind}) has no traces. Every entry point should have at least one trace.`,
          path: `node "${ep.id}"`,
        });
      }
      // For non-route_handler entry points, only warn if they have a call chain (non-leaf)
      // Leaf functions without traces are fine — they don't drive the simulator.
    }
  }

  // Check that match arms in entry points with source_code are covered by traces
  for (const ep of entryPoints) {
    if (!ep.source_code) continue;
    if (!tracedEntries.has(ep.id)) continue;

    const matchArms = (ep.source_code.match(/=>\s*\{/g) || []).length;
    const wildcardArms = (ep.source_code.match(/_\s*=>/g) || []).length;
    const totalArms = matchArms + wildcardArms;

    const entryTraces = traces.filter((t) => t.route_id === ep.id);

    if (totalArms > 0 && entryTraces.length < totalArms) {
      errors.push({
        severity: 'warning',
        category: 'completeness',
        message: `Entry point "${ep.id}" has ~${totalArms} match arms but only ${entryTraces.length} traces. Each distinct code path should have its own trace.`,
        path: `node "${ep.id}"`,
      });
    }
  }

  return errors;
}

// ─── output_cases validation ────────────────────────────────────────

const BANNED_MATCH_ROOTS = new Set([
  'client',
  'config',
  'settings',
  'timeout',
  'interval',
  'connection',
  'pool',
  'cache',
  'monitor',
  'provider',
  'factory',
  'registry',
  'http_client',
  'reqwest_client',
  'db',
  'database',
]);

function isConfigField(field: string): boolean {
  const root = field.split('.')[0].split('[')[0].toLowerCase();
  if (BANNED_MATCH_ROOTS.has(root)) return true;
  const parts = field.toLowerCase().split('.');
  return parts.some(
    (p) =>
      p.includes('timeout') ||
      p.includes('interval') ||
      p.includes('batch_size') ||
      p.includes('capacity') ||
      p.includes('port') ||
      p.includes('_secs') ||
      p.includes('_ms') ||
      p.includes('_seconds') ||
      p.includes('_minutes'),
  );
}

function findStringifiedJsonErrors(obj: unknown, path: string): string[] {
  const errs: string[] = [];
  if (typeof obj === 'string') {
    const t = obj.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length > 5) {
      try {
        JSON.parse(t);
        errs.push(
          `${path} contains stringified JSON "${t.slice(0, 60)}...". Replace with a parsed JSON object.`,
        );
      } catch {
        /* not JSON */
      }
    }
    return errs;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 3); i++) {
      errs.push(...findStringifiedJsonErrors(obj[i], `${path}[${i}]`));
    }
    return errs;
  }
  if (typeof obj === 'object' && obj !== null) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      errs.push(...findStringifiedJsonErrors(v, `${path}.${k}`));
    }
  }
  return errs;
}

const SKIP_OUTPUT_CASES_KINDS = new Set(['struct', 'enum']);

function validateOutputCases(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];

  // Collect all node ids that appear in at least one trace step
  const nodesInTraces = new Set<string>();
  for (const trace of traces) {
    for (const step of trace.steps) {
      nodesInTraces.add(step.node_id);
    }
  }

  const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

  // 1. Every node in a trace (except struct/enum/background_process) should have output_cases
  for (const nodeId of nodesInTraces) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    if (SKIP_OUTPUT_CASES_KINDS.has(node.kind)) continue;

    if (!node.output_cases || node.output_cases.length === 0) {
      // Allow nodes with example_output as a fallback
      if (node.example_output == null) {
        errors.push({
          severity: 'warning',
          category: 'completeness',
          message: `Node "${node.id}" (${node.kind}) appears in traces but has no output_cases and no example_output. The simulator cannot compute output for this step — add output_cases so the chain reacts when input changes.`,
          path: `node "${node.id}".output_cases`,
        });
      }
    }
  }

  // 2. Validate each output_case structure
  for (let i = 0; i < result.nodes.length; i++) {
    const node = result.nodes[i];
    if (!node.output_cases) continue;

    for (let j = 0; j < node.output_cases.length; j++) {
      const oc = node.output_cases[j];
      const p = `nodes[${i}].output_cases[${j}]`;

      // output field is required
      if (oc.output === undefined) {
        errors.push({
          severity: 'error',
          category: 'structure',
          message: `Node "${node.id}" output_case[${j}] missing "output" field`,
          path: p,
        });
      }

      // Validate match conditions if present
      if (oc.match) {
        for (let m = 0; m < oc.match.length; m++) {
          const condErrors = validateCondition(oc.match[m], `${p}.match[${m}]`);
          errors.push(...condErrors);

          // Check for config/internal field references in match
          const field = oc.match[m]?.field;
          if (field && isConfigField(field)) {
            errors.push({
              severity: 'error',
              category: 'structure',
              message: `Node "${node.id}" output_case[${j}] match[${m}] references config/internal field "${field}". Match conditions must only reference data fields from the upstream node's output (e.g. "ok", "orders", "status"), not config values or runtime objects.`,
              path: `${p}.match[${m}]`,
            });
          }
        }
      }

      // Check for stringified JSON in output values
      if (oc.output !== undefined) {
        const strJsonErrors = findStringifiedJsonErrors(oc.output, `${p}.output`);
        for (const msg of strJsonErrors) {
          errors.push({
            severity: 'error',
            category: 'structure',
            message: msg,
            path: `${p}.output`,
          });
        }
      }

      // terminates should be boolean if present
      if (oc.terminates !== undefined && typeof oc.terminates !== 'boolean') {
        errors.push({
          severity: 'warning',
          category: 'structure',
          message: `Node "${node.id}" output_case[${j}] "terminates" should be a boolean, got ${typeof oc.terminates}`,
          path: `${p}.terminates`,
        });
      }
    }

    // Check that catch-all (match: []) is last if present
    const catchAllIdx = node.output_cases.findIndex((oc) => !oc.match || oc.match.length === 0);
    if (catchAllIdx >= 0 && catchAllIdx < node.output_cases.length - 1) {
      errors.push({
        severity: 'warning',
        category: 'structure',
        message: `Node "${node.id}" has a catch-all output_case (match: []) at index ${catchAllIdx} but it is not the last case. Cases after it are unreachable. Move it to the end.`,
        path: `nodes[${i}].output_cases[${catchAllIdx}]`,
      });
    }
  }

  return errors;
}

// ─── Multiple catch-all trace validation ────────────────────────────

function validateTraceCatchAlls(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];

  // Group traces by route_id, count how many have match: []
  const routeCatchAlls = new Map<string, number>();
  for (const trace of traces) {
    if (!trace.match || trace.match.length === 0) {
      routeCatchAlls.set(trace.route_id, (routeCatchAlls.get(trace.route_id) ?? 0) + 1);
    }
  }

  for (const [routeId, count] of routeCatchAlls) {
    if (count > 1) {
      errors.push({
        severity: 'error',
        category: 'trace',
        message: `Route "${routeId}" has ${count} catch-all traces (match: []). Only ONE is allowed per route — the resolver picks the first arbitrarily, making the others unreachable. Add distinguishing match conditions to all but one.`,
        path: `traces for route "${routeId}"`,
      });
    }
  }

  return errors;
}

// ─── Chain-awareness check ──────────────────────────────────────────

function validateOutputCaseChaining(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];
  const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

  for (const trace of traces) {
    if (trace.steps.length < 2) continue;

    for (let s = 1; s < trace.steps.length; s++) {
      const step = trace.steps[s];
      const prevNode = nodeMap.get(trace.steps[s - 1].node_id);
      const currNode = nodeMap.get(step.node_id);
      if (!prevNode || !currNode) continue;
      if (SKIP_OUTPUT_CASES_KINDS.has(currNode.kind)) continue;
      if (!currNode.output_cases || currNode.output_cases.length === 0) continue;

      // Skip if step has input_mapping — the node receives transformed input,
      // so its match conditions reference the mapped fields, not raw upstream output.
      if (step.input_mapping && Object.keys(step.input_mapping).length > 0) continue;

      // Get fields that the previous node outputs (from its first/success output_case)
      const prevOutput = prevNode.output_cases?.[0]?.output;
      if (!prevOutput || typeof prevOutput !== 'object' || prevOutput === null) continue;
      const prevFields = new Set(Object.keys(prevOutput as Record<string, unknown>));

      // Check if current node's match conditions reference fields from the prev output
      const firstCase = currNode.output_cases[0];
      if (!firstCase.match || firstCase.match.length === 0) continue;

      const matchFields = firstCase.match.map((c) => c.field.split('.')[0].split('[')[0]);
      const referencesUpstream = matchFields.some((f) => prevFields.has(f));

      if (!referencesUpstream) {
        errors.push({
          severity: 'warning',
          category: 'completeness',
          message: `Trace "${trace.label}" step ${s}: node "${currNode.id}" output_cases match on [${matchFields.join(', ')}] but the previous step "${prevNode.id}" outputs [${Array.from(prevFields).join(', ')}]. None overlap — the conditions may not be chain-aware. output_cases should match fields from the upstream node's output, not the original request body.`,
          path: `node "${currNode.id}".output_cases[0].match`,
        });
      }
    }
  }

  return errors;
}

// ─── Schema alignment: input_schema vs upstream output ──────────────

function getNestedKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>();
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return keys;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.add(path);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const nested of getNestedKeys(v, path)) keys.add(nested);
    }
  }
  return keys;
}

function validateSchemaAlignment(result: PerServiceResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const traces = result.traces ?? [];
  const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

  for (const trace of traces) {
    if (trace.steps.length < 2) continue;

    for (let s = 1; s < trace.steps.length; s++) {
      const prevNode = nodeMap.get(trace.steps[s - 1].node_id);
      const currNode = nodeMap.get(trace.steps[s].node_id);
      if (!prevNode || !currNode) continue;
      if (!currNode.input_schema || currNode.input_schema.length === 0) continue;

      // Get the fields the upstream outputs
      const prevOutput = prevNode.output_cases?.[0]?.output;
      if (!prevOutput || typeof prevOutput !== 'object' || prevOutput === null) continue;
      const upstreamKeys = getNestedKeys(prevOutput);

      // Skip if step has input_mapping — it handles the transformation
      const step = trace.steps[s];
      if (step.input_mapping && Object.keys(step.input_mapping).length > 0) continue;

      // Check each required field in downstream's input_schema
      const missingFields: string[] = [];
      for (const field of currNode.input_schema) {
        if (!field.required) continue;
        const rootKey = field.field.split('.')[0].split('[')[0];
        if (!upstreamKeys.has(rootKey)) {
          missingFields.push(field.field);
        }
      }

      if (missingFields.length > 0) {
        errors.push({
          severity: 'error',
          category: 'structure',
          message: `Schema misalignment in trace "${trace.label}" step ${s}: node "${currNode.id}" needs [${missingFields.join(', ')}] but upstream "${prevNode.id}" outputs [${Array.from(
            upstreamKeys,
          )
            .filter((k) => !k.includes('.'))
            .join(
              ', ',
            )}]. Add input_mapping to this trace step to extract the right fields, or fix the upstream output to include them.`,
          path: `trace "${trace.label}" step ${s}`,
        });
      }
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
    ...validateOutputCases(result),
    ...validateTraceCatchAlls(result),
    ...validateOutputCaseChaining(result),
    ...validateSchemaAlignment(result),
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
