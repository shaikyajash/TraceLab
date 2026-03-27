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
  if (!cond || !cond.field || !cond.op) return true;
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
