/**
 * Deterministic trace resolver — no AI needed.
 *
 * Traces can have:
 *   `match` — array of conditions on the input payload; ALL must be true for the trace to apply.
 *   `when`  — condition on individual steps; step is included only if true.
 *
 * Resolution:
 *   1. Filter traces by route_id.
 *   2. Try each trace in order — first one where ALL `match` conditions pass wins.
 *   3. Filter its steps by `when` conditions.
 *   4. Return the resolved trace with concrete steps.
 */

import { ComponentsGraph, RouteTrace, StepCondition, TraceStepDef } from './schema';

// ─── Condition evaluator ─────────────────────────────────────────────

function getField(payload: Record<string, unknown>, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(cond: StepCondition, payload: Record<string, unknown>): boolean {
  const fieldValue = getField(payload, cond.field);

  switch (cond.op) {
    case 'eq':
      return fieldValue === cond.value;

    case 'neq':
      return fieldValue !== cond.value;

    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(String(fieldValue));

    case 'not_in':
      return Array.isArray(cond.value) && !cond.value.includes(String(fieldValue));

    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;

    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;

    case 'eq_field':
      // Compare field value against another field's value
      return typeof cond.value === 'string' && fieldValue === getField(payload, cond.value);

    case 'neq_field':
      return typeof cond.value === 'string' && fieldValue !== getField(payload, cond.value);

    default:
      return true;
  }
}

function matchesAll(
  conditions: StepCondition[] | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(c, payload));
}

// ─── Trace resolver ──────────────────────────────────────────────────

export interface ResolvedTrace {
  trace: RouteTrace;
  /** Steps after filtering by `when` conditions */
  steps: TraceStepDef[];
}

/**
 * Deterministically resolve a trace for a given route and payload.
 * No AI needed — uses match/when conditions from the trace definitions.
 *
 * Returns null if no trace matches (caller should fall back to BFS or LLM).
 */
export function resolveTrace(
  graph: ComponentsGraph,
  routeId: string,
  inputPayload: unknown,
): ResolvedTrace | null {
  const traces = graph.traces?.filter((t) => t.route_id === routeId) ?? [];
  if (traces.length === 0) return null;

  const payload =
    typeof inputPayload === 'object' && inputPayload !== null
      ? (inputPayload as Record<string, unknown>)
      : {};

  // Try each trace in order — first match wins
  for (const trace of traces) {
    if (!matchesAll(trace.match, payload)) continue;

    // Filter steps by `when` conditions
    const steps = trace.steps.filter((step) => !step.when || evaluateCondition(step.when, payload));

    return { trace, steps };
  }

  // No match — try traces without `match` (unconditional traces) as fallback
  const unconditional = traces.filter((t) => !t.match || t.match.length === 0);
  if (unconditional.length > 0) {
    const trace = unconditional[0];
    const steps = trace.steps.filter((step) => !step.when || evaluateCondition(step.when, payload));
    return { trace, steps };
  }

  return null;
}
