import React, { useRef, useEffect, useState } from 'react';
import type { ComponentNode, PayloadEdge } from '@/types';
import { KIND_COLORS, KIND_LABELS, STORAGE_KEYS } from '@/constants';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  width: number;
  routes: ComponentNode[];
  traceMethod: string;
  traceRouteId: string | null;
  setTraceRouteId: (id: string | null) => void;
  setTraceMethod: (method: string) => void;
  clearTrace: () => void;
  setSelectedId: (id: string | null) => void;
  routePathParams: string[];
  pathParams: Record<string, string>;
  setPathParams: (
    params: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  reqBody: string;
  setReqBody: (body: string) => void;
  runSimulation: () => void;
  isTracing: boolean;
  traceSteps: any[];
  traceVisible: number;
  selectedNode: ComponentNode | null | undefined;
  coreEdges: PayloadEdge[];
  nodeById: (id: string) => ComponentNode | undefined;
  setGraph: (graph: any) => void;
  setError: (error: string | null) => void;
  setIsGraphUnloading?: (unloading: boolean) => void;
  toggleSidebar?: () => void;
  isPausedAtBreakpoint?: boolean;
  rerunFromStep: (stepIndex: number, nodeId: string, newInput: unknown) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-[#666] mb-1 tracking-wide font-medium">{label}</div>
      <div className="bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded-md px-2.5 py-2 text-[11px] text-[#bbb] wrap-break-word leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  isOpen,
  onToggle,
  badge,
  children,
}: {
  title: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 border-b-[0.5px] border-[#2a2a2e]/50 pb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between bg-transparent border-none py-1.5 cursor-pointer"
      >
        <div className="text-[10px] text-[#666] tracking-[1.2px] font-semibold flex items-center">
          {title}
          {badge}
        </div>
        <svg
          className="w-3 h-3 text-[#666] transition-transform duration-300 ease-in-out"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  const {
    width,
    routes,
    traceMethod,
    traceRouteId,
    setTraceRouteId,
    clearTrace,
    setSelectedId,
    routePathParams,
    pathParams,
    setPathParams,
    reqBody,
    setReqBody,
    runSimulation,
    isTracing,
    traceSteps,
    traceVisible,
    selectedNode,
    coreEdges,
    nodeById,
    setGraph,
    setError,
    setIsGraphUnloading,
    toggleSidebar,
    isPausedAtBreakpoint,
    rerunFromStep,
  } = props;

  const [paramsOpen, setParamsOpen] = useState(true);
  const [bodyOpen, setBodyOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [traceFlowOpen, setTraceFlowOpen] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [stepInputEdits, setStepInputEdits] = useState<Record<number, string>>({});

  const traceFlowRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const selectedEntryNode = traceRouteId ? nodeById(traceRouteId) : undefined;
  const isHttpEntry = selectedEntryNode?.kind === 'route_handler';

  const handleSimulate = () => {
    runSimulation();
    setTraceFlowOpen(true);
    setInspectorOpen(false);
    setExpandedStep(null);
    setStepInputEdits({});
  };

  const handleClearTrace = () => {
    clearTrace();
    setTraceFlowOpen(false);
    setInspectorOpen(false);
    setParamsOpen(true);
    setBodyOpen(true);
    setExpandedStep(null);
    setStepInputEdits({});
  };

  // Expand Inspector and scroll when a node is selected, collapse if deselected
  useEffect(() => {
    if (selectedNode) {
      // Open inspector when node is selected (paused at breakpoint OR manual selection)
      if (isPausedAtBreakpoint || !isTracing) {
        setInspectorOpen(true);

        // Check if the selected node is exactly the one we paused on
        const isAtBreakpointStep =
          isPausedAtBreakpoint &&
          traceVisible > 0 &&
          traceSteps[traceVisible - 1]?.nodeId === selectedNode.id;

        if (isAtBreakpointStep) {
          setTraceFlowOpen(true);
          const stepIndex = traceVisible - 1;
          setExpandedStep(stepIndex);
          setTimeout(() => {
            const el = document.getElementById(`trace-step-${stepIndex}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 310);
        } else {
          setTimeout(() => {
            inspectorRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
          }, 310);
        }
      }

      // During active simulation (not paused), keep trace flow visible
      if (isTracing && !isPausedAtBreakpoint) {
        setInspectorOpen(false);
        if (traceSteps.length > 0) {
          setTraceFlowOpen(true);
        }
      }
    } else {
      setInspectorOpen(false);
    }
  }, [selectedNode, isPausedAtBreakpoint, isTracing, traceSteps, traceVisible]);

  // Collapse params/body if they're empty when route changes
  useEffect(() => {
    if (traceRouteId) {
      setParamsOpen(routePathParams.length > 0);
      setBodyOpen(reqBody.trim() !== '' && reqBody.trim() !== '{\n  \n}');
    }
  }, [traceRouteId, routePathParams.length, reqBody]);

  // Auto-scroll to latest step in Trace Flow
  useEffect(() => {
    if (traceFlowOpen && traceFlowRef.current && traceVisible > 0) {
      const el = traceFlowRef.current;
      setTimeout(() => {
        const parent = el.closest('.overflow-y-auto');
        if (parent) {
          parent.scrollTo({
            top: parent.scrollHeight,
            behavior: 'smooth',
          });
        }
      }, 50);
    }
  }, [traceVisible, traceFlowOpen]);

  return (
    <div
      className="min-w-[200px] max-w-[600px] border-r-[0.5px] border-[#2a2a2e] bg-[#0d0d0f] flex flex-col overflow-hidden shrink-0"
      style={{ width }}
    >
      {/* Simulate Header */}
      <div className="p-4 border-b-[0.5px] border-[#2a2a2e]">
        <div className="flex items-center justify-between mb-3 mt-0.5">
          <div className="text-[10px] text-[#666] tracking-[1.2px] font-semibold">SIMULATE</div>
          {toggleSidebar && (
            <button
              onClick={toggleSidebar}
              className="text-[#888] hover:text-white transition-colors bg-transparent border-none cursor-pointer flex items-center justify-center font-bold tracking-widest text-[10px]"
              title="Close sidebar"
            >
              &lt;&lt;
            </button>
          )}
        </div>

        <div className="flex gap-1.5 mb-2.5">
          <div
            className="bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md px-2 py-2 font-bold text-[10px] w-12 text-center shrink-0"
            style={{
              color:
                traceMethod === 'GET'
                  ? '#3B6D11'
                  : traceMethod === 'POST'
                    ? '#854F0B'
                    : traceMethod === 'DELETE'
                      ? '#993C1D'
                      : traceMethod === 'FN'
                        ? '#378ADD'
                        : traceMethod === 'BIZ'
                          ? '#1D9E75'
                          : traceMethod === 'BG'
                            ? '#9333EA'
                            : traceMethod === 'MQ'
                              ? '#EC4899'
                              : traceMethod === 'RUN'
                                ? '#F59E0B'
                                : '#534AB7',
            }}
          >
            {traceMethod}
          </div>
          <Select
            value={traceRouteId || ''}
            onValueChange={(value: string) => {
              setTraceRouteId(value || null);
              clearTrace();
            }}
          >
            <SelectTrigger className="flex-1 bg-[#111114] border-[#2a2a2e] h-auto py-2 px-3 text-white text-[11px] hover:border-[#378ADD] focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="select entry point..." className="text-white" />
            </SelectTrigger>
            <SelectContent
              className="bg-[#111114] border-[#2a2a2e] text-white max-h-[300px] overflow-y-auto"
              position="popper"
              side="bottom"
              align="start"
              sideOffset={4}
            >
              {routes.map((r) => (
                <SelectItem
                  key={r.id}
                  value={r.id}
                  className="text-[11px] text-white hover:bg-gray-200 hover:text-gray-900 focus:bg-gray-200 focus:text-gray-900 cursor-pointer data-highlighted:bg-gray-200 data-highlighted:text-gray-900"
                >
                  {r.kind === 'route_handler'
                    ? r.path_pattern || r.name
                    : `${r.name}${r.input ? `(${r.input})` : ''}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleSimulate}
          disabled={!traceRouteId || isTracing}
          className="w-full bg-[#378ADD] hover:bg-[#4a9bef] text-white disabled:bg-[#1a1a1e] disabled:text-[#555] disabled:opacity-40 transition-colors mb-2"
        >
          {isTracing ? 'Simulating...' : traceSteps.length > 0 ? 'Re-run Simulation' : 'Simulate'}
        </Button>

        {traceSteps.length > 0 && !isTracing && (
          <Button
            onClick={handleClearTrace}
            className="w-full bg-transparent border border-[#2a2a2e] hover:border-[#ef4444] text-[#888] hover:text-[#ef4444] transition-colors"
          >
            Clear Simulation
          </Button>
        )}
      </div>

      {/* Sections Content */}
      <div className="flex-1 overflow-y-auto p-4 relative" style={{ scrollBehavior: 'smooth' }}>
        {!traceRouteId ? (
          /* Empty state when no route selected */
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <svg
              className="w-16 h-16 text-[#2a2a2e] mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <h3 className="text-[13px] text-[#888] font-semibold mb-2">Select an Entry Point</h3>
            <p className="text-[11px] text-[#555] leading-relaxed max-w-[240px]">
              Choose an entry point from the dropdown above to start simulating and exploring the
              trace flow
            </p>
          </div>
        ) : (
          <>
            {/* PARAMS SECTION — only for HTTP route_handlers with path params */}
            {isHttpEntry && routePathParams.length > 0 && (
              <CollapsibleSection
                title="PARAMS"
                isOpen={paramsOpen}
                onToggle={() => setParamsOpen(!paramsOpen)}
                badge={<span className="text-[#854F0B] ml-1.5">{routePathParams.length}</span>}
              >
                {routePathParams.map((param) => (
                  <div key={param} className="mb-2">
                    <div className="text-[9px] text-[#854F0B] mb-1 font-semibold tracking-wide">
                      :{param}
                    </div>
                    <input
                      type="text"
                      value={pathParams[param] || ''}
                      onChange={(e) =>
                        setPathParams((prev) => ({ ...prev, [param]: e.target.value }))
                      }
                      placeholder={`value for :${param}`}
                      className="w-full bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md px-2.5 py-2 text-[#ddd] text-[11px] outline-none box-border"
                    />
                  </div>
                ))}
              </CollapsibleSection>
            )}

            {/* INPUT SECTION — "BODY" for HTTP, "INPUT" for everything else */}
            <CollapsibleSection
              title={isHttpEntry ? 'BODY' : 'INPUT'}
              isOpen={bodyOpen}
              onToggle={() => setBodyOpen(!bodyOpen)}
            >
              <textarea
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder={isHttpEntry ? '{"action": "Generate", ...}' : '{"arg1": "value", ...}'}
                spellCheck={false}
                className="w-full min-h-[120px] bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md p-2.5 text-[#ddd] text-[11px] outline-none box-border resize-y leading-relaxed mb-1"
              />
            </CollapsibleSection>

            {/* INSPECTOR SECTION */}
            <div ref={inspectorRef}>
              <CollapsibleSection
                title="INSPECTOR"
                isOpen={inspectorOpen}
                onToggle={() => setInspectorOpen(!inspectorOpen)}
              >
                {!selectedNode ? (
                  <div className="text-[#555] text-[11px] text-center py-2 leading-relaxed">
                    No node selected
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-[13px] text-[#ddd] font-semibold">{selectedNode.name}</div>

                    <Field label="KIND">
                      <span
                        className="inline-block text-[9px] font-bold tracking-wide px-[7px] py-[3px] rounded"
                        style={{
                          background: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic)
                            .badgeBg,
                          color: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic)
                            .badgeText,
                        }}
                      >
                        {KIND_LABELS[selectedNode.kind] || selectedNode.kind.toUpperCase()}
                      </span>
                    </Field>

                    <Field label="DEFINED IN">{selectedNode.defined_in || '—'}</Field>
                    <Field label="INPUT">{selectedNode.input || '—'}</Field>
                    <Field label="OUTPUT">{selectedNode.output || '—'}</Field>

                    <Field label="MUTATES STATE">
                      <span
                        className="inline-block text-[9px] font-semibold px-2.5 py-[3px] rounded-xl border-[0.5px]"
                        style={{
                          background: selectedNode.mutates_state ? '#2d1a0a' : '#0d1f0d',
                          borderColor: selectedNode.mutates_state ? '#633806' : '#27500A',
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
                            <div key={i} className={i > 0 ? 'mt-2' : ''}>
                              <div className="text-[10px] text-[#378ADD] font-medium">
                                {nodeById(e.from)?.name || e.from}
                              </div>
                              {e.payload && (
                                <div className="text-[9px] text-[#666] mt-0.5">{e.payload}</div>
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
                            <div key={i} className={i > 0 ? 'mt-2' : ''}>
                              <div className="text-[10px] text-[#1D9E75] font-medium">
                                {nodeById(e.to)?.name || e.to}
                              </div>
                              {e.payload && (
                                <div className="text-[9px] text-[#666] mt-0.5">{e.payload}</div>
                              )}
                            </div>
                          ))}
                        </Field>
                      );
                    })()}
                  </div>
                )}
              </CollapsibleSection>
            </div>

            {/* TRACE FLOW SECTION */}
            <CollapsibleSection
              title="TRACE FLOW"
              isOpen={traceFlowOpen}
              onToggle={() => setTraceFlowOpen(!traceFlowOpen)}
              badge={
                traceSteps.length > 0 && (
                  <span className="text-[#378ADD] ml-1.5">{traceSteps.length}</span>
                )
              }
            >
              <div ref={traceFlowRef}>
                {traceSteps.length > 0 ? (
                  <>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-[10px] text-[#666] tracking-wider font-semibold">
                        <span className="text-[#555] tracking-normal">
                          {traceVisible} / {traceSteps.length} steps
                        </span>
                      </div>
                      {!isTracing &&
                        traceVisible > 0 &&
                        traceVisible === traceSteps.length &&
                        (traceSteps[traceSteps.length - 1]?.terminated ? (
                          <span className="bg-[#2e1a0a] text-[#ef9f27] px-2 py-0.5 rounded text-[10px] font-bold">
                            TERMINATED
                          </span>
                        ) : (
                          <span className="bg-[#0e2e0e] text-[#7ac97a] px-2 py-0.5 rounded text-[10px] font-bold">
                            DONE
                          </span>
                        ))}
                    </div>
                    {traceSteps.slice(0, traceVisible).map((step, i) => {
                      const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                      const isExpanded = expandedStep === i;
                      const rawInput =
                        stepInputEdits[i] ??
                        (step.inputPayload != null
                          ? JSON.stringify(step.inputPayload, null, 2)
                          : '');
                      const hasPayloads = step.inputPayload != null || step.outputPayload != null;
                      return (
                        <div
                          key={i}
                          id={`trace-step-${i}`}
                          className="mb-1"
                          style={{
                            animation: 'fadeInBlur 0.4s ease-out',
                            animationFillMode: 'both',
                          }}
                        >
                          {i > 0 && step.edgeLabel && (
                            <div className="flex items-center gap-2 py-1 pl-4">
                              <div className="w-0 h-0 border-l-4 border-l-[#378ADD] border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent" />
                              <span className="text-[9px] text-[#666] italic">
                                {step.edgeLabel}
                              </span>
                            </div>
                          )}
                          {i > 0 && !step.edgeLabel && (
                            <div className="flex items-center gap-2 py-1 pl-4">
                              <div className="w-0 h-0 border-l-4 border-l-[#378ADD] border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent" />
                            </div>
                          )}
                          <div
                            className="bg-[#111114] rounded-md p-3 transition-colors relative"
                            style={{
                              border: `0.5px solid ${isExpanded ? colors.border + '88' : colors.border + '33'}`,
                            }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div
                                className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                                style={{ background: colors.badgeBg, color: colors.badgeText }}
                              >
                                {KIND_LABELS[step.kind] || step.kind.toUpperCase()}
                              </div>
                              <span className="text-[10px] text-[#bbb] font-medium">
                                {step.name}
                              </span>
                              <div className="ml-auto flex items-center gap-1.5">
                                {hasPayloads && (
                                  <button
                                    onClick={() => setExpandedStep(isExpanded ? null : i)}
                                    className="text-[8px] px-1.5 py-0.5 rounded border-[0.5px] border-[#2a2a2e] text-[#555] hover:text-[#378ADD] hover:border-[#378ADD] transition-colors bg-transparent cursor-pointer"
                                    title={isExpanded ? 'Hide I/O' : 'Inspect I/O'}
                                  >
                                    {isExpanded ? '▲ I/O' : '▼ I/O'}
                                  </button>
                                )}
                                <div className="w-5 h-5 shrink-0 rounded-full bg-[#378ADD] flex items-center justify-center text-[9px] font-bold text-white shadow-sm ring-1 ring-black/20">
                                  {i + 1}
                                </div>
                              </div>
                            </div>
                            {step.description && (
                              <div className="text-[9px] text-[#666] leading-relaxed">
                                {step.description}
                              </div>
                            )}
                            {step.terminated && (
                              <div className="mt-1.5 flex items-center gap-1.5 bg-[#2e1a0a] border border-[#633806] rounded px-2 py-1">
                                <span className="text-[9px] font-bold text-[#ef9f27]">
                                  CHAIN STOPPED
                                </span>
                                {step.terminatedReason && (
                                  <span className="text-[8px] text-[#b87a1a]">
                                    — {step.terminatedReason}
                                  </span>
                                )}
                              </div>
                            )}
                            {isExpanded && (
                              <div className="mt-2.5 space-y-2">
                                {step.inputPayload != null && (
                                  <div>
                                    <div className="text-[8px] text-[#555] tracking-wider font-semibold mb-1">
                                      INPUT
                                    </div>
                                    <textarea
                                      value={rawInput}
                                      onChange={(e) =>
                                        setStepInputEdits((prev) => ({
                                          ...prev,
                                          [i]: e.target.value,
                                        }))
                                      }
                                      spellCheck={false}
                                      className="w-full min-h-[80px] bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded px-2 py-1.5 text-[10px] text-[#ccc] font-mono outline-none resize-y leading-relaxed box-border"
                                    />
                                    {stepInputEdits[i] != null && (
                                      <button
                                        onClick={() => {
                                          try {
                                            const parsed = JSON.parse(stepInputEdits[i]);
                                            rerunFromStep(i, step.nodeId, parsed);
                                            // Clear stale edits for this step and all later steps
                                            setStepInputEdits((prev) => {
                                              const n = { ...prev };
                                              Object.keys(n).forEach((k) => {
                                                if (Number(k) >= i) delete n[Number(k)];
                                              });
                                              return n;
                                            });
                                            // Keep panel open so user sees the updated input/output
                                          } catch {
                                            /* invalid JSON */
                                          }
                                        }}
                                        className="mt-1 w-full bg-[#378ADD] hover:bg-[#4a9bef] text-white text-[9px] font-semibold py-1 rounded cursor-pointer border-none transition-colors"
                                      >
                                        Run from step {i + 1}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {step.outputPayload != null && (
                                  <div>
                                    <div className="text-[8px] text-[#555] tracking-wider font-semibold mb-1">
                                      OUTPUT{' '}
                                      <span className="text-[#333] normal-case tracking-normal font-normal">
                                        (precomputed)
                                      </span>
                                    </div>
                                    <pre className="bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded px-2 py-1.5 text-[10px] text-[#aaa] font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                                      {JSON.stringify(step.outputPayload, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="text-[#555] text-[11px] text-center my-4 leading-relaxed">
                    No trace available
                    <br />
                    Run a simulation first
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </>
        )}
      </div>

      {/* Back button */}
      <div className="p-2 border-t border-[#2a2a2e]">
        <button
          onClick={() => {
            if (setIsGraphUnloading) {
              setIsGraphUnloading(true);
              setTimeout(() => {
                setGraph(null);
                setSelectedId(null);
                setError(null);
                clearTrace();
                localStorage.removeItem(STORAGE_KEYS.GRAPH);
                localStorage.removeItem(STORAGE_KEYS.GITHUB_URL);
              }, 400);
            } else {
              setGraph(null);
              setSelectedId(null);
              setError(null);
              clearTrace();
              localStorage.removeItem(STORAGE_KEYS.GRAPH);
              localStorage.removeItem(STORAGE_KEYS.GITHUB_URL);
            }
          }}
          className="w-full bg-transparent border border-[#2a2a2e] rounded-md py-2 text-[#666] text-[10px] cursor-pointer hover:border-[#378ADD] hover:text-[#888] transition-colors"
        >
          &larr; Scan different file
        </button>
      </div>
    </div>
  );
}
