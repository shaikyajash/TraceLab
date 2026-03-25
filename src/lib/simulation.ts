import { ComponentNode, SimulationStep } from './schema';
import { buildSimulationPrompt, type TraceStepContext } from './simulation-prompts';
import { chat } from './llm';

export async function simulateNode(
  node: ComponentNode,
  inputPayload: unknown,
  traceContext?: TraceStepContext,
): Promise<SimulationStep> {
  const { system, user } = buildSimulationPrompt(node, inputPayload, traceContext);

  const jsonStr = await chat({ system, user, maxTokens: 4096 });

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(jsonStr);
  } catch {
    // Last resort: try to extract JSON from the response
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) {
      result = JSON.parse(match[0]);
    } else {
      // Return a minimal result so simulation can continue
      return {
        node_id: node.id,
        node_name: node.name,
        node_kind: node.kind,
        service: node.service,
        input_payload: inputPayload,
        output_payload: inputPayload,
        explanation: `LLM returned unparseable response for ${node.name}`,
        diff_summary: 'Parse error — payload passed through unchanged',
      };
    }
  }

  return {
    node_id: node.id,
    node_name: node.name,
    node_kind: node.kind,
    service: node.service,
    input_payload: inputPayload,
    output_payload: result.output_payload ?? inputPayload,
    explanation: (result.explanation as string) || '',
    diff_summary: (result.diff_summary as string) || '',
  };
}
