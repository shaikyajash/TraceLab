"use client";

import type { ComponentNode, PayloadEdge, TraceStep } from "@/types";
import { NODE_W, NODE_H, KIND_COLORS, KIND_LABELS, CANVAS_WIDTH, CANVAS_HEIGHT, MIN_SCALE, MAX_SCALE, SCALE_STEP } from "@/constants";

interface GraphCanvasProps {
  coreNodes: ComponentNode[];
  coreEdges: PayloadEdge[];
  positions: Map<string, { x: number; y: number }>;
  tx: number;
  ty: number;
  scale: number;
  isPanning: boolean;
  selectedId: string | null;
  activeTraceIds: Set<string>;
  traceHeadId: string | null;
  traceSteps: TraceStep[];
  traceVisible: number;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSelectedId: (id: string | null) => void;
  handleCanvasMouseDown: (e: React.MouseEvent) => void;
  handleCanvasMouseMove: (e: React.MouseEvent) => void;
  handleCanvasMouseUp: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleCanvasClick: (e: React.MouseEvent) => void;
  fitView: () => void;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  exportGraph: () => void;
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const cy1 = y1 + Math.abs(y2 - y1) * 0.4;
  const cy2 = y2 - Math.abs(y2 - y1) * 0.4;
  return `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`;
}

export default function GraphCanvas(props: GraphCanvasProps) {
  const {
    coreNodes,
    coreEdges,
    positions,
    tx,
    ty,
    scale,
    isPanning,
    selectedId,
    activeTraceIds,
    traceHeadId,
    traceSteps,
    traceVisible,
    isSidebarCollapsed,
    toggleSidebar,
    setSelectedId,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleWheel,
    handleCanvasClick,
    fitView,
    setScale,
    exportGraph,
  } = props;

  // Create a map of nodeId to all step numbers (for nodes that appear multiple times)
  // Only include steps that have been revealed (up to traceVisible)
  const nodeStepMap = new Map<string, number[]>();
  traceSteps.slice(0, traceVisible).forEach((step, index) => {
    const existing = nodeStepMap.get(step.nodeId) || [];
    nodeStepMap.set(step.nodeId, [...existing, index + 1]);
  });

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
        flex: 1,
        position: "relative",
        overflow: "hidden",
        cursor: isPanning ? "grabbing" : "grab",
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
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transformOrigin: "0 0",
          transition: isPanning ? "none" : "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: isPanning ? "transform" : "auto",
        }}
      >
        {/* SVG edges */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="#2a4a7a" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
            <marker id="arr-lit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="#378ADD" strokeWidth="1.5" strokeLinecap="round" />
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
                stroke={isLit ? "#378ADD" : "#1a3a5c"}
                strokeWidth={isLit ? 2 : 1.5}
                strokeDasharray="5 4"
                markerEnd={isLit ? "url(#arr-lit)" : "url(#arr)"}
                style={{
                  animation: "dash 1.2s linear infinite",
                  animationDelay: `${i * 0.15}s`,
                  transition: "stroke 0.3s, stroke-width 0.3s",
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
          const isGreyedOut = activeTraceIds.size > 0 && !isTraceActive;
          const stepNumbers = nodeStepMap.get(node.id) || [];

          return (
            <div
              key={node.id}
              data-node
              onClick={(e) => { 
                e.stopPropagation(); 
                if (!isGreyedOut) {
                  setSelectedId(node.id);
                  // Auto-open sidebar when clicking a node
                  if (isSidebarCollapsed) {
                    toggleSidebar();
                  }
                }
              }}
              className="absolute transition-all duration-200"
              style={{
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                minHeight: NODE_H,
                background: "#111114",
                border: isHead 
                  ? `2px solid ${colors.border}` 
                  : isSelected 
                    ? "2px solid #378ADD" 
                    : isTraceActive
                      ? `2px solid ${colors.border}66`
                      : "1px solid #2a2a2e",
                borderRadius: 10,
                opacity: isGreyedOut ? 0.25 : 1,
                cursor: isGreyedOut ? "not-allowed" : "pointer",
                overflow: "visible",
              }}
            >
              {/* Step number badges - positioned at top left, multiple if node appears multiple times */}
              {stepNumbers.length > 0 && (
                <div className="absolute -top-2 -left-2 flex gap-1 z-10">
                  {stepNumbers.map((num, idx) => (
                    <div 
                      key={idx}
                      className="w-6 h-6 rounded-full bg-[#378ADD] flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#0d0d0f]"
                      style={{
                        boxShadow: "0 2px 8px rgba(55, 138, 221, 0.4)"
                      }}
                    >
                      {num}
                    </div>
                  ))}
                </div>
              )}

              {/* Top colored strip */}
              <div 
                className="h-1 w-full"
                style={{ background: colors.border }}
              />

              {/* Content */}
              <div className="p-3 overflow-hidden">
                {/* Badges row */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div 
                    className="text-[8px] px-2 py-1 rounded-md font-bold tracking-wider"
                    style={{ background: colors.badgeBg, color: colors.badgeText }}
                  >
                    {label}
                  </div>
                  {node.mutates_state && (
                    <div className="text-[7px] bg-[#2d1a0a] text-[#EF9F27] px-1.5 py-0.5 rounded-md font-bold border border-[#633806]">
                      MUT
                    </div>
                  )}
                  {isHead && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-[#378ADD] animate-pulse" />
                  )}
                  {isSelected && !isHead && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#378ADD]" />
                  )}
                </div>

                {/* Node name */}
                <div className="text-[12px] text-[#eee] font-semibold mb-2 leading-tight">
                  {node.name}
                </div>

                {/* Description */}
                {node.description && (
                  <div className="text-[9px] text-[#777] leading-relaxed">
                    {node.description.length > 85 ? node.description.slice(0, 85) + "..." : node.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="absolute top-3 left-3 right-3 flex justify-between z-10 pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          {isSidebarCollapsed && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                toggleSidebar();
              }}
              className="bg-[#111114] border border-[#2a2a2e] rounded-md px-3 py-2 text-[#888] text-[10px] cursor-pointer font-bold tracking-widest hover:border-[#378ADD] hover:text-white transition-colors"
            >
              &gt;&gt;
            </button>
          )}
          {[
            { label: "fit view", action: fitView },
            { label: "+ zoom", action: () => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)) },
            { label: "– zoom", action: () => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)) },
          ].map((btn, i) => (
            <button 
              key={i} 
              onClick={(e) => {
                e.stopPropagation();
                btn.action();
              }}
              className="bg-[#111114] border border-[#2a2a2e] rounded-md px-3 py-2 text-[#888] text-[10px] cursor-pointer font-medium hover:border-[#378ADD] hover:text-[#aaa] transition-colors"
            >
              {btn.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pointer-events-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              exportGraph();
            }}
            className="bg-[#111114] border border-[#2a2a2e] rounded-md px-3 py-2 text-[#888] text-[10px] cursor-pointer font-medium hover:border-[#378ADD] hover:text-[#aaa] transition-colors flex items-center gap-1.5"
          >
            Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}
