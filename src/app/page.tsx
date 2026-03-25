'use client';

import React, { useState, useEffect, useRef } from 'react';
import FlowVisualizer from '@/components/FlowVisualizer';
import ExecutionPanel from '@/components/ExecutionPanel';
import OnboardingFlow from '@/components/OnboardingFlow';
import { VisualizerSchema, Route, ExecutionStep, ServerEntity } from '@/types/visualizer';
import { RequestExecutor } from '@/lib/request-executor';

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [schema, setSchema] = useState<VisualizerSchema | null>(null);
  const [selectedServer, setSelectedServer] = useState<ServerEntity | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executor, setExecutor] = useState<RequestExecutor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const executionRef = useRef<{ paused: boolean }>({ paused: false });

  const loadVisualizer = () => {
    // Load visualizer.json
    fetch('/visualizer.json')
      .then(res => res.json())
      .then(data => {
        setSchema(data);
        if (data.servers.length > 0) {
          const server = data.servers[0];
          setSelectedServer(server);
          setExecutor(new RequestExecutor(`http://localhost:${server.port}`));
          if (server.routes.length > 0) {
            setSelectedRoute(server.routes[0]);
          }
        }
        setShowOnboarding(false);
      })
      .catch(err => console.error('Failed to load visualizer.json:', err));
  };

  useEffect(() => {
    // Check if we already have a visualizer
    fetch('/visualizer.json')
      .then(res => {
        if (res.ok) {
          // Skip onboarding if visualizer exists
          setShowOnboarding(false);
          loadVisualizer();
        }
      })
      .catch(() => {
        // Show onboarding if no visualizer
        setShowOnboarding(true);
      });
  }, []);

  const handleOnboardingComplete = () => {
    loadVisualizer();
  };

  const handleExecute = async (payload: any) => {
    if (!selectedRoute || isExecuting) return;

    setExecutionSteps([]);
    setCurrentStep(0);
    setIsPaused(false);
    setIsExecuting(true);
    setError(null);
    executionRef.current.paused = false;

    try {
      // Call the API endpoint instead of executing directly
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId: selectedRoute.id,
          payload
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Execution failed:', data);
        throw new Error(data.error || 'Execution failed');
      }

      // Simulate the step-by-step execution for visualization
      const { state } = data;
      
      for (let i = 0; i < selectedRoute.flowSteps.length; i++) {
        if (executionRef.current.paused) break;

        const flowStep = selectedRoute.flowSteps[i];
        const step = {
          stepIndex: i,
          componentId: flowStep.componentId,
          functionName: flowStep.functionName,
          inputPayload: i === 0 ? payload : {},
          outputPayload: i === selectedRoute.flowSteps.length - 1 ? state.payload : {},
          timestamp: Date.now(),
          duration: 100,
        };

        setExecutionSteps(prev => [...prev, step]);
        setCurrentStep(prev => prev + 1);
        
        // Wait 2 seconds between steps for visibility
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      console.error('Execution error:', error);
      setError(error.message || 'Request failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const handlePause = () => {
    setIsPaused(true);
    executionRef.current.paused = true;
  };

  const handleResume = async () => {
    if (!selectedRoute || !executor || !isExecuting) return;
    
    setIsPaused(false);
    executionRef.current.paused = false;

    // Continue from where we left off
    const remainingSteps = selectedRoute.flowSteps.slice(currentStep);
    
    for (let i = 0; i < remainingSteps.length; i++) {
      if (executionRef.current.paused) break;
      
      const flowStep = remainingSteps[i];
      const step: ExecutionStep = {
        stepIndex: currentStep + i,
        componentId: flowStep.componentId,
        functionName: flowStep.functionName,
        inputPayload: executionSteps[executionSteps.length - 1]?.outputPayload || {},
        outputPayload: { continued: true },
        timestamp: Date.now(),
        duration: 100,
      };

      setExecutionSteps(prev => [...prev, step]);
      setCurrentStep(prev => prev + 1);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };

  const handleStepEdit = async (stepIndex: number, modifiedPayload: any) => {
    if (!selectedRoute || !executor) return;

    // Reset and re-execute from the beginning with modified payload at that step
    setExecutionSteps([]);
    setCurrentStep(0);
    setIsExecuting(true);

    try {
      const state = await executor.executeWithBreakpoint(
        selectedRoute,
        executionSteps[0]?.inputPayload || {},
        stepIndex,
        modifiedPayload
      );

      setExecutionSteps(state.history);
      setCurrentStep(state.currentStep);
    } catch (error) {
      console.error('Step edit error:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    setExecutionSteps([]);
    setCurrentStep(0);
    setIsPaused(false);
    setIsExecuting(false);
    executionRef.current.paused = false;
  };

  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  if (!schema || !selectedServer || !selectedRoute) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)'
          }}>
            ⟳
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>TraceLab</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Loading visualizer...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      {/* Topbar */}
      <div className="h-14 flex items-center gap-0 border-b" style={{ 
        background: 'var(--bg)', 
        borderColor: 'var(--border)' 
      }}>
        <div className="flex items-center gap-3 px-5 border-r h-full" style={{ borderColor: 'var(--border)' }}>
          <div className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            TraceLab
          </div>
        </div>

        <div className="flex items-center gap-2 px-4">
          <select
            value={selectedRoute?.id || ''}
            onChange={e => {
              const route = selectedServer?.routes.find(r => r.id === e.target.value);
              if (route) {
                setSelectedRoute(route);
                setExecutionSteps([]);
                setCurrentStep(0);
                setError(null);
              }
            }}
            className="px-3 py-1.5 border text-sm"
            style={{
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {selectedServer?.routes.map(route => (
              <option key={route.id} value={route.id}>
                {route.method} {route.path}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              // Delete visualizer.json and restart onboarding
              fetch('/visualizer.json', { method: 'DELETE' }).catch(() => {});
              setSchema(null);
              setSelectedServer(null);
              setSelectedRoute(null);
              setExecutionSteps([]);
              setCurrentStep(0);
              setShowOnboarding(true);
            }}
            className="px-3 py-1.5 border text-sm transition-colors hover:bg-gray-50"
            style={{
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text2)'
            }}
          >
            Scan Repo
          </button>
        </div>

        <div className="flex-1"></div>

        {isExecuting && (
          <div className="flex items-center gap-2 px-3 py-1 border mr-4" style={{
            background: isPaused ? '#fef3c7' : '#d1fae5',
            borderColor: isPaused ? '#fcd34d' : '#6ee7b7',
            color: isPaused ? '#92400e' : '#065f46'
          }}>
            <div className={`w-1.5 h-1.5 rounded-full ${isPaused ? '' : 'animate-pulse'}`} style={{
              background: 'currentColor'
            }}></div>
            <span className="text-xs font-medium">
              {isPaused ? 'paused' : 'running'} · {currentStep}/{selectedRoute?.flowSteps.length || 0}
            </span>
          </div>
        )}

        {executionSteps.length > 0 && !isExecuting && (
          <button
            onClick={handleReset}
            className="px-3 py-1.5 border text-sm mr-4 transition-colors hover:bg-gray-50"
            style={{
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text2)'
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col">
          {error && (
            <div className="mx-4 mt-4 p-3 border flex items-start gap-3" style={{
              background: '#fee2e2',
              borderColor: '#fca5a5',
              color: '#991b1b'
            }}>
              <span className="text-lg">⚠</span>
              <div className="flex-1">
                <div className="font-semibold text-sm mb-1">Request Failed</div>
                <div className="text-xs">{error}</div>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-xs px-2 py-1 hover:bg-red-200"
              >
                ✕
              </button>
            </div>
          )}
          <FlowVisualizer
            server={selectedServer}
            selectedRoute={selectedRoute}
            executionSteps={executionSteps}
            currentStep={currentStep}
          />
        </div>
        <div className="w-96">
          <ExecutionPanel
            route={selectedRoute}
            executionSteps={executionSteps}
            currentStep={currentStep}
            onExecute={handleExecute}
            onStepEdit={handleStepEdit}
            onPause={handlePause}
            onResume={handleResume}
            isPaused={isPaused}
            isExecuting={isExecuting}
          />
        </div>
      </div>
    </div>
  );
}