// Re-export all types from schema
export type {
  ComponentsGraph,
  ComponentNode,
  PayloadEdge,
  ScanProgress,
  ScanPhase,
  RouteTrace,
  TraceStepDef,
  StepCondition,
  ServiceInfo,
  StateMutation,
  CrossServiceCall,
  ExternalPackage,
  DiscoveredService,
  PerServiceResult,
  SimulationStep,
  SimulationEvent,
  SimulationRequest,
} from '@/lib/schema';

// UI-specific types
export interface TraceStep {
  nodeId: string;
  name: string;
  kind: string;
  description: string;
  edgeLabel: string;
  inputType: string | null; // node.input type signature
  outputType: string | null; // node.output type signature
  inputPayload?: unknown; // example data flowing in (from LLM simulation)
  outputPayload?: unknown; // example data flowing out (from LLM simulation)
  diffSummary?: string; // what changed between input and output
  /** True if this step's output_case had terminates: true — chain stopped here */
  terminated?: boolean;
  terminatedReason?: string;
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
