'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  ComponentsGraph,
  ComponentNode,
  PayloadEdge,
  ScanProgress,
  TraceStep,
  TraceStepDef,
} from '@/types';
import { resolveTrace } from '@/lib/trace-resolver';
import { resolveNodeOutput, adaptInput } from '@/lib/simulation';
import { convertNew2Graph } from '@/lib/convert-graph';
import {
  CORE_KINDS,
  NODE_W,
  NODE_H,
  H_GAP,
  V_GAP,
  DEFAULT_SCALE,
  DEFAULT_TX,
  DEFAULT_TY,
  MIN_SCALE,
  MAX_SCALE,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  TRACE_STEP_DELAY,
  TRACE_HEAD_CLEAR_DELAY,
  STORAGE_KEYS,
} from '@/constants';
import LandingPage from '@/components/LandingPage';
import Sidebar from '@/components/Sidebar';
import GraphCanvas from '@/components/GraphCanvas';

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

  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => !incoming.get(n.id)?.length);
  const queue: string[] = [];

  for (const r of roots) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  for (const n of nodes) {
    if (!depth.has(n.id)) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  }

  let head = 0;
  const MAX_DEPTH = nodes.length + 1;
  while (head < queue.length) {
    const id = queue[head++];
    const d = depth.get(id)!;
    if (d >= MAX_DEPTH) continue;
    for (const child of outgoing.get(id) || []) {
      if (child === id) continue;
      const prev = depth.get(child);
      if (prev === undefined || prev < d + 1) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  const maxDepth = Math.max(...Array.from(depth.values()), 0);
  const layers: ComponentNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    layers[d].push(n);
  }

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

export default function Home() {
  const [graph, setGraph] = useState<ComponentsGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [scanPhase, setScanPhase] = useState<string>('');
  const [forceRescan, setForceRescan] = useState(false);

  /* restore session from localStorage on mount */
  useEffect(() => {
    try {
      const savedGraph = localStorage.getItem(STORAGE_KEYS.GRAPH);
      const savedUrl = localStorage.getItem(STORAGE_KEYS.GITHUB_URL);
      if (savedGraph) {
        const rawData = JSON.parse(savedGraph);
        const convertedData = convertNew2Graph(rawData);
        setGraph(convertedData);
      }
      if (savedUrl) setGithubUrl(savedUrl);
    } catch (err) {
      console.error('Failed to restore session:', err);
    }
  }, []);

  /* canvas state */
  const [tx, setTx] = useState(DEFAULT_TX);
  const [ty, setTy] = useState(DEFAULT_TY);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  /* selection */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* sidebar resize */
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const resizeStart = useRef({ x: 0, w: DEFAULT_SIDEBAR_WIDTH });

  /* simulation tracing */
  const [traceMethod, setTraceMethod] = useState('GET');
  const [traceRouteId, setTraceRouteId] = useState<string | null>(null);
  const [activeTraceIds, setActiveTraceIds] = useState<Set<string>>(new Set());
  const [traceHeadId, setTraceHeadId] = useState<string | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [traceVisible, setTraceVisible] = useState(0);
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [isPausedAtBreakpoint, setIsPausedAtBreakpoint] = useState(false);
  const [currentBreakpointId, setCurrentBreakpointId] = useState<string | null>(null);

  /* start from node feature */
  const [startFromNodeId, setStartFromNodeId] = useState<string | null>(null);
  const [startFromNodeInput, setStartFromNodeInput] = useState('{\n  \n}');

  // Refs for always-current values inside async callbacks (avoids stale closures)
  const traceStepsRef = useRef<TraceStep[]>([]);
  const traceVisibleRef = useRef(0);
  const breakpointsRef = useRef<Set<string>>(new Set());
  // Full trace path definition from resolveTrace — NOT truncated by termination
  const resolvedStepDefsRef = useRef<TraceStepDef[]>([]);

  // Keep refs in sync with state
  useEffect(() => {
    traceStepsRef.current = traceSteps;
  }, [traceSteps]);
  useEffect(() => {
    traceVisibleRef.current = traceVisible;
  }, [traceVisible]);
  useEffect(() => {
    breakpointsRef.current = breakpoints;
  }, [breakpoints]);

  /* request builder */
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [reqBody, setReqBody] = useState('{\n  \n}');

  /* graph transition */
  const [isGraphLoaded, setIsGraphLoaded] = useState(false);
  const [isGraphUnloading, setIsGraphUnloading] = useState(false);

  /* trigger transition when graph changes */
  useEffect(() => {
    if (graph) {
      setIsGraphLoaded(false);
      setIsGraphUnloading(false);
      const timer = setTimeout(() => setIsGraphLoaded(true), 50);
      return () => clearTimeout(timer);
    }
  }, [graph]);

  /* adjust canvas position when sidebar is toggled */
  const prevCollapsedRef = useRef(isSidebarCollapsed);
  useEffect(() => {
    if (graph && prevCollapsedRef.current !== isSidebarCollapsed) {
      // When sidebar closes, shift canvas right to recenter
      // When sidebar opens, shift canvas left to recenter
      const offset = isSidebarCollapsed ? sidebarWidth / 2 : -sidebarWidth / 2;
      // Use requestAnimationFrame for smoother transition
      requestAnimationFrame(() => {
        setTx((prev) => prev + offset);
      });
      prevCollapsedRef.current = isSidebarCollapsed;
    }
  }, [isSidebarCollapsed, graph, sidebarWidth]);

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

  /* entry points for sidebar — any node that is the entry of at least one trace */
  const routes = useMemo(() => {
    const traceEntryIds = new Set(graph?.traces?.map((t) => t.route_id) ?? []);
    if (traceEntryIds.size > 0) {
      return coreNodes.filter((n) => traceEntryIds.has(n.id));
    }
    // Fallback: if no traces, show route_handlers
    return coreNodes.filter((n) => n.kind === 'route_handler');
  }, [coreNodes, graph]);

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

    if (node.kind === 'route_handler') {
      // HTTP entry point — extract method from node or id
      if (node.method) {
        setTraceMethod(node.method.toUpperCase());
      } else {
        const idUpper = node.id.toUpperCase();
        if (idUpper.startsWith('GET ')) setTraceMethod('GET');
        else if (idUpper.startsWith('POST ')) setTraceMethod('POST');
        else if (idUpper.startsWith('PUT ')) setTraceMethod('PUT');
        else if (idUpper.startsWith('DELETE ')) setTraceMethod('DELETE');
        else if (idUpper.startsWith('PATCH ')) setTraceMethod('PATCH');
        else setTraceMethod('GET');
      }
    } else {
      // Non-HTTP entry point — use kind as the "method" badge
      setTraceMethod(
        node.kind === 'function'
          ? 'FN'
          : node.kind === 'business_logic'
            ? 'BIZ'
            : node.kind === 'background_process'
              ? 'BG'
              : node.kind === 'message_queue'
                ? 'MQ'
                : 'RUN',
      );
    }

    // Populate input body: prefer example_payload (HTTP), fall back to example_input (any entry)
    if (node.example_payload) {
      try {
        setReqBody(JSON.stringify(JSON.parse(node.example_payload), null, 2));
      } catch {
        setReqBody(node.example_payload);
      }
    } else if (node.example_input) {
      setReqBody(JSON.stringify(node.example_input, null, 2));
    } else {
      // Check if first trace for this entry has an example_payload
      const firstTrace = graph?.traces?.find((t) => t.route_id === node.id);
      if (firstTrace?.example_payload) {
        setReqBody(JSON.stringify(firstTrace.example_payload, null, 2));
      } else {
        setReqBody('{\n  \n}');
      }
    }

    const init: Record<string, string> = {};
    for (const p of routePathParams) init[p] = '';
    setPathParams(init);
  }, [traceRouteId, coreNodes, routePathParams]);

  /* positions */
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (!graph) {
      initialFitDone.current = false;
      return;
    }
    setPositions(layoutNodes(coreNodes, coreEdges));
  }, [graph, coreNodes, coreEdges]);

  /* sidebar resize handlers */
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
      const delta = e.clientX - resizeStart.current.x;
      setSidebarWidth(
        Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, resizeStart.current.w + delta)),
      );
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  /* parse git clone command or URL */
  const parseGitInput = useCallback(
    (input: string): { url: string; branch?: string } => {
      const trimmed = input.trim();

      // Check if it's a git clone command
      if (trimmed.startsWith('git clone')) {
        const branchMatch = trimmed.match(/-b\s+([^\s]+)/);
        const extractedBranch = branchMatch ? branchMatch[1] : undefined;
        const urlMatch = trimmed.match(/(?:https?:\/\/|git@)[^\s]+/);
        const extractedUrl = urlMatch ? urlMatch[0] : trimmed;
        return { url: extractedUrl, branch: extractedBranch };
      }

      // Check if it's a web URL with /src/branch/ pattern (Gitea/GitLab style)
      const webBranchMatch = trimmed.match(
        /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/src\/branch\/(.+?)\/?$/,
      );
      if (webBranchMatch) {
        const baseUrl = webBranchMatch[1];
        const branchName = webBranchMatch[2];
        return {
          url: baseUrl.endsWith('.git') ? baseUrl : `${baseUrl}.git`,
          branch: branchName,
        };
      }

      // Check for GitHub-style branch URLs
      const githubBranchMatch = trimmed.match(
        /^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/tree\/(.+?)\/?$/,
      );
      if (githubBranchMatch) {
        const baseUrl = githubBranchMatch[1];
        const branchName = githubBranchMatch[2];
        return {
          url: baseUrl.endsWith('.git') ? baseUrl : `${baseUrl}.git`,
          branch: branchName,
        };
      }

      // Otherwise treat as plain repo URL
      return { url: trimmed, branch: branch.trim() || undefined };
    },
    [branch],
  );

  /* detect local filesystem path input */
  const isSystemPathInput = useCallback((input: string): boolean => {
    const trimmed = input.trim();
    if (!trimmed) return false;

    // Common path forms: /abs, ./rel, ../rel, ~/home, file:///...
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../') ||
      trimmed.startsWith('~/') ||
      trimmed.startsWith('file://')
    ) {
      return true;
    }

    // Windows-style absolute path, e.g. C:\repo
    return /^[a-zA-Z]:[\\/]/.test(trimmed);
  }, []);

  const normalizeSystemPath = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (trimmed.startsWith('file://')) {
      try {
        return decodeURIComponent(new URL(trimmed).pathname);
      } catch {
        return trimmed.replace(/^file:\/\//, '');
      }
    }
    return trimmed;
  }, []);

  /* scan from GitHub URL */
  const handleScan = useCallback(async () => {
    const input = githubUrl.trim();
    if (!input) return;

    const usingSystemPath = isSystemPathInput(input);
    const scanInput = usingSystemPath ? normalizeSystemPath(input) : parseGitInput(input).url;
    const parsedBranch = usingSystemPath ? undefined : parseGitInput(input).branch;

    if (usingSystemPath) {
      setBranch('');
    } else if (parsedBranch) {
      setBranch(parsedBranch);
    }

    setIsScanning(true);
    setError(null);
    setScanMessage('Starting...');
    setScanPhase('discovering');

    try {
      const res = await fetch(usingSystemPath ? '/api/scan' : '/api/clone-and-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: usingSystemPath
          ? JSON.stringify({ workspacePath: scanInput, forceRescan })
          : JSON.stringify({ url: scanInput, branch: parsedBranch, forceRescan }),
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

      if (outputPath) {
        const loadRes = await fetch('/api/load-graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: outputPath }),
        });
        if (loadRes.ok) {
          const rawData: ComponentsGraph = await loadRes.json();
          const convertedData = convertNew2Graph(rawData);
          setGraph(convertedData);
          localStorage.setItem(STORAGE_KEYS.GRAPH, JSON.stringify(convertedData));
          localStorage.setItem(STORAGE_KEYS.GITHUB_URL, scanInput);
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
  }, [githubUrl, forceRescan, parseGitInput, isSystemPathInput, normalizeSystemPath]);

  /* upload JSON directly */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rawData = JSON.parse(reader.result as string);
        // Convert new2.json format if needed
        const convertedData = convertNew2Graph(rawData);
        setGraph(convertedData);
        localStorage.setItem(STORAGE_KEYS.GRAPH, JSON.stringify(convertedData));
        setError(null);
      } catch {
        setError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  /* canvas interactions */
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
      // Use direct state update for smoother panning
      const newTx = panStart.current.tx + (e.clientX - panStart.current.x);
      const newTy = panStart.current.ty + (e.clientY - panStart.current.y);
      setTx(newTx);
      setTy(newTy);
    },
    [isPanning],
  );

  const handleCanvasMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((_e: React.WheelEvent) => {
    // Disabled zoom on scroll
  }, []);

  const fitView = useCallback(() => {
    if (positions.size === 0) {
      // No nodes, reset to defaults
      setScale(DEFAULT_SCALE);
      setTx(DEFAULT_TX);
      setTy(DEFAULT_TY);
      return;
    }

    // Calculate bounding box of all nodes
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    positions.forEach(({ x, y }) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    });

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;

    // Get viewport dimensions (accounting for sidebar)
    const viewportWidth =
      typeof window !== 'undefined'
        ? window.innerWidth - (isSidebarCollapsed ? 0 : sidebarWidth)
        : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    // Add padding around the graph
    const padding = 60;
    const availableWidth = viewportWidth - padding * 2;
    const availableHeight = viewportHeight - padding * 2;

    // Calculate scale to fit the graph
    const scaleX = availableWidth / graphWidth;
    const scaleY = availableHeight / graphHeight;
    const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);

    // Calculate translation to center the graph
    const scaledGraphWidth = graphWidth * newScale;
    const scaledGraphHeight = graphHeight * newScale;
    const newTx = (viewportWidth - scaledGraphWidth) / 2 - minX * newScale;
    const newTy = (viewportHeight - scaledGraphHeight) / 2 - minY * newScale;

    setScale(newScale);
    setTx(newTx);
    setTy(newTy);
  }, [positions, isSidebarCollapsed, sidebarWidth]);

  // Auto-fit view when graph is first loaded
  useEffect(() => {
    if (positions.size > 0 && !initialFitDone.current) {
      initialFitDone.current = true;
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        fitView();
      });
    }
  }, [positions, fitView]);

  const exportGraph = useCallback(() => {
    if (!graph) return;
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(graph, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', 'servicelab.tracelab.json');
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }, [graph]);

  const resetLayout = useCallback(() => {
    if (!graph) return;
    setPositions(layoutNodes(coreNodes, coreEdges));
    requestAnimationFrame(() => fitView());
  }, [graph, coreNodes, coreEdges, fitView]);

  const handleNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { x, y });
      return next;
    });
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-node]')) setSelectedId(null);
  }, []);

  /* node lookup */
  const nodeById = useCallback((id: string) => coreNodes.find((n) => n.id === id), [coreNodes]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, ComponentNode>();
    for (const n of coreNodes) m.set(n.id, n);
    return m;
  }, [coreNodes]);

  /* simulation */
  const runSimulation = useCallback(async () => {
    if (!traceRouteId || !graph) return;
    setIsTracing(true);
    setTraceSteps([]);
    setTraceVisible(0);
    setActiveTraceIds(new Set());
    setTraceHeadId(null);
    setIsPausedAtBreakpoint(false);
    setCurrentBreakpointId(null);

    let payload: unknown = {};
    try {
      payload = JSON.parse(reqBody);
    } catch {
      /* empty */
    }

    // Merge path params into payload so output_cases can match on them
    const filledParams = Object.entries(pathParams).filter(([, v]) => v !== '');
    if (filledParams.length > 0 && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      payload = { ...Object.fromEntries(filledParams), ...(payload as Record<string, unknown>) };
    }

    const resolved = resolveTrace(graph, traceRouteId, payload);

    if (!resolved) {
      setIsTracing(false);
      return;
    }

    const { steps: resolvedStepDefs } = resolved;
    resolvedStepDefsRef.current = resolvedStepDefs;

    let currentPayload: unknown = payload;
    const steps: TraceStep[] = [];
    for (const s of resolvedStepDefs) {
      const node = nodeMap.get(s.node_id);
      // Adapt previous output to fit this node's expected input shape
      const inputPayload = node
        ? adaptInput(currentPayload, node, s.input_mapping)
        : currentPayload;
      const resolved = node
        ? resolveNodeOutput(node, inputPayload)
        : { output: inputPayload, terminates: false, explanation: undefined };
      currentPayload = resolved.output;
      steps.push({
        nodeId: s.node_id,
        name: node?.name || s.node_id,
        kind: node?.kind || 'function',
        description: s.summary,
        edgeLabel: s.edge_label,
        inputType: node?.input ?? null,
        outputType: node?.output ?? null,
        inputPayload,
        outputPayload: resolved.output,
        terminated: resolved.terminates,
        terminatedReason: resolved.terminates
          ? (resolved.explanation ?? 'Execution terminated at this step')
          : undefined,
      });
      if (resolved.terminates) break; // stop — this node rejected/errored
    }

    setTraceSteps(steps);
    traceStepsRef.current = steps;

    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
      setTraceHeadId(steps[i].nodeId);
      setActiveTraceIds((prev) => new Set([...prev, steps[i].nodeId]));
      setTraceVisible(i + 1);
      traceVisibleRef.current = i + 1;

      // Check if current node is a breakpoint
      if (breakpoints.has(steps[i].nodeId)) {
        setIsPausedAtBreakpoint(true);
        setCurrentBreakpointId(steps[i].nodeId);
        setSelectedId(steps[i].nodeId);
        setIsTracing(false);
        return; // Pause execution
      }
    }

    setIsTracing(false);
    setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
  }, [traceRouteId, graph, nodeMap, reqBody, pathParams, breakpoints]);

  /* Start simulation from a specific node with custom input */
  const startFromNode = useCallback(async () => {
    if (!startFromNodeId || !graph) return;
    
    setIsTracing(true);
    setTraceSteps([]);
    setTraceVisible(0);
    setActiveTraceIds(new Set());
    setTraceHeadId(null);
    setIsPausedAtBreakpoint(false);
    setCurrentBreakpointId(null);

    let payload: unknown = {};
    try {
      payload = JSON.parse(startFromNodeInput);
    } catch {
      /* empty */
    }

    // Build a trace starting from this node
    const startNode = nodeMap.get(startFromNodeId);
    if (!startNode) return;

    // Find all reachable nodes from this starting point using BFS
    const reachable = new Set<string>();
    const queue = [startFromNodeId];
    reachable.add(startFromNodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        if (edge.from === current && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }

    // Create trace steps for reachable nodes
    const steps: TraceStep[] = [];
    let currentPayload: unknown = payload;

    // Start with the selected node
    const resolved = resolveNodeOutput(startNode, payload);
    currentPayload = resolved.output;
    steps.push({
      nodeId: startFromNodeId,
      name: startNode.name,
      kind: startNode.kind,
      description: startNode.description || 'Starting node',
      edgeLabel: '',
      inputType: startNode.input ?? null,
      outputType: startNode.output ?? null,
      inputPayload: payload,
      outputPayload: resolved.output,
      terminated: resolved.terminates,
      terminatedReason: resolved.terminates
        ? (resolved.explanation ?? 'Execution terminated at this step')
        : undefined,
    });

    if (resolved.terminates) {
      setTraceSteps(steps);
      traceStepsRef.current = steps;
      setTraceHeadId(startFromNodeId);
      setActiveTraceIds(new Set([startFromNodeId]));
      setTraceVisible(1);
      setIsTracing(false);
      return;
    }

    // Continue to reachable nodes
    for (const nodeId of reachable) {
      if (nodeId === startFromNodeId) continue;
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const inputPayload = adaptInput(currentPayload, node, undefined);
      const nodeResolved = resolveNodeOutput(node, inputPayload);
      currentPayload = nodeResolved.output;

      steps.push({
        nodeId,
        name: node.name,
        kind: node.kind,
        description: node.description || '',
        edgeLabel: '',
        inputType: node.input ?? null,
        outputType: node.output ?? null,
        inputPayload,
        outputPayload: nodeResolved.output,
        terminated: nodeResolved.terminates,
        terminatedReason: nodeResolved.terminates
          ? (nodeResolved.explanation ?? 'Execution terminated at this step')
          : undefined,
      });

      if (nodeResolved.terminates) break;
    }

    setTraceSteps(steps);
    traceStepsRef.current = steps;

    // Animate through steps
    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
      setTraceHeadId(steps[i].nodeId);
      setActiveTraceIds((prev) => new Set([...prev, steps[i].nodeId]));
      setTraceVisible(i + 1);
      traceVisibleRef.current = i + 1;

      // Check if current node is a breakpoint
      if (breakpoints.has(steps[i].nodeId)) {
        setIsPausedAtBreakpoint(true);
        setCurrentBreakpointId(steps[i].nodeId);
        setSelectedId(steps[i].nodeId);
        setIsTracing(false);
        return;
      }
    }

    setIsTracing(false);
    setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
  }, [startFromNodeId, startFromNodeInput, graph, nodeMap, breakpoints]);

  const resumeSimulation = useCallback(async () => {
    // Read latest state from refs
    const steps = traceStepsRef.current;
    const startAt = traceVisibleRef.current;

    // If all shown steps have been revealed, check if we can extend the chain.
    // This happens when the last computed step terminated (truncated the array)
    // but we still have more step definitions in the full trace.
    if (startAt >= steps.length && resolvedStepDefsRef.current.length > steps.length) {
      // Rebuild full template from resolvedStepDefs, recompute from the last step's output
      const lastStep = steps[steps.length - 1];
      if (lastStep && !lastStep.terminated) {
        // Last step is no longer terminated (was edited), extend the chain
        const fullTemplate = buildFullTemplate(resolvedStepDefsRef.current, nodeMap);
        const extended = recomputeFromStep(
          fullTemplate,
          steps.length,
          lastStep.outputPayload,
          nodeMap,
        );
        const allSteps = [
          ...steps
            .slice(0, steps.length)
            .map((s) => ({ ...s, terminated: false, terminatedReason: undefined })),
          ...extended,
        ];
        setTraceSteps(allSteps);
        traceStepsRef.current = allSteps;
        // Animate from where we left off
        setIsTracing(true);
        setIsPausedAtBreakpoint(false);
        setCurrentBreakpointId(null);
        for (let i = startAt; i < allSteps.length; i++) {
          await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
          setTraceHeadId(allSteps[i].nodeId);
          setActiveTraceIds((prev) => new Set([...prev, allSteps[i].nodeId]));
          setTraceVisible(i + 1);
          traceVisibleRef.current = i + 1;
          if (breakpointsRef.current.has(allSteps[i].nodeId)) {
            setIsPausedAtBreakpoint(true);
            setCurrentBreakpointId(allSteps[i].nodeId);
            setSelectedId(allSteps[i].nodeId);
            setIsTracing(false);
            return;
          }
        }
        setIsTracing(false);
        setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
        return;
      }
    }

    if (!steps.length || startAt >= steps.length) return;

    setIsTracing(true);
    setIsPausedAtBreakpoint(false);
    setCurrentBreakpointId(null);

    for (let i = startAt; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
      setTraceHeadId(steps[i].nodeId);
      setActiveTraceIds((prev) => new Set([...prev, steps[i].nodeId]));
      setTraceVisible(i + 1);
      traceVisibleRef.current = i + 1;

      if (breakpointsRef.current.has(steps[i].nodeId)) {
        setIsPausedAtBreakpoint(true);
        setCurrentBreakpointId(steps[i].nodeId);
        setSelectedId(steps[i].nodeId);
        setIsTracing(false);
        return;
      }
    }

    setIsTracing(false);
    setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
  }, [nodeMap]);

  const skipBreakpoint = useCallback(() => {
    setIsPausedAtBreakpoint(false);
    setCurrentBreakpointId(null);
    resumeSimulation();
  }, [resumeSimulation]);

  const toggleBreakpoint = useCallback((nodeId: string) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const clearTrace = useCallback(() => {
    setActiveTraceIds(new Set());
    setTraceHeadId(null);
    setTraceSteps([]);
    setTraceVisible(0);
    setIsPausedAtBreakpoint(false);
    setCurrentBreakpointId(null);
    resolvedStepDefsRef.current = [];
  }, []);

  /** Build a full template of TraceStep objects from resolvedStepDefs (no I/O computed) */
  function buildFullTemplate(
    stepDefs: TraceStepDef[],
    nodeMap: Map<string, ComponentNode>,
  ): TraceStep[] {
    return stepDefs.map((s) => {
      const node = nodeMap.get(s.node_id);
      return {
        nodeId: s.node_id,
        name: node?.name || s.node_id,
        kind: node?.kind || 'function',
        description: s.summary,
        edgeLabel: s.edge_label,
        inputType: node?.input ?? null,
        outputType: node?.output ?? null,
      };
    });
  }

  /** Recompute outputs from a given index in a steps template */
  function recomputeFromStep(
    templateSteps: TraceStep[],
    fromIdx: number,
    input: unknown,
    nodeMap: Map<string, ComponentNode>,
  ): TraceStep[] {
    const result: TraceStep[] = [];
    let current = input;
    for (let i = fromIdx; i < templateSteps.length; i++) {
      const node = nodeMap.get(templateSteps[i].nodeId);
      // Adapt previous output to fit this node's expected input
      const adapted = node ? adaptInput(current, node) : current;
      const res = node ? resolveNodeOutput(node, adapted) : { output: adapted, terminates: false };
      result.push({
        ...templateSteps[i],
        inputPayload: adapted,
        outputPayload: res.output,
        terminated: res.terminates,
        terminatedReason: res.terminates
          ? (res.explanation ?? 'Execution terminated at this step')
          : undefined,
      });
      if (res.terminates) break;
      current = res.output;
    }
    return result;
  }

  /**
   * Re-run payload propagation from a given step with a new input.
   * Uses the full resolvedStepDefs (never truncated) so the chain can
   * extend past previously-terminated steps when input is corrected.
   */
  const rerunFromStep = useCallback(
    (stepIndex: number, nodeId: string, newInput: unknown) => {
      if (!graph || !traceRouteId) return;

      // Helper: recompute outputs from a start index, stopping if a step terminates
      const recompute = (steps: TraceStep[], fromIdx: number, input: unknown): TraceStep[] => {
        const result = steps.slice(0, fromIdx);
        let current = input;
        for (let i = fromIdx; i < steps.length; i++) {
          const node = nodeMap.get(steps[i].nodeId);
          const stepDef = resolvedStepDefsRef.current?.[i];
          // Adapt previous output to fit this node's expected input shape
          const inputPayload =
            node && stepDef ? adaptInput(current, node, stepDef.input_mapping) : current;
          const res = node
            ? resolveNodeOutput(node, inputPayload)
            : { output: inputPayload, terminates: false, explanation: undefined };
          result.push({
            ...steps[i],
            inputPayload,
            outputPayload: res.output,
            terminated: res.terminates,
            terminatedReason: res.terminates
              ? (res.explanation ?? 'Execution terminated at this step')
              : undefined,
          });
          if (res.terminates) break;
          current = res.output;
        }
        return result;
      };

      // ── Step 0: the user edited the request body itself ──
      if (stepIndex === 0) {
        const resolved = resolveTrace(graph, traceRouteId, newInput);

        if (resolved) {
          resolvedStepDefsRef.current = resolved.steps;
        }

        const newSteps = recompute(traceStepsRef.current, 0, newInput);
        setTraceSteps(newSteps);
        traceStepsRef.current = newSteps;
        setTraceVisible(0);
        traceVisibleRef.current = 0;
        setActiveTraceIds(new Set());
        setIsPausedAtBreakpoint(false);
        setCurrentBreakpointId(null);
        setIsTracing(true);

        // Animate through all steps
        (async () => {
          for (let i = 0; i < newSteps.length; i++) {
            await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
            setTraceHeadId(newSteps[i].nodeId);
            setActiveTraceIds((prev) => new Set([...prev, newSteps[i].nodeId]));
            setTraceVisible(i + 1);
            traceVisibleRef.current = i + 1;

            if (breakpointsRef.current.has(newSteps[i].nodeId)) {
              setIsPausedAtBreakpoint(true);
              setCurrentBreakpointId(newSteps[i].nodeId);
              setSelectedId(newSteps[i].nodeId);
              setIsTracing(false);
              return;
            }
          }
          setIsTracing(false);
          setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
        })();
        return;
      }

      // ── Step N > 0: intermediate payload edit ──
      // Re-resolve the trace with the new input to re-evaluate when conditions
      // This ensures steps are included/excluded based on the edited input
      const resolved = resolveTrace(graph, traceRouteId, newInput);
      
      if (resolved) {
        resolvedStepDefsRef.current = resolved.steps;
      }

      // Rebuild the trace steps from the edited step onwards
      const newSteps = recompute(traceStepsRef.current, stepIndex, newInput);
      setTraceSteps(newSteps);
      traceStepsRef.current = newSteps;
    },
    [graph, traceRouteId, nodeMap],
  );

  /* landing screen */
  if (!graph) {
    return (
      <LandingPage
        githubUrl={githubUrl}
        setGithubUrl={setGithubUrl}
        branch={branch}
        setBranch={setBranch}
        forceRescan={forceRescan}
        setForceRescan={setForceRescan}
        isScanning={isScanning}
        scanPhase={scanPhase}
        scanMessage={scanMessage}
        error={error}
        handleScan={handleScan}
        handleUpload={handleUpload}
      />
    );
  }

  /* graph visualizer */
  const selectedNode = selectedId ? nodeById(selectedId) || null : null;

  return (
    <div
      className="bg-[#0d0d0f] h-screen flex overflow-hidden"
      style={{ userSelect: isResizing ? 'none' : 'auto' }}
    >
      <style>{`
        @keyframes dash { to { stroke-dashoffset: -18; } }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.8); opacity: 0.4; }
        }
        @keyframes fadeInBlur {
          0% { opacity: 0; filter: blur(8px); transform: scale(0.98); }
          100% { opacity: 1; filter: blur(0px); transform: scale(1); }
        }
        @keyframes fadeOutBlur {
          0% { opacity: 1; filter: blur(0px); transform: scale(1); }
          100% { opacity: 0; filter: blur(8px); transform: scale(0.98); }
        }
        @keyframes slideInFromLeft {
          0% { transform: translateX(-100%); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeInSlide {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="flex w-full h-full"
        style={{
          animation: isGraphUnloading
            ? 'fadeOutBlur 0.4s ease-out'
            : isGraphLoaded
              ? 'fadeInBlur 0.6s ease-out'
              : 'none',
          opacity: isGraphUnloading ? 0 : isGraphLoaded ? 1 : 0,
          filter: isGraphUnloading ? 'blur(8px)' : isGraphLoaded ? 'blur(0px)' : 'blur(8px)',
        }}
      >
        <div
          className="h-full flex overflow-hidden"
          style={{
            width: isSidebarCollapsed ? 0 : sidebarWidth,
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: isSidebarCollapsed ? 0 : 1,
          }}
        >
          {!isSidebarCollapsed && (
            <Sidebar
              width={sidebarWidth}
              routes={routes}
              traceMethod={traceMethod}
              traceRouteId={traceRouteId}
              setTraceRouteId={setTraceRouteId}
              setTraceMethod={setTraceMethod}
              clearTrace={clearTrace}
              setSelectedId={setSelectedId}
              routePathParams={routePathParams}
              pathParams={pathParams}
              setPathParams={setPathParams}
              reqBody={reqBody}
              setReqBody={setReqBody}
              runSimulation={runSimulation}
              isTracing={isTracing}
              traceSteps={traceSteps}
              traceVisible={traceVisible}
              selectedNode={selectedNode}
              coreEdges={coreEdges}
              nodeById={nodeById}
              setGraph={setGraph}
              setError={setError}
              setIsGraphUnloading={setIsGraphUnloading}
              toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              isPausedAtBreakpoint={isPausedAtBreakpoint}
              rerunFromStep={rerunFromStep}
              resumeSimulation={resumeSimulation}
              startFromNodeId={startFromNodeId}
              setStartFromNodeId={setStartFromNodeId}
              startFromNodeInput={startFromNodeInput}
              setStartFromNodeInput={setStartFromNodeInput}
              startFromNode={startFromNode}
            />
          )}
        </div>

        {/* Resize handle */}
        {!isSidebarCollapsed && (
          <div
            onMouseDown={handleResizeStart}
            className="w-1 cursor-col-resize transition-colors duration-150 z-20 shrink-0 h-full"
            style={{ background: isResizing ? '#378ADD' : 'transparent' }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = '#333';
            }}
            onMouseLeave={(e) => {
              if (!isResizing) (e.target as HTMLElement).style.background = 'transparent';
            }}
          />
        )}

        <GraphCanvas
          coreNodes={coreNodes}
          coreEdges={coreEdges}
          positions={positions}
          tx={tx}
          ty={ty}
          scale={scale}
          isPanning={isPanning}
          selectedId={selectedId}
          activeTraceIds={activeTraceIds}
          traceHeadId={traceHeadId}
          traceSteps={traceSteps}
          traceVisible={traceVisible}
          isSidebarCollapsed={isSidebarCollapsed}
          breakpoints={breakpoints}
          toggleBreakpoint={toggleBreakpoint}
          setBreakpoints={setBreakpoints}
          isPausedAtBreakpoint={isPausedAtBreakpoint}
          currentBreakpointId={currentBreakpointId}
          resumeSimulation={resumeSimulation}
          skipBreakpoint={skipBreakpoint}
          toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          setSelectedId={(id) => {
            setSelectedId(id);
          }}
          handleCanvasMouseDown={handleCanvasMouseDown}
          handleCanvasMouseMove={handleCanvasMouseMove}
          handleCanvasMouseUp={handleCanvasMouseUp}
          handleWheel={handleWheel}
          handleCanvasClick={handleCanvasClick}
          fitView={fitView}
          resetLayout={resetLayout}
          setScale={setScale}
          exportGraph={exportGraph}
          onNodeDrag={handleNodeDrag}
          startFromNodeId={startFromNodeId}
          setStartFromNodeId={setStartFromNodeId}
          startFromNodeInput={startFromNodeInput}
          setStartFromNodeInput={setStartFromNodeInput}
          startFromNode={startFromNode}
        />
      </div>
    </div>
  );
}
