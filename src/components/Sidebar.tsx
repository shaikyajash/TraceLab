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
  runSimulationFromNode?: (nodeId: string, inputPayload: unknown) => Promise<void>;
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
  resumeSimulation?: () => void;
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

// ── Validation helpers (mirrors simulation.ts logic, runs client-side) ──────────

function getFieldValue(payload: unknown, field: string): unknown {
  const parts = field.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (typeof current === 'string') {
      const t = current.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { current = JSON.parse(t); } catch { return undefined; }
      } else return undefined;
    }
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getActualType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

interface CheckResult {
  ok: boolean;
  // schema-level error
  schemaError?: { field: string; message: string; status?: number | string };
  // output_cases result
  matchedCase?: { explanation?: string; terminates?: boolean };
  noMatchDiagnostics?: string[];
}

/**
 * Run the same validation logic as simulation.ts against the node's
 * input_schema and output_cases, purely client-side, so "Save & Check"
 * gives immediate feedback without waiting for rerunFromStep to settle.
 */
function checkInputAgainstNode(input: unknown, node: ComponentNode): CheckResult {
  // 1. input_schema validation
  if (node.input_schema && node.input_schema.length > 0) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return {
        ok: false,
        schemaError: {
          field: '(root)',
          message: `Expected a JSON object, got ${getActualType(input)}`,
        },
      };
    }
    for (const fieldDef of node.input_schema) {
      const value = getFieldValue(input, fieldDef.field);
      const label = fieldDef.description || fieldDef.field;
      const srcError = fieldDef.error_message;
      const status = fieldDef.error_status;

      if (fieldDef.required && (value === undefined || value === null)) {
        const isSourceDerived = status != null;
        if (isSourceDerived) {
          return {
            ok: false,
            schemaError: {
              field: fieldDef.field,
              message: srcError || `Missing required field: "${label}"`,
              status,
            },
          };
        }
      }

      if (value === undefined || value === null) continue;

      const actualType = getActualType(value);
      if (actualType !== fieldDef.type) {
        return {
          ok: false,
          schemaError: {
            field: fieldDef.field,
            message: srcError || `"${label}" must be ${fieldDef.type}, got ${actualType}`,
            status,
          },
        };
      }

      if (fieldDef.enum && fieldDef.enum.length > 0 && typeof value === 'string') {
        if (!fieldDef.enum.includes(value)) {
          return {
            ok: false,
            schemaError: {
              field: fieldDef.field,
              message: srcError || `"${label}" must be one of: ${fieldDef.enum.join(', ')}`,
              status,
            },
          };
        }
      }

      if (fieldDef.pattern && typeof value === 'string') {
        try {
          if (!new RegExp(fieldDef.pattern).test(value)) {
            return {
              ok: false,
              schemaError: {
                field: fieldDef.field,
                message: srcError || `"${label}" does not match expected format`,
                status,
              },
            };
          }
        } catch { /* invalid regex */ }
      }
    }
  }

  // 2. output_cases match check
  if (node.output_cases && node.output_cases.length > 0) {
    // Simple condition evaluator
    const evalCond = (cond: any, payload: unknown): boolean => {
      const val = getFieldValue(payload, cond.field);
      switch (cond.op) {
        case 'eq': return val === cond.value;
        case 'neq': return val !== cond.value;
        case 'exists': return val !== undefined && val !== null;
        case 'not_exists': return val === undefined || val === null;
        case 'gt': return typeof val === 'number' && val > cond.value;
        case 'lt': return typeof val === 'number' && val < cond.value;
        case 'gte': return typeof val === 'number' && val >= cond.value;
        case 'lte': return typeof val === 'number' && val <= cond.value;
        case 'contains':
          if (Array.isArray(val)) return val.includes(cond.value);
          if (typeof val === 'string') return val.includes(cond.value);
          return false;
        default: return false;
      }
    };

    // Pass 1: exact match
    for (const c of node.output_cases) {
      if (!c.match || c.match.length === 0) {
        // catch-all
        return { ok: true, matchedCase: { explanation: c.explanation, terminates: !!c.terminates } };
      }
      if (c.match.every((cond: any) => evalCond(cond, input))) {
        return { ok: !c.terminates, matchedCase: { explanation: c.explanation, terminates: !!c.terminates } };
      }
    }

    // Pass 2: best partial match (non-terminating)
    let bestCase: any = null;
    let bestScore = 0;
    for (const c of node.output_cases) {
      if (!c.match || c.match.length === 0 || c.terminates) continue;
      const passing = c.match.filter((cond: any) => evalCond(cond, input)).length;
      if (passing > bestScore) { bestScore = passing; bestCase = c; }
    }
    if (bestCase && bestScore > 0) {
      return { ok: true, matchedCase: { explanation: bestCase.explanation, terminates: false } };
    }

    // No match — build diagnostics
    const diagnostics: string[] = [];
    for (let i = 0; i < node.output_cases.length; i++) {
      const c = node.output_cases[i];
      if (!c.match || c.match.length === 0) continue;
      const failed = c.match
        .filter((cond: any) => !evalCond(cond, input))
        .map((cond: any) => {
          const actual = getFieldValue(input, cond.field);
          return `${cond.field} ${cond.op}${cond.value !== undefined ? ' ' + JSON.stringify(cond.value) : ''} (got: ${JSON.stringify(actual) ?? 'missing'})`;
        });
      if (failed.length > 0) {
        diagnostics.push(`${c.explanation || `case ${i + 1}`}: ${failed.join(', ')}`);
      }
    }

    return { ok: false, noMatchDiagnostics: diagnostics };
  }

  // No schema, no output_cases — always passes
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────

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
    runSimulationFromNode,
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
    resumeSimulation,
  } = props;

  const [paramsOpen, setParamsOpen] = useState(true);
  const [bodyOpen, setBodyOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [traceFlowOpen, setTraceFlowOpen] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [stepInputEdits, setStepInputEdits] = useState<Record<number, string>>({});
  // Per-step check results — populated on "Save & Check" click
  const [checkResults, setCheckResults] = useState<Record<number, CheckResult>>({});
  // Node input mode (double-click on node)
  const [nodeInputMode, setNodeInputMode] = useState<string | null>(null);
  const [nodeInputValue, setNodeInputValue] = useState('{\n  \n}');

  const traceFlowRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const checkResultRef = useRef<HTMLDivElement>(null);

  const selectedEntryNode = traceRouteId ? nodeById(traceRouteId) : undefined;
  const isHttpEntry = selectedEntryNode?.kind === 'route_handler';

  // Listen for node double-click events
  useEffect(() => {
    const handleNodeDoubleClick = (e: Event) => {
      const customEvent = e as CustomEvent;
      const nodeId = customEvent.detail?.nodeId;
      if (nodeId) {
        const node = nodeById(nodeId);
        if (node) {
          setNodeInputMode(nodeId);
          // Pre-populate with example input if available
          if (node.example_input) {
            setNodeInputValue(JSON.stringify(node.example_input, null, 2));
          } else if (node.example_payload) {
            setNodeInputValue(JSON.stringify(node.example_payload, null, 2));
          } else {
            setNodeInputValue('{\n  \n}');
          }
        }
      }
    };

    window.addEventListener('nodeDoubleClick', handleNodeDoubleClick);
    return () => window.removeEventListener('nodeDoubleClick', handleNodeDoubleClick);
  }, [nodeById]);

  const handleSimulate = () => {
    runSimulation();
    setTraceFlowOpen(true);
    setInspectorOpen(false);
    setParamsOpen(false);
    setBodyOpen(false);
    setExpandedStep(null);
    setStepInputEdits({});
    setCheckResults({});
  };

  const handleClearTrace = () => {
    clearTrace();
    setTraceFlowOpen(false);
    setInspectorOpen(false);
    setParamsOpen(true);
    setBodyOpen(true);
    setExpandedStep(null);
    setStepInputEdits({});
    setCheckResults({});
  };

  const handleInputEdit = (stepIndex: number, value: string) => {
    setStepInputEdits((prev) => ({ ...prev, [stepIndex]: value }));
    // Clear previous check result when user edits
    setCheckResults((prev) => {
      const n = { ...prev };
      delete n[stepIndex];
      return n;
    });
    if (traceSteps[stepIndex]) {
      traceSteps[stepIndex].terminated = false;
    }
  };

  // Auto-set expandedStep when selecting a node that exists in trace
  useEffect(() => {
    if (selectedNode && traceSteps.length > 0) {
      const stepIndex = traceSteps.findLastIndex((step) => step.nodeId === selectedNode.id);
      if (stepIndex !== -1 && stepIndex !== expandedStep) {
        setExpandedStep(stepIndex);
      } else if (stepIndex === -1 && expandedStep !== null) {
        setExpandedStep(null);
      }
    }
  }, [selectedNode, traceSteps]);

  // Expand Inspector and scroll when a node is selected
  useEffect(() => {
    if (selectedNode && !isTracing) {
      setInspectorOpen(true);
      setTimeout(() => {
        if (expandedStep !== null && traceSteps[expandedStep]?.terminated && errorRef.current) {
          errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // Auto-scroll to latest step in Trace Flow - only when actively tracing
  useEffect(() => {
    if (traceFlowOpen && traceFlowRef.current && traceVisible > 0 && isTracing) {
      const el = traceFlowRef.current;
      setTimeout(() => {
        const parent = el.closest('.overflow-y-auto');
        if (parent) {
          parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
        }
      }, 100);
    }
  }, [traceVisible, traceFlowOpen, isTracing]);

  // Scroll to bottom when tracing finishes
  useEffect(() => {
    if (traceFlowOpen && traceFlowRef.current && !isTracing && traceVisible > 0) {
      const el = traceFlowRef.current;
      setTimeout(() => {
        const parent = el.closest('.overflow-y-auto');
        if (parent) {
          parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
        }
      }, 150);
    }
  }, [isTracing, traceFlowOpen]);

  // ── Inspector content (shared between the two branches) ──────────────────
  const renderInspectorContent = () => {
    if (!selectedNode) {
      return (
        <div className="text-[#555] text-[11px] text-center py-2 leading-relaxed">
          No node selected
        </div>
      );
    }

    const checkResult = expandedStep !== null ? checkResults[expandedStep] : undefined;
    const currentStep = expandedStep !== null ? traceSteps[expandedStep] : undefined;

    return (
      <div className="space-y-3">
        <div className="text-[13px] text-[#ddd] font-semibold">{selectedNode.name}</div>

        <Field label="KIND">
          <span
            className="inline-block text-[9px] font-bold tracking-wide px-[7px] py-[3px] rounded"
            style={{
              background: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeBg,
              color: (KIND_COLORS[selectedNode.kind] || KIND_COLORS.business_logic).badgeText,
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

        {/* Input editor - only show when paused at breakpoint */}
        {expandedStep !== null && isPausedAtBreakpoint && (
          <div>
            <Field label="INPUT">
              <textarea
                value={
                  stepInputEdits[expandedStep] ??
                  (currentStep?.inputPayload != null
                    ? JSON.stringify(currentStep.inputPayload, null, 2)
                    : '{}')
                }
                onChange={(e) => handleInputEdit(expandedStep, e.target.value)}
                placeholder="Edit input JSON and click Save & Check..."
                spellCheck={false}
                className="w-full min-h-[100px] bg-[#0d0d0f] border-[0.5px] border-[#2a2a2e] rounded px-2.5 py-2 text-[10px] text-[#ccc] font-mono outline-none resize-y leading-relaxed box-border mt-1"
              />
            </Field>

            <Button
              onClick={() => {
                const rawEdit =
                  stepInputEdits[expandedStep] ??
                  JSON.stringify(currentStep?.inputPayload ?? {});

                let parsed: unknown;
                try {
                  parsed = JSON.parse(rawEdit);
                } catch {
                  // Invalid JSON — show parse error as check result
                  setCheckResults((prev) => ({
                    ...prev,
                    [expandedStep]: {
                      ok: false,
                      schemaError: {
                        field: '(root)',
                        message: 'Invalid JSON — fix syntax before checking',
                      },
                    },
                  }));
                  setTimeout(() => {
                    checkResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 50);
                  return;
                }

                // Run validation against node definition
                const result = checkInputAgainstNode(parsed, selectedNode);
                setCheckResults((prev) => ({ ...prev, [expandedStep]: result }));

                // Also propagate the rerun (updates outputPayload downstream)
                rerunFromStep(expandedStep, traceSteps[expandedStep].nodeId, parsed);

                // Clear edits for this step and all later steps
                setStepInputEdits((prev) => {
                  const n = { ...prev };
                  for (const k of Object.keys(n)) {
                    if (Number(k) >= expandedStep) delete n[Number(k)];
                  }
                  return n;
                });

                // Scroll to check result
                setTimeout(() => {
                  checkResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 80);

                // If no error and paused at breakpoint, auto-resume
                if (result.ok && !result.matchedCase?.terminates && isPausedAtBreakpoint && resumeSimulation) {
                  setTimeout(() => resumeSimulation(), 100);
                }
              }}
              className="w-full bg-[#378ADD] hover:bg-[#4a9bef] text-white text-[10px] font-semibold mt-2"
            >
              Save & Check
            </Button>

            {/* ── Check result banner ───────────────────────────────── */}
            {checkResult && (
              <div ref={checkResultRef} className="mt-2 space-y-1.5">
                {checkResult.ok ? (
                  /* ✅ PASS */
                  <div className="flex items-start gap-2 bg-[#0d1f0d] border border-[#27500A] rounded px-2.5 py-2">
                    <span className="text-[#639922] font-bold text-[10px] shrink-0 mt-px">✓ VALID</span>
                    <span className="text-[9px] text-[#639922]/80 leading-relaxed">
                      {checkResult.matchedCase?.terminates
                        ? `Matched case (terminates): ${checkResult.matchedCase.explanation || 'execution stops here'}`
                        : checkResult.matchedCase?.explanation
                          ? `Matched: ${checkResult.matchedCase.explanation}`
                          : 'Input passes all schema checks and matches an output case.'}
                    </span>
                  </div>
                ) : (
                  /* ❌ FAIL */
                  <div className="bg-[#1f0d0d] border border-[#6b1a1a] rounded px-2.5 py-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#ef4444] font-bold text-[10px]">✗ VALIDATION FAILED</span>
                      {checkResult.schemaError?.status && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#6b1a1a] text-[#ef9f9f] font-mono">
                          {checkResult.schemaError.status}
                        </span>
                      )}
                    </div>

                    {checkResult.schemaError && (
                      <div>
                        <div className="text-[9px] text-[#ef9f9f] font-mono mb-0.5">
                          field: {checkResult.schemaError.field}
                        </div>
                        <div className="text-[10px] text-[#ffb3b3] leading-relaxed">
                          {checkResult.schemaError.message}
                        </div>
                      </div>
                    )}

                    {checkResult.noMatchDiagnostics && checkResult.noMatchDiagnostics.length > 0 && (
                      <div>
                        <div className="text-[9px] text-[#ef9f9f] mb-1">No output_case matched:</div>
                        {checkResult.noMatchDiagnostics.map((d, i) => (
                          <div key={i} className="text-[9px] text-[#ffb3b3] font-mono leading-relaxed pl-1 border-l border-[#6b1a1a] mb-0.5">
                            {d}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step I/O from runtime */}
        {expandedStep !== null && currentStep && (
          <>
            {currentStep.outputPayload != null && (
              <Field label="OUTPUT">
                <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                  {JSON.stringify(currentStep.outputPayload, null, 2)}
                </pre>
              </Field>
            )}
            {currentStep.terminated && (
              <div
                ref={errorRef}
                className="flex items-center gap-2 bg-[#2e1a0a] border border-[#633806] rounded px-2.5 py-1.5"
              >
                <span className="text-[10px] font-bold text-[#ef9f27]">CHAIN STOPPED</span>
                {currentStep.terminatedReason && (
                  <span className="text-[9px] text-[#b87a1a]">
                    — {currentStep.terminatedReason}
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
    );
  };

  return (
    <div
      className="min-w-[200px] max-w-[600px] border-r-[0.5px] border-[#2a2a2e] bg-[#0d0d0f] flex flex-col overflow-hidden shrink-0"
      style={{ width }}
    >
      {/* Simulate Header - hidden when paused at breakpoint */}
      {!isPausedAtBreakpoint && (
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
      )}

      {/* Sections Content */}
      <div 
        className="flex-1 overflow-y-auto p-4 relative" 
        style={{ 
          scrollBehavior: 'smooth',
          scrollbarWidth: isTracing ? 'none' : 'thin',
          msOverflowStyle: isTracing ? 'none' : 'auto',
        }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: ${isTracing ? 'none' : 'block'};
          }
        `}</style>

        {/* NODE INPUT MODE - appears when double-clicking a node (always visible) */}
        {nodeInputMode && (
          <CollapsibleSection
            title="NODE INPUT"
            isOpen={true}
            onToggle={() => setNodeInputMode(null)}
          >
            <div className="space-y-2">
              <div className="text-[11px] text-[#ddd] font-semibold mb-2">
                {nodeById(nodeInputMode)?.name || nodeInputMode}
              </div>
              <div className="text-[9px] text-[#666] mb-2">
                Provide input to start simulation from this node
              </div>
              <textarea
                value={nodeInputValue}
                onChange={(e) => setNodeInputValue(e.target.value)}
                placeholder='{"key": "value"}'
                spellCheck={false}
                className="w-full min-h-[100px] bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md p-2.5 text-[#ddd] text-[11px] outline-none box-border resize-y leading-relaxed mb-2"
              />
              <Button
                onClick={() => {
                  try {
                    const input = JSON.parse(nodeInputValue);
                    // Close node input mode
                    setNodeInputMode(null);
                    // Run simulation from this node independently
                    if (runSimulationFromNode) {
                      runSimulationFromNode(nodeInputMode, input);
                      setTraceFlowOpen(true);
                      setInspectorOpen(false);
                      setParamsOpen(false);
                      setBodyOpen(false);
                    }
                  } catch (err) {
                    setError('Invalid JSON input');
                  }
                }}
                className="w-full bg-[#1D9E75] hover:bg-[#2ab88f] text-white text-[10px] font-semibold"
              >
                Start Simulation from This Node
              </Button>
              <Button
                onClick={() => setNodeInputMode(null)}
                className="w-full bg-transparent border border-[#2a2a2e] hover:border-[#666] text-[#888] hover:text-[#aaa] text-[10px] font-semibold"
              >
                Cancel
              </Button>
            </div>
          </CollapsibleSection>
        )}

        {!traceRouteId ? (
          <>
            <CollapsibleSection
              title="PARAMS"
              isOpen={false}
              onToggle={() => setParamsOpen(!paramsOpen)}
            >
              <div className="text-[11px] text-[#555] py-2 text-center">No route selected</div>
            </CollapsibleSection>

            <CollapsibleSection title="BODY" isOpen={false} onToggle={() => setBodyOpen(!bodyOpen)}>
              <textarea
                value={reqBody}
                onChange={(e) => setReqBody(e.target.value)}
                placeholder='{"action": "Generate", ...}'
                spellCheck={false}
                className="w-full min-h-[120px] bg-[#111114] border-[0.5px] border-[#2a2a2e] rounded-md p-2.5 text-[#ddd] text-[11px] outline-none box-border resize-y leading-relaxed mb-1"
              />
            </CollapsibleSection>

            <div ref={inspectorRef}>
              <CollapsibleSection
                title="INSPECTOR"
                isOpen={inspectorOpen}
                onToggle={() => setInspectorOpen(!inspectorOpen)}
              >
                {renderInspectorContent()}
              </CollapsibleSection>
            </div>
          </>
        ) : (
          <>
            {isHttpEntry && routePathParams.length > 0 && (
              <CollapsibleSection
                title="PARAMS"
                isOpen={paramsOpen}
                onToggle={() => setParamsOpen(!paramsOpen)}
                badge={<span className="text-[#854F0B] ml-1.5">{routePathParams.length}</span>}
              >
                {routePathParams.map((param) => (
                  <div key={param} className="mb-2">
                    <div className="text-[9px] text-[#854F0B] mb-1 font-semibold tracking-wide">:{param}</div>
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

            <div ref={inspectorRef}>
              <CollapsibleSection
                title="INSPECTOR"
                isOpen={inspectorOpen}
                onToggle={() => setInspectorOpen(!inspectorOpen)}
              >
                {renderInspectorContent()}
              </CollapsibleSection>
            </div>
          </>
        )}

        {/* TRACE FLOW - Always visible when there are steps */}
        {traceSteps.length > 0 && (
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
              {traceSteps.slice(0, traceVisible).map((step, i) => {
                const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                return (
                  <div
                    key={i}
                    id={`trace-step-${i}`}
                    className="relative mb-3 mt-5"
                    style={{ animation: 'fadeInBlur 0.4s ease-out', animationFillMode: 'both' }}
                  >
                    {i > 0 && (
                      <div className="flex flex-col items-center py-1.5">
                        <div className="w-[2px] h-4 bg-linear-to-b from-[#378ADD] to-[#378ADD]/30" />
                        {step.edgeLabel && (
                          <span className="text-[9px] text-[#666] italic font-medium mt-1">
                            {step.edgeLabel}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="relative pt-2">
                      <div
                        className={`absolute left-1/2 -translate-x-1/2 -top-2 w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] text-white ${
                          step.terminated ? 'bg-[#f59e0b]' : 'bg-[#378ADD]'
                        }`}
                      >
                        {i + 1}
                      </div>
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
                            setCheckResults((prev) => {
                              const n = { ...prev };
                              delete n[i];
                              return n;
                            });
                            setTimeout(() => {
                              if (step.terminated && errorRef.current) {
                                errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              } else {
                                inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            </div>
          </CollapsibleSection>
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