import { ComponentNode, SimulationStep } from "./schema";
import {
  buildSimulationPrompt,
  type TraceStepContext,
} from "./simulation-prompts";
import { chat } from "./llm";

export async function simulateNode(
  node: ComponentNode,
  inputPayload: unknown,
  traceContext?: TraceStepContext,
): Promise<SimulationStep> {
  const { system, user } = buildSimulationPrompt(
    node,
    inputPayload,
    traceContext,
  );

  const jsonStr = await chat({ system, user, maxTokens: 4096 });
  const result = JSON.parse(jsonStr);

  return {
    node_id: node.id,
    node_name: node.name,
    node_kind: node.kind,
    service: node.service,
    input_payload: inputPayload,
    output_payload: result.output_payload,
    explanation: result.explanation || "",
    diff_summary: result.diff_summary || "",
  };
}
