"use client";

import type { ComponentNode, PayloadEdge } from "@/lib/schema";

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
  setSelectedId: (id: string | null) => void;
  handleCanvasMouseDown: (e: React.MouseEvent) => void;
  handleCanvasMouseMove: (e: React.MouseEvent) => void;
  handleCanvasMouseUp: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleCanvasClick: (e: React.MouseEvent) => void;
  fitView: () => void;
  setScale: React.Dispatch<React.SetStateAction<number>>;
}

const NODE_W = 190;
const NODE_H = 80;

const KIND_COLORS: Record<string, { bg: string; border: string; badgeBg: string; badgeText: string }> = {
  route_handler: { bg: "#0e1e30", border: "#185FA5", badgeBg: "#B5D4F4", badgeText: "#0C447C" },
  middleware: { bg: "#1a0e2e", border: "#534AB7", badgeBg: "#CECBF6", badgeText: "#3C3489" },
  business_logic: { bg: "#0e1e0e", border: "#3B6D11", badgeBg: "#C0DD97", badgeText: "#27500A" },
  transformer: { bg: "#1e1200", border: "#854F0B", badgeBg: "#FAC775", badgeText: "#633806" },
  validator: { bg: "#1e0e00", border: "#993C1D", badgeBg: "#F5C4B3", badgeText: "#712B13" },
  db_call: { bg: "#001e18", border: "#0F6E56", badgeBg: "#9FE1CB", badgeText: "#085041" },
};

const KIND_LABELS: Record<string, string> = {
  route_handler: "ROUTE",
  middleware: "MIDDLEWARE",
  business_logic: "HANDLER",
  transformer: "TRANSFORM",
  validator: "VALIDATOR",
  db_call: "DB",
};

const LEGEND_ITEMS = [
  { kind: "route_handler", label: "route" },
  { kind: "middleware", label: "middleware" },
  { kind: "business_logic", label: "business" },
  { kind: "transformer", label: "transformer" },
  { kind: "validator", label: "validator" },
  { kind: "db_call", label: "db_call" },
];

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
    setSelectedId,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleWheel,
    handleCanvasClick,
    fitView,
    setScale,
  } = props;

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
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {/* SVG edges */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 4000,
            height: 4000,
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

          return (
            <div
              key={node.id}
              data-node
              onClick={(e) => { e.stopPropagation(); setSelectedId(node.id); }}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                minHeight: NODE_H,
                background: colors.bg,
                border: `0.5px solid ${colors.border}`,
                borderRadius: 8,
                padding: "10px 12px",
                cursor: "pointer",
                boxShadow: isHead
                  ? `0 0 20px ${colors.border}88, 0 0 0 2px ${colors.border}`
                  : isSelected
                    ? "0 0 0 2px #378ADD"
                    : isTraceActive
                      ? `0 0 12px ${colors.border}44`
                      : "none",
                transition: "box-shadow 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ fontSize: 8, background: colors.badgeBg, color: colors.badgeText, padding: "2px 5px", borderRadius: 3, fontWeight: 700, letterSpacing: 0.5 }}>
                  {label}
                </div>
                {node.mutates_state && (
                  <div style={{ fontSize: 8, background: "#2d1a0a", color: "#EF9F27", padding: "2px 5px", borderRadius: 3, fontWeight: 700, border: "0.5px solid #633806" }}>
                    MUTATES
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#ddd", fontWeight: 500, marginBottom: 4, lineHeight: 1.3 }}>
                {node.name}
              </div>
              {node.description && (
                <div style={{ fontSize: 9, color: "#666", lineHeight: 1.3 }}>
                  {node.description.length > 80 ? node.description.slice(0, 80) + "..." : node.description}
                </div>
              )}
              {isHead && (
                <div style={{ position: "absolute", top: -4, right: -4, width: 10, height: 10, borderRadius: "50%", background: "#378ADD", boxShadow: "0 0 8px #378ADD", animation: "pulse 0.6s ease-in-out infinite" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 4, zIndex: 10 }}>
        {[
          { label: "fit view", action: fitView },
          { label: "+ zoom", action: () => setScale((s) => Math.min(2, s + 0.15)) },
          { label: "– zoom", action: () => setScale((s) => Math.max(0.3, s - 0.15)) },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action}
            style={{ background: "#111114", border: "0.5px solid #222", borderRadius: 5, padding: "6px 10px", color: "#888", fontFamily: "inherit", fontSize: 10, cursor: "pointer", fontWeight: 500 }}
          >{btn.label}</button>
        ))}
      </div>

      {/* Legend */}
      <div style={{ position: "absolute", bottom: 16, left: 16, background: "#111113", border: "0.5px solid #222", borderRadius: 8, padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "8px 16px", zIndex: 10 }}>
        {LEGEND_ITEMS.map((item) => {
          const c = KIND_COLORS[item.kind];
          return (
            <div key={item.kind} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#777" }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, border: `1.5px solid ${c.border}`, background: c.bg }} />
              {item.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
