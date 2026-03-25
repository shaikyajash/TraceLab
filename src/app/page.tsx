'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  ComponentsGraph,
  ComponentNode,
  PayloadEdge,
  ScanProgress,
  StepCondition,
} from '@/lib/schema';

/* ── colour palette per node kind ── */
const KIND_COLORS: Record<
  string,
  { bg: string; border: string; badgeBg: string; badgeText: string }
> = {
  route_handler: {
    bg: '#0e1e30',
    border: '#185FA5',
    badgeBg: '#B5D4F4',
    badgeText: '#0C447C',
  },
  middleware: {
    bg: '#1a0e2e',
    border: '#534AB7',
    badgeBg: '#CECBF6',
    badgeText: '#3C3489',
  },
  business_logic: {
    bg: '#0e1e0e',
    border: '#3B6D11',
    badgeBg: '#C0DD97',
    badgeText: '#27500A',
  },
  transformer: {
    bg: '#1e1200',
    border: '#854F0B',
    badgeBg: '#FAC775',
    badgeText: '#633806',
  },
  validator: {
    bg: '#1e0e00',
    border: '#993C1D',
    badgeBg: '#F5C4B3',
    badgeText: '#712B13',
  },
  db_call: {
    bg: '#001e18',
    border: '#0F6E56',
    badgeBg: '#9FE1CB',
    badgeText: '#085041',
  },
};

const KIND_LABELS: Record<string, string> = {
  route_handler: 'ROUTE',
  middleware: 'MIDDLEWARE',
  business_logic: 'HANDLER',
  transformer: 'TRANSFORM',
  validator: 'VALIDATOR',
  db_call: 'DB',
};

const CORE_KINDS = new Set([
  'route_handler',
  'middleware',
  'business_logic',
  'transformer',
  'validator',
  'db_call',
]);

const LEGEND_ITEMS = [
  { kind: 'route_handler', label: 'route' },
  { kind: 'middleware', label: 'middleware' },
  { kind: 'business_logic', label: 'business' },
  { kind: 'transformer', label: 'transformer' },
  { kind: 'validator', label: 'validator' },
  { kind: 'db_call', label: 'db_call' },
];

const NODE_W = 190;
const NODE_H = 80;
const H_GAP = 20;
const V_GAP = 110;

/**
 * Layout using topological depth from edges (BFS from roots).
 * Nodes with no incoming edges are roots (layer 0).
 * Each other node's layer = max(parent layers) + 1.
 * Within each layer, sort by average x of parents.
 */
function layoutNodes(
  nodes: ComponentNode[],
  edges: PayloadEdge[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const ids = new Set(nodes.map((n) => n.id));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from)!.push(e.to);
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push(e.from);
  }

  /* compute depth per node via BFS from roots */
  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => !incoming.get(n.id)?.length);
  const queue: string[] = [];

  for (const r of roots) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  /* nodes with no edges at all */
  for (const n of nodes) {
    if (!depth.has(n.id)) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  }

  /* BFS — set depth = max(parent depth) + 1, with cycle protection */
  let head = 0;
  const MAX_DEPTH = nodes.length + 1;
  while (head < queue.length) {
    const id = queue[head++];
    const d = depth.get(id)!;
    if (d >= MAX_DEPTH) continue; // cap depth to prevent cycles
    for (const child of outgoing.get(id) || []) {
      if (child === id) continue; // skip self-edges
      const prev = depth.get(child);
      if (prev === undefined || prev < d + 1) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  /* group into layers */
  const maxDepth = Math.max(...Array.from(depth.values()), 0);
  const layers: ComponentNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    layers[d].push(n);
  }

  /* find widest layer for centering */
  let maxLayerWidth = 0;
  for (const layer of layers) {
    if (layer.length === 0) continue;
    const w = layer.length * NODE_W + (layer.length - 1) * H_GAP;
    if (w > maxLayerWidth) maxLayerWidth = w;
  }
  const canvasCenter = Math.max(maxLayerWidth / 2 + 60, 500);

  let y = 50;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    if (layer.length === 0) continue;

    /* sort by average x of parents */
    if (li > 0) {
      layer.sort((a, b) => {
        const avgX = (id: string) => {
          const parents = incoming.get(id) || [];
          if (parents.length === 0) return canvasCenter;
          let sum = 0;
          for (const pid of parents) {
            const p = positions.get(pid);
            sum += p ? p.x + NODE_W / 2 : canvasCenter;
          }
          return sum / parents.length;
        };
        return avgX(a.id) - avgX(b.id);
      });
    }

    const totalWidth = layer.length * NODE_W + (layer.length - 1) * H_GAP;
    let x = canvasCenter - totalWidth / 2;
    for (const n of layer) {
      positions.set(n.id, { x, y });
      x += NODE_W + H_GAP;
    }
    y += NODE_H + V_GAP;
  }

  return positions;
}

