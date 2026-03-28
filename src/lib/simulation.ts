import { ComponentNode, InputFieldSchema, SimulationStep, TraceStepDef } from './schema';
import { matchesAll, evaluateCondition } from './conditions';
import { executeCompute } from './compute';

/**
 * Apply explicit input_mapping to transform the previous step's output.
 */
export function applyInputMapping(prevOutput: unknown, mapping: Record<string, string>): unknown {
  const result: Record<string, unknown> = {};
  for (const [targetField, sourcePath] of Object.entries(mapping)) {
    result[targetField] = getFieldValue(prevOutput, sourcePath);
  }
  return result;
}

/**
 * Automatically adapt the previous step's output to fit the next node's expected input.
 *
 * Strategy:
 * 1. If node has explicit input_mapping on the trace step → use that (highest priority)
 * 2. If node has input_schema → build a NEW object with ONLY the fields the schema expects
 * 3. If node has input_mapping on the node itself → use that
 * 4. Parse the node's input type signature to understand expected structure
 * 5. Fallback: pass through prevOutput as-is
 *
 * The key insight: Build a FRESH object that matches the function signature,
 * extracting values from prevOutput based on the expected input type.
 */
export function adaptInput(
  prevOutput: unknown,
  node: ComponentNode,
  stepMapping?: Record<string, string>,
): unknown {
  // Priority 1: explicit input_mapping from trace step
  if (stepMapping && Object.keys(stepMapping).length > 0) {
    return applyInputMapping(prevOutput, stepMapping);
  }

  // Priority 2: input_mapping on the node itself
  if (node.input_mapping && Object.keys(node.input_mapping).length > 0) {
    return applyInputMapping(prevOutput, node.input_mapping);
  }

  if (typeof prevOutput !== 'object' || prevOutput === null || Array.isArray(prevOutput)) {
    return prevOutput;
  }

  const prev = prevOutput as Record<string, unknown>;

  // Priority 3: Build input from input_schema (ONLY expected fields)
  if (node.input_schema && node.input_schema.length > 0) {
    const adapted: Record<string, unknown> = {};

    for (const field of node.input_schema) {
      const rootKey = field.field.split('.')[0].split('[')[0];

      // Check if field exists at root level
      if (rootKey in prev) {
        adapted[rootKey] = prev[rootKey];
        continue;
      }

      // Search nested structures
      const found = deepFind(prev, rootKey);
      if (found !== undefined) {
        adapted[rootKey] = found;
        continue;
      }

      // Required field not found - leave undefined (validation will catch it)
      if (field.required) {
        adapted[rootKey] = undefined;
      }
    }

    return adapted;
  }

  // Priority 4: Parse input type signature
  if (node.input) {
    const expectedFields = extractFieldsFromTypeSignature(node.input);
    if (expectedFields.length > 0) {
      const adapted: Record<string, unknown> = {};

      for (const fieldName of expectedFields) {
        if (fieldName in prev) {
          adapted[fieldName] = prev[fieldName];
          continue;
        }

        const found = deepFind(prev, fieldName);
        if (found !== undefined) {
          adapted[fieldName] = found;
        }
      }

      return adapted;
    }
  }

  // Fallback: pass through as-is
  return prevOutput;
}

/**
 * Extract field names from a type signature string.
 * Examples:
 *   "CreateOrderRequest" → []
 *   "{url: string, chains: Chain[]}" → ["url", "chains"]
 *   "{create_order: MatchedOrderVerbose, source_swap: SwapInfo}" → ["create_order", "source_swap"]
 */
function extractFieldsFromTypeSignature(typeStr: string): string[] {
  const trimmed = typeStr.trim();

  // If it's just a type name (no braces), we can't extract fields
  if (!trimmed.includes('{')) {
    return [];
  }

  // Extract content between first { and last }
  const match = trimmed.match(/\{([^}]+)\}/);
  if (!match) return [];

  const content = match[1];
  const fields: string[] = [];

  // Split by comma, but be careful of nested types
  const parts = content.split(',');
  for (const part of parts) {
    const fieldMatch = part.trim().match(/^(\w+)\s*:/);
    if (fieldMatch) {
      fields.push(fieldMatch[1]);
    }
  }

  return fields;
}

