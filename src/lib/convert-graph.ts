/**
 * Convert new2.json format to app-compatible format
 */

import { ComponentsGraph, ComponentNode, PayloadEdge, RouteTrace } from './schema';

export function convertNew2Graph(rawGraph: any): ComponentsGraph {
  // If already in v1 format, return as-is
  if (Array.isArray(rawGraph.nodes)) {
    return rawGraph;
  }

  // Convert new2.json format
  const nodes: ComponentNode[] = [];
  const edges: PayloadEdge[] = [];
  const traces: RouteTrace[] = [];

  // Convert nodes from object map to array
  if (rawGraph.nodes && typeof rawGraph.nodes === 'object') {
    for (const [id, nodeDef] of Object.entries(rawGraph.nodes)) {
      const node = nodeDef as any;
      nodes.push({
        id: node.id || id,
        service: 'order_monitor',
        kind: node.kind || 'function',
        name: node.fn_name || id,
        input: node.input_type,
        output: node.output_type,
        mutates_state: false,
        defined_in: node.file || '',
        description: node.why_included,
        source_code: '',
        example_input: node.compute?.steps?.[0]?.example_input,
        example_output: node.compute?.output,
        input_schema: node.input_schema,
      });
    }
  }

  // Convert edges
  if (rawGraph.edges && Array.isArray(rawGraph.edges)) {
    for (const edge of rawGraph.edges) {
      edges.push({
        from: edge.from,
        to: edge.to,
        payload: `${edge.from}_to_${edge.to}`,
        from_service: 'order_monitor',
        to_service: 'order_monitor',
      });
    }
  }

  // Convert traces from object map to array
  if (rawGraph.traces && typeof rawGraph.traces === 'object' && !Array.isArray(rawGraph.traces)) {
    for (const [entryId, traceList] of Object.entries(rawGraph.traces)) {
      const traces_arr = traceList as any[];
      for (const traceDef of traces_arr) {
        traces.push({
          route_id: traceDef.entry_point || entryId,
          label: traceDef.label,
          description: traceDef.label,
          example_payload: traceDef.example_initial_input || {},
          steps: (traceDef.steps || []).map((step: any) => ({
            node_id: step.node_id,
            edge_label: step.label,
            summary: step.label,
            when: step.when,
            input_mapping: step.input_mapping,
          })),
          match: traceDef.match ? [traceDef.match] : undefined,
        });
      }
    }
  }

  return {
    meta: {
      scanned_at: rawGraph.scanned_at || new Date().toISOString(),
      workspace_path: rawGraph.workspace_path || '.',
      services_found: ['order_monitor'],
      files_scanned: nodes.length,
      model: rawGraph.model || 'unknown',
    },
    services: [
      {
        id: 'order_monitor',
        kind: 'service',
        path: '.',
        description: 'Order monitoring service',
      },
    ],
    nodes,
    edges,
    traces,
  };
}
