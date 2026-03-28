'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ComponentNode, PayloadEdge, TraceStep } from '@/types';
import {
  NODE_W,
  NODE_H,
  KIND_COLORS,
  KIND_LABELS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MIN_SCALE,
  MAX_SCALE,
  SCALE_STEP,
} from '@/constants';

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
  breakpoints: Set<string>;
  toggleBreakpoint: (nodeId: string) => void;
  setBreakpoints: React.Dispatch<React.SetStateAction<Set<string>>>;
  isPausedAtBreakpoint: boolean;
  currentBreakpointId: string | null;
  resumeSimulation: () => void;
  skipBreakpoint: () => void;
  toggleSidebar: () => void;
  setSelectedId: (id: string | null) => void;
  handleCanvasMouseDown: (e: React.MouseEvent) => void;
  handleCanvasMouseMove: (e: React.MouseEvent) => void;
  handleCanvasMouseUp: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleCanvasClick: (e: React.MouseEvent) => void;
  fitView: () => void;
  resetLayout: () => void;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  exportGraph: () => void;
  onNodeDrag: (nodeId: string, x: number, y: number) => void;
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
    breakpoints,
    toggleBreakpoint,
    setBreakpoints,
    isPausedAtBreakpoint,
    currentBreakpointId,
    resumeSimulation,
    skipBreakpoint,
    toggleSidebar,
    setSelectedId,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleWheel,
    handleCanvasClick,
    fitView,
    resetLayout,
    setScale,
    exportGraph,
    onNodeDrag,
  } = props;

  // Node dragging state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, nodePos: { x: number; y: number }) => {
      e.stopPropagation();
      e.preventDefault();
      setDraggingNodeId(nodeId);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        nodeX: nodePos.x,
        nodeY: nodePos.y,
      };
    },
    [],
  );

  useEffect(() => {
    if (!draggingNodeId) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = (e.clientX - dragStart.current.x) / scale;
      const dy = (e.clientY - dragStart.current.y) / scale;
      const newX = dragStart.current.nodeX + dx;
      const newY = dragStart.current.nodeY + dy;
      onNodeDrag(draggingNodeId, newX, newY);
    };

    const handleMouseUp = () => {
      setDraggingNodeId(null);
      dragStart.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingNodeId, scale, onNodeDrag]);

  // Create a map of nodeId to all step numbers (for nodes that appear multiple times)
  // Only include steps that have been revealed (up to traceVisible)
  const nodeStepMap = new Map<string, number[]>();
  traceSteps.slice(0, traceVisible).forEach((step, index) => {
    const existing = nodeStepMap.get(step.nodeId) || [];
    nodeStepMap.set(step.nodeId, [...existing, index + 1]);
  });

  // Create a map of function steps that appear between nodes (not in coreNodes)
  const functionSteps = traceSteps
    .slice(0, traceVisible)
    .filter((step) => step.kind === 'function' && !coreNodes.some((n) => n.id === step.nodeId));

  // Map functions to edges they belong to (between which two nodes)
  const edgeFunctions = new Map<string, typeof functionSteps>();
  for (let i = 0; i < traceSteps.slice(0, traceVisible).length; i++) {
    const step = traceSteps[i];
    if (step.kind === 'function' && !coreNodes.some((n) => n.id === step.nodeId)) {
      // Find the previous and next core nodes
      let prevNodeId = null;
      let nextNodeId = null;

      for (let j = i - 1; j >= 0; j--) {
        if (coreNodes.some((n) => n.id === traceSteps[j].nodeId)) {
          prevNodeId = traceSteps[j].nodeId;
          break;
        }
      }

      for (let j = i + 1; j < traceSteps.slice(0, traceVisible).length; j++) {
        if (coreNodes.some((n) => n.id === traceSteps[j].nodeId)) {
          nextNodeId = traceSteps[j].nodeId;
          break;
        }
      }

      if (prevNodeId && nextNodeId) {
        const edgeKey = `${prevNodeId}->${nextNodeId}`;
        const existing = edgeFunctions.get(edgeKey) || [];
        edgeFunctions.set(edgeKey, [...existing, step]);
      }
    }
  }

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
        position: 'relative',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        background: '#0a0a0c',
        backgroundImage: `
          linear-gradient(rgba(42, 74, 122, 0.15) 1px, transparent 1px),
          linear-gradient(90deg, rgba(42, 74, 122, 0.15) 1px, transparent 1px)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: `${tx}px ${ty}px`,
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
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transformOrigin: '0 0',
          transition: isPanning ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: isPanning ? 'transform' : 'auto',
        }}
      >
        {/* SVG edges */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
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
                stroke={isLit ? '#378ADD' : '#2a4a7a'}
                strokeWidth={isLit ? 2 : 1.5}
                strokeDasharray="5 4"
                markerEnd={isLit ? 'url(#arr-lit)' : 'url(#arr)'}
                style={{
                  animation: isLit ? 'dash 1.5s linear infinite' : 'none',
                  transition: 'stroke 0.3s, stroke-width 0.3s',
                }}
              />
            );
          })}
        </svg>

        {/* Function bubbles on edges */}
        {coreEdges.map((edge, i) => {
          const fromPos = positions.get(edge.from);
          const toPos = positions.get(edge.to);
          if (!fromPos || !toPos) return null;

          const edgeKey = `${edge.from}->${edge.to}`;
          const functions = edgeFunctions.get(edgeKey);
          if (!functions || functions.length === 0) return null;

          const x1 = fromPos.x + NODE_W / 2;
          const y1 = fromPos.y + NODE_H;
          const x2 = toPos.x + NODE_W / 2;
          const y2 = toPos.y;

          // Calculate midpoint on the bezier curve (approximate)
          const midY = (y1 + y2) / 2;
          const midX = (x1 + x2) / 2;

          return (
            <div
              key={`func-${i}`}
              className="absolute pointer-events-auto group"
              style={{
                left: midX - 12,
                top: midY - 12,
                zIndex: 5,
              }}
            >
              <div
                className="w-6 h-6 rounded-full bg-[#854F0B] border-2 border-[#0d0d0f] flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                style={{
                  boxShadow: '0 2px 8px rgba(133, 79, 11, 0.4)',
                }}
              >
                <span className="text-[8px] font-bold text-white">{functions.length}</span>
              </div>

              {/* Tooltip on hover */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block whitespace-nowrap z-50">
                <div className="bg-[#111114] border border-[#854F0B] rounded-md px-3 py-2 shadow-lg">
                  {functions.map((fn, idx) => (
                    <div key={idx} className="text-[10px] text-[#ddd] font-medium">
                      {fn.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

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
          const isBreakpoint = breakpoints.has(node.id);
          const isPausedHere = isPausedAtBreakpoint && currentBreakpointId === node.id;
          const isDragging = draggingNodeId === node.id;

          return (
            <div
              key={node.id}
              data-node
              onMouseDown={(e) => {
                if (!isGreyedOut && e.button === 0) {
                  handleNodeMouseDown(e, node.id, pos);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                // Only trigger click if not dragging
                if (!isDragging && !isGreyedOut) {
                  setSelectedId(node.id);
                  // Auto-open sidebar when clicking a node
                  if (isSidebarCollapsed) {
                    toggleSidebar();
                  }
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isDragging && !isGreyedOut) {
                  setSelectedId(node.id);
                  if (isSidebarCollapsed) {
                    toggleSidebar();
                  }
                  // Trigger node input mode
                  const event = new CustomEvent('nodeDoubleClick', { detail: { nodeId: node.id } });
                  window.dispatchEvent(event);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();

                // Select the node and open inspector
                if (!isGreyedOut) {
                  setSelectedId(node.id);
                  if (isSidebarCollapsed) {
                    toggleSidebar();
                  }
                }

                // Allow breakpoints on any node at any time
                toggleBreakpoint(node.id);
              }}
              className={`absolute ${isDragging ? '' : 'transition-all duration-200'}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: NODE_W,
                minHeight: NODE_H,
                background: 'linear-gradient(135deg, #1a1a1f 0%, #111114 100%)',
                border: isPausedHere
                  ? '3px solid #f59e0b'
                  : isBreakpoint
                    ? '2px solid #f59e0b'
                    : isHead
                      ? `2px solid ${colors.border}`
                      : isSelected
                        ? '2px solid #378ADD'
                        : isTraceActive
                          ? `2px solid ${colors.border}66`
                          : '1px solid #2a2a2e',
                borderRadius: 12,
                opacity: isGreyedOut ? 0.25 : 1,
                cursor: isDragging ? 'grabbing' : isGreyedOut ? 'not-allowed' : 'grab',
                overflow: 'visible',
                boxShadow: isDragging
                    ? '0 8px 20px rgba(0,0,0,0.4)'
                    : '0 2px 6px rgba(0, 0, 0, 0.2)',
                zIndex: isDragging ? 100 : undefined,
                userSelect: 'none',
                backdropFilter: 'blur(8px)',
              }}
            >
              {/* Breakpoint indicator - top right corner */}
              {isBreakpoint && (
                <div
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#f59e0b] flex items-center justify-center z-10 border-2 border-[#0d0d0f]"
                 
                  title="Breakpoint"
                >
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              )}

              {/* Step number badges - positioned at top left, multiple if node appears multiple times */}
              {stepNumbers.length > 0 && (
                <div className="absolute -top-2 -left-2 flex gap-1 z-10">
                  {stepNumbers.map((num, idx) => (
                    <div
                      key={idx}
                      className="w-6 h-6 rounded-full bg-[#378ADD] flex items-center justify-center text-[10px] font-bold text-white"
                    >
                      {num}
                    </div>
                  ))}
                </div>
              )}

              {/* Top colored strip */}
              <div
                className="h-1.5 w-full rounded-t-2xl mt-[-1.1px]"
                style={{
                  background: isPausedHere 
                    ? '#f59e0b' 
                    : isBreakpoint 
                      ? '#f59e0b' 
                      : colors.border,
                }}
              />

              {/* Content */}
              <div className="p-3.5 overflow-hidden">
                {/* Badges row */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div
                    className="text-[8px] px-2.5 py-1 rounded-md font-bold tracking-wider"
                    style={{ 
                      background: colors.badgeBg, 
                      color: colors.badgeText,
                    }}
                  >
                    {label}
                  </div>
                  {node.mutates_state && (
                    <div className="text-[7px] bg-[#2d1a0a] text-[#EF9F27] px-2 py-1 rounded-md font-bold border border-[#633806]">
                      MUT
                    </div>
                  )}
                  {isPausedHere && (
                    <div className="ml-auto flex items-center justify-center w-5 h-5 rounded bg-[#f59e0b]">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    </div>
                  )}
                  {isHead && !isPausedHere && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-[#378ADD] animate-pulse" />
                  )}
                  {isSelected && !isHead && !isPausedHere && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-[#378ADD]" />
                  )}
                </div>

                {/* Node name */}
                <div 
                  className="text-[13px] text-[#f5f5f5] font-semibold mb-2 leading-tight tracking-tight overflow-hidden text-ellipsis whitespace-nowrap group relative"
                  title={node.name}
                >
                  {node.name}
                  {/* Tooltip on hover */}
                  <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50 pointer-events-none">
                    <div className="bg-[#111114] border border-[#378ADD] rounded-md px-3 py-2 shadow-lg whitespace-nowrap">
                      <div className="text-[11px] text-[#f5f5f5] font-medium">
                        {node.name}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Description */}
                {node.description && (
                  <div className="text-[9px] text-[#888] leading-relaxed">
                    {node.description.length > 85
                      ? node.description.slice(0, 85) + '...'
                      : node.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none">
        <div className="flex flex-col gap-2 pointer-events-auto">
          {/* First row: Sidebar toggle + view controls + export */}
          <div className="flex gap-2">
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
              { label: 'fit view', action: fitView },
              { label: 'reset layout', action: resetLayout },
              {
                label: '+ zoom',
                action: () => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)),
              },
              {
                label: '– zoom',
                action: () => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)),
              },
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

          {/* Second row: Info banner */}
          <div className="bg-[#111114]/90 backdrop-blur-sm border border-[#f59e0b] rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg w-fit">
            <svg
              className="w-4 h-4 text-[#f59e0b] shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-[10px] text-[#888] font-medium whitespace-nowrap">
              Right-click on any node to add breakpoints
            </span>
          </div>

          {/* Third row: Breakpoint controls */}
          {(breakpoints.size > 0 || isPausedAtBreakpoint) && (
            <div className="flex gap-2">
              {/* Breakpoint counter */}
              {breakpoints.size > 0 && (
                <div className="bg-[#111114] border border-[#f59e0b] rounded-md px-3 py-2 text-[#f59e0b] text-[10px] font-bold flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                  {breakpoints.size} breakpoint{breakpoints.size !== 1 ? 's' : ''}
                </div>
              )}

              {/* Resume/Skip controls */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPausedAtBreakpoint && !traceSteps[traceVisible - 1]?.terminated) {
                    resumeSimulation();
                  }
                }}
                disabled={!isPausedAtBreakpoint || traceSteps[traceVisible - 1]?.terminated}
                className="bg-[#378ADD] hover:bg-[#4a9bef] text-white px-4 py-2 rounded-md text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  traceSteps[traceVisible - 1]?.terminated
                    ? 'Fix errors in the current step before resuming'
                    : 'Resume simulation from breakpoint'
                }
              >
                {traceSteps[traceVisible - 1]?.terminated ? 'Fix issues before resuming' : 'Resume'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPausedAtBreakpoint) {
                    skipBreakpoint();
                  }
                }}
                disabled={!isPausedAtBreakpoint}
                className="bg-[#111114] border border-[#f59e0b] hover:bg-[#f59e0b] text-[#f59e0b] hover:text-white px-4 py-2 rounded-md text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Skip
              </button>

              {/* Clear breakpoints button */}
              {breakpoints.size > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setBreakpoints(new Set());
                  }}
                  className="bg-[#111114] border border-[#ef4444] hover:bg-[#ef4444] text-[#ef4444] hover:text-white px-4 py-2 rounded-md text-[10px] font-medium transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
