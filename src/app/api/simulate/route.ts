import { NextRequest } from "next/server";
import { SimulationEvent, SimulationRequest } from "@/lib/schema";
import { simulateNode } from "@/lib/simulation";
import { setProvider, type LLMProvider } from "@/lib/llm";

function encode(event: SimulationEvent): string {
  return JSON.stringify(event) + "\n";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { graph, start_node_id, initial_payload, breakpoints, provider } =
    body as SimulationRequest & { provider?: string };

  if (provider === "claude" || provider === "gemini") {
    setProvider(provider as LLMProvider);
  }

  // Build adjacency list for BFS traversal
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from) || [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  // BFS to get ordered node sequence
  const visited = new Set<string>();
  const sequence: string[] = [];
  const queue = [start_node_id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    sequence.push(id);
    for (const neighbor of adjacency.get(id) || []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SimulationEvent) => {
        controller.enqueue(new TextEncoder().encode(encode(event)));
      };

      try {
        let currentPayload = initial_payload;

        for (const nodeId of sequence) {
          const node = nodeMap.get(nodeId);
          if (!node) continue;

          // Check breakpoint BEFORE simulating
          if (breakpoints.includes(nodeId) && nodeId !== start_node_id) {
            send({
              type: "breakpoint",
              node_id: nodeId,
              message: `Breakpoint hit at ${node.name}`,
            });
            // Send current payload so client knows what to show in editor
            send({
              type: "step",
              step: {
                node_id: nodeId,
                node_name: node.name,
                node_kind: node.kind,
                service: node.service,
                input_payload: currentPayload,
                output_payload: currentPayload,
                explanation:
                  "Paused at breakpoint — payload has not been processed by this component yet.",
                diff_summary: "No changes (breakpoint)",
              },
            });
            controller.close();
            return;
          }

          const step = await simulateNode(node, currentPayload);
          send({ type: "step", step });
          currentPayload = step.output_payload;
        }

        send({ type: "complete", message: "Simulation complete" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Simulation error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
