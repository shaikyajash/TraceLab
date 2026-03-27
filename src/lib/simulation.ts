import { ComponentNode, SimulationStep } from './schema';
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
function mergeInputIntoOutput(template: unknown, input: unknown): unknown {
  if (
    typeof template !== 'object' ||
    template === null ||
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(template) ||
    Array.isArray(input)
  ) {
    return template;
  }
  const tpl = template as Record<string, unknown>;
  const inp = input as Record<string, unknown>;
  const result: Record<string, unknown> = { ...tpl };

  for (const key of Object.keys(tpl)) {
    if (!(key in inp)) continue;
    const tVal = tpl[key];
    const iVal = inp[key];

    if (
      typeof tVal === 'object' &&
      tVal !== null &&
      !Array.isArray(tVal) &&
      typeof iVal === 'object' &&
      iVal !== null &&
      !Array.isArray(iVal)
    ) {
      // Recurse into nested objects
      result[key] = mergeInputIntoOutput(tVal, iVal);
    } else if (!Array.isArray(tVal)) {
      // Replace scalar/primitive with actual input value
      result[key] = iVal;
    }
    // Arrays: keep template value (structure comes from the template)
  }

  return result;
}

export function resolveNodeOutput(node: ComponentNode, inputPayload: unknown): ResolvedOutput {
  if (node.output_cases && node.output_cases.length > 0) {
    for (const c of node.output_cases) {
      if (matchesAll(c.match, inputPayload)) {
        // Merge actual input values into the output template so user-provided
        // values (e.g. "arbitrum") flow through instead of hardcoded examples.
        const output = mergeInputIntoOutput(c.output, inputPayload);
        return { output, terminates: !!c.terminates, explanation: c.explanation };
      }
    }
  }
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
