import { ComponentNode, InputFieldSchema, SimulationStep } from './schema';
import { matchesAll } from './conditions';

export interface ResolvedOutput {
  output: unknown;
  /** True when the matched output_case has terminates: true — downstream steps should be skipped. */
  terminates: boolean;
  explanation?: string;
}

/**
 * Merge actual input values into the output template.
 * The output_case defines the shape (which fields exist), but actual runtime values
 * come from the input where field names overlap. This way if the user types "arbitrum"
 * as the chain param, the output carries "arbitrum" instead of the hardcoded "ethereum".
 *
 * Only overlapping top-level keys are replaced. Nested objects are merged recursively.
 * Array values from the template are kept as-is (structure comes from the template).
 */
/** Try to parse stringified JSON, return as-is if not JSON */
function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t);
    } catch {
      /* not JSON */
    }
  }
  return value;
}

function mergeInputIntoOutput(template: unknown, input: unknown): unknown {
  const tpl = tryParseJson(template);
  const inp = tryParseJson(input);

  if (
    typeof tpl !== 'object' ||
    tpl === null ||
    typeof inp !== 'object' ||
    inp === null ||
    Array.isArray(tpl) ||
    Array.isArray(inp)
  ) {
    return tpl;
  }
  const tplObj = tpl as Record<string, unknown>;
  const inpObj = inp as Record<string, unknown>;
  const result: Record<string, unknown> = { ...tplObj };

  for (const key of Object.keys(tplObj)) {
    if (!(key in inpObj)) continue;
    const tVal = tryParseJson(tplObj[key]);
    const iVal = tryParseJson(inpObj[key]);

    if (
      typeof tVal === 'object' &&
      tVal !== null &&
      !Array.isArray(tVal) &&
      typeof iVal === 'object' &&
      iVal !== null &&
      !Array.isArray(iVal)
    ) {
      result[key] = mergeInputIntoOutput(tVal, iVal);
    } else if (!Array.isArray(tVal)) {
      result[key] = iVal;
    }
  }

  return result;
}

// ─── Input schema validation ────────────────────────────────────────

/** Navigate a dot-notation + bracket path to get a nested value.
 *  Auto-parses stringified JSON encountered along the path —
 *  handles LLM outputs that embed objects as escaped strings. */
function getFieldValue(payload: unknown, field: string): unknown {
  const parts = field.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = payload;
  for (const part of parts) {
    // Auto-parse stringified JSON encountered along the path
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
  // Final value: also try to parse if it's stringified JSON
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

function getActualType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

interface SchemaValidationError {
  field: string;
  expected: string;
  actual: string;
  /** The error message — uses error_message from source code when available, generic fallback otherwise */
  message: string;
  /** HTTP status / error code from source if specified */
  status?: number | string;
}

/**
 * Validate input against a node's input_schema. Returns null if valid,
 * or a precise error describing the first failing field.
 *
 * When input_schema fields have `error_message`, it uses the EXACT error string
 * from the source code (e.g. "At least one chain must be provided") instead of
 * generating a generic message.
 */
function validateInputSchema(
  input: unknown,
  schema: InputFieldSchema[],
): SchemaValidationError | null {
  // First: input must be an object (not null, not array, not primitive)
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      field: '(root)',
      expected: 'object',
      actual: getActualType(input),
      message: `Expected input to be a JSON object, got ${getActualType(input)}`,
    };
  }

  for (const fieldDef of schema) {
    const value = getFieldValue(input, fieldDef.field);
    const label = fieldDef.description || fieldDef.field;
    // Use exact source error message when available, otherwise build a generic one
    const srcError = fieldDef.error_message;
    const status = fieldDef.error_status;

    // Required check
    if (fieldDef.required && (value === undefined || value === null)) {
      return {
        field: fieldDef.field,
        expected: fieldDef.type,
        actual: 'missing',
        message: srcError || `Missing required field: "${label}"`,
        status,
      };
    }

    // Skip further checks if field is absent and not required
    if (value === undefined || value === null) continue;

    // Type check
    const actualType = getActualType(value);
    if (actualType !== fieldDef.type) {
      return {
        field: fieldDef.field,
        expected: fieldDef.type,
        actual: actualType,
        message: srcError || `Field "${label}" must be ${fieldDef.type}, got ${actualType}`,
        status,
      };
    }

    // Enum check (allowed values)
    if (fieldDef.enum && fieldDef.enum.length > 0 && typeof value === 'string') {
      if (!fieldDef.enum.includes(value)) {
        return {
          field: fieldDef.field,
          expected: `one of [${fieldDef.enum.join(', ')}]`,
          actual: String(value),
          message:
            srcError ||
            `Field "${label}" has invalid value "${value}". Expected: ${fieldDef.enum.join(', ')}`,
          status,
        };
      }
    }

    // Pattern check (regex for strings)
    if (fieldDef.pattern && typeof value === 'string') {
      try {
        const regex = new RegExp(fieldDef.pattern);
        if (!regex.test(value)) {
          return {
            field: fieldDef.field,
            expected: `string matching ${fieldDef.pattern}`,
            actual: String(value),
            message: srcError || `Field "${label}" does not match expected format`,
            status,
          };
        }
      } catch {
        // Invalid regex in schema — skip pattern check
      }
    }
  }

  return null;
}

// ─── Main resolution ────────────────────────────────────────────────

export function resolveNodeOutput(node: ComponentNode, inputPayload: unknown): ResolvedOutput {
  // Phase 1: Validate against input_schema — repo-accurate error messages
  if (node.input_schema && node.input_schema.length > 0) {
    const schemaError = validateInputSchema(inputPayload, node.input_schema);
    if (schemaError) {
      return {
        output: {
          ok: false,
          error: schemaError.message,
          ...(schemaError.status != null ? { status: schemaError.status } : {}),
          validation: {
            field: schemaError.field,
            expected: schemaError.expected,
            actual: schemaError.actual,
          },
        },
        terminates: true,
        explanation: `Input validation failed: ${schemaError.message}`,
      };
    }
  }

  // Phase 2: Evaluate output_cases — business logic branching
  if (node.output_cases && node.output_cases.length > 0) {
    for (const c of node.output_cases) {
      if (matchesAll(c.match, inputPayload)) {
        const output = mergeInputIntoOutput(c.output, inputPayload);
        return { output, terminates: !!c.terminates, explanation: c.explanation };
      }
    }
  }

  // Phase 3: Fallback
  return { output: node.example_output ?? inputPayload, terminates: false };
}

export function simulateNode(node: ComponentNode, inputPayload: unknown): SimulationStep {
  const resolved = resolveNodeOutput(node, inputPayload);
  return {
    node_id: node.id,
    node_name: node.name,
    node_kind: node.kind,
    service: node.service,
    input_payload: inputPayload,
    output_payload: resolved.output,
    explanation: node.description || `${node.name} processed the payload.`,
    diff_summary:
      node.output_cases && node.output_cases.length > 0
        ? 'Output resolved from conditional output_cases'
        : node.example_output != null
          ? 'Output from precomputed example'
          : 'Payload passed through unchanged (no example output defined)',
  };
}
