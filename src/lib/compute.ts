/**
 * Compute engine for dynamic output generation in simulation.
 * Replaces static output_cases with condition-based operations.
 */

import { evaluateCondition } from './conditions';
import type { StepCondition } from './schema';

export interface ComputeStep {
  op:
    | 'evaluate_condition'
    | 'priority_select'
    | 'filter'
    | 'count'
    | 'derive'
    | 'map'
    | 'reduce';
  
  // For evaluate_condition
  condition?: StepCondition;
  
  // For priority_select
  cases?: Array<{
    condition: StepCondition;
    value: unknown;
  }>;
  
  // For filter/map/reduce
  source?: string; // field path to array
  
  // For map
  transform?: Record<string, string>; // field mappings
  
  // For reduce
  accumulator?: string; // initial value expression
  reducer?: string; // operation: 'sum', 'concat', 'merge'
  
  // Output field name (where to store result)
  output_field: string;
  
  // For derive - simple field copy or expression
  expression?: string;
}

export interface ComputeDefinition {
  steps: ComputeStep[];
  output: Record<string, string>; // maps output fields to computed field references
}

/**
 * Get a field value from payload using dot notation and array indexing.
 */
function getField(payload: unknown, path: string): unknown {
  if (!path) return undefined;
  
  // Handle special $ prefix for computed fields
  if (path.startsWith('$')) {
    return (payload as any)?.[path];
  }
  
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = payload;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Set a field value in payload using dot notation.
 */
function setField(payload: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: any = payload;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  
  current[parts[parts.length - 1]] = value;
}

/**
 * Execute a single compute step.
 */
function executeStep(
  step: ComputeStep,
  payload: Record<string, unknown>,
  input: unknown,
): void {
  switch (step.op) {
    case 'evaluate_condition': {
      if (!step.condition) throw new Error('evaluate_condition requires condition');
      const result = evaluateCondition(step.condition, input);
      setField(payload, step.output_field, result);
      break;
    }
    
    case 'priority_select': {
      if (!step.cases) throw new Error('priority_select requires cases');
      for (const c of step.cases) {
        if (evaluateCondition(c.condition, payload)) {
          setField(payload, step.output_field, c.value);
          return;
        }
      }
      // No case matched - set undefined
      setField(payload, step.output_field, undefined);
      break;
    }
    
    case 'filter': {
      if (!step.source || !step.condition) {
        throw new Error('filter requires source and condition');
      }
      const arr = getField(input, step.source);
      if (!Array.isArray(arr)) {
        setField(payload, step.output_field, []);
        return;
      }
      const filtered = arr.filter((item) => evaluateCondition(step.condition!, item));
      setField(payload, step.output_field, filtered);
      break;
    }
    
    case 'count': {
      if (!step.source) throw new Error('count requires source');
      const arr = getField(payload, step.source);
      const count = Array.isArray(arr) ? arr.length : 0;
      setField(payload, step.output_field, count);
      break;
    }
    
    case 'derive': {
      if (!step.expression) throw new Error('derive requires expression');
      const value = getField(input, step.expression);
      setField(payload, step.output_field, value);
      break;
    }
    
    case 'map': {
      if (!step.source || !step.transform) {
        throw new Error('map requires source and transform');
      }
      const arr = getField(input, step.source);
      if (!Array.isArray(arr)) {
        setField(payload, step.output_field, []);
        return;
      }
      const mapped = arr.map((item) => {
        const result: Record<string, unknown> = {};
        for (const [targetField, sourcePath] of Object.entries(step.transform!)) {
          result[targetField] = getField(item, sourcePath);
        }
        return result;
      });
      setField(payload, step.output_field, mapped);
      break;
    }
    
    case 'reduce': {
      if (!step.source || !step.reducer) {
        throw new Error('reduce requires source and reducer');
      }
      const arr = getField(input, step.source);
      if (!Array.isArray(arr)) {
        setField(payload, step.output_field, step.accumulator || 0);
        return;
      }
      
      let result: any = step.accumulator || 0;
      switch (step.reducer) {
        case 'sum':
          result = arr.reduce((acc, val) => acc + (Number(val) || 0), 0);
          break;
        case 'concat':
          result = arr.reduce((acc, val) => acc.concat(val), []);
          break;
        case 'merge':
          result = arr.reduce((acc, val) => ({ ...acc, ...val }), {});
          break;
      }
      setField(payload, step.output_field, result);
      break;
    }
  }
}

/**
 * Execute a compute definition to generate output from input.
 */
export function executeCompute(
  compute: { steps: ComputeStep[]; output: Record<string, unknown> },
  input: unknown,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  
  // Execute all steps in order
  for (const step of compute.steps) {
    executeStep(step, payload, input);
  }
  
  // Build final output from computed fields
  const output: Record<string, unknown> = {};
  
  for (const [outputKey, computedPath] of Object.entries(compute.output)) {
    output[outputKey] = resolveOutputValue(computedPath, payload);
  }
  
  return output;
}

/**
 * Recursively resolve output values, replacing $field references with computed values.
 */
function resolveOutputValue(value: unknown, payload: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    return getField(payload, value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveOutputValue(item, payload));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveOutputValue(v, payload);
    }
    return result;
  }
  return value;
}
