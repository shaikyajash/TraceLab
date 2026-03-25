// Re-export all types from schema
export type {
  ComponentsGraph,
  ComponentNode,
  PayloadEdge,
  ScanProgress,
  ScanPhase,
  RouteTrace,
  TraceStepDef,
  ServiceInfo,
  StateMutation,
  CrossServiceCall,
  ExternalPackage,
  DiscoveredService,
  PerServiceResult,
  SimulationStep,
  SimulationEvent,
  SimulationRequest,
} from "@/lib/schema";

// UI-specific types
export interface TraceStep {
  nodeId: string;
  name: string;
  kind: string;
  description: string;
  edgeLabel: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface NodeColors {
  bg: string;
  border: string;
  badgeBg: string;
  badgeText: string;
}
