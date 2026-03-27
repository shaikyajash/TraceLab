import { ComponentNode, SimulationStep } from './schema';
import { matchesAll } from './conditions';

export interface ResolvedOutput {
  output: unknown;
  /** True when the matched output_case has terminates: true — downstream steps should be skipped. */
  terminates: boolean;
  explanation?: string;
}

export function resolveNodeOutput(node: ComponentNode, inputPayload: unknown): ResolvedOutput {
  if (node.output_cases && node.output_cases.length > 0) {
    for (const c of node.output_cases) {
      if (matchesAll(c.match, inputPayload)) {
        return { output: c.output, terminates: !!c.terminates, explanation: c.explanation };
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
