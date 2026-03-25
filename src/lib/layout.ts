import dagre from '@dagrejs/dagre';
import { type Node, type Edge } from '@xyflow/react';
import { ComponentsGraph } from './schema';

const NODE_WIDTH = 210;
const NODE_HEIGHT = 54;

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  entryPoints: string[];
}

const FLOW_KINDS = new Set([
  'route_handler',
  'transformer',
  'validator',
  'middleware',
  'business_logic',
  'db_call',
  'external_http_call',
  'message_queue',
  'function',
]);

export function computeLayout(graph: ComponentsGraph): LayoutResult {
  // 1. Collect nodes that participate in edges
  const edgeNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    edgeNodeIds.add(edge.from);
    edgeNodeIds.add(edge.to);
  }

  // 2. Filter to flow-relevant nodes
  const flowNodes = graph.nodes.filter((n) => FLOW_KINDS.has(n.kind) || edgeNodeIds.has(n.id));

  // 3. Single flat dagre graph — no grouping, no parent/child
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 28,
    ranksep: 70,
    marginx: 50,
    marginy: 50,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of flowNodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of graph.edges) {
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to);
    }
  }

  for (const call of graph.cross_service_calls) {
    const fromNode = flowNodes.find((n) => n.service === call.from_service);
    const toNode = flowNodes.find((n) => n.service === call.to_service);
    if (fromNode && toNode && g.hasNode(fromNode.id) && g.hasNode(toNode.id)) {
      if (!g.hasEdge(fromNode.id, toNode.id)) {
        g.setEdge(fromNode.id, toNode.id);
      }
    }
  }

  dagre.layout(g);

  // 4. Compute service bounding boxes from positioned nodes
  const serviceBounds = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number }
  >();

  for (const node of flowNodes) {
    const dn = g.node(node.id);
    if (!dn) continue;
    const bounds = serviceBounds.get(node.service) || {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    bounds.minX = Math.min(bounds.minX, dn.x - NODE_WIDTH / 2);
    bounds.minY = Math.min(bounds.minY, dn.y - NODE_HEIGHT / 2);
    bounds.maxX = Math.max(bounds.maxX, dn.x + NODE_WIDTH / 2);
    bounds.maxY = Math.max(bounds.maxY, dn.y + NODE_HEIGHT / 2);
    serviceBounds.set(node.service, bounds);
  }

  // 5. Build React Flow nodes
  const rfNodes: Node[] = [];

  // Service background nodes (visual-only, behind everything)
  const colorIndex = new Map<string, number>();
  graph.services.forEach((s, i) => colorIndex.set(s.id, i % 6));

  const SERVICE_PAD = 24;
  const SERVICE_HEADER = 46;

  for (const service of graph.services) {
    const bounds = serviceBounds.get(service.id);
    if (!bounds) continue;

    rfNodes.push({
      id: `service:${service.id}`,
      type: 'serviceGroup',
      position: {
        x: bounds.minX - SERVICE_PAD,
        y: bounds.minY - SERVICE_PAD - SERVICE_HEADER,
      },
      data: {
        label: service.id,
        description: service.description,
        colorIdx: colorIndex.get(service.id) || 0,
      },
      style: {
        width: bounds.maxX - bounds.minX + SERVICE_PAD * 2,
        height: bounds.maxY - bounds.minY + SERVICE_PAD * 2 + SERVICE_HEADER,
      },
      selectable: false,
      draggable: false,
      zIndex: -1,
    });
  }

  // Component nodes — positioned directly by dagre (no parent)
  for (const node of flowNodes) {
    const dn = g.node(node.id);
    if (!dn) continue;

    rfNodes.push({
      id: node.id,
      type: 'componentCard',
      position: {
        x: dn.x - NODE_WIDTH / 2,
        y: dn.y - NODE_HEIGHT / 2,
      },
      data: {
        ...node,
        isBreakpoint: false,
        simulationState: 'idle' as const,
      },
    });
  }

  // 6. Build edges
  const rfEdges: Edge[] = [];
  const rfNodeIds = new Set(rfNodes.map((n) => n.id));

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (!rfNodeIds.has(edge.from) || !rfNodeIds.has(edge.to)) continue;

    rfEdges.push({
      id: `edge-${i}`,
      source: edge.from,
      target: edge.to,
      type: 'animatedEdge',
      data: {
        payload: edge.payload,
        isCrossService: edge.from_service !== edge.to_service,
        isActive: false,
      },
    });
  }

  for (let i = 0; i < graph.cross_service_calls.length; i++) {
    const call = graph.cross_service_calls[i];
    const fromNode = flowNodes.find((n) => n.service === call.from_service);
    const toNode = flowNodes.find((n) => n.service === call.to_service);
    if (!fromNode || !toNode) continue;
    if (rfEdges.some((e) => e.source === fromNode.id && e.target === toNode.id)) continue;

    rfEdges.push({
      id: `cross-${i}`,
      source: fromNode.id,
      target: toNode.id,
      type: 'animatedEdge',
      data: {
        payload: call.payload_in || '',
        isCrossService: true,
        isActive: false,
      },
    });
  }

  // Entry points: only route_handler nodes
  const entryPoints = graph.nodes.filter((n) => n.kind === 'route_handler').map((n) => n.id);

  return { nodes: rfNodes, edges: rfEdges, entryPoints };
}

// BFS from start node for simulation ordering
export function computeNodeSequence(graph: ComponentsGraph, startNodeId: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from) || [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const visited = new Set<string>();
  const sequence: string[] = [];
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    sequence.push(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return sequence;
}
