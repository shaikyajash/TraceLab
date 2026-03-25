import { Route, ExecutionStep, ExecutionState } from '@/types/visualizer';

/**
 * Sandbox Executor - Simulates API execution without making real HTTP requests
 * Validates payloads, simulates responses, and shows realistic errors
 */
export class SandboxExecutor {
  
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

    // Validate payload first
    const validationError = this.validatePayload(route, payload);
    if (validationError) {
      throw new Error(validationError);
    }

    // Simulate step-by-step execution
    let currentPayload = payload;
    const startTime = Date.now();

    for (let i = 0; i < route.flowSteps.length; i++) {
      const flowStep = route.flowSteps[i];
      
      // Simulate processing time (2 seconds per step)
      await this.delay(2000);
      
      // Transform data based on the step
      const outputPayload = this.simulateStepExecution(
        flowStep,
        currentPayload,
        i === route.flowSteps.length - 1
      );

      const executionStep: ExecutionStep = {
        stepIndex: i,
        componentId: flowStep.componentId,
        functionName: flowStep.functionName,
        inputPayload: currentPayload,
        outputPayload: outputPayload,
        timestamp: startTime + (i * 2000),
        duration: 2000,
      };

      state.history.push(executionStep);
      state.currentStep = i + 1;
      currentPayload = outputPayload;

      if (onStepComplete) {
        onStepComplete(executionStep);
      }

      if (state.paused) {
        break;
      }
    }

    state.payload = currentPayload;
    return state;
  }

  private validatePayload(route: Route, payload: any): string | null {
    // Simulate validation based on route method and common patterns
    
    if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
      // Check for common required fields based on route path
      if (route.path.includes('/login') || route.path.includes('/auth/login')) {
        if (!payload.email) return 'Email is required';
        if (!payload.password) return 'Password is required';
        if (payload.email && !this.isValidEmail(payload.email)) {
          return 'Invalid email format';
        }
      }

      if (route.path.includes('/register') || route.path.includes('/signup')) {
        if (!payload.email) return 'Email is required';
        if (!payload.password) return 'Password is required';
        if (payload.password && payload.password.length < 8) {
          return 'Password must be at least 8 characters';
        }
      }

      if (route.path.includes('/user') && route.method === 'POST') {
        if (!payload.name && !payload.firstName) return 'Name is required';
        if (!payload.email) return 'Email is required';
      }
    }

    return null;
  }

  private simulateStepExecution(
    flowStep: any,
    inputPayload: any,
    isFinalStep: boolean
  ): any {
    const componentType = flowStep.componentId.toLowerCase();
    const functionName = flowStep.functionName.toLowerCase();

    // Simulate validation step
    if (componentType.includes('validat') || functionName.includes('validat')) {
      // Randomly simulate validation errors (10% chance)
      if (Math.random() < 0.1) {
        return {
          valid: false,
          errors: ['Validation failed: Invalid data format'],
          error: 'Validation error'
        };
      }
      return {
        valid: true,
        errors: [],
        validatedData: inputPayload
      };
    }

    // Simulate authentication/middleware
    if (componentType.includes('middleware') || componentType.includes('auth') || componentType.includes('cookie')) {
      // Simulate auth failure (5% chance)
      if (Math.random() < 0.05) {
        return {
          error: 'Unauthorized',
          message: 'Authentication token is invalid or expired',
          statusCode: 401
        };
      }
      return {
        ...inputPayload,
        authenticated: true,
        userId: 'user_' + Math.random().toString(36).substr(2, 9),
        token: 'jwt_' + Math.random().toString(36).substr(2, 16)
      };
    }

    // Simulate service layer
    if (componentType.includes('service')) {
      if (functionName.includes('create')) {
        return {
          success: true,
          id: 'id_' + Math.random().toString(36).substr(2, 9),
          ...inputPayload,
          createdAt: new Date().toISOString()
        };
      }
      if (functionName.includes('get') || functionName.includes('find')) {
        return {
          success: true,
          id: 'id_' + Math.random().toString(36).substr(2, 9),
          ...inputPayload,
          found: true
        };
      }
      if (functionName.includes('update')) {
        return {
          success: true,
          ...inputPayload,
          updatedAt: new Date().toISOString()
        };
      }
      if (functionName.includes('delete')) {
        return {
          success: true,
          deleted: true,
          deletedAt: new Date().toISOString()
        };
      }
    }

    // Simulate repository/database layer
    if (componentType.includes('repository') || componentType.includes('db') || componentType.includes('client')) {
      // Simulate DB errors (3% chance)
      if (Math.random() < 0.03) {
        return {
          error: 'Database error',
          message: 'Connection timeout or query failed',
          statusCode: 500
        };
      }
      
      if (functionName.includes('save') || functionName.includes('insert')) {
        return {
          success: true,
          ...inputPayload,
          saved: true,
          rowsAffected: 1,
          insertId: Math.floor(Math.random() * 10000)
        };
      }
      if (functionName.includes('select') || functionName.includes('find') || functionName.includes('get')) {
        return {
          success: true,
          data: [{ id: Math.floor(Math.random() * 1000), ...inputPayload }],
          count: 1
        };
      }
      if (functionName.includes('update')) {
        return {
          success: true,
          rowsAffected: 1,
          updated: true
        };
      }
      if (functionName.includes('count')) {
        return {
          success: true,
          count: Math.floor(Math.random() * 100)
        };
      }
    }

    // Simulate notification/external service
    if (componentType.includes('notification') || componentType.includes('email') || componentType.includes('sms')) {
      return {
        success: true,
        sent: true,
        messageId: 'msg_' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString()
      };
    }

    // Simulate response utilities (NextResponse, etc)
    if (componentType.includes('response') || componentType.includes('nextresponse')) {
      if (functionName.includes('json')) {
        return {
          success: true,
          statusCode: 200,
          body: inputPayload
        };
      }
    }

    // Simulate URL/params parsing
    if (componentType.includes('url') || componentType.includes('params')) {
      return {
        ...inputPayload,
        parsed: true,
        params: { id: '123', page: '1', limit: '10' }
      };
    }

    // Final step - return success response
    if (isFinalStep) {
      return {
        success: true,
        message: 'Operation completed successfully',
        statusCode: 200,
        data: inputPayload
      };
    }

    // Default transformation
    return {
      ...inputPayload,
      processed: true,
      step: flowStep.functionName,
      timestamp: new Date().toISOString()
    };
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    const payloadToUse = modifiedPayload || initialPayload;
    let currentPayload = payloadToUse;

    // Execute up to breakpoint
    for (let i = 0; i <= breakpointStep && i < route.flowSteps.length; i++) {
      const flowStep = route.flowSteps[i];
      
      const outputPayload = this.simulateStepExecution(
        flowStep,
        currentPayload,
        i === route.flowSteps.length - 1
      );

      const executionStep: ExecutionStep = {
        stepIndex: i,
        componentId: flowStep.componentId,
        functionName: flowStep.functionName,
        inputPayload: currentPayload,
        outputPayload: outputPayload,
        timestamp: Date.now(),
        duration: 100,
      };

      state.history.push(executionStep);
      state.currentStep = i + 1;
      currentPayload = outputPayload;
    }

    state.paused = true;
    state.payload = currentPayload;
    return state;
  }
}
