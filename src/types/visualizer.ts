// Core schema for visualizer.json
export interface VisualizerSchema {
  servers: ServerEntity[];
  externalServices: ExternalService[];
}

export interface ServerEntity {
  id: string;
  name: string;
  port: number;
  language: string;
  routes: Route[];
  internalComponents: InternalComponent[];
  externalCalls: ExternalCall[];
}

export interface Route {
  id: string;
  path: string;
  method: string;
  handler: string;
  examplePayload?: any;
  flowSteps: FlowStep[];
}

export interface InternalComponent {
  id: string;
  name: string;
  type: 'handler' | 'middleware' | 'service' | 'repository' | 'util';
  filePath: string;
  functions: ComponentFunction[];
}

export interface ComponentFunction {
  name: string;
  params: string[];
  returns: string;
  transformsData: boolean;
}

export interface FlowStep {
  componentId: string;
  functionName: string;
  order: number;
  dataTransformation?: DataTransformation;
}

export interface DataTransformation {
  input: string;
  output: string;
  description: string;
}

export interface ExternalCall {
  from: string;
  to: string;
  method: string;
  endpoint: string;
}

export interface ExternalService {
  id: string;
  name: string;
  baseUrl: string;
}

// Runtime execution types
export interface ExecutionState {
  routeId: string;
  currentStep: number;
  payload: any;
  history: ExecutionStep[];
  paused: boolean;
}

export interface ExecutionStep {
  stepIndex: number;
  componentId: string;
  functionName: string;
  inputPayload: any;
  outputPayload: any;
  timestamp: number;
  duration: number;
}
