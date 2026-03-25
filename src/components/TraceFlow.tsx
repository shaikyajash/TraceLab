"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TraceStep } from "@/types";
import { KIND_COLORS, KIND_LABELS } from "@/constants";

interface TraceFlowProps {
  traceSteps: TraceStep[];
  traceVisible: number;
  isTracing: boolean;
  clearTrace: () => void;
}

export default function TraceFlow({ traceSteps, traceVisible, isTracing, clearTrace }: TraceFlowProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (traceSteps.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 shadow-2xl">
      <Card className="w-[320px] bg-[#111114] border-[#2a2a2e] overflow-hidden">
        <CardHeader className="p-3 border-b border-[#2a2a2e] flex flex-row items-center justify-between cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className="flex items-center gap-2">
            <svg className="w-3 h-3 text-[#378ADD]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="text-[10px] font-semibold text-[#ddd] uppercase tracking-wider">
              Trace Flow
            </h3>
            <span className="text-[9px] text-[#555]">
              {traceVisible} / {traceSteps.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!isTracing && (
              <Button
                onClick={(e) => { e.stopPropagation(); clearTrace(); }}
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[8px] text-[#555] hover:text-[#ddd] hover:bg-[#1a1a1c]"
              >
                Clear
              </Button>
            )}
            <svg 
              className={`w-3 h-3 text-[#555] transition-transform ${isCollapsed ? '' : 'rotate-180'}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </CardHeader>
        {!isCollapsed && (
          <CardContent className="p-3 max-h-[400px] overflow-y-auto">
            <div className="space-y-1.5">
              {traceSteps.slice(0, traceVisible).map((step, i) => {
                const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                return (
                  <div key={i}>
                    {/* Connector arrow */}
                    {i > 0 && step.edgeLabel && (
                      <div className="flex items-center gap-1.5 py-0.5 pl-3">
                        <div className="w-0 h-0 border-l-[3px] border-l-[#378ADD] border-t-2 border-t-transparent border-b-2 border-b-transparent" />
                        <span className="text-[8px] text-[#555] italic">{step.edgeLabel}</span>
                      </div>
                    )}
                    {i > 0 && !step.edgeLabel && (
                      <div className="flex items-center gap-1.5 py-0.5 pl-3">
                        <div className="w-0 h-0 border-l-[3px] border-l-[#378ADD] border-t-2 border-t-transparent border-b-2 border-b-transparent" />
                      </div>
                    )}
                    {/* Step card */}
                    <div 
                      className="bg-[#0a0a0c] rounded p-2 transition-all hover:bg-[#0d0d0f]"
                      style={{ border: `0.5px solid ${colors.border}33` }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div 
                          className="text-[7px] px-1 py-0.5 rounded font-bold"
                          style={{ background: colors.badgeBg, color: colors.badgeText }}
                        >
                          {KIND_LABELS[step.kind] || step.kind.toUpperCase()}
                        </div>
                        <span className="text-[9px] text-[#bbb] font-medium">{step.name}</span>
                      </div>
                      {step.description && (
                        <div className="text-[8px] text-[#666] leading-relaxed">{step.description}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
