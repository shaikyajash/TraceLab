import { NextRequest } from "next/server";
import { SimulationEvent, SimulationRequest } from "@/lib/schema";
import { simulateNode } from "@/lib/simulation";
import { setProvider, type LLMProvider } from "@/lib/llm";
import { selectTrace, collectTypeContext } from "@/lib/trace-selector";
import type { TraceStepContext } from "@/lib/simulation-prompts";

function encode(event: SimulationEvent): string {
  return JSON.stringify(event) + "\n";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { graph, start_node_id, initial_payload, breakpoints, provider } =
    body as SimulationRequest & { provider?: string };

  if (provider === "claude" || provider === "gemini" || provider === "openai") {
    setProvider(provider as LLMProvider);
  }

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // ── Try trace-aware simulation first ──
  const selectedTrace = await selectTrace(
    graph,
    start_node_id,
    initial_payload,
  );

  const typeContext = collectTypeContext(graph.nodes);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SimulationEvent) => {
        controller.enqueue(new TextEncoder().encode(encode(event)));
      };

      try {
        let currentPayload = initial_payload;

        if (selectedTrace) {
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // TRACE-AWARE PATH: walk the trace steps in order
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          // Send trace selection info as first event
          send({
            type: "step",
            step: {
              node_id: "__trace_selected__",
              node_name: "Trace Selected",
              node_kind: "function",
              service: "",
              input_payload: initial_payload,
              output_payload: initial_payload,
              explanation: `Selected trace: "${selectedTrace.label}" — ${selectedTrace.description}`,
              diff_summary: `Matched trace with ${selectedTrace.steps.length} steps`,
            },
          });

          for (let i = 0; i < selectedTrace.steps.length; i++) {
            const traceStep = selectedTrace.steps[i];
            const node = nodeMap.get(traceStep.node_id);
            if (!node) continue;

            // Check breakpoint BEFORE simulating
            if (
              breakpoints.includes(node.id) &&
              node.id !== start_node_id
            ) {
              send({
                type: "breakpoint",
                node_id: node.id,
                message: `Breakpoint hit at ${node.name}`,
              });
              send({
                type: "step",
                step: {
                  node_id: node.id,
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

            const traceContext: TraceStepContext = {
              traceLabel: selectedTrace.label,
              traceDescription: selectedTrace.description,
              stepSummary: traceStep.summary,
              edgeLabel: traceStep.edge_label,
              typeContext,
              stepIndex: i,
              totalSteps: selectedTrace.steps.length,
            };

            const step = await simulateNode(
              node,
              currentPayload,
              traceContext,
            );
            send({ type: "step", step });
            currentPayload = step.output_payload;
          }
        } else {
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // FALLBACK: BFS traversal (no traces available)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          const adjacency = new Map<string, string[]>();
          for (const edge of graph.edges) {
            const list = adjacency.get(edge.from) || [];
            list.push(edge.to);
            adjacency.set(edge.from, list);
          }

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

          for (const nodeId of sequence) {
            const node = nodeMap.get(nodeId);
            if (!node) continue;

            if (
              breakpoints.includes(nodeId) &&
              nodeId !== start_node_id
            ) {
              send({
                type: "breakpoint",
                node_id: nodeId,
                message: `Breakpoint hit at ${node.name}`,
              });
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
        }

        send({ type: "complete", message: "Simulation complete" });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Simulation error";
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
