import {
  DiscoveredService,
  PerServiceResult,
  CrossServiceCall,
} from "./schema";
import { buildPerServicePrompt, buildCrossServicePrompt } from "./prompts";
import { chat, getModelName as _getModelName } from "./llm";

export { _getModelName as getModelName };

export async function analyzeService(
  service: DiscoveredService
): Promise<PerServiceResult> {
  if (service.rsFiles.length === 0) {
    return {
      service: {
        id: service.name,
        kind: "service",
        path: service.path,
        description: "Empty service (no .rs files found)",
      },
      nodes: [],
      edges: [],
      mutations: [],
      external_packages: [],
    };
  }

  const { system, user } = buildPerServicePrompt(service);

  let jsonStr: string;
  try {
    jsonStr = await chat({ system, user });
  } catch {
    throw new Error(`LLM call failed for service ${service.name}`);
  }

  try {
    const result = JSON.parse(jsonStr);
    return {
      service: result.service,
      nodes: result.nodes || [],
      edges: result.edges || [],
      mutations: result.mutations || [],
      external_packages: result.external_packages || [],
      traces: result.traces || [],
    };
  } catch {
    // Retry once asking the LLM to fix the JSON
    const fixed = await chat({
      system: "Fix the following invalid JSON. Return ONLY valid JSON, nothing else.",
      user: jsonStr,
    });
    const result = JSON.parse(fixed);
    return {
      service: result.service,
      nodes: result.nodes || [],
      edges: result.edges || [],
      mutations: result.mutations || [],
      external_packages: result.external_packages || [],
      traces: result.traces || [],
    };
  }
}

export async function analyzeCrossService(
  serviceNames: string[],
  perServiceResults: PerServiceResult[]
): Promise<CrossServiceCall[]> {
  if (serviceNames.length < 2) return [];

  const summaries = perServiceResults.map((r) => ({
    serviceName: r.service.id,
    nodes: r.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
  }));

  const { system, user } = buildCrossServicePrompt(serviceNames, summaries);

  try {
    const jsonStr = await chat({ system, user });
    const result = JSON.parse(jsonStr);
    return result.cross_service_calls || [];
  } catch {
    return [];
  }
}
