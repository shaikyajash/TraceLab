import { StepCondition } from './schema';

function getField(payload: unknown, field: string | undefined): unknown {
  if (!field) return undefined;
  const parts = field.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = payload;
  for (const part of parts) {
    // Auto-parse stringified JSON along the path
    if (typeof current === 'string') {
      const t = current.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          current = JSON.parse(t);
        } catch {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'string') {
    const t = current.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.parse(t);
      } catch {
        /* return as string */
      }
    }
  }
  return current;
}

export function evaluateCondition(
  cond: StepCondition | undefined | null,
  payload: unknown,
): boolean {
  if (!cond || !cond.op) return true;
  
  // Handle logical operators
  if (cond.op === 'and') {
    return cond.conditions?.every((c) => evaluateCondition(c, payload)) ?? true;
  }
  if (cond.op === 'or') {
    return cond.conditions?.some((c) => evaluateCondition(c, payload)) ?? false;
  }
  if (cond.op === 'not') {
    return !(cond.conditions?.[0] ? evaluateCondition(cond.conditions[0], payload) : false);
  }
  
  if (!cond.field) return true;
  const fieldValue = getField(payload, cond.field);
  
  switch (cond.op) {
    case 'eq':
      return fieldValue === cond.value;
    case 'neq':
      return fieldValue !== cond.value;
    case 'gt':
      return typeof fieldValue === 'number' && typeof cond.value === 'number' && fieldValue > cond.value;
    case 'gte':
      return typeof fieldValue === 'number' && typeof cond.value === 'number' && fieldValue >= cond.value;
    case 'lt':
      return typeof fieldValue === 'number' && typeof cond.value === 'number' && fieldValue < cond.value;
    case 'lte':
      return typeof fieldValue === 'number' && typeof cond.value === 'number' && fieldValue <= cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(String(fieldValue));
    case 'not_in':
      return Array.isArray(cond.value) && !cond.value.includes(String(fieldValue));
    case 'contains':
      return typeof fieldValue === 'string' && typeof cond.value === 'string' && fieldValue.includes(cond.value);
    case 'starts_with':
      return typeof fieldValue === 'string' && typeof cond.value === 'string' && fieldValue.startsWith(cond.value);
    case 'ends_with':
      return typeof fieldValue === 'string' && typeof cond.value === 'string' && fieldValue.endsWith(cond.value);
    case 'not_empty':
      if (Array.isArray(fieldValue)) return fieldValue.length > 0;
      if (typeof fieldValue === 'string') return fieldValue.length > 0;
      return fieldValue !== null && fieldValue !== undefined;
    case 'is_empty':
      if (Array.isArray(fieldValue)) return fieldValue.length === 0;
      if (typeof fieldValue === 'string') return fieldValue.length === 0;
      return fieldValue === null || fieldValue === undefined;
    case 'is_some':
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'is_none':
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    case 'eq_field':
      return typeof cond.value === 'string' && fieldValue === getField(payload, cond.value);
    case 'neq_field':
      return typeof cond.value === 'string' && fieldValue !== getField(payload, cond.value);
    case 'eq_type':
      return typeof fieldValue === String(cond.value);
    default:
      return true;
  }
}

export function matchesAll(conditions: StepCondition[] | undefined, payload: unknown): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(c, payload));
}
