import { ComponentNode, ComponentsGraph, RouteTrace } from "./schema";
import { chat } from "./llm";

/**
 * Collects enum and struct definitions from the graph nodes
 * to give the LLM context about valid values and types.
 */
export function collectTypeContext(nodes: ComponentNode[]): string {
  const typeNodes = nodes.filter(
    (n) => n.kind === "enum" || n.kind === "struct",
  );
  if (typeNodes.length === 0) return "";

  return typeNodes
    .map((n) => {
      const code = n.source_code || "";
      const fields = n.fields
        ?.map((f) => `  ${f.name}: ${f.type}`)
        .join("\n");
      return `${n.kind} ${n.name}${fields ? `\n${fields}` : ""}${code ? `\n${code}` : ""}`;
    })
    .join("\n\n");
}

/**
 * Selects the best matching trace for a given route and input payload.
 *
 * Strategy:
 * 1. Filter traces by route_id
 * 2. If only one trace, return it
 * 3. Use LLM to semantically match the input payload to the right trace
 */
export async function selectTrace(
  graph: ComponentsGraph,
  routeId: string,
  inputPayload: unknown,
): Promise<RouteTrace | null> {
  const traces = graph.traces;
  if (!traces || traces.length === 0) return null;

  const routeTraces = traces.filter((t) => t.route_id === routeId);
  if (routeTraces.length === 0) return null;
  if (routeTraces.length === 1) return routeTraces[0];

  const typeContext = collectTypeContext(graph.nodes);

  const system = `You select execution traces. Given a user's input payload and a list of possible execution traces (each with a label, description, and example payload), determine which trace would be triggered.

IMPORTANT RULES:
- Match semantically, not just by string equality. For example "evm" means an EVM chain like Ethereum, "lightning" is close to Spark/Lightning Network.
- If the input contains values that don't match any known type/enum variant, pick the trace that handles validation errors or the closest semantic match.
- If the input has fields that only appear in one trace's example (e.g. "secret_hashes" only appears in retrieve traces), strongly prefer that trace.
- Consider the number of items in arrays (e.g. 2 secret_hashes → batch retrieval).

Respond with ONLY the trace index as a single integer. Nothing else.`;

  const traceList = routeTraces
    .map(
      (t, i) =>
        `[${i}] "${t.label}"\n    Description: ${t.description}\n    Example: ${JSON.stringify(t.example_payload)}`,
    )
    .join("\n\n");

  const user = `${typeContext ? `Known types:\n${typeContext}\n\n` : ""}Available traces:\n${traceList}\n\nUser input payload:\n${JSON.stringify(inputPayload, null, 2)}\n\nWhich trace index (0-${routeTraces.length - 1})?`;

  try {
    const response = await chat({ system, user, maxTokens: 32 });
    const index = parseInt(response.trim(), 10);
    if (!isNaN(index) && index >= 0 && index < routeTraces.length) {
      return routeTraces[index];
    }
  } catch {
    // Fall through to heuristic
  }

  // Heuristic fallback: score by matching keys and values
  const payloadStr = JSON.stringify(inputPayload).toLowerCase();
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < routeTraces.length; i++) {
    const exStr = JSON.stringify(routeTraces[i].example_payload).toLowerCase();
    let score = 0;

    // Count matching keys
    if (typeof inputPayload === "object" && inputPayload !== null) {
      for (const key of Object.keys(inputPayload)) {
        if (exStr.includes(key.toLowerCase())) score += 2;
      }
    }
    // Check if any example values appear in input
    if (typeof routeTraces[i].example_payload === "object") {
      for (const val of Object.values(
        routeTraces[i].example_payload as Record<string, unknown>,
      )) {
        if (
          typeof val === "string" &&
          payloadStr.includes(val.toLowerCase())
        ) {
          score += 3;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return routeTraces[bestIdx];
}
