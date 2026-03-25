'use client';

import React, { useState } from 'react';
import { Route, ExecutionStep } from '@/types/visualizer';

interface ExecutionPanelProps {
  route: Route;
  executionSteps: ExecutionStep[];
  currentStep: number;
  onExecute: (payload: any) => void;
  onStepEdit: (stepIndex: number, payload: any) => void;
  onPause: () => void;
  onResume: () => void;
  isPaused: boolean;
  isExecuting: boolean;
}

export default function ExecutionPanel({
  route,
  executionSteps,
  currentStep,
  onExecute,
  onStepEdit,
  onPause,
  onResume,
  isPaused,
  isExecuting,
}: ExecutionPanelProps) {
  const [payload, setPayload] = useState(
    JSON.stringify(route.examplePayload || {}, null, 2)
  );
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [editPayload, setEditPayload] = useState('');

  const handleExecute = () => {
    try {
      const parsed = JSON.parse(payload);
      onExecute(parsed);
    } catch (e) {
      alert('Invalid JSON payload');
    }
  };

  const handleStepEdit = (stepIndex: number) => {
    const step = executionSteps[stepIndex];
    setEditingStep(stepIndex);
    setEditPayload(JSON.stringify(step.outputPayload, null, 2));
  };

  const handleSaveEdit = () => {
    if (editingStep === null) return;
    try {
      const parsed = JSON.parse(editPayload);
      onStepEdit(editingStep, parsed);
      setEditingStep(null);
    } catch (e) {
      alert('Invalid JSON');
    }
  };

  return (
    <div className="h-full flex flex-col border-l" style={{ 
      background: 'var(--bg1)', 
      borderColor: 'var(--border)' 
    }}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
          Execution Control
        </h2>
        
        <div className="text-xs mb-2" style={{ color: 'var(--text2)' }}>
          <span className="font-mono" style={{ color: 'var(--purple)' }}>{route.method}</span>
          {' '}
          <span className="font-mono" style={{ color: 'var(--text)' }}>{route.path}</span>
        </div>
      </div>

      {/* Payload Editor */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <label className="block text-[11px] font-medium mb-2" style={{ color: 'var(--text2)' }}>
          Request Payload:
        </label>
        <textarea
          value={payload}
          onChange={e => setPayload(e.target.value)}
          className="w-full h-32 p-2 rounded-lg border font-mono text-[10px] resize-none"
          style={{
            background: 'var(--bg)',
            borderColor: 'var(--border2)',
            color: 'var(--text)',
            lineHeight: '1.6'
          }}
          placeholder="Enter JSON payload"
        />
        
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleExecute}
            disabled={isExecuting && !isPaused}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: isExecuting && !isPaused ? 'var(--bg3)' : 'var(--accent)',
              color: '#fff',
              cursor: isExecuting && !isPaused ? 'not-allowed' : 'pointer',
              opacity: isExecuting && !isPaused ? 0.5 : 1
            }}
          >
            {isExecuting ? '▶ Executing...' : '▶ Execute'}
          </button>
          
          {isExecuting && !isPaused && (
            <button
              onClick={onPause}
              className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'var(--amber-glow)',
                borderColor: 'rgba(245,165,36,0.4)',
                color: 'var(--amber)',
                border: '1px solid'
              }}
            >
              ⏸ Pause
            </button>
          )}
          
          {isPaused && (
            <button
              onClick={onResume}
              className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'var(--green-glow)',
                borderColor: 'rgba(34,214,138,0.4)',
                color: 'var(--green)',
                border: '1px solid'
              }}
            >
              ▶ Resume
            </button>
          )}
        </div>
        
        {isExecuting && (
          <div className="mt-3 p-2 rounded-lg border text-xs" style={{
            background: 'var(--accent-glow)',
            borderColor: 'rgba(61,142,240,0.3)',
            color: 'var(--accent)'
          }}>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'currentColor' }}></div>
              <span className="font-mono">Step {currentStep} of {route.flowSteps.length}</span>
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
              2 seconds per step · pause anytime
            </div>
          </div>
        )}
      </div>

      {/* Execution History */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text3)' }}>
          Execution History
        </h3>
        
        <div className="space-y-2">
          {executionSteps.map((step, index) => (
            <div
              key={index}
              className="p-3 rounded-lg border transition-all"
              style={{
                background: index === currentStep - 1
                  ? 'var(--accent-glow)'
                  : index < currentStep
                  ? 'var(--green-glow)'
                  : 'var(--bg2)',
                borderColor: index === currentStep - 1
                  ? 'rgba(61,142,240,0.4)'
                  : index < currentStep
                  ? 'rgba(34,214,138,0.3)'
                  : 'var(--border)'
              }}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-xs font-medium font-mono" style={{ color: 'var(--text)' }}>
                    Step {index + 1}: {step.functionName}
                  </div>
                  <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text3)' }}>
                    {step.duration}ms
                  </div>
                </div>
                <button
                  onClick={() => handleStepEdit(index)}
                  className="text-[10px] px-2 py-1 rounded border transition-all"
                  style={{
                    background: 'var(--accent-glow)',
                    borderColor: 'rgba(61,142,240,0.3)',
                    color: 'var(--accent)'
                  }}
                >
                  Edit & Replay
                </button>
              </div>
              
              <details className="text-[10px]">
                <summary className="cursor-pointer font-mono" style={{ color: 'var(--accent)' }}>
                  View Payload
                </summary>
                <pre className="mt-2 p-2 rounded overflow-x-auto font-mono" style={{
                  background: 'var(--bg)',
                  color: 'var(--text2)',
                  lineHeight: '1.6'
                }}>
                  {JSON.stringify(step.outputPayload, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editingStep !== null && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{
          background: 'rgba(8,10,15,0.85)'
        }}>
          <div className="w-[480px] rounded-2xl border overflow-hidden" style={{
            background: 'var(--bg1)',
            borderColor: 'rgba(245,165,36,0.35)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div className="flex items-center gap-3 p-4 border-b" style={{
              background: 'var(--amber-glow)',
              borderColor: 'rgba(245,165,36,0.2)'
            }}>
              <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--amber)' }}></div>
              <div className="flex-1 text-sm font-semibold" style={{ color: 'var(--amber)' }}>
                Edit Payload at Step {editingStep + 1}
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'rgba(245,165,36,0.7)' }}>
                {executionSteps[editingStep]?.componentId}
              </div>
            </div>
            
            <div className="p-4">
              <label className="block text-[11px] font-medium mb-2" style={{ color: 'var(--text2)' }}>
                Modified Payload:
              </label>
              <textarea
                value={editPayload}
                onChange={e => setEditPayload(e.target.value)}
                className="w-full h-48 p-3 rounded-lg border font-mono text-[10px] resize-none"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'rgba(245,165,36,0.3)',
                  color: 'var(--text)',
                  lineHeight: '1.6'
                }}
              />
              
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 px-4 py-2 rounded-lg text-xs font-medium"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff'
                  }}
                >
                  ▶ Save & Continue
                </button>
                <button
                  onClick={() => setEditingStep(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border"
                  style={{
                    background: 'var(--bg3)',
                    borderColor: 'var(--border2)',
                    color: 'var(--text2)'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
