"use client";

import React from "react";
import type { ComponentNode, PayloadEdge } from "@/types";
import { KIND_COLORS, KIND_LABELS } from "@/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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
  setPathParams: (params: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  reqBody: string;
  setReqBody: (body: string) => void;
  activeReqTab: "params" | "body";
  setActiveReqTab: (tab: "params" | "body") => void;
  runSimulation: () => void;
  isTracing: boolean;
  traceSteps: any[];
  traceVisible: number;
  selectedNode: ComponentNode | null | undefined;
  coreEdges: PayloadEdge[];
  nodeById: (id: string) => ComponentNode | undefined;
  setGraph: (graph: any) => void;
  setError: (error: string | null) => void;
  mainTab?: "request" | "trace";
  setMainTab?: (tab: "request" | "trace") => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-[#666] mb-1 tracking-wide font-medium">{label}</div>
      <div className="bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded-md px-2.5 py-2 text-[11px] text-[#bbb] wrap-break-word leading-relaxed">{children}</div>
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
    mainTab: externalMainTab,
    setMainTab: externalSetMainTab,
  } = props;

  const [internalMainTab, setInternalMainTab] = React.useState<"request" | "trace">("request");
  const mainTab = externalMainTab ?? internalMainTab;
  const setMainTab = externalSetMainTab ?? setInternalMainTab;

  const [paramsOpen, setParamsOpen] = React.useState(true);
  const [bodyOpen, setBodyOpen] = React.useState(true);
  const [inspectorOpen, setInspectorOpen] = React.useState(true);

  const traceFlowRef = React.useRef<HTMLDivElement>(null);

  const handleSimulate = () => {
    runSimulation();
    setMainTab("trace");
  };

  // Auto-scroll to latest step
  React.useEffect(() => {
    if (mainTab === "trace" && traceFlowRef.current && traceVisible > 0) {
      traceFlowRef.current.scrollTo({
        top: traceFlowRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [traceVisible, mainTab]);

  return (
    <div
      className="min-w-[200px] max-w-[600px] border-r-[0.5px] border-[#2a2a2e] bg-[#0d0d0f] flex flex-col overflow-hidden shrink-0"
      style={{ width }}
    >
      {/* Simulate */}
      <div className="p-4 border-b-[0.5px] border-[#2a2a2e]">
        <div className="text-[10px] text-[#666] tracking-[1.2px] mb-3 font-semibold">SIMULATE</div>

        {/* Method + Route */}
        <div className="flex gap-1.5 mb-2.5">
          <div 
            className="bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md px-2 py-2 font-bold text-[10px] w-12 text-center shrink-0"
            style={{ color: traceMethod === "GET" ? "#3B6D11" : traceMethod === "POST" ? "#854F0B" : traceMethod === "DELETE" ? "#993C1D" : "#534AB7" }}
          >
            {traceMethod}
          </div>
          <Select value={traceRouteId || ""} onValueChange={(value: string) => { setTraceRouteId(value || null); clearTrace(); setSelectedId(value || null); }}>
            <SelectTrigger className="flex-1 bg-[#111114] border-[#2a2a2e] h-auto py-2 px-3 text-white text-[11px] hover:border-[#378ADD] focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="select route..." className="text-white" />
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
                  className="text-[11px] text-white hover:bg-[#378ADD] hover:text-white focus:bg-[#378ADD] focus:text-white cursor-pointer data-highlighted:bg-[#378ADD] data-highlighted:text-white"
                >
                  {r.path_pattern || r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Simulate button */}
        <Button 
          onClick={traceSteps.length > 0 && !isTracing ? clearTrace : handleSimulate} 
          disabled={!traceRouteId || isTracing}
          className="w-full bg-[#378ADD] hover:bg-[#4a9bef] text-white disabled:bg-[#1a1a1e] disabled:text-[#555] disabled:opacity-40"
        >
          {isTracing ? "Simulating..." : traceSteps.length > 0 ? "Clear Simulation" : "Simulate"}
        </Button>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-0 border-b-[0.5px] border-[#2a2a2e]">
        {(["request", "trace"] as const).map((tab) => (
          <button 
            key={tab} 
            onClick={() => setMainTab(tab)}
            className="flex-1 bg-transparent border-none px-0 py-3 font-normal text-[10px] tracking-wide cursor-pointer uppercase transition-colors"
            style={{ 
              borderBottom: mainTab === tab ? "2px solid #378ADD" : "2px solid transparent",
              color: mainTab === tab ? "#ddd" : "#666",
              fontWeight: mainTab === tab ? 600 : 400,
            }}
          >
            {tab === "request" ? "Request" : "Trace Flow"}
            {tab === "trace" && traceSteps.length > 0 && <span className="text-[#378ADD] ml-1">{traceSteps.length}</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div ref={traceFlowRef} className="flex-1 overflow-y-auto p-4">
        {mainTab === "request" ? (
          <>
            {/* Params Section */}
            <div className="mb-4">
              <button
                onClick={() => setParamsOpen(!paramsOpen)}
                className="w-full flex items-center justify-between bg-transparent border-none py-2 cursor-pointer"
              >
                <div className="text-[10px] text-[#666] tracking-[1.2px] font-semibold">
                  PARAMS
                  {routePathParams.length > 0 && <span className="text-[#854F0B] ml-1.5">{routePathParams.length}</span>}
                </div>
                <svg 
                  className="w-3 h-3 text-[#666] transition-transform duration-200"
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                  style={{ transform: paramsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {paramsOpen && (
                <div className="mt-2.5">
                  {routePathParams.length === 0 ? (
                    <div className="text-[11px] text-[#555] py-4 text-center">
                      {traceRouteId ? "No path parameters" : "Select a route first"}
                    </div>
                  ) : routePathParams.map((param) => (
                    <div key={param} className="mb-2">
                      <div className="text-[9px] text-[#854F0B] mb-1 font-semibold tracking-wide">:{param}</div>
                      <input 
                        type="text" 
                        value={pathParams[param] || ""} 
                        onChange={(e) => setPathParams((prev) => ({ ...prev, [param]: e.target.value }))}
                        placeholder={`value for :${param}`}
                        className="w-full bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md px-2.5 py-2 text-[#ddd] text-[11px] outline-none box-border"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Body Section */}
            <div className="mb-4">
              <button
                onClick={() => setBodyOpen(!bodyOpen)}
                className="w-full flex items-center justify-between bg-transparent border-none py-2 cursor-pointer"
              >
                <div className="text-[10px] text-[#666] tracking-[1.2px] font-semibold">BODY</div>
                <svg 
                  className="w-3 h-3 text-[#666] transition-transform duration-200"
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                  style={{ transform: bodyOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {bodyOpen && (
                <div className="mt-2.5">
                  <textarea 
                    value={reqBody} 
                    onChange={(e) => setReqBody(e.target.value)} 
                    placeholder='{"action": "Generate", ...}' 
                    spellCheck={false}
                    className="w-full min-h-[120px] bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md p-2.5 text-[#ddd] text-[11px] outline-none box-border resize-y leading-relaxed"
                  />
                </div>
              )}
            </div>

            {/* Inspector Section */}
            {selectedNode && (
              <div className="mb-4">
                <button
                  onClick={() => setInspectorOpen(!inspectorOpen)}
                  className="w-full flex items-center justify-between bg-transparent border-none py-2 cursor-pointer"
                >
                  <div className="text-[10px] text-[#666] tracking-[1.2px] font-semibold">INSPECTOR</div>
                  <svg 
                    className="w-3 h-3 text-[#666] transition-transform duration-200"
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                    style={{ transform: inspectorOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {inspectorOpen && (
                  <div className="mt-2.5 space-y-3">
                    <div className="text-[13px] text-[#ddd] font-semibold">{selectedNode.name}</div>

                      <Field label="KIND">
                        <span 
                          className="inline-block text-[9px] font-bold tracking-wide px-[7px] py-[3px] rounded"
                          style={{ 
                            background: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeBg, 
                            color: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeText 
                          }}
                        >
                          {KIND_LABELS[selectedNode.kind] || selectedNode.kind.toUpperCase()}
                        </span>
                      </Field>

                      <Field label="DEFINED IN">{selectedNode.defined_in || "—"}</Field>
                      <Field label="INPUT">{selectedNode.input || "—"}</Field>
                      <Field label="OUTPUT">{selectedNode.output || "—"}</Field>

                      <Field label="MUTATES STATE">
                        <span 
                          className="inline-block text-[9px] font-semibold px-2.5 py-[3px] rounded-xl border-[0.5px]"
                          style={{ 
                            background: selectedNode.mutates_state ? "#2d1a0a" : "#0d1f0d",
                            borderColor: selectedNode.mutates_state ? "#633806" : "#27500A",
                            color: selectedNode.mutates_state ? "#EF9F27" : "#639922"
                          }}
                        >
                          {selectedNode.mutates_state ? "YES" : "NO"}
                        </span>
                      </Field>

                      {selectedNode.description && <Field label="DESCRIPTION">{selectedNode.description}</Field>}

                      {(() => {
                        const inEdges = coreEdges.filter((e) => e.to === selectedNode.id);
                        if (inEdges.length === 0) return null;
                        return (
                          <Field label={`RECEIVES FROM (${inEdges.length})`}>
                            {inEdges.map((e, i) => (
                              <div key={i} className={i > 0 ? "mt-2" : ""}>
                                <div className="text-[10px] text-[#378ADD] font-medium">{nodeById(e.from)?.name || e.from}</div>
                                {e.payload && <div className="text-[9px] text-[#666] mt-0.5">{e.payload}</div>}
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
                              <div key={i} className={i > 0 ? "mt-2" : ""}>
                                <div className="text-[10px] text-[#1D9E75] font-medium">{nodeById(e.to)?.name || e.to}</div>
                                {e.payload && <div className="text-[9px] text-[#666] mt-0.5">{e.payload}</div>}
                              </div>
                            ))}
                          </Field>
                        );
                      })()}
                    </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Trace Flow Tab */}
            {traceSteps.length > 0 ? (
              <>
                <div className="text-[10px] text-[#666] tracking-wider mb-3 font-semibold">
                  TRACE FLOW
                  <span className="text-[#555] ml-2 tracking-normal">{traceVisible} / {traceSteps.length} steps</span>
                </div>
                {!isTracing && (
                  <div className="mb-3 flex gap-3 text-[10px] items-center">
                    <span className="bg-[#0e2e0e] text-[#7ac97a] px-2 py-0.5 rounded font-bold">DONE</span>
                    <button onClick={clearTrace} className="ml-auto bg-transparent border-none text-[#666] text-[9px] cursor-pointer underline hover:text-[#888]">clear</button>
                  </div>
                )}
                {traceSteps.slice(0, traceVisible).map((step, i) => {
                  const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                  return (
                    <div key={i} className="mb-1">
                      {i > 0 && step.edgeLabel && (
                        <div className="flex items-center gap-2 py-1 pl-4">
                          <div className="w-0 h-0 border-l-4 border-l-[#378ADD] border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent" />
                          <span className="text-[9px] text-[#666] italic">{step.edgeLabel}</span>
                        </div>
                      )}
                      {i > 0 && !step.edgeLabel && (
                        <div className="flex items-center gap-2 py-1 pl-4">
                          <div className="w-0 h-0 border-l-4 border-l-[#378ADD] border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent" />
                        </div>
                      )}
                      <div 
                        className="bg-[#111114] rounded-md p-3 hover:bg-[#14141a] transition-colors"
                        style={{ border: `0.5px solid ${colors.border}33` }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div 
                            className="text-[8px] px-1.5 py-0.5 rounded font-bold"
                            style={{ background: colors.badgeBg, color: colors.badgeText }}
                          >
                            {KIND_LABELS[step.kind] || step.kind.toUpperCase()}
                          </div>
                          <span className="text-[10px] text-[#bbb] font-medium">{step.name}</span>
                        </div>
                        {step.description && (
                          <div className="text-[9px] text-[#666] leading-relaxed">{step.description}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="text-[#444] text-[11px] text-center mt-16 leading-relaxed">
                No trace available<br />Run a simulation first
              </div>
            )}
          </>
        )}
      </div>

      {/* Back button */}
      <div className="p-4 border-t border-[#2a2a2e]">
        <button 
          onClick={() => { setGraph(null); setSelectedId(null); setError(null); clearTrace(); }}
          className="w-full bg-transparent border border-[#2a2a2e] rounded-md py-2 text-[#666] text-[10px] cursor-pointer hover:border-[#378ADD] hover:text-[#888] transition-colors"
        >
          &larr; load different file
        </button>
      </div>
    </div>
  );
}
