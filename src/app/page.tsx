"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { ComponentsGraph, ComponentNode, PayloadEdge, ScanProgress, StepCondition, TraceStep } from "@/types";
import { 
  CORE_KINDS, 
  NODE_W, 
  NODE_H, 
  H_GAP, 
  V_GAP,
  DEFAULT_SCALE,
  DEFAULT_TX,
  DEFAULT_TY,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  TRACE_STEP_DELAY,
  TRACE_HEAD_CLEAR_DELAY,
  STORAGE_KEYS,
} from "@/constants";
import LandingPage from "@/components/LandingPage";
import Sidebar from "@/components/Sidebar";
import GraphCanvas from "@/components/GraphCanvas";

function layoutNodes(
  nodes: ComponentNode[],
  edges: PayloadEdge[]
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
  const roots = nodes.filter((n) => !(incoming.get(n.id)?.length));
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

function smartTrace(
  startId: string,
  edges: PayloadEdge[],
  coreIds: Set<string>,
  nodeMap: Map<string, ComponentNode>,
  payload: Record<string, unknown>
): TraceStep[] {
  const out = new Map<string, Array<{ to: string; payload: string }>>();
  for (const e of edges) {
    if (!coreIds.has(e.from) || !coreIds.has(e.to)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push({ to: e.to, payload: e.payload });
  }

  const hints: string[] = [];
  for (const v of Object.values(payload)) {
    if (typeof v === "string") hints.push(v.toLowerCase());
  }

  const visited = new Set<string>();
  const steps: TraceStep[] = [];
  const queue: Array<{ id: string; edgeLabel: string }> = [{ id: startId, edgeLabel: "" }];
  visited.add(startId);

  while (queue.length > 0) {
    const { id, edgeLabel } = queue.shift()!;
    const node = nodeMap.get(id);
    steps.push({
      nodeId: id,
      name: node?.name || id,
      kind: node?.kind || "function",
      description: node?.description || "",
      edgeLabel,
    });

    const children = out.get(id) || [];
    if (children.length === 0) continue;

    if (hints.length > 0 && children.length > 1) {
      const scored = children.map((c) => {
        const label = c.payload.toLowerCase();
        let score = 0;
        for (const h of hints) {
          if (label.includes(h)) score += 10;
        }
        return { ...c, score };
      });
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

export default function Home() {
  const [graph, setGraph] = useState<ComponentsGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanPhase, setScanPhase] = useState<string>("");
  const [forceRescan, setForceRescan] = useState(false);

  /* restore session from localStorage on mount */
  useEffect(() => {
    try {
      const savedGraph = localStorage.getItem(STORAGE_KEYS.GRAPH);
      const savedUrl = localStorage.getItem(STORAGE_KEYS.GITHUB_URL);
      if (savedGraph) setGraph(JSON.parse(savedGraph));
      if (savedUrl) setGithubUrl(savedUrl);
    } catch (err) {
      console.error("Failed to restore session:", err);
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
  const [traceMethod, setTraceMethod] = useState("GET");
  const [traceRouteId, setTraceRouteId] = useState<string | null>(null);
  const [activeTraceIds, setActiveTraceIds] = useState<Set<string>>(new Set());
  const [traceHeadId, setTraceHeadId] = useState<string | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const [traceVisible, setTraceVisible] = useState(0);

  /* request builder */
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [reqBody, setReqBody] = useState("{\n  \n}");

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
        setTx(prev => prev + offset);
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
    return graph.edges.filter(
      (e) => coreNodeIds.has(e.from) && coreNodeIds.has(e.to)
    );
  }, [graph, coreNodeIds]);

  /* routes for sidebar */
  const routes = useMemo(() => {
    return coreNodes.filter((n) => n.kind === "route_handler");
  }, [coreNodes]);

  /* extract path params from selected route pattern */
  const routePathParams = useMemo(() => {
    if (!traceRouteId) return [];
    const node = coreNodes.find((n) => n.id === traceRouteId);
    const pattern = node?.path_pattern || "";
    const matches = pattern.match(/[:{}][a-zA-Z_]+}?/g);
    if (!matches) return [];
    return matches.map((m) => m.replace(/[:{}]/g, ""));
  }, [traceRouteId, coreNodes]);

  /* auto-populate method, path params, and body when route changes */
  useEffect(() => {
    if (!traceRouteId) return;
    const node = coreNodes.find((n) => n.id === traceRouteId);
    if (!node) return;

    if (node.method) {
      setTraceMethod(node.method.toUpperCase());
    } else {
      const idUpper = node.id.toUpperCase();
      if (idUpper.startsWith("GET ")) setTraceMethod("GET");
      else if (idUpper.startsWith("POST ")) setTraceMethod("POST");
      else if (idUpper.startsWith("PUT ")) setTraceMethod("PUT");
      else if (idUpper.startsWith("DELETE ")) setTraceMethod("DELETE");
      else if (idUpper.startsWith("PATCH ")) setTraceMethod("PATCH");
    }

    if (node.example_payload) {
      try {
        setReqBody(JSON.stringify(JSON.parse(node.example_payload), null, 2));
      } catch {
        setReqBody(node.example_payload);
      }
    } else {
      setReqBody("{\n  \n}");
    }

    const init: Record<string, string> = {};
    for (const p of routePathParams) init[p] = "";
    setPathParams(init);
  }, [traceRouteId, coreNodes, routePathParams]);

  /* positions */
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );

  useEffect(() => {
    if (!graph) return;
    setPositions(layoutNodes(coreNodes, coreEdges));
  }, [graph, coreNodes, coreEdges]);

  /* sidebar resize handlers */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStart.current = { x: e.clientX, w: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStart.current.x;
      setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, resizeStart.current.w + delta)));
    };
    const onUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing]);

  /* scan from GitHub URL */
  const handleScan = useCallback(async () => {
    const url = githubUrl.trim();
    if (!url) return;
    setIsScanning(true);
    setError(null);
    setScanMessage("Starting...");
    setScanPhase("discovering");

    try {
      const res = await fetch("/api/clone-and-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, forceRescan }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let outputPath = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const progress: ScanProgress = JSON.parse(line);
            setScanPhase(progress.phase);
            setScanMessage(progress.message);

            if (progress.phase === "done" && progress.summary) {
              outputPath = progress.summary.outputPath;
            }
            if (progress.phase === "error") {
              throw new Error(progress.message);
            }
          } catch (e) {
            if (e instanceof Error && e.message !== line) throw e;
          }
        }
      }

      if (outputPath) {
        const loadRes = await fetch("/api/load-graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: outputPath }),
        });
        if (loadRes.ok) {
          const data: ComponentsGraph = await loadRes.json();
          setGraph(data);
          localStorage.setItem(STORAGE_KEYS.GRAPH, JSON.stringify(data));
          localStorage.setItem(STORAGE_KEYS.GITHUB_URL, url);
        } else {
          throw new Error("Scan completed but failed to load graph");
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsScanning(false);
      setScanPhase("");
      setScanMessage("");
    }
  }, [githubUrl, forceRescan]);

  /* upload JSON directly */
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        setGraph(data);
        localStorage.setItem(STORAGE_KEYS.GRAPH, JSON.stringify(data));
        setError(null);
      } catch {
        setError("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  /* canvas interactions */
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-node]")) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    },
    [tx, ty]
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
    [isPanning]
  );

  const handleCanvasMouseUp = useCallback(() => setIsPanning(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Disabled zoom on scroll
  }, []);

  const fitView = useCallback(() => {
    setScale(DEFAULT_SCALE);
    // Adjust center position based on sidebar state
    const offset = isSidebarCollapsed ? sidebarWidth / 2 : 0;
    setTx(DEFAULT_TX + offset);
    setTy(DEFAULT_TY);
  }, [isSidebarCollapsed, sidebarWidth]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-node]")) setSelectedId(null);
  }, []);

  /* node lookup */
  const nodeById = useCallback(
    (id: string) => coreNodes.find((n) => n.id === id),
    [coreNodes]
  );

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

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(reqBody) as Record<string, unknown>;
    } catch { /* empty */ }

    let steps: TraceStep[];

    const precomputed = graph.traces?.filter((t) => t.route_id === traceRouteId) || [];
    if (precomputed.length > 0) {
      /* evaluate match/when conditions deterministically */
      const evalCond = (c: StepCondition, p: Record<string, unknown>): boolean => {
        const v = p[c.field];
        switch (c.op) {
          case "eq": return v === c.value;
          case "neq": return v !== c.value;
          case "in": return Array.isArray(c.value) && c.value.includes(String(v));
          case "not_in": return Array.isArray(c.value) && !c.value.includes(String(v));
          case "exists": return v !== undefined && v !== null;
          case "not_exists": return v === undefined || v === null;
          case "eq_field": return typeof c.value === "string" && v === p[c.value];
          case "neq_field": return typeof c.value === "string" && v !== p[c.value];
          default: return true;
        }
      };

      /* first trace where ALL match conditions pass wins (order matters) */
      let bestTrace = precomputed[precomputed.length - 1];
      for (const trace of precomputed) {
        const conds = trace.match;
        if (!conds || conds.length === 0) continue;
        if (conds.every((c) => evalCond(c, payload))) { bestTrace = trace; break; }
      }
      /* if nothing matched, use first unconditional trace */
      if (!bestTrace.match || bestTrace.match.length === 0) {
        for (const trace of precomputed) {
          if (!trace.match || trace.match.length === 0) { bestTrace = trace; break; }
        }
      }

      /* filter steps by "when" conditions */
      steps = bestTrace.steps
        .filter((s) => !s.when || evalCond(s.when, payload))
        .map((s) => {
          const node = nodeMap.get(s.node_id);
          return {
            nodeId: s.node_id,
            name: node?.name || s.node_id,
            kind: node?.kind || "function",
            description: s.summary,
            edgeLabel: s.edge_label,
          };
        });
    } else {
      steps = smartTrace(traceRouteId, coreEdges, coreNodeIds, nodeMap, payload);
    }

    setTraceSteps(steps);

    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, TRACE_STEP_DELAY));
      setTraceHeadId(steps[i].nodeId);
      setActiveTraceIds((prev) => new Set([...prev, steps[i].nodeId]));
      setTraceVisible(i + 1);
    }

    setIsTracing(false);
    setTimeout(() => setTraceHeadId(null), TRACE_HEAD_CLEAR_DELAY);
  }, [traceRouteId, graph, coreEdges, coreNodeIds, nodeMap, reqBody]);

  const clearTrace = useCallback(() => {
    setActiveTraceIds(new Set());
    setTraceHeadId(null);
    setTraceSteps([]);
    setTraceVisible(0);
  }, []);

  /* landing screen */
  if (!graph) {
    return (
      <LandingPage
        githubUrl={githubUrl}
        setGithubUrl={setGithubUrl}
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
  const selectedNode = selectedId ? (nodeById(selectedId) || null) : null;

  return (
    <div className="bg-[#0d0d0f] h-screen flex overflow-hidden" style={{ userSelect: isResizing ? "none" : "auto" }}>
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
            ? "fadeOutBlur 0.4s ease-out" 
            : isGraphLoaded 
              ? "fadeInBlur 0.6s ease-out" 
              : "none",
          opacity: isGraphUnloading ? 0 : isGraphLoaded ? 1 : 0,
          filter: isGraphUnloading ? "blur(8px)" : isGraphLoaded ? "blur(0px)" : "blur(8px)",
        }}
      >

      <div 
        className="h-full flex overflow-hidden"
        style={{
          width: isSidebarCollapsed ? 0 : sidebarWidth,
          transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
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
          />
        )}
      </div>

      {/* Resize handle */}
      {!isSidebarCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="w-1 cursor-col-resize transition-colors duration-150 z-20 shrink-0 h-full"
          style={{ background: isResizing ? "#378ADD" : "transparent" }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#333"; }}
          onMouseLeave={(e) => { if (!isResizing) (e.target as HTMLElement).style.background = "transparent"; }}
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
        setScale={setScale}
      />
      </div>
    </div>
  );
}
