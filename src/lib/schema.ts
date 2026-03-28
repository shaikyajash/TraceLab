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

export interface StepCondition {
  field: string;
  op:
    | 'eq'
    | 'neq'
    | 'in'
    | 'not_in'
    | 'exists'
    | 'not_exists'
    | 'eq_field'
    | 'neq_field'
    | 'eq_type'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'not_empty'
    | 'is_empty'
    | 'is_some'
    | 'is_none'
    | 'starts_with'
    | 'ends_with'
    | 'and'
    | 'or'
    | 'not';
  value?: string | string[] | number | boolean;
  conditions?: StepCondition[]; // For and/or/not operations
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
  /**
   * Maps previous step's output to this step's expected input shape.
   * Each key is a field name in this step's input, each value is a dot-notation
   * path into the previous step's output.
   *
   * Example: if previous step outputs {orders: [{create_order: {...}}], caches: {...}}
   * and this step expects a single MatchedOrderVerbose:
   *   input_mapping: {"create_order": "orders[0].create_order", "source_swap": "orders[0].source_swap"}
   *
   * If absent, the entire previous output is passed as-is (backwards compatible).
   */
  input_mapping?: Record<string, string>;
}

export interface ServiceInfo {
  id: string;
  kind: 'service';
  path: string;
  description: string;
}

/** Describes one expected field in a node's input — used for deterministic validation. */
export interface InputFieldSchema {
  /** Dot-notation path: "url", "chains[0].name", "headers.Authorization" */
  field: string;
  /** Expected JS typeof: "string", "number", "boolean", "object", "array" */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** If true, simulation returns a precise error when this field is missing */
  required: boolean;
  /** Human-readable label for error messages, e.g. "executor URL" */
  description?: string;
  /** For string fields: regex pattern the value must match (e.g. "^https?://", "^[0-9a-f]{64}$") */
  pattern?: string;
  /** For string fields: list of allowed values */
  enum?: string[];
  /** EXACT error message from source code to return on validation failure.
   *  e.g. "At least one chain must be provided" — copied verbatim from the Rust source. */
  error_message?: string;
  /** HTTP status code or error code from source (e.g. 400, 422, "BAD_REQUEST") */
  error_status?: number | string;
}

/** One output case for a node — first case where ALL match conditions pass wins.
 *  If no cases match (or output_cases is absent), falls back to example_output ?? inputPayload. */
export interface NodeOutputCase {
  /** If set, ALL conditions must pass. Empty array = unconditional fallback. */
  match?: StepCondition[];
  output: Record<string, unknown> | unknown[] | string | number | boolean | null;
  /** Optional human-readable explanation for this output case */
  explanation?: string;
  /** If true, execution stops at this node (auth rejection, validation failure, error response).
   *  Downstream steps are skipped — this node's output is the final response. */
  terminates?: boolean;
}

/** Compute step for dynamic output generation */
export interface ComputeStep {
  op:
    | 'evaluate_condition'
    | 'priority_select'
    | 'filter'
    | 'count'
    | 'derive'
    | 'map'
    | 'reduce';
  condition?: StepCondition;
  cases?: Array<{ condition: StepCondition; value: unknown }>;
  source?: string;
  transform?: Record<string, string>;
  accumulator?: string;
  reducer?: 'sum' | 'concat' | 'merge';
  output_field: string;
  expression?: string;
}

/** Compute definition for a node — replaces static output_cases with dynamic computation */
export interface ComputeDefinition {
  steps: ComputeStep[];
  output: Record<string, unknown>;
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
    | 'function'
    | 'background_process';

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
  example_input?: Record<string, unknown> | null;
  example_output?: Record<string, unknown> | null;
  /** Conditional output cases — resolved deterministically from the input payload at simulation time */
  output_cases?: NodeOutputCase[];
  /** Input schema for deterministic validation — checked BEFORE output_cases.
   *  If any field fails validation, simulation returns a precise error and terminates. */
  input_schema?: InputFieldSchema[];
  /** Compute definition for dynamic output generation — replaces static output_cases */
  compute?: ComputeDefinition;
  /** Input mapping for this node — maps fields from expected input to actual parameter names */
  input_mapping?: Record<string, string>;
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
  /** If set, stop simulation after this many steps (e.g. 1 = single-node dry run) */
  max_steps?: number;
  graph: ComponentsGraph;
  start_node_id: string;
  initial_payload: unknown;
  breakpoints: string[];
}
