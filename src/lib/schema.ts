// Output schema for components.json

export interface ComponentsGraph {
  meta: {
    scanned_at: string;
    workspace_path: string;
    services_found: string[];
    files_scanned: number;
    model: string;
  };
  services: ServiceInfo[];
  nodes: ComponentNode[];
  edges: PayloadEdge[];
  mutations: StateMutation[];
  cross_service_calls: CrossServiceCall[];
  external_packages: ExternalPackage[];
  traces?: RouteTrace[];
}

/** Condition for matching a trace to a payload or filtering a step */
export interface StepCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists' | 'eq_field' | 'neq_field';
  value?: string | string[];
}

/** Precomputed trace — may be parametric via match/when conditions */
export interface RouteTrace {
  route_id: string;
  label: string;
  description: string;
  example_payload: Record<string, unknown>;
  steps: TraceStepDef[];
  /** If set, ALL conditions must be true for this trace to apply. Checked in order — first match wins. */
  match?: StepCondition[];
}

export interface TraceStepDef {
  node_id: string;
  edge_label: string;
  summary: string;
  /** If set, this step is included only when the condition is true against the input payload */
  when?: StepCondition;
}

export interface ServiceInfo {
  id: string;
  kind: 'service';
  path: string;
  description: string;
}

export interface ComponentNode {
  id: string;
  service: string;
  kind:
    | 'route_handler'
    | 'transformer'
    | 'validator'
    | 'middleware'
    | 'business_logic'
    | 'db_call'
    | 'external_http_call'
    | 'struct'
    | 'enum'
    | 'message_queue'

  name: string;
  input?: string;
  output?: string;
  mutates_state: boolean;
  mutation_target?: string;
  defined_in: string;
  description?: string;
  method?: string;
  path_pattern?: string;
  handler?: string;
  fields?: Array<{ name: string; type: string }>;
  used_by_services?: string[];
  source_code?: string;
  example_payload?: string;
  port?: number;
}

export interface PayloadEdge {
  from: string;
  to: string;
  payload: string;
  from_service: string;
  to_service: string;
}

export interface StateMutation {
  id: string;
  service: string;
  kind: 'mutation';
  mutates: string;
  via: string;
  in_component: string;
  defined_in: string;
}

export interface CrossServiceCall {
  id: string;
  kind: 'cross_service_call';
  from_service: string;
  to_service: string;
  via: string;
  endpoint?: string;
  payload_in?: string;
  payload_out?: string;
  defined_in: string;
}

export interface ExternalPackage {
  crate: string;
  used_in_services: string[];
  purpose: string;
}

// Scan progress types for streaming UI updates

export type ScanPhase =
  | 'discovering'
  | 'reading'
  | 'resolving_types'
  | 'analyzing'
  | 'validating'
  | 'cross_service'
  | 'merging'
  | 'writing'
  | 'done'
  | 'error';

export interface ScanProgress {
  phase: ScanPhase;
  message: string;
  servicesFound?: number;
  currentService?: string;
  completedServices?: number;
  totalServices?: number;
  summary?: {
    services: number;
    nodes: number;
    edges: number;
    mutations: number;
    crossServiceCalls: number;
    externalPackages: number;
    outputPath: string;
  };
  cached?: boolean;
}

// Internal types for per-service analysis

export interface DiscoveredService {
  name: string;
  path: string;
  cargoTomlPath: string;
  rsFiles: Array<{ relativePath: string; content: string }>;
}

export interface PerServiceResult {
  service: ServiceInfo;
  nodes: ComponentNode[];
  edges: PayloadEdge[];
  mutations: StateMutation[];
  external_packages: ExternalPackage[];
  traces?: RouteTrace[];
}

// Simulation types

export interface SimulationStep {
  node_id: string;
  node_name: string;
  node_kind: string;
  service: string;
  input_payload: unknown;
  output_payload: unknown;
  explanation: string;
  diff_summary: string;
}

export interface SimulationEvent {
  type: 'step' | 'breakpoint' | 'complete' | 'error';
  step?: SimulationStep;
  node_id?: string;
  message?: string;
}

export interface SimulationRequest {
  graph: ComponentsGraph;
  start_node_id: string;
  initial_payload: unknown;
  breakpoints: string[];
}