/**
 * Deep-search an object for a key, looking inside nested objects and arrays.
 * Returns the first match found.
 */
function deepFind(obj: unknown, key: string, maxDepth = 4): unknown {
  if (maxDepth <= 0) return undefined;
  if (typeof obj !== 'object' || obj === null) return undefined;

  if (!Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;
    if (key in record) return record[key];
    // Search nested objects
    for (const v of Object.values(record)) {
      if (typeof v === 'object' && v !== null) {
        const found = deepFind(v, key, maxDepth - 1);
        if (found !== undefined) return found;
      }
    }
  } else {
    // Search first array element
    if (obj.length > 0) {
      const found = deepFind(obj[0], key, maxDepth - 1);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

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

  // If input is not an object, return template
  if (typeof inp !== 'object' || inp === null) {
    return tpl;
  }

  // If template is not an object, return input (user's data takes precedence)
  if (typeof tpl !== 'object' || tpl === null) {
    return inp;
  }

  // Handle arrays: prefer input array if both are arrays
  if (Array.isArray(tpl) && Array.isArray(inp)) {
    return inp;
  }

  // If only one is array, return input if it's the array (user data), otherwise template
  if (Array.isArray(inp)) {
    return inp;
  }
  if (Array.isArray(tpl)) {
    return tpl;
  }

  const tplObj = tpl as Record<string, unknown>;
  const inpObj = inp as Record<string, unknown>;
  
  // Start with input as base (user's data is primary)
  const result: Record<string, unknown> = { ...inpObj };

  // Add template fields that aren't in input (computed fields like order_evaluations)
  for (const key of Object.keys(tplObj)) {
    if (key in inpObj) {
      // Field exists in both - merge recursively
      const tVal = tryParseJson(tplObj[key]);
      const iVal = tryParseJson(inpObj[key]);

      // If both are arrays, use input array directly
      if (Array.isArray(tVal) && Array.isArray(iVal)) {
        result[key] = iVal;
      } else if (
        typeof tVal === 'object' &&
        tVal !== null &&
        !Array.isArray(tVal) &&
        typeof iVal === 'object' &&
        iVal !== null &&
        !Array.isArray(iVal)
      ) {
        // Both are objects (not arrays), merge recursively
        result[key] = mergeInputIntoOutput(tVal, iVal);
      } else {
        // Primitive or mismatched types, use input value
        result[key] = iVal;
      }
    } else {
      // Field only in template - compute it based on input if possible
      if (key === 'cleanup_summary' && 'orders' in result && Array.isArray(result.orders)) {
        // Compute cleanup_summary from input orders
        const orders = result.orders as any[];
        result[key] = {
          current_order_ids: orders.map((o: any) => o.create_order?.create_id).filter(Boolean),
          removed_invalid_order_ids: [],
          removed_non_init_order_ids: [],
          removed_non_redeemed_order_ids: [],
          removed_managed_secret_order_ids: [],
          removed_improper_fill_order_ids: [],
          removed_hard_fail_order_ids: []
        };
      } else if (key === 'order_evaluations' && 'orders' in result && Array.isArray(result.orders)) {
        // Compute order_evaluations from input orders
        const orders = result.orders as any[];
        // Filter out blacklisted orders (they are skipped in the actual Rust code)
        const blacklistedOrders = orders.filter((order: any) => {
          const isBlacklisted = order.create_order?.additional_data?.is_blacklisted;
          return isBlacklisted;
        });
        const processedOrders = orders.filter((order: any) => {
          const isBlacklisted = order.create_order?.additional_data?.is_blacklisted;
          return !isBlacklisted;
        });
        
        // Add skipped orders summary
        if (blacklistedOrders.length > 0) {
          result['skipped_orders'] = {
            count: blacklistedOrders.length,
            reason: 'blacklisted',
            order_ids: blacklistedOrders.map((o: any) => o.create_order?.create_id).filter(Boolean)
          };
        }
        
        result[key] = processedOrders.map((order: any) => {
          // Simple state determination based on swap status
          let orderState = 'New';
          const srcSwap = order.source_swap || {};
          const dstSwap = order.destination_swap || {};
          
          // Check for hard fail: source refunded after destination initiated
          if (srcSwap.refund_tx_hash && dstSwap.initiate_tx_hash && !dstSwap.redeem_tx_hash && !dstSwap.refund_tx_hash) {
            orderState = 'HardFail';
          }
          // Check redemption states (only if swaps were initiated)
          else if (srcSwap.redeem_tx_hash && srcSwap.initiate_tx_hash) {
            orderState = 'CobiRedeemed';
          } else if (dstSwap.redeem_tx_hash && dstSwap.initiate_tx_hash) {
            orderState = 'UserRedeemed';
          } else if (dstSwap.initiate_tx_hash && !dstSwap.redeem_tx_hash) {
            orderState = 'CobiInitiated';
          } else if (srcSwap.initiate_tx_hash && !srcSwap.redeem_tx_hash) {
            orderState = 'UserInitiated';
          }
          // Check for improper fill (only if swaps have been initiated)
          else if ((srcSwap.initiate_tx_hash || dstSwap.initiate_tx_hash) && 
                   (srcSwap.filled_amount !== srcSwap.amount || dstSwap.filled_amount !== dstSwap.amount)) {
            orderState = 'ImproperFill';
          }
          
          // Validate pending orders (New state)
          let isValidPendingOrder = null;
          if (orderState === 'New') {
            // Invalid if has redeem tx when nothing is initiated
            isValidPendingOrder = !(srcSwap.redeem_tx_hash && !srcSwap.initiate_tx_hash);
          }
          
          return {
            order: order,
            order_state: orderState,
            is_valid_pending_order: isValidPendingOrder
          };
        });
      } else if (key === 'cache_updates' && 'order_evaluations' in result && Array.isArray(result.order_evaluations)) {
        // Compute cache_updates from order_evaluations
        const evals = result.order_evaluations as any[];
        result[key] = {
          hard_fail_order_ids: evals.filter((e: any) => e.order_state === 'HardFail').map((e: any) => e.order?.create_order?.create_id).filter(Boolean),
          invalid_order_ids: evals.filter((e: any) => e.order_state === 'New' && e.is_valid_pending_order === false).map((e: any) => e.order?.create_order?.create_id).filter(Boolean),
          non_init_order_ids: evals.filter((e: any) => e.order_state === 'UserInitiated').map((e: any) => e.order?.create_order?.create_id).filter(Boolean),
          non_redeemed_order_ids: evals.filter((e: any) => e.order_state === 'UserRedeemed').map((e: any) => e.order?.create_order?.create_id).filter(Boolean),
          managed_secret_order_ids: evals.filter((e: any) => e.order_state === 'CobiInitiated').map((e: any) => e.order?.create_order?.create_id).filter(Boolean),
          improper_fill_order_ids: evals.filter((e: any) => e.order_state === 'ImproperFill').map((e: any) => e.order?.create_order?.create_id).filter(Boolean)
        };
      } else {
        // Other computed fields - use template value
        result[key] = tplObj[key];
      }
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
  // Phase 0: If node has compute definition, use that (highest priority)
  if (node.compute) {
    try {
      const output = executeCompute(node.compute, inputPayload);
      // Check if output indicates termination (error case)
      const terminates = 
        (typeof output === 'object' && output !== null && 'err' in output) ||
        (typeof output === 'object' && output !== null && 'ok' in output && output.ok === false);
      return {
        output,
        terminates,
        explanation: 'Output computed dynamically from input',
      };
    } catch (err) {
      return {
        output: {
          ok: false,
          error: `Compute execution failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        terminates: true,
        explanation: 'Compute error',
      };
    }
  }

  // Phase 1: Validate against input_schema — repo-accurate error messages
  // Only terminates if the field has an explicit error_message or error_status (source-derived).
  // Auto-derived schemas without these may mismatch the chain — fall through to output_cases.
  if (node.input_schema && node.input_schema.length > 0) {
    const schemaError = validateInputSchema(inputPayload, node.input_schema);
    if (schemaError) {
      const isSourceDerived = schemaError.status != null;
      if (isSourceDerived) {
        // Explicit source-code validation — trust it fully, terminate
        return {
          output: {
            ok: false,
            error: schemaError.message,
            status: schemaError.status,
            validation: {
              field: schemaError.field,
              expected: schemaError.expected,
              actual: schemaError.actual,
            },
          },
          terminates: true,
          explanation: schemaError.message,
        };
      }
      // Auto-derived schema — check if output_cases can handle it first.
      // If output_cases also fail, we'll use this error as the diagnostic.
    }
  }

  // Phase 2: Evaluate output_cases — business logic branching
  if (node.output_cases && node.output_cases.length > 0) {
    // Pass 1: exact match (all conditions pass)
    for (const c of node.output_cases) {
      if (matchesAll(c.match, inputPayload)) {
        const output = mergeInputIntoOutput(c.output, inputPayload);
        return { output, terminates: !!c.terminates, explanation: c.explanation };
      }
    }

    // Pass 2: best partial match — find the non-terminating case with the most conditions passing.
    // This handles LLM-generated match conditions that are overly specific (e.g. "client.timeout eq 5").
    // The real business logic condition (e.g. "orders exists") may pass even if irrelevant ones don't.
    let bestCase: (typeof node.output_cases)[0] | null = null;
    let bestScore = 0;
    for (const c of node.output_cases) {
      if (!c.match || c.match.length === 0) continue; // skip catch-all
      if (c.terminates) continue; // only consider success paths
      const passing = c.match.filter((cond) => evaluateCondition(cond, inputPayload)).length;
      if (passing > bestScore) {
        bestScore = passing;
        bestCase = c;
      }
    }
    if (bestCase && bestScore > 0) {
      const output = mergeInputIntoOutput(bestCase.output, inputPayload);
      return { output, terminates: !!bestCase.terminates, explanation: bestCase.explanation };
    }

    // Check if there's a catch-all case (no match conditions or empty match array)
    const catchAll = node.output_cases.find((c) => !c.match || c.match.length === 0);
    if (catchAll) {
      const output = mergeInputIntoOutput(catchAll.output, inputPayload);
      return { output, terminates: !!catchAll.terminates, explanation: catchAll.explanation };
    }

    // No output_case matched — produce a diagnostic showing WHY
    // Analyze each case's conditions to show which fields failed
    const diagnostics: string[] = [];
    for (let i = 0; i < node.output_cases.length; i++) {
      const c = node.output_cases[i];
      if (!c.match || c.match.length === 0) continue; // skip catch-all (it would have matched)
      const failedConds: string[] = [];
      for (const cond of c.match) {
        if (!evaluateCondition(cond, inputPayload)) {
          const actual = getFieldValue(inputPayload, cond.field);
          failedConds.push(
            `${cond.field} ${cond.op}${cond.value !== undefined ? ' ' + JSON.stringify(cond.value) : ''} (got: ${JSON.stringify(actual) ?? 'undefined'})`,
          );
        }
      }
      if (failedConds.length > 0) {
        const label = c.explanation || `case ${i + 1}`;
        diagnostics.push(`${label}: ${failedConds.join(', ')}`);
      }
    }

    return {
      output: {
        ok: false,
        error: `No output_case matched for "${node.name}". Input does not satisfy any condition.`,
        diagnostics,
        input_keys:
          typeof inputPayload === 'object' && inputPayload !== null
            ? Object.keys(inputPayload as Record<string, unknown>)
            : [],
      },
      terminates: true,
      explanation: `No output_case matched — ${diagnostics.length} case(s) evaluated, all failed`,
    };
  }

  // Phase 3: Fallback — no output_cases defined
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
