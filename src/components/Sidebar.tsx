"use client";

import type { ComponentNode, PayloadEdge } from "@/lib/schema";

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
}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#555", marginBottom: 3, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ background: "#0a0a0c", border: "0.5px solid #1a1a1c", borderRadius: 5, padding: "6px 8px", fontSize: 11, color: "#bbb", wordBreak: "break-word" }}>{children}</div>
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
    setTraceMethod,
    clearTrace,
    setSelectedId,
    routePathParams,
    pathParams,
    setPathParams,
    reqBody,
    setReqBody,
    activeReqTab,
    setActiveReqTab,
    runSimulation,
    isTracing,
    traceSteps,
    traceVisible,
    selectedNode,
    coreEdges,
    nodeById,
    setGraph,
    setError,
  } = props;

  return (
    <div
      style={{
        width,
        minWidth: 200,
        maxWidth: 600,
        borderRight: "0.5px solid #1a1a1c",
        background: "#111114",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Simulate */}
      <div style={{ padding: "14px 14px 12px", borderBottom: "0.5px solid #1a1a1c" }}>
        <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginBottom: 10 }}>SIMULATE</div>

        {/* Method + Route */}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <div style={{ background: "#0d0d0f", border: "0.5px solid #222", borderRadius: 4, padding: "5px 8px", color: traceMethod === "GET" ? "#3B6D11" : traceMethod === "POST" ? "#854F0B" : traceMethod === "DELETE" ? "#993C1D" : "#534AB7", fontFamily: "inherit", fontSize: 10, fontWeight: 700, width: 42, textAlign: "center", flexShrink: 0 }}>
            {traceMethod}
          </div>
          <select value={traceRouteId || ""} onChange={(e) => { setTraceRouteId(e.target.value || null); clearTrace(); setSelectedId(e.target.value || null); }}
            style={{ flex: 1, background: "#0d0d0f", border: "0.5px solid #222", borderRadius: 4, padding: "5px 8px", color: "#aaa", fontFamily: "inherit", fontSize: 10, outline: "none", cursor: "pointer" }}
          >
            <option value="">select route...</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.path_pattern || r.name}</option>)}
          </select>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 8, borderBottom: "0.5px solid #222" }}>
          {(["params", "body"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveReqTab(tab)}
              style={{ flex: 1, background: "transparent", border: "none", borderBottom: activeReqTab === tab ? "2px solid #378ADD" : "2px solid transparent", padding: "6px 0", color: activeReqTab === tab ? "#bbb" : "#555", fontFamily: "inherit", fontSize: 9, fontWeight: activeReqTab === tab ? 600 : 400, letterSpacing: 0.5, cursor: "pointer", textTransform: "uppercase" }}
            >
              {tab}{tab === "params" && routePathParams.length > 0 && <span style={{ color: "#854F0B", marginLeft: 3 }}>{routePathParams.length}</span>}
            </button>
          ))}
        </div>

        {/* Params */}
        {activeReqTab === "params" && (
          <div style={{ marginBottom: 8 }}>
            {routePathParams.length === 0 ? (
              <div style={{ fontSize: 10, color: "#444", padding: "8px 0", textAlign: "center" }}>
                {traceRouteId ? "No path parameters" : "Select a route first"}
              </div>
            ) : routePathParams.map((param) => (
              <div key={param} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: "#854F0B", marginBottom: 2, fontWeight: 600 }}>:{param}</div>
                <input type="text" value={pathParams[param] || ""} onChange={(e) => setPathParams((prev) => ({ ...prev, [param]: e.target.value }))}
                  placeholder={`value for :${param}`}
                  style={{ width: "100%", background: "#0a0a0c", border: "0.5px solid #222", borderRadius: 4, padding: "5px 8px", color: "#ccc", fontFamily: "inherit", fontSize: 11, outline: "none", boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        {activeReqTab === "body" && (
          <div style={{ marginBottom: 8 }}>
            <textarea value={reqBody} onChange={(e) => setReqBody(e.target.value)} placeholder='{"action": "Generate", ...}' spellCheck={false}
              style={{ width: "100%", minHeight: 100, background: "#0a0a0c", border: "0.5px solid #222", borderRadius: 4, padding: "8px", color: "#ccc", fontFamily: "inherit", fontSize: 11, outline: "none", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5 }}
            />
          </div>
        )}

        {/* Simulate button */}
        <button onClick={runSimulation} disabled={!traceRouteId || isTracing}
          style={{ width: "100%", background: isTracing ? "#1a1a1e" : "#185FA5", border: "none", borderRadius: 5, padding: "8px 0", color: isTracing ? "#555" : "#fff", fontFamily: "inherit", fontSize: 11, fontWeight: 600, cursor: !traceRouteId || isTracing ? "default" : "pointer", opacity: !traceRouteId ? 0.4 : 1, letterSpacing: 0.5 }}
        >{isTracing ? "Simulating..." : "Simulate"}</button>

        {/* Trace status */}
        {traceSteps.length > 0 && !isTracing && (
          <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 10, alignItems: "center" }}>
            <span style={{ background: "#0e2e0e", color: "#7ac97a", padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 10 }}>DONE</span>
            <span style={{ color: "#555" }}>{traceSteps.length} steps</span>
            <button onClick={clearTrace} style={{ marginLeft: "auto", background: "none", border: "none", color: "#555", fontFamily: "inherit", fontSize: 9, cursor: "pointer", textDecoration: "underline" }}>clear</button>
          </div>
        )}
      </div>

      {/* Inspector / Trace flow */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {traceSteps.length > 0 ? (
          <>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginBottom: 10 }}>
              TRACE FLOW
              <span style={{ color: "#444", marginLeft: 6, letterSpacing: 0 }}>{traceVisible} / {traceSteps.length} steps</span>
            </div>
            {traceSteps.slice(0, traceVisible).map((step, i) => {
              const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
              return (
                <div key={i} style={{ marginBottom: 2 }}>
                  {i > 0 && step.edgeLabel && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0 4px 16px" }}>
                      <div style={{ width: 0, height: 0, borderLeft: "4px solid #378ADD", borderTop: "3px solid transparent", borderBottom: "3px solid transparent" }} />
                      <span style={{ fontSize: 9, color: "#555", fontStyle: "italic" }}>{step.edgeLabel}</span>
                    </div>
                  )}
                  {i > 0 && !step.edgeLabel && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0 4px 16px" }}>
                      <div style={{ width: 0, height: 0, borderLeft: "4px solid #378ADD", borderTop: "3px solid transparent", borderBottom: "3px solid transparent" }} />
                    </div>
                  )}
                  <div style={{ background: "#0a0a0c", border: `0.5px solid ${colors.border}33`, borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <div style={{ fontSize: 8, background: colors.badgeBg, color: colors.badgeText, padding: "1px 4px", borderRadius: 2, fontWeight: 700 }}>
                        {KIND_LABELS[step.kind] || step.kind.toUpperCase()}
                      </div>
                      <span style={{ fontSize: 10, color: "#bbb", fontWeight: 500 }}>{step.name}</span>
                    </div>
                    {step.description && (
                      <div style={{ fontSize: 9, color: "#666", lineHeight: 1.4 }}>{step.description}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, marginBottom: 8 }}>INSPECTOR</div>
            {!selectedNode ? (
              <div style={{ color: "#333", fontSize: 11, textAlign: "center", marginTop: 60, lineHeight: 1.6 }}>
                Click any node to inspect<br />its payload, mutations,<br />and connections
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: "#ddd", fontWeight: 600 }}>{selectedNode.name}</div>

                <Field label="KIND">
                  <span style={{ display: "inline-block", background: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeBg, color: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeText, fontSize: 9, fontWeight: 700, letterSpacing: 0.8, padding: "2px 6px", borderRadius: 3 }}>
                    {KIND_LABELS[selectedNode.kind] || selectedNode.kind.toUpperCase()}
                  </span>
                </Field>

                <Field label="DEFINED IN">{selectedNode.defined_in || "—"}</Field>
                <Field label="INPUT">{selectedNode.input || "—"}</Field>
                <Field label="OUTPUT">{selectedNode.output || "—"}</Field>

                <Field label="MUTATES STATE">
                  <span style={{ display: "inline-block", fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: selectedNode.mutates_state ? "#2d1a0a" : "#0d1f0d", border: selectedNode.mutates_state ? "0.5px solid #633806" : "0.5px solid #27500A", color: selectedNode.mutates_state ? "#EF9F27" : "#639922" }}>
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
                        <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>
                          <div style={{ fontSize: 10, color: "#378ADD" }}>{nodeById(e.from)?.name || e.from}</div>
                          {e.payload && <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>{e.payload}</div>}
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
                          <div style={{ fontSize: 10, color: "#1D9E75" }}>{nodeById(e.to)?.name || e.to}</div>
                          {e.payload && <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>{e.payload}</div>}
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
      <div style={{ padding: "10px 14px", borderTop: "0.5px solid #1a1a1c" }}>
        <button onClick={() => { setGraph(null); setSelectedId(null); setError(null); clearTrace(); }}
          style={{ width: "100%", background: "transparent", border: "0.5px solid #222", borderRadius: 5, padding: "6px 0", color: "#555", fontFamily: "inherit", fontSize: 10, cursor: "pointer" }}
        >&larr; load different file</button>
      </div>
    </div>
  );
}
