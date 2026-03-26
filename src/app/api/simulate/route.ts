import { NextRequest } from 'next/server';
import { SimulationEvent, SimulationRequest } from '@/lib/schema';
import { simulateNode } from '@/lib/simulation';
import { resolveTrace } from '@/lib/trace-resolver';

function encode(event: SimulationEvent): string {
  return JSON.stringify(event) + '\n';
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { graph, start_node_id, initial_payload, breakpoints, max_steps } =
    body as SimulationRequest;

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Deterministic trace resolution — no AI
  const resolved = resolveTrace(graph, start_node_id, initial_payload);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: SimulationEvent) => {
        if (closed) return;
        try {
          controller.enqueue(new TextEncoder().encode(encode(event)));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        if (!resolved) {
          send({ type: 'error', message: 'No precomputed trace found for this route.' });
          close();
          return;
        }

        const { trace: selectedTrace, steps: resolvedSteps } = resolved;

        send({
          type: 'step',
          step: {
            node_id: '__trace_selected__',
            node_name: 'Trace Selected',
            node_kind: 'function',
            service: '',
            input_payload: initial_payload,
            output_payload: initial_payload,
            explanation: `Selected trace: "${selectedTrace.label}" — ${selectedTrace.description}`,
            diff_summary: `Matched trace with ${resolvedSteps.length} steps`,
          },
        });

        let currentPayload = initial_payload;
        const stepLimit = max_steps != null ? max_steps : resolvedSteps.length;

        for (let i = 0; i < Math.min(resolvedSteps.length, stepLimit); i++) {
          const traceStep = resolvedSteps[i];
          const node = nodeMap.get(traceStep.node_id);
          if (!node) continue;

          if (breakpoints.includes(node.id) && node.id !== start_node_id) {
            send({
              type: 'breakpoint',
              node_id: node.id,
              message: `Breakpoint hit at ${node.name}`,
            });
            send({
              type: 'step',
              step: {
                node_id: node.id,
                node_name: node.name,
                node_kind: node.kind,
                service: node.service,
                input_payload: currentPayload,
                output_payload: currentPayload,
                explanation:
                  'Paused at breakpoint — payload has not been processed by this component yet.',
                diff_summary: 'No changes (breakpoint)',
              },
            });
            close();
            return;
          }

          const step = simulateNode(node, currentPayload);
          send({ type: 'step', step });
          currentPayload = step.output_payload;
        }

        send({ type: 'complete', message: 'Simulation complete' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Simulation error';
        send({ type: 'error', message });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
