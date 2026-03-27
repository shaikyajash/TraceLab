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
  const errorRef = useRef<HTMLDivElement>(null);

  const selectedEntryNode = traceRouteId ? nodeById(traceRouteId) : undefined;
  const isHttpEntry = selectedEntryNode?.kind === 'route_handler';

  const handleSimulate = () => {
    runSimulation();
    setTraceFlowOpen(true);
    setInspectorOpen(false);
    setParamsOpen(false);
    setBodyOpen(false);
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

  // Clear error state when input is edited
  const handleInputEdit = (stepIndex: number, value: string) => {
    setStepInputEdits((prev) => ({
      ...prev,
      [stepIndex]: value,
    }));
    // Clear terminated flag for this step when user edits input
    if (traceSteps[stepIndex]) {
      traceSteps[stepIndex].terminated = false;
    }
  };

  // Auto-set expandedStep when selecting a node that exists in trace
  useEffect(() => {
    if (selectedNode && traceSteps.length > 0) {
      // Find the latest step for this node in the trace
      const stepIndex = traceSteps.findLastIndex((step) => step.nodeId === selectedNode.id);
      if (stepIndex !== -1 && stepIndex !== expandedStep) {
        setExpandedStep(stepIndex);
      } else if (stepIndex === -1 && expandedStep !== null) {
        // Node not in trace, clear expandedStep
        setExpandedStep(null);
      }
    }
  }, [selectedNode, traceSteps]);

  // Expand Inspector and scroll when a node is selected
  useEffect(() => {
    if (selectedNode && !isTracing) {
      setInspectorOpen(true);

      // Scroll to inspector or error
      setTimeout(() => {
        if (expandedStep !== null && traceSteps[expandedStep]?.terminated && errorRef.current) {
          errorRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        } else {
          inspectorRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }, 310);
    }
  }, [selectedNode, isTracing, expandedStep]);

  // Collapse params/body if they're empty when route changes
  useEffect(() => {
    if (traceRouteId) {
      setParamsOpen(routePathParams.length > 0);
      setBodyOpen(reqBody.trim() !== '' && reqBody.trim() !== '{\n  \n}');
    }
  }, [traceRouteId, routePathParams.length, reqBody]);

  // Auto-scroll to latest step in Trace Flow during and after simulation
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
      }, 100);
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
          <>
            {/* PARAMS SECTION */}
            <CollapsibleSection
              title="PARAMS"
              isOpen={false}
              onToggle={() => setParamsOpen(!paramsOpen)}
            >
              <div className="text-[11px] text-[#555] py-2 text-center">No route selected</div>
            </CollapsibleSection>

            {/* BODY SECTION */}
            <CollapsibleSection title="BODY" isOpen={false} onToggle={() => setBodyOpen(!bodyOpen)}>
              <textarea
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder='{"action": "Generate", ...}'
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
              title={
                <div className="flex items-center gap-2">
                  <span>TRACE FLOW</span>
                </div>
              }
              isOpen={false}
              onToggle={() => setTraceFlowOpen(!traceFlowOpen)}
            >
              <div className="text-[#555] text-[11px] text-center my-4 leading-relaxed">
                No trace available
                <br />
                Run a simulation first
              </div>
            </CollapsibleSection>
          </>
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

                    {/* Input editor — keyed by step index so each step is independently editable */}
                    {expandedStep !== null && (
                      <div>
                        <Field label="INPUT">
                          <textarea
                            value={
                              stepInputEdits[expandedStep] ??
                              (traceSteps[expandedStep]?.inputPayload != null
                                ? JSON.stringify(traceSteps[expandedStep].inputPayload, null, 2)
                                : '{}')
                            }
                            onChange={(e) => {
                              setStepInputEdits((prev) => ({
                                ...prev,
                                [expandedStep]: e.target.value,
                              }));
                            }}
                            placeholder="Edit input JSON and click Run to recompute..."
                            spellCheck={false}
                            className="w-full min-h-[100px] bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded px-2.5 py-2 text-[10px] text-[#ccc] font-mono outline-none resize-y leading-relaxed box-border mt-1"
                          />
                        </Field>
                        <Button
                          onClick={() => {
                            try {
                              const inputToUse =
                                stepInputEdits[expandedStep] ??
                                JSON.stringify(traceSteps[expandedStep].inputPayload);
                              const parsed = JSON.parse(inputToUse);
                              rerunFromStep(expandedStep, traceSteps[expandedStep].nodeId, parsed);
                              // Clear edits for this step and all later steps
                              setStepInputEdits((prev) => {
                                const n = { ...prev };
                                for (const k of Object.keys(n)) {
                                  if (Number(k) >= expandedStep) delete n[Number(k)];
                                }
                                return n;
                              });
                            } catch (err) {
                              console.error('Failed to parse input JSON:', err);
                            }
                          }}
                          className="w-full bg-[#378ADD] hover:bg-[#4a9bef] text-white text-[10px] font-semibold mt-2"
                        >
                          Save & Check
                        </Button>
                      </div>
                    )}

                    {/* Show step I/O if we have an expanded step with actual runtime data */}
                    {expandedStep !== null && traceSteps[expandedStep] && (
                      <>
                        {traceSteps[expandedStep].outputPayload != null && (
                          <Field label="OUTPUT">
                            <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                              {JSON.stringify(traceSteps[expandedStep].outputPayload, null, 2)}
                            </pre>
                          </Field>
                        )}
                        {traceSteps[expandedStep].terminated && (
                          <div
                            ref={errorRef}
                            className="flex items-center gap-2 bg-[#2e1a0a] border border-[#633806] rounded px-2.5 py-1.5"
                          >
                            <span className="text-[10px] font-bold text-[#ef9f27]">
                              CHAIN STOPPED
                            </span>
                            {traceSteps[expandedStep].terminatedReason && (
                              <span className="text-[9px] text-[#b87a1a]">
                                — {traceSteps[expandedStep].terminatedReason}
                              </span>
                            )}
                          </div>
                        )}
                      </>
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
              title={
                <div className="flex items-center gap-2">
                  <span>TRACE FLOW</span>
                  {traceSteps.length > 0 && (
                    <span
                      className={`tracking-normal ${
                        traceSteps.some((s) => s.terminated)
                          ? 'text-[#f59e0b]'
                          : !isTracing && traceVisible > 0 && traceVisible === traceSteps.length
                            ? 'text-[#378ADD]'
                            : 'text-[#555]'
                      }`}
                    >
                      {traceVisible} / {traceSteps.length}
                    </span>
                  )}
                </div>
              }
              isOpen={traceFlowOpen}
              onToggle={() => setTraceFlowOpen(!traceFlowOpen)}
            >
              <div ref={traceFlowRef}>
                {traceSteps.length > 0 ? (
                  <>
                    {traceSteps.slice(0, traceVisible).map((step, i) => {
                      const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                      return (
                        <div
                          key={i}
                          id={`trace-step-${i}`}
                          className="relative mb-3 mt-5"
                          style={{
                            animation: 'fadeInBlur 0.4s ease-out',
                            animationFillMode: 'both',
                          }}
                        >
                          {/* Connector line */}
                          {i > 0 && (
                            <div className="flex flex-col items-center py-1.5">
                              <div className="w-[2px] h-4 bg-gradient-to-b from-[#378ADD] to-[#378ADD]/30" />
                              {step.edgeLabel && (
                                <span className="text-[9px] text-[#666] italic font-medium mt-1">
                                  {step.edgeLabel}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Step card with bubble on top */}
                          <div className="relative pt-2">
                            {/* Step number bubble - centered on top edge, more inside */}
                            <div
                              className={`absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] text-white ${
                                step.terminated ? 'bg-[#f59e0b]' : 'bg-[#378ADD]'
                              }`}
                            >
                              {i + 1}
                            </div>
                            {/* Step content card */}
                            <div
                              className="bg-[#111114] rounded-lg p-2.5 transition-all hover:bg-[#0d0d0f] hover:shadow-lg cursor-pointer"
                              style={{
                                border: step.terminated
                                  ? `1px solid #ef9f27`
                                  : `1px solid ${colors.border}40`,
                              }}
                              onClick={() => {
                                const node = nodeById(step.nodeId);
                                if (node) {
                                  setSelectedId(step.nodeId);
                                  setInspectorOpen(true);
                                  setExpandedStep(i);
                                  setTimeout(() => {
                                    // If this step has an error, scroll to error, otherwise scroll to inspector
                                    if (step.terminated && errorRef.current) {
                                      errorRef.current.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'center',
                                      });
                                    } else {
                                      inspectorRef.current?.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'start',
                                      });
                                    }
                                  }, 100);
                                }
                              }}
                            >
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <div
                                  className="text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"
                                  style={{ background: colors.badgeBg, color: colors.badgeText }}
                                >
                                  {KIND_LABELS[step.kind] || step.kind}
                                </div>
                                <span className="text-[10px] text-[#ddd] font-semibold flex-1 truncate">
                                  {step.name}
                                </span>
                              </div>
                              {step.description && !step.description.includes('CHAIN STOP') && (
                                <div className="text-[10px] text-[#888] leading-relaxed">
                                  {step.description}
                                </div>
                              )}
                            </div>
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
