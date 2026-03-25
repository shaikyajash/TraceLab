'use client';

import React, { useState, useEffect, useRef } from 'react';
import FlowVisualizer from '@/components/FlowVisualizer';
import ExecutionPanel from '@/components/ExecutionPanel';
import OnboardingFlow from '@/components/OnboardingFlow';
import { VisualizerSchema, Route, ExecutionStep, ServerEntity } from '@/types/visualizer';

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [schema, setSchema] = useState<VisualizerSchema | null>(null);
  const [selectedServer, setSelectedServer] = useState<ServerEntity | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const executionRef = useRef<{ paused: boolean }>({ paused: false });

  const loadVisualizer = () => {
    setIsLoading(true);
    // Load visualizer.json
    fetch('/visualizer.json')
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch visualizer.json');
        }
        return res.json();
      })
      .then(data => {
        console.log('Loaded visualizer schema:', data);
        
        if (!data.servers || data.servers.length === 0) {
          throw new Error('No servers found in visualizer.json');
        }
        
        setSchema(data);
        if (data.servers.length > 0) {
          const server = data.servers[0];
          setSelectedServer(server);
          if (server.routes.length > 0) {
            setSelectedRoute(server.routes[0]);
          }
        }
        setShowOnboarding(false);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Failed to load visualizer.json:', err);
        setIsLoading(false);
        setShowOnboarding(true);
      });
  };

  useEffect(() => {
    // Check if we already have a visualizer
    setIsLoading(true);
    
    // Add timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      console.error('Loading timeout - forcing onboarding');
      setIsLoading(false);
      setShowOnboarding(true);
    }, 5000);
    
    fetch('/visualizer.json')
      .then(res => {
        clearTimeout(timeout);
        console.log('Fetch response status:', res.status, res.ok);
        if (!res.ok) {
          throw new Error('No visualizer found');
        }
        return res.json();
      })
      .then(data => {
        console.log('Parsed visualizer data:', data);
        console.log('Servers count:', data?.servers?.length);
        
        // Validate data
        if (!data.servers || data.servers.length === 0) {
          throw new Error('No servers found in visualizer.json');
        }
        
        const server = data.servers[0];
        
        // Check if server has routes
        if (!server.routes || server.routes.length === 0) {
          console.warn('No routes found in server');
          setIsLoading(false);
          setShowOnboarding(true);
          alert('No API routes found in the scanned repository. The scanner may not have detected route definitions. Please try scanning a different repository or check if the repository contains HTTP route handlers.');
          return;
        }
        
        // Set all state at once
        setSchema(data);
        setSelectedServer(server);
        setSelectedRoute(server.routes[0]);
        setIsLoading(false);
        setShowOnboarding(false);
        console.log('Visualizer loaded successfully');
        console.log('State set:', { 
          hasSchema: !!data, 
          hasServer: !!server, 
          hasRoute: server.routes.length > 0,
          routeCount: server.routes.length,
          isLoading: false,
          showOnboarding: false
        });
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.log('Error loading visualizer:', err);
        setIsLoading(false);
        setShowOnboarding(true);
      });
    
    return () => clearTimeout(timeout);
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
    if (!selectedRoute || !isExecuting) return;
    
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
    if (!selectedRoute) return;

    // Reset and re-execute from the beginning with modified payload at that step
    setExecutionSteps([]);
    setCurrentStep(0);
    setIsExecuting(true);

    try {
      // Call the API endpoint with breakpoint
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId: selectedRoute.id,
          payload: executionSteps[0]?.inputPayload || {},
          breakpointStep: stepIndex,
          modifiedPayload
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Execution failed');
      }

      setExecutionSteps(data.state.history);
      setCurrentStep(data.state.currentStep);
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl animate-spin" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)'
          }}>
            ⟳
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>TraceLab</h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Loading visualizer...
          </p>
          <button
            onClick={() => {
              setIsLoading(false);
              setShowOnboarding(true);
            }}
            className="mt-4 px-4 py-2 text-xs border rounded hover:bg-gray-50"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text2)'
            }}
          >
            Cancel & Start Over
          </button>
        </div>
      </div>
    );
  }

  if (!schema || !selectedServer) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)'
          }}>
            ⟳
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>TraceLab</h1>
          <p className="text-sm mb-2" style={{ color: 'var(--text2)' }}>
            Initializing...
          </p>
          <p className="text-xs" style={{ color: 'var(--text3)' }}>
            Schema: {schema ? '✓' : '✗'} | Server: {selectedServer ? '✓' : '✗'}
          </p>
          <button
            onClick={() => {
              console.log('Force reload clicked');
              window.location.reload();
            }}
            className="mt-4 px-4 py-2 text-xs border rounded hover:bg-gray-50"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text2)'
            }}
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  // Handle case where server has no routes
  if (!selectedRoute && selectedServer && (!selectedServer.routes || selectedServer.routes.length === 0)) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl" style={{
            background: '#fee2e2',
            color: '#dc2626'
          }}>
            ⚠
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>No Routes Found</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
            The scanner didn't find any HTTP route definitions in the repository.
          </p>
          <div className="text-xs mb-4 p-3 rounded text-left" style={{
            background: '#f9fafb',
            color: '#6b7280',
            border: '1px solid #e5e7eb'
          }}>
            <p className="mb-2">This can happen if:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>The repository doesn't contain API route handlers</li>
              <li>Routes are defined in a way the scanner doesn't recognize</li>
              <li>The repository is a library/service without HTTP endpoints</li>
            </ul>
          </div>
          <button
            onClick={() => {
              setSchema(null);
              setSelectedServer(null);
              setSelectedRoute(null);
              setShowOnboarding(true);
            }}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            style={{
              background: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            Scan Different Repository
          </button>
        </div>
      </div>
    );
  }

  if (!selectedRoute) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)'
          }}>
            ⟳
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>TraceLab</h1>
          <p className="text-sm mb-2" style={{ color: 'var(--text2)' }}>
            Initializing...
          </p>
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="mt-4 px-4 py-2 text-xs border rounded hover:bg-gray-50"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text2)'
            }}
          >
            Reload Page
          </button>
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
        {/* Inspector Sidebar */}
        {selectedNode && (
          <div className="w-96 border-r flex flex-col" style={{
            background: 'var(--bg)',
            borderColor: 'var(--border)'
          }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                  Step Inspector
                </h3>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-xs px-2 py-1 hover:bg-gray-100 rounded"
                  style={{ color: 'var(--text2)' }}
                >
                  ✕
                </button>
              </div>
              <div className="text-xs" style={{ color: 'var(--text2)' }}>
                Step {selectedNode.stepIndex + 1} of {selectedRoute?.flowSteps.length}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Component Info */}
              <div>
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>
                  COMPONENT
                </div>
                <div className="text-sm font-medium mb-1" style={{ color: 'var(--text)' }}>
                  {selectedNode.component?.name}
                </div>
                <div className="text-xs px-2 py-1 inline-block rounded" style={{
                  background: '#f3f4f6',
                  color: '#6b7280'
                }}>
                  {selectedNode.component?.type}
                </div>
              </div>

              {/* Function */}
              <div>
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>
                  FUNCTION
                </div>
                <div className="text-xs font-mono p-2 rounded" style={{
                  background: '#f9fafb',
                  color: '#374151',
                  border: '1px solid #e5e7eb'
                }}>
                  {selectedNode.flowStep?.functionName}
                </div>
              </div>

              {/* File Path */}
              {selectedNode.component?.filePath && (
                <div>
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>
                    FILE PATH
                  </div>
                  <div className="text-xs p-2 rounded break-all" style={{
                    background: '#f9fafb',
                    color: '#6b7280',
                    border: '1px solid #e5e7eb'
                  }}>
                    {selectedNode.component.filePath}
                  </div>
                </div>
              )}

              {/* Execution Data - Show actual request/response if executed */}
              {executionSteps[selectedNode.stepIndex] && (
                <div>
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>
                    EXECUTION DATA
                  </div>
                  
                  {/* Input Payload */}
                  <div className="mb-3">
                    <div className="text-xs font-medium mb-1 flex items-center gap-2" style={{ color: '#059669' }}>
                      <span>📥 Input</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                        background: '#d1fae5',
                        color: '#065f46'
                      }}>
                        {executionSteps[selectedNode.stepIndex].duration}ms
                      </span>
                    </div>
                    <details className="text-xs">
                      <summary className="cursor-pointer p-2 rounded hover:bg-gray-50" style={{
                        background: '#f0fdf4',
                        color: '#065f46',
                        border: '1px solid #bbf7d0'
                      }}>
                        View Input Payload
                      </summary>
                      <pre className="mt-2 p-2 rounded overflow-x-auto text-[10px] font-mono" style={{
                        background: '#f9fafb',
                        color: '#374151',
                        border: '1px solid #e5e7eb',
                        maxHeight: '200px'
                      }}>
                        {JSON.stringify(executionSteps[selectedNode.stepIndex].inputPayload, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {/* Output Payload */}
                  <div>
                    <div className="text-xs font-medium mb-1 flex items-center gap-2" style={{ color: '#dc2626' }}>
                      <span>📤 Output</span>
                      {executionSteps[selectedNode.stepIndex].outputPayload?.error && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                          background: '#fee2e2',
                          color: '#991b1b'
                        }}>
                          ERROR
                        </span>
                      )}
                      {executionSteps[selectedNode.stepIndex].outputPayload?.success && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                          background: '#d1fae5',
                          color: '#065f46'
                        }}>
                          SUCCESS
                        </span>
                      )}
                    </div>
                    <details className="text-xs" open>
                      <summary className="cursor-pointer p-2 rounded hover:bg-gray-50" style={{
                        background: '#fef2f2',
                        color: '#991b1b',
                        border: '1px solid #fecaca'
                      }}>
                        View Output Payload
                      </summary>
                      <pre className="mt-2 p-2 rounded overflow-x-auto text-[10px] font-mono" style={{
                        background: '#f9fafb',
                        color: '#374151',
                        border: '1px solid #e5e7eb',
                        maxHeight: '200px'
                      }}>
                        {JSON.stringify(executionSteps[selectedNode.stepIndex].outputPayload, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              )}

              {/* Data Transformation - Show expected transformation */}
              {selectedNode.flowStep?.dataTransformation && (
                <div>
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text2)' }}>
                    EXPECTED TRANSFORMATION
                  </div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: '#059669' }}>
                        Expected Input:
                      </div>
                      <div className="text-xs p-2 rounded" style={{
                        background: '#f0fdf4',
                        color: '#065f46',
                        border: '1px solid #bbf7d0'
                      }}>
                        {selectedNode.flowStep.dataTransformation.input}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium mb-1" style={{ color: '#dc2626' }}>
                        Expected Output:
                      </div>
                      <div className="text-xs p-2 rounded" style={{
                        background: '#fef2f2',
                        color: '#991b1b',
                        border: '1px solid #fecaca'
                      }}>
                        {selectedNode.flowStep.dataTransformation.output}
                      </div>
                    </div>
                    {selectedNode.flowStep.dataTransformation.description && (
                      <div>
                        <div className="text-xs font-medium mb-1" style={{ color: 'var(--text2)' }}>
                          Description:
                        </div>
                        <div className="text-xs p-2 rounded" style={{
                          background: '#f9fafb',
                          color: '#374151',
                          border: '1px solid #e5e7eb'
                        }}>
                          {selectedNode.flowStep.dataTransformation.description}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
            onNodeSelect={setSelectedNode}
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