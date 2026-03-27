'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { TraceStep } from '@/types';
import { KIND_COLORS, KIND_LABELS } from '@/constants';

interface TraceFlowProps {
  traceSteps: TraceStep[];
  traceVisible: number;
  isTracing: boolean;
  clearTrace: () => void;
}

export default function TraceFlow({
  traceSteps,
  traceVisible,
  isTracing,
  clearTrace,
}: TraceFlowProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (traceSteps.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 shadow-2xl">
      <Card className="w-[380px] bg-[#111114] border-[#2a2a2e] overflow-hidden">
        <CardHeader
          className="p-4 border-b border-[#2a2a2e] flex flex-row items-center justify-between cursor-pointer hover:bg-[#1a1a1e] transition-colors"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-3">
            <svg
              className="w-4 h-4 text-[#378ADD]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            <h3 className="text-xs font-semibold text-[#ddd] uppercase tracking-wider">
              Trace Flow
            </h3>
            <span className="text-xs text-[#666] font-medium">
              {traceVisible} / {traceSteps.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {traceSteps.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  clearTrace();
                }}
                className="h-6 px-2 text-[10px] text-[#888] hover:text-[#ddd] hover:bg-[#2a2a2e]"
              >
                Clear
              </Button>
            )}
            <svg
              className={`w-4 h-4 text-[#666] transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </CardHeader>
        {!isCollapsed && (
          <CardContent className="p-4 max-h-[500px] overflow-y-auto">
            <div className="space-y-0">
              {traceSteps.slice(0, traceVisible).map((step, i) => {
                const colors = KIND_COLORS[step.kind] || KIND_COLORS.business_logic;
                return (
                  <div key={i} className="relative">
                    {/* Connector line */}
                    {i > 0 && (
                      <div className="flex items-center gap-3 py-2 pl-[18px]">
                        <div className="w-[2px] h-6 bg-gradient-to-b from-[#378ADD] to-[#378ADD]/30" />
                        {step.edgeLabel && (
                          <span className="text-[10px] text-[#666] italic font-medium">
                            {step.edgeLabel}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Step card with bubble */}
                    <div className="flex gap-3 items-start">
                      {/* Step number bubble */}
                      <div
                        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${colors.border}, ${colors.border}dd)`,
                          color: '#fff',
                          border: `2px solid ${colors.border}`,
                        }}
                      >
                        {i + 1}
                      </div>
                      {/* Step content card */}
                      <div
                        className="flex-1 bg-[#0a0a0c] rounded-lg p-3 transition-all hover:bg-[#0d0d0f] hover:shadow-lg mb-1"
                        style={{ border: `1px solid ${colors.border}40` }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="text-[9px] px-2 py-1 rounded font-bold uppercase tracking-wide"
                            style={{ background: colors.badgeBg, color: colors.badgeText }}
                          >
                            {KIND_LABELS[step.kind] || step.kind}
                          </div>
                          <span className="text-xs text-[#ddd] font-semibold flex-1">{step.name}</span>
                        </div>
                        {step.description && !step.description.includes('CHAIN STOP') && (
                          <div className="text-[11px] text-[#888] leading-relaxed">
                            {step.description}
                          </div>
                        )}
                      </div>
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