/* ── cubic bezier path ── */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const cy1 = y1 + Math.abs(y2 - y1) * 0.4;
  const cy2 = y2 - Math.abs(y2 - y1) * 0.4;
  return `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`;
}

/* ── trace step type ── */
interface TraceStep {
  nodeId: string;
  name: string;
  kind: string;
  description: string;
  edgeLabel: string; /* label on the edge that led here */
}

/**
 * Payload-aware BFS: match payload fields against edge labels to pick the right branch.
 * e.g. if payload has action:"Generate", prefer edges containing "Generate" over "Retrieve".
 */
function smartTrace(
  startId: string,
  edges: PayloadEdge[],
  coreIds: Set<string>,
  nodeMap: Map<string, ComponentNode>,
  payload: Record<string, unknown>,
): TraceStep[] {
  const out = new Map<string, Array<{ to: string; payload: string }>>();
  for (const e of edges) {
    if (!coreIds.has(e.from) || !coreIds.has(e.to)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push({ to: e.to, payload: e.payload });
  }

  /* extract hint strings from payload values for matching */
  const hints: string[] = [];
  for (const v of Object.values(payload)) {
    if (typeof v === 'string') hints.push(v.toLowerCase());
  }

  const visited = new Set<string>();
  const steps: TraceStep[] = [];
  const queue: Array<{ id: string; edgeLabel: string }> = [{ id: startId, edgeLabel: '' }];
  visited.add(startId);

  while (queue.length > 0) {
    const { id, edgeLabel } = queue.shift()!;
    const node = nodeMap.get(id);
    steps.push({
      nodeId: id,
      name: node?.name || id,
      kind: node?.kind || 'function',
      description: node?.description || '',
      edgeLabel,
    });

    const children = out.get(id) || [];
    if (children.length === 0) continue;

    /* if we have hints, score edges by how well they match the payload */
    if (hints.length > 0 && children.length > 1) {
      const scored = children.map((c) => {
        const label = c.payload.toLowerCase();
        let score = 0;
        for (const h of hints) {
          if (label.includes(h)) score += 10;
        }
        return { ...c, score };
      });
      /* if any edges match, only follow those; otherwise follow all */
      const maxScore = Math.max(...scored.map((s) => s.score));
      const filtered = maxScore > 0 ? scored.filter((s) => s.score === maxScore) : scored;
      for (const c of filtered) {
        if (!visited.has(c.to)) {
          visited.add(c.to);
          queue.push({ id: c.to, edgeLabel: c.payload });
        }
      }
    } else {
      for (const c of children) {
        if (!visited.has(c.to)) {
          visited.add(c.to);
          queue.push({ id: c.to, edgeLabel: c.payload });
        }
      }
    }
  }

  return steps;
}

/* ── main page ── */
export default function Home() {
  const [graph, setGraph] = useState<ComponentsGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [scanPhase, setScanPhase] = useState<string>('');
  const [forceRescan, setForceRescan] = useState(false);

  /* canvas state */
  const [tx, setTx] = useState(20);
  const [ty, setTy] = useState(20);
  const [scale, setScale] = useState(0.72);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  /* selection */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* sidebar resize */
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStart = useRef({ x: 0, w: 300 });

  /* simulation tracing */
  const [traceMethod, setTraceMethod] = useState('GET');
  const [traceRouteId, setTraceRouteId] = useState<string | null>(null);
  const [activeTraceIds, setActiveTraceIds] = useState<Set<string>>(new Set());
  const [traceHeadId, setTraceHeadId] = useState<string | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [traceVisible, setTraceVisible] = useState(0);

  /* request builder */
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [reqBody, setReqBody] = useState('{\n  \n}');
  const [activeReqTab, setActiveReqTab] = useState<'params' | 'body'>('params');

  /* filtered core nodes + edges */
  const coreNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n) => CORE_KINDS.has(n.kind));
  }, [graph]);

  const coreNodeIds = useMemo(() => new Set(coreNodes.map((n) => n.id)), [coreNodes]);

  const coreEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => coreNodeIds.has(e.from) && coreNodeIds.has(e.to));
  }, [graph, coreNodeIds]);

  /* routes for sidebar */
  const routes = useMemo(() => {
    return coreNodes.filter((n) => n.kind === 'route_handler');
  }, [coreNodes]);

  /* extract path params from selected route pattern */
  const routePathParams = useMemo(() => {
    if (!traceRouteId) return [];
    const node = coreNodes.find((n) => n.id === traceRouteId);
    const pattern = node?.path_pattern || '';
    const matches = pattern.match(/[:{}][a-zA-Z_]+}?/g);
    if (!matches) return [];
    return matches.map((m) => m.replace(/[:{}]/g, ''));
  }, [traceRouteId, coreNodes]);

  /* auto-populate method, path params, and body when route changes */
  useEffect(() => {
    if (!traceRouteId) return;
    const node = coreNodes.find((n) => n.id === traceRouteId);
    if (!node) return;

    /* auto-detect method from node data */
    if (node.method) {
      setTraceMethod(node.method.toUpperCase());
    } else {
      /* try to infer from the node id or name */
      const idUpper = node.id.toUpperCase();
      if (idUpper.startsWith('GET ')) setTraceMethod('GET');
      else if (idUpper.startsWith('POST ')) setTraceMethod('POST');
      else if (idUpper.startsWith('PUT ')) setTraceMethod('PUT');
      else if (idUpper.startsWith('DELETE ')) setTraceMethod('DELETE');
      else if (idUpper.startsWith('PATCH ')) setTraceMethod('PATCH');
    }

    /* auto-fill body from example_payload */
    if (node.example_payload) {
      try {
        /* pretty-print if valid JSON */
        setReqBody(JSON.stringify(JSON.parse(node.example_payload), null, 2));
      } catch {
        setReqBody(node.example_payload);
      }
      /* switch to body tab if it's a method that supports a body */
      const m = (node.method || 'GET').toUpperCase();
      if (m !== 'GET' && m !== 'HEAD') {
        setActiveReqTab('body');
      }
    } else {
      setReqBody('{\n  \n}');
    }

    /* reset path params */
    const init: Record<string, string> = {};
    for (const p of routePathParams) init[p] = '';
    setPathParams(init);
  }, [traceRouteId, coreNodes, routePathParams]);

  /* positions */
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (!graph) return;
    setPositions(layoutNodes(coreNodes, coreEdges));
  }, [graph, coreNodes, coreEdges]);

  /* ── sidebar resize handlers ── */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStart.current = { x: e.clientX, w: sidebarWidth };
    },
    [sidebarWidth],
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = resizeStart.current.x - e.clientX;
      setSidebarWidth(Math.max(200, Math.min(600, resizeStart.current.w + delta)));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  /* ── scan from GitHub URL ── */
  const handleScan = useCallback(async () => {
    const url = githubUrl.trim();
    if (!url) return;
    setIsScanning(true);
    setError(null);
    setScanMessage('Starting...');
    setScanPhase('discovering');

    try {
      const res = await fetch('/api/clone-and-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, forceRescan }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outputPath = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const progress: ScanProgress = JSON.parse(line);
            setScanPhase(progress.phase);
            setScanMessage(progress.message);

            if (progress.phase === 'done' && progress.summary) {
              outputPath = progress.summary.outputPath;
            }
            if (progress.phase === 'error') {
              throw new Error(progress.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== line) throw e;
          }
        }
      }

      /* load the graph from the output file */
      if (outputPath) {
        const loadRes = await fetch('/api/load-graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: outputPath }),
        });
        if (loadRes.ok) {
          const data: ComponentsGraph = await loadRes.json();
          setGraph(data);
        } else {
          throw new Error('Scan completed but failed to load graph');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsScanning(false);
      setScanPhase('');
      setScanMessage('');
    }
  }, [githubUrl, forceRescan]);

  /* ── upload JSON directly ── */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        setGraph(data);
        setError(null);
      } catch {
        setError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  /* ── canvas interactions ── */
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-node]')) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    },
    [tx, ty],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setTx(panStart.current.tx + (e.clientX - panStart.current.x));
      setTy(panStart.current.ty + (e.clientY - panStart.current.y));
    },
    [isPanning],
  );

  const handleCanvasMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(2, Math.max(0.3, s + (e.deltaY > 0 ? -0.08 : 0.08))));
  }, []);

  const fitView = useCallback(() => {
    setScale(0.72);
    setTx(20);
    setTy(20);
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-node]')) setSelectedId(null);
  }, []);

  /* ── node lookup ── */
  const nodeById = useCallback((id: string) => coreNodes.find((n) => n.id === id), [coreNodes]);

  /* node map for quick lookup */
  const nodeMap = useMemo(() => {
    const m = new Map<string, ComponentNode>();
    for (const n of coreNodes) m.set(n.id, n);
    return m;
  }, [coreNodes]);

  /* ── simulation: prefer precomputed traces, fallback to smart BFS ── */
  const runSimulation = useCallback(async () => {
    if (!traceRouteId || !graph) return;
    setIsTracing(true);
    setTraceSteps([]);
    setTraceVisible(0);
    setActiveTraceIds(new Set());
    setTraceHeadId(null);

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(reqBody) as Record<string, unknown>;
    } catch {
      /* empty */
    }

    let steps: TraceStep[];

    /* try precomputed traces first — use match/when conditions */
    const precomputed = graph.traces?.filter((t) => t.route_id === traceRouteId) || [];
    if (precomputed.length > 0) {
      /* evaluate match/when conditions (same logic as trace-resolver.ts) */
      const evalCond = (c: StepCondition, p: Record<string, unknown>): boolean => {
        const v = p[c.field];
        switch (c.op) {
          case 'eq': return v === c.value;
          case 'neq': return v !== c.value;
          case 'in': return Array.isArray(c.value) && c.value.includes(String(v));
          case 'not_in': return Array.isArray(c.value) && !c.value.includes(String(v));
          case 'exists': return v !== undefined && v !== null;
          case 'not_exists': return v === undefined || v === null;
          case 'eq_field': return typeof c.value === 'string' && v === p[c.value];
          case 'neq_field': return typeof c.value === 'string' && v !== p[c.value];
          default: return true;
        }
      };

      /* find first trace where ALL match conditions pass (order matters) */
      let bestTrace = precomputed[precomputed.length - 1]; // fallback: last (catch-all)
      for (const trace of precomputed) {
        const conditions = trace.match;
        if (!conditions || conditions.length === 0) continue; // skip catch-alls in first pass
        if (conditions.every((c) => evalCond(c, payload))) {
          bestTrace = trace;
          break;
        }
      }
      // If no conditional trace matched, try unconditional ones
      if (bestTrace === precomputed[precomputed.length - 1] && bestTrace.match?.length) {
        for (const trace of precomputed) {
          if (!trace.match || trace.match.length === 0) { bestTrace = trace; break; }
        }
      }

      /* filter steps by "when" conditions, then convert to TraceStep format */
      steps = bestTrace.steps
        .filter((s) => !s.when || evalCond(s.when, payload))
        .map((s) => {
          const node = nodeMap.get(s.node_id);
          return {
            nodeId: s.node_id,
            name: node?.name || s.node_id,
            kind: node?.kind || 'function',
            description: s.summary,
            edgeLabel: s.edge_label,
          };
        });
    } else {
      /* fallback: smart BFS */
      steps = smartTrace(traceRouteId, coreEdges, coreNodeIds, nodeMap, payload);
    }

    setTraceSteps(steps);

    /* animate through steps */
    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, 300));
      setTraceHeadId(steps[i].nodeId);
      setActiveTraceIds((prev) => new Set([...prev, steps[i].nodeId]));
      setTraceVisible(i + 1);
    }

    setIsTracing(false);
    setTimeout(() => setTraceHeadId(null), 800);
  }, [traceRouteId, graph, coreEdges, coreNodeIds, nodeMap, reqBody]);

  const clearTrace = useCallback(() => {
    setActiveTraceIds(new Set());
    setTraceHeadId(null);
    setTraceSteps([]);
    setTraceVisible(0);
  }, []);

  /* ── landing screen ── */
  if (!graph) {
    const PHASE_LABELS: Record<string, string> = {
      discovering: 'Discovering',
      reading: 'Reading',
      analyzing: 'Analyzing',
      cross_service: 'Cross-service',
      merging: 'Writing',
    };

    return (
      <div
        style={{
          background: '#0d0d0f',
          color: '#ddd',
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 440, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Logo */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>
              TRACE<span style={{ color: '#378ADD' }}>LAB</span>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
              Paste a Git repo URL to scan and visualize
            </div>
          </div>

          {/* GitHub URL input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleScan();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <input
              type="text"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://gitea.example.com/org/repo"
              disabled={isScanning}
              style={{
                background: '#111114',
                border: '0.5px solid #2a2a2e',
                borderRadius: 8,
                padding: '12px 14px',
                color: '#ddd',
                fontFamily: 'inherit',
                fontSize: 12,
                outline: 'none',
                opacity: isScanning ? 0.5 : 1,
              }}
            />

            {/* Force rescan checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceRescan}
                onChange={(e) => setForceRescan(e.target.checked)}
                disabled={isScanning}
                style={{ accentColor: '#378ADD' }}
              />
              <span style={{ fontSize: 10, color: '#555' }}>
                Force rescan (ignore cached results)
              </span>
            </label>

            <button
              type="submit"
              disabled={isScanning || !githubUrl.trim()}
              style={{
                background: isScanning ? '#111114' : '#185FA5',
                border: isScanning ? '0.5px solid #2a2a2e' : 'none',
                borderRadius: 8,
                padding: '11px 0',
                color: isScanning ? '#666' : '#fff',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                cursor: isScanning || !githubUrl.trim() ? 'default' : 'pointer',
                opacity: !githubUrl.trim() && !isScanning ? 0.4 : 1,
                letterSpacing: 0.3,
              }}
            >
              {isScanning ? 'Scanning...' : 'Scan & Visualize'}
            </button>
          </form>

          {/* Scan progress */}
          {isScanning && scanPhase && (
            <div
              style={{
                background: '#111114',
                border: '0.5px solid #1a1a1c',
                borderRadius: 8,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#378ADD',
                    animation: 'pulse 1s ease-in-out infinite',
                  }}
                />
                <span
                  style={{ fontSize: 10, color: '#378ADD', fontWeight: 600, letterSpacing: 0.5 }}
                >
                  {PHASE_LABELS[scanPhase] || scanPhase.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#666', lineHeight: 1.5 }}>{scanMessage}</div>
            </div>
          )}

          {/* Divider */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#333', fontSize: 9 }}
          >
            <div style={{ flex: 1, height: 0.5, background: '#222' }} />
            <span>or upload existing scan</span>
            <div style={{ flex: 1, height: 0.5, background: '#222' }} />
          </div>

          {/* Upload */}
          <label
            style={{
              display: 'block',
              background: '#111114',
              border: '0.5px dashed #2a2a2e',
              borderRadius: 8,
              padding: '14px 0',
              textAlign: 'center',
              cursor: 'pointer',
              fontSize: 11,
              color: '#555',
            }}
          >
            Upload .tracelab.json
            <input type="file" accept=".json" onChange={handleUpload} style={{ display: 'none' }} />
          </label>

          {/* Error */}
          {error && (
            <div
              style={{
                background: '#1e0e0e',
                border: '0.5px solid #3a1a1a',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 11,
                color: '#e07070',
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  /* ── graph visualizer ── */
  const selectedNode = selectedId ? nodeById(selectedId) : null;

  const traceEdgeSet = new Set<string>();
  if (activeTraceIds.size > 0) {
    for (const e of coreEdges) {
      if (activeTraceIds.has(e.from) && activeTraceIds.has(e.to)) {
        traceEdgeSet.add(`${e.from}->${e.to}`);
      }
    }
  }

  return (
    <div
      style={{
        background: '#0d0d0f',
        fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
        userSelect: isResizing ? 'none' : 'auto',
      }}
    >
      {/* ── Global styles ── */}
      <style>{`
        @keyframes dash { to { stroke-dashoffset: -18; } }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.8); opacity: 0.4; }
        }
      `}</style>

      {/* ── Canvas panel ── */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onWheel={handleWheel}
        onClick={handleCanvasClick}
      >
        <div
          id="graph-wrap"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG edges */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 4000,
              height: 4000,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <defs>
              <marker
                id="arr"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M2 1L8 5L2 9"
                  fill="none"
                  stroke="#2a4a7a"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </marker>
              <marker
                id="arr-lit"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M2 1L8 5L2 9"
                  fill="none"
                  stroke="#378ADD"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </marker>
            </defs>
            {coreEdges.map((edge, i) => {
              const fromPos = positions.get(edge.from);
              const toPos = positions.get(edge.to);
              if (!fromPos || !toPos) return null;
              const x1 = fromPos.x + NODE_W / 2;
              const y1 = fromPos.y + NODE_H;
              const x2 = toPos.x + NODE_W / 2;
              const y2 = toPos.y;
              const isLit = traceEdgeSet.has(`${edge.from}->${edge.to}`);
              return (
                <path
                  key={i}
                  d={edgePath(x1, y1, x2, y2)}
                  fill="none"
                  stroke={isLit ? '#378ADD' : '#1a3a5c'}
                  strokeWidth={isLit ? 2 : 1.5}
                  strokeDasharray="5 4"
                  markerEnd={isLit ? 'url(#arr-lit)' : 'url(#arr)'}
                  style={{
                    animation: 'dash 1.2s linear infinite',
                    animationDelay: `${i * 0.15}s`,
                    transition: 'stroke 0.3s, stroke-width 0.3s',
                  }}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {coreNodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const colors = KIND_COLORS[node.kind] || KIND_COLORS.business_logic;
            const label = KIND_LABELS[node.kind] || node.kind.toUpperCase();
            const isSelected = selectedId === node.id;
            const isTraceActive = activeTraceIds.has(node.id);
            const isHead = traceHeadId === node.id;

            return (
              <div
                key={node.id}
                data-node
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(node.id);
                }}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: NODE_W,
                  minHeight: NODE_H,
                  background: colors.bg,
                  border: `0.5px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  boxShadow: isHead
                    ? `0 0 20px ${colors.border}88, 0 0 0 2px ${colors.border}`
                    : isSelected
                      ? '0 0 0 2px #378ADD'
                      : isTraceActive
                        ? `0 0 12px ${colors.border}44`
                        : 'none',
                  opacity: activeTraceIds.size > 0 && !isTraceActive ? 0.3 : 1,
                  transition: 'box-shadow 0.3s, opacity 0.3s',
                }}
              >
                <div
                  style={{
                    display: 'inline-block',
                    background: colors.badgeBg,
                    color: colors.badgeText,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    padding: '2px 6px',
                    borderRadius: 3,
                    marginBottom: 6,
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 12, color: '#ddd', fontWeight: 500, lineHeight: 1.3 }}>
                  {node.name}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#666',
                    marginTop: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.description || node.defined_in || node.service}
                </div>
                {isHead && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#378ADD',
                      boxShadow: '0 0 8px #378ADD',
                      animation: 'pulse 0.6s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Toolbar */}
        <div
          style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 4, zIndex: 10 }}
        >
          {[
            { label: 'fit view', action: fitView },
            { label: '+ zoom', action: () => setScale((s) => Math.min(2, s + 0.15)) },
            { label: '\u2013 zoom', action: () => setScale((s) => Math.max(0.3, s - 0.15)) },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              style={{
                background: '#161618',
                border: '0.5px solid #2a2a2c',
                borderRadius: 6,
                padding: '6px 14px',
                color: '#888',
                fontFamily: 'inherit',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            background: '#111113',
            border: '0.5px solid #222',
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 16px',
            zIndex: 10,
          }}
        >
          {LEGEND_ITEMS.map((item) => {
            const c = KIND_COLORS[item.kind];
            return (
              <div
                key={item.kind}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: '#777',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    border: `1.5px solid ${c.border}`,
                    background: c.bg,
                  }}
                />
                {item.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Resize handle ── */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: isResizing ? '#378ADD' : 'transparent',
          transition: 'background 0.15s',
          zIndex: 20,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.background = '#333';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) (e.target as HTMLElement).style.background = 'transparent';
        }}
      />

      {/* ── Right sidebar ── */}
      <div
        style={{
          width: sidebarWidth,
          minWidth: 200,
          maxWidth: 600,
          borderLeft: '0.5px solid #1a1a1c',
          background: '#111114',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* ── Simulate ── */}
        <div style={{ padding: '14px 14px 12px', borderBottom: '0.5px solid #1a1a1c' }}>
          <div style={{ fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 10 }}>
            SIMULATE
          </div>

          {/* Method + Route */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <div
              style={{
                background: '#0d0d0f',
                border: '0.5px solid #222',
                borderRadius: 4,
                padding: '5px 8px',
                color:
                  traceMethod === 'GET'
                    ? '#3B6D11'
                    : traceMethod === 'POST'
                      ? '#854F0B'
                      : traceMethod === 'DELETE'
                        ? '#993C1D'
                        : '#534AB7',
                fontFamily: 'inherit',
                fontSize: 10,
                fontWeight: 700,
                width: 42,
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              {traceMethod}
            </div>
            <select
              value={traceRouteId || ''}
              onChange={(e) => {
                setTraceRouteId(e.target.value || null);
                clearTrace();
                setSelectedId(e.target.value || null);
              }}
              style={{
                flex: 1,
                background: '#0d0d0f',
                border: '0.5px solid #222',
                borderRadius: 4,
                padding: '5px 8px',
                color: '#aaa',
                fontFamily: 'inherit',
                fontSize: 10,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="">select route...</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.path_pattern || r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tabs: Params / Body */}
          <div
            style={{ display: 'flex', gap: 0, marginBottom: 8, borderBottom: '0.5px solid #222' }}
          >
            {(['params', 'body'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveReqTab(tab)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  borderBottom:
                    activeReqTab === tab ? '2px solid #378ADD' : '2px solid transparent',
                  padding: '6px 0',
                  color: activeReqTab === tab ? '#bbb' : '#555',
                  fontFamily: 'inherit',
                  fontSize: 9,
                  fontWeight: activeReqTab === tab ? 600 : 400,
                  letterSpacing: 0.5,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {tab}
                {tab === 'params' && routePathParams.length > 0 && (
                  <span style={{ color: '#854F0B', marginLeft: 3 }}>{routePathParams.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Params */}
          {activeReqTab === 'params' && (
            <div style={{ marginBottom: 8 }}>
              {routePathParams.length === 0 ? (
                <div style={{ fontSize: 10, color: '#444', padding: '8px 0', textAlign: 'center' }}>
                  {traceRouteId ? 'No path parameters' : 'Select a route first'}
                </div>
              ) : (
                routePathParams.map((param) => (
                  <div key={param} style={{ marginBottom: 6 }}>
                    <div
                      style={{ fontSize: 9, color: '#854F0B', marginBottom: 2, fontWeight: 600 }}
                    >
                      :{param}
                    </div>
                    <input
                      type="text"
                      value={pathParams[param] || ''}
                      onChange={(e) =>
                        setPathParams((prev) => ({ ...prev, [param]: e.target.value }))
                      }
                      placeholder={`value for :${param}`}
                      style={{
                        width: '100%',
                        background: '#0a0a0c',
                        border: '0.5px solid #222',
                        borderRadius: 4,
                        padding: '5px 8px',
                        color: '#ccc',
                        fontFamily: 'inherit',
                        fontSize: 11,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* Body */}
          {activeReqTab === 'body' && (
            <div style={{ marginBottom: 8 }}>
              <textarea
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder='{"action": "Generate", ...}'
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 100,
                  background: '#0a0a0c',
                  border: '0.5px solid #222',
                  borderRadius: 4,
                  padding: '8px',
                  color: '#ccc',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  lineHeight: 1.5,
                }}
              />
            </div>
          )}

          {/* Simulate button */}
          <button
            onClick={runSimulation}
            disabled={!traceRouteId || isTracing}
            style={{
              width: '100%',
              background: isTracing ? '#1a1a1e' : '#185FA5',
              border: 'none',
              borderRadius: 5,
              padding: '8px 0',
              color: isTracing ? '#555' : '#fff',
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 600,
              cursor: !traceRouteId || isTracing ? 'default' : 'pointer',
              opacity: !traceRouteId ? 0.4 : 1,
              letterSpacing: 0.5,
            }}
          >
            {isTracing ? 'Simulating...' : 'Simulate'}
          </button>

          {/* Trace status */}
          {traceSteps.length > 0 && !isTracing && (
            <div
              style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 10, alignItems: 'center' }}
            >
              <span
                style={{
                  background: '#0e2e0e',
                  color: '#7ac97a',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 10,
                }}
              >
                DONE
              </span>
              <span style={{ color: '#555' }}>{traceSteps.length} steps</span>
              <button
                onClick={clearTrace}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: 'none',
                  color: '#555',
                  fontFamily: 'inherit',
                  fontSize: 9,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                clear
              </button>
            </div>
          )}
        </div>

        {/* ── Inspector / Trace flow ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {traceSteps.length > 0 ? (
            /* ── Trace flow view ── */
            <>
              <div style={{ fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 10 }}>
                TRACE FLOW
                <span style={{ color: '#444', marginLeft: 6, letterSpacing: 0 }}>
                  {traceVisible} / {traceSteps.length} steps
                </span>
              </div>
              {traceSteps.slice(0, traceVisible).map((step, i) => {
                const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                return (
                  <div key={i} style={{ marginBottom: 2 }}>
                    {/* connector arrow showing edge label */}
                    {i > 0 && step.edgeLabel && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 0 4px 16px',
                        }}
                      >
                        <div
                          style={{
                            width: 0,
                            height: 0,
                            borderLeft: '4px solid #378ADD',
                            borderTop: '3px solid transparent',
                            borderBottom: '3px solid transparent',
                          }}
                        />
                        <span style={{ fontSize: 9, color: '#555', fontStyle: 'italic' }}>
                          {step.edgeLabel}
                        </span>
                      </div>
                    )}
                    {i > 0 && !step.edgeLabel && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 0 4px 16px',
                        }}
                      >
                        <div
                          style={{
                            width: 0,
                            height: 0,
                            borderLeft: '4px solid #378ADD',
                            borderTop: '3px solid transparent',
                            borderBottom: '3px solid transparent',
                          }}
                        />
                      </div>
                    )}
                    {/* step card */}
                    <div
                      style={{
                        background: '#0a0a0c',
                        border: `0.5px solid ${colors.border}33`,
                        borderRadius: 6,
                        padding: '8px 10px',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}
                      >
                        <div
                          style={{
                            fontSize: 8,
                            background: colors.badgeBg,
                            color: colors.badgeText,
                            padding: '1px 4px',
                            borderRadius: 2,
                            fontWeight: 700,
                          }}
                        >
                          {KIND_LABELS[step.kind] || step.kind.toUpperCase()}
                        </div>
                        <span style={{ fontSize: 10, color: '#bbb', fontWeight: 500 }}>
                          {step.name}
                        </span>
                      </div>
                      {step.description && (
                        <div style={{ fontSize: 9, color: '#666', lineHeight: 1.4 }}>
                          {step.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            /* ── Inspector view ── */
            <>
              <div style={{ fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 8 }}>
                INSPECTOR
              </div>
              {!selectedNode ? (
                <div
                  style={{
                    color: '#333',
                    fontSize: 11,
                    textAlign: 'center',
                    marginTop: 60,
                    lineHeight: 1.6,
                  }}
                >
                  Click any node to inspect
                  <br />
                  its payload, mutations,
                  <br />
                  and connections
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, color: '#ddd', fontWeight: 600 }}>
                    {selectedNode.name}
                  </div>

                  <Field label="KIND">
                    <span
                      style={{
                        display: 'inline-block',
                        background: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic)
                          .badgeBg,
                        color: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic)
                          .badgeText,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        padding: '2px 6px',
                        borderRadius: 3,
                      }}
                    >
                      {KIND_LABELS[selectedNode.kind] || selectedNode.kind.toUpperCase()}
                    </span>
                  </Field>

                  <Field label="DEFINED IN">{selectedNode.defined_in || '\u2014'}</Field>
                  <Field label="INPUT">{selectedNode.input || '\u2014'}</Field>
                  <Field label="OUTPUT">{selectedNode.output || '\u2014'}</Field>

                  <Field label="MUTATES STATE">
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: selectedNode.mutates_state ? '#2d1a0a' : '#0d1f0d',
                        border: selectedNode.mutates_state
                          ? '0.5px solid #633806'
                          : '0.5px solid #27500A',
                        color: selectedNode.mutates_state ? '#EF9F27' : '#639922',
                      }}
                    >
                      {selectedNode.mutates_state ? 'YES' : 'NO'}
                    </span>
                  </Field>

                  {selectedNode.description && (
                    <Field label="DESCRIPTION">{selectedNode.description}</Field>
                  )}

                  {(() => {
                    const inEdges = coreEdges.filter((e) => e.to === selectedNode.id);
                    if (inEdges.length === 0) return null;
                    return (
                      <Field label={`RECEIVES FROM (${inEdges.length})`}>
                        {inEdges.map((e, i) => (
                          <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>
                            <div style={{ fontSize: 10, color: '#378ADD' }}>
                              {nodeById(e.from)?.name || e.from}
                            </div>
                            {e.payload && (
                              <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>
                                {e.payload}
                              </div>
                            )}
                          </div>
                        ))}
                      </Field>
                    );
                  })()}

                  {(() => {
                    const outEdges = coreEdges.filter((e) => e.from === selectedNode.id);
                    if (outEdges.length === 0) return null;
                    return (
                      <Field label={`SENDS TO (${outEdges.length})`}>
                        {outEdges.map((e, i) => (
                          <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>
                            <div style={{ fontSize: 10, color: '#1D9E75' }}>
                              {nodeById(e.to)?.name || e.to}
                            </div>
                            {e.payload && (
                              <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>
                                {e.payload}
                              </div>
                            )}
                          </div>
                        ))}
                      </Field>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Back button */}
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid #1a1a1c' }}>
          <button
            onClick={() => {
              setGraph(null);
              setSelectedId(null);
              setError(null);
              clearTrace();
            }}
            style={{
              width: '100%',
              background: 'transparent',
              border: '0.5px solid #222',
              borderRadius: 5,
              padding: '6px 0',
              color: '#555',
              fontFamily: 'inherit',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            &larr; load different file
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Inspector field ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#555', marginBottom: 3, letterSpacing: 0.5 }}>{label}</div>
      <div
        style={{
          background: '#0a0a0c',
          border: '0.5px solid #1a1a1c',
          borderRadius: 5,
          padding: '6px 8px',
          fontSize: 11,
          color: '#bbb',
          wordBreak: 'break-word',
        }}
      >
        {children}
      </div>
    </div>
  );
}
