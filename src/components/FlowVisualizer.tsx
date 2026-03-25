'use client';

import React, { useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ServerEntity, Route, ExecutionStep } from '@/types/visualizer';

interface FlowVisualizerProps {
  server: ServerEntity;
  selectedRoute?: Route;
  executionSteps?: ExecutionStep[];
  currentStep?: number;
}

export default function FlowVisualizer({
  server,
  selectedRoute,
  executionSteps = [],
  currentStep = 0,
}: FlowVisualizerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!selectedRoute) return;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Server container node
    newNodes.push({
      id: server.id,
      type: 'group',
      data: { 
        label: (
          <div style={{ 
            padding: '12px 16px',
            background: 'var(--bg2)',
            borderRadius: '12px 12px 0 0',
            borderBottom: '1px solid var(--border)'
          }}>
            <div style={{ 
              fontSize: '13px', 
              fontWeight: 600, 
              color: 'var(--text)',
              marginBottom: '2px'
            }}>
              {server.name}
            </div>
            <div style={{ 
              fontSize: '10px', 
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--text3)' 
            }}>
              :{server.port} · {server.language}
            </div>
          </div>
        )
      },
      position: { x: 50, y: 50 },
      style: {
        width: 1200,
        height: 800,
        background: 'var(--bg1)',
        border: '1px solid var(--border2)',
        borderRadius: '16px',
        padding: 0
      },
    });

    // Create nodes for each component in the flow
    selectedRoute.flowSteps.forEach((step, index) => {
      const component = server.internalComponents.find(
        c => c.id === step.componentId
      );

      if (!component) return;

      const isActive = index === currentStep - 1;
      const isCompleted = index < currentStep;

      newNodes.push({
        id: step.componentId,
        type: 'default',
        data: {
          label: (
            <div style={{ textAlign: 'center', padding: '4px' }}>
              <div style={{ 
                fontWeight: 600, 
                fontSize: '12px',
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--text)',
                marginBottom: '4px'
              }}>
                {component.name}
              </div>
              <div style={{ 
                fontSize: '10px', 
                color: 'var(--text3)',
                fontFamily: 'JetBrains Mono, monospace'
              }}>
                {step.functionName}
              </div>
              {step.dataTransformation && (
                <div style={{ 
                  fontSize: '9px', 
                  marginTop: '4px',
                  padding: '2px 6px',
                  background: 'var(--accent-glow)',
                  color: 'var(--accent)',
                  borderRadius: '4px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}>
                  {step.dataTransformation.description}
                </div>
              )}
            </div>
          ),
        },
        position: { x: 150 + index * 250, y: 200 },
        parentId: server.id,
        style: {
          background: isActive
            ? 'var(--accent-glow)'
            : isCompleted
            ? 'var(--green-glow)'
            : 'var(--bg2)',
          border: isActive 
            ? '2px solid var(--accent)' 
            : isCompleted
            ? '2px solid var(--green)'
            : '1px solid var(--border2)',
          padding: '12px',
          borderRadius: '10px',
          minWidth: 180,
          color: 'var(--text)',
          boxShadow: isActive 
            ? '0 0 20px var(--accent-glow)' 
            : isCompleted
            ? '0 0 12px var(--green-glow)'
            : 'none'
        },
      });

      if (index > 0) {
        const prevStep = selectedRoute.flowSteps[index - 1];
        newEdges.push({
          id: `e${prevStep.componentId}-${step.componentId}`,
          source: prevStep.componentId,
          target: step.componentId,
          animated: index === currentStep - 1,
          style: { 
            stroke: isCompleted ? 'var(--green)' : isActive ? 'var(--accent)' : 'var(--border3)', 
            strokeWidth: 2 
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isCompleted ? 'var(--green)' : isActive ? 'var(--accent)' : 'var(--border3)',
          },
        });
      }
    });

    // Add external service calls
    server.externalCalls.forEach((call, index) => {
      const externalNodeId = `external-${call.to}`;
      
      if (!newNodes.find(n => n.id === externalNodeId)) {
        newNodes.push({
          id: externalNodeId,
          type: 'output',
          data: { 
            label: (
              <div style={{ 
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--text)'
              }}>
                {call.to}
              </div>
            )
          },
          position: { x: 150, y: 500 + index * 100 },
          parentId: server.id,
          style: {
            background: 'var(--red-glow)',
            border: '2px solid var(--red)',
            color: 'var(--text)',
            borderRadius: '8px',
            padding: '8px 12px'
          },
        });
      }

      newEdges.push({
        id: `e${call.from}-${externalNodeId}`,
        source: call.from,
        target: externalNodeId,
        label: `${call.method} ${call.endpoint}`,
        style: { 
          stroke: 'var(--red)', 
          strokeDasharray: '5,5',
          strokeWidth: 2
        },
        labelStyle: {
          fill: 'var(--text2)',
          fontSize: '10px',
          fontFamily: 'JetBrains Mono, monospace'
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--red)',
        },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [server, selectedRoute, currentStep, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ 
      width: '100%', 
      height: '100%',
      background: '#fafbfc',
      position: 'relative'
    }}>
      {/* Subtle dot grid background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        pointerEvents: 'none',
        zIndex: 0
      }}></div>
      
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        style={{ background: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls 
          style={{ 
            background: 'white',
            border: '1px solid var(--border2)',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}
        />
        <Background 
          color="var(--border)" 
          gap={24}
          style={{ background: 'transparent' }}
        />
      </ReactFlow>
    </div>
  );
}
