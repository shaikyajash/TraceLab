'use client';

import React, { useCallback, useEffect } from 'react';
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
  onNodeSelect?: (node: any) => void;
}

const KIND_STYLES: Record<string, { bg: string; border: string; badge: string; badgeBg: string; label: string }> = {
  handler: { bg: '#f0f4f9', border: '#378ADD', badge: '#0C447C', badgeBg: '#B5D4F4', label: 'ROUTE' },
  middleware: { bg: '#f5f3f9', border: '#7F77DD', badge: '#3C3489', badgeBg: '#CECBF6', label: 'MIDDLEWARE' },
  service: { bg: '#f0f9f0', border: '#639922', badge: '#27500A', badgeBg: '#C0DD97', label: 'SERVICE' },
  repository: { bg: '#f0f7f9', border: '#1D9E75', badge: '#085041', badgeBg: '#9FE1CB', label: 'DB' },
  util: { bg: '#f9f5f0', border: '#BA7517', badge: '#633806', badgeBg: '#FAC775', label: 'UTIL' },
  validator: { bg: '#f9f3f0', border: '#D85A30', badge: '#712B13', badgeBg: '#F5C4B3', label: 'VALIDATOR' },
};

export default function FlowVisualizer({
  server,
  selectedRoute,
  executionSteps = [],
  currentStep = 0,
  onNodeSelect,
}: FlowVisualizerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (onNodeSelect) {
      const stepIndex = parseInt(node.id.split('-step-')[1]);
      const flowStep = selectedRoute?.flowSteps[stepIndex];
      const component = server.internalComponents.find(c => c.id === flowStep?.componentId);
      onNodeSelect({ node, flowStep, component, stepIndex });
    }
  }, [onNodeSelect, selectedRoute, server]);

  useEffect(() => {
    if (!selectedRoute) return;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Smart layout algorithm
    // - Parallel services (same type, independent) go horizontal
    // - Sequential services (dependent) go vertical
    // - Group by component type for better visualization
    
    const nodeWidth = 200;
    const nodeHeight = 90;
    const verticalGap = 100;
    const horizontalGap = 250;
    const startX = 150;
    const startY = 50;

    // Analyze flow to detect parallel vs sequential patterns
    const steps = selectedRoute.flowSteps.map((step, index) => {
      const component = server.internalComponents.find(c => c.id === step.componentId);
      return { step, component, index };
    });

    // Group consecutive steps of same type (they can be horizontal)
    const groups: any[][] = [];
    let currentGroup: any[] = [];
    let lastType = '';

    steps.forEach((item, index) => {
      const currentType = item.component?.type || 'unknown';
      
      // Start new group if type changes or if it's a critical step (handler, middleware)
      if (currentType !== lastType || 
          currentType === 'handler' || 
          currentType === 'middleware' ||
          currentGroup.length >= 3) { // Max 3 per row
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [item];
      } else {
        currentGroup.push(item);
      }
      
      lastType = currentType;
    });
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    // Position nodes based on groups
    let currentY = startY;
    
    groups.forEach((group, groupIndex) => {
      const groupWidth = group.length * nodeWidth + (group.length - 1) * horizontalGap;
      const groupStartX = startX + (groupWidth > 600 ? 0 : (600 - groupWidth) / 2);
      
      group.forEach((item, indexInGroup) => {
        const { step, component, index } = item;
        if (!component) return;

        const isActive = index === currentStep - 1;
        const isCompleted = index < currentStep;
        const nodeId = `${selectedRoute.id}-step-${index}`;
        
        const kind = KIND_STYLES[component.type] || KIND_STYLES.service;
        
        // Calculate position
        const x = group.length === 1 
          ? startX + 200 // Center single nodes
          : groupStartX + indexInGroup * (nodeWidth + horizontalGap);
        const y = currentY;

        newNodes.push({
          id: nodeId,
          type: 'default',
          data: {
            label: (
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  letterSpacing: '0.8px',
                  padding: '3px 7px',
                  borderRadius: '4px',
                  display: 'inline-block',
                  marginBottom: '7px',
                  background: kind.badgeBg,
                  color: kind.badge
                }}>
                  {kind.label}
                </div>
                <div style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1a1a1f',
                  marginBottom: '4px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {component.name}
                </div>
                <div style={{
                  fontSize: '10px',
                  color: '#666',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {step.functionName}
                </div>
              </div>
            ),
          },
          position: { x, y },
          style: {
            background: isActive ? '#eff6ff' : isCompleted ? '#f0fdf4' : kind.bg,
            border: isActive 
              ? '2px solid #378ADD' 
              : isCompleted 
              ? '2px solid #639922'
              : `1px solid ${kind.border}`,
            borderRadius: '8px',
            width: nodeWidth,
            height: nodeHeight,
            cursor: 'pointer',
            transition: 'all 0.15s',
            boxShadow: isActive 
              ? '0 0 0 3px rgba(59, 130, 246, 0.1)' 
              : isCompleted
              ? '0 0 0 3px rgba(34, 197, 94, 0.1)'
              : 'none'
          },
        });

        // Create edges
        if (index > 0) {
          const prevNodeId = `${selectedRoute.id}-step-${index - 1}`;
          newEdges.push({
            id: `${selectedRoute.id}-edge-${index}`,
            source: prevNodeId,
            target: nodeId,
            animated: index === currentStep - 1,
            type: 'smoothstep',
            style: {
              stroke: isCompleted ? '#639922' : isActive ? '#378ADD' : '#cbd5e1',
              strokeWidth: 2
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isCompleted ? '#639922' : isActive ? '#378ADD' : '#cbd5e1',
              width: 20,
              height: 20
            },
          });
        }
      });
      
      // Move to next row
      currentY += nodeHeight + verticalGap;
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Controls
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}
        />
        <Background
          color="#e5e7eb"
          gap={24}
          size={1}
        />
      </ReactFlow>

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '12px',
        left: '12px',
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '10px 12px',
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        zIndex: 10
      }}>
        {Object.entries(KIND_STYLES).map(([key, style]) => (
          <div key={key} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '10px',
            color: '#666'
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '2px',
              background: style.bg,
              border: `1px solid ${style.border}`
            }}></div>
            {style.label.toLowerCase()}
          </div>
        ))}
      </div>
    </div>
  );
}
