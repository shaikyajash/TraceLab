import axios, { AxiosRequestConfig } from 'axios';
import { ExecutionState, ExecutionStep, Route } from '@/types/visualizer';

export class RequestExecutor {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async executeRoute(
    route: Route,
    payload: any,
    onStepComplete?: (step: ExecutionStep) => void
  ): Promise<ExecutionState> {
    const state: ExecutionState = {
      routeId: route.id,
      currentStep: 0,
      payload,
      history: [],
      paused: false,
    };

    // Execute the actual HTTP request first
    const startTime = Date.now();
    let finalResult: any;
    
    try {
      finalResult = await this.executeActualRequest(route, payload);
    } catch (error: any) {
      console.error('Request failed:', error);
      throw error;
    }

    const totalDuration = Date.now() - startTime;

    // Simulate step-by-step execution for visualization
    // SLOW DOWN: 2 seconds per step for better visibility
    const stepDuration = Math.floor(totalDuration / route.flowSteps.length);
    let currentPayload = payload;

    for (let i = 0; i < route.flowSteps.length; i++) {
      const flowStep = route.flowSteps[i];
      
      // Simulate progressive transformation
      const outputPayload = i === route.flowSteps.length - 1 
        ? finalResult 
        : this.simulateTransformation(currentPayload, flowStep);

      const executionStep: ExecutionStep = {
        stepIndex: i,
        componentId: flowStep.componentId,
        functionName: flowStep.functionName,
        inputPayload: currentPayload,
        outputPayload: outputPayload,
        timestamp: startTime + (i * stepDuration),
        duration: stepDuration,
      };

      state.history.push(executionStep);
      state.currentStep = i + 1;
      currentPayload = outputPayload;

      if (onStepComplete) {
        onStepComplete(executionStep);
        // SLOW DOWN: Wait 2 seconds between steps for visibility
        await this.delay(2000);
      }

      if (state.paused) {
        break;
      }
    }

    return state;
  }

  setPaused(paused: boolean) {
    // This will be called from the UI to pause execution
    this.isPaused = paused;
  }

  private isPaused: boolean = false;

  private simulateTransformation(input: any, flowStep: any): any {
    // Simulate intermediate transformations based on component type
    if (flowStep.dataTransformation) {
      return {
        ...input,
        _step: flowStep.functionName,
        _transformed: true,
      };
    }
    return input;
  }

  private async executeActualRequest(route: Route, payload: any): Promise<any> {
    const config: AxiosRequestConfig = {
      method: route.method.toLowerCase() as any,
      url: `${this.baseUrl}${route.path}`,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (['post', 'put', 'patch'].includes(route.method.toLowerCase())) {
      config.data = payload;
    } else {
      config.params = payload;
    }

    const response = await axios(config);
    return response.data;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeWithBreakpoint(
    route: Route,
    initialPayload: any,
    breakpointStep: number,
    modifiedPayload?: any
  ): Promise<ExecutionState> {
    const state: ExecutionState = {
      routeId: route.id,
      currentStep: 0,
      payload: initialPayload,
      history: [],
      paused: false,
    };

    // For breakpoint execution, we need to re-execute with modified payload
    const payloadToUse = modifiedPayload || initialPayload;
    
    try {
      const result = await this.executeActualRequest(route, payloadToUse);
      
      // Simulate steps up to and including breakpoint
      for (let i = 0; i <= breakpointStep && i < route.flowSteps.length; i++) {
        const flowStep = route.flowSteps[i];
        
        const executionStep: ExecutionStep = {
          stepIndex: i,
          componentId: flowStep.componentId,
          functionName: flowStep.functionName,
          inputPayload: i === 0 ? payloadToUse : state.history[i - 1].outputPayload,
          outputPayload: i === breakpointStep ? result : this.simulateTransformation(payloadToUse, flowStep),
          timestamp: Date.now(),
          duration: 50,
        };

        state.history.push(executionStep);
        state.currentStep = i + 1;
      }

      state.paused = true;
      state.payload = result;
    } catch (error: any) {
      console.error('Breakpoint execution failed:', error);
      throw error;
    }

    return state;
  }
}
