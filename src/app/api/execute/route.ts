import { NextRequest } from 'next/server';
import { SandboxExecutor } from '@/lib/sandbox-executor';
import * as fs from 'fs';
import * as path from 'path';
import { VisualizerSchema } from '@/types/visualizer';

export async function POST(request: NextRequest) {
  try {
    const { routeId, payload, breakpointStep, modifiedPayload } = await request.json();

    console.log('Execute API called (SANDBOX MODE):', { routeId, payload });

    const schemaPath = path.join(process.cwd(), 'public', 'visualizer.json');
    const schema: VisualizerSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

    let route = null;

    for (const server of schema.servers) {
      const foundRoute = server.routes.find(r => r.id === routeId);
      if (foundRoute) {
        route = foundRoute;
        console.log('Found route:', route.path, '(Simulating execution)');
        break;
      }
    }

    if (!route) {
      return Response.json({ error: 'Route not found' }, { status: 404 });
    }

    // Use sandbox executor instead of real HTTP requests
    const executor = new SandboxExecutor();

    let state;
    if (breakpointStep !== undefined) {
      state = await executor.executeWithBreakpoint(
        route,
        payload,
        breakpointStep,
        modifiedPayload
      );
    } else {
      state = await executor.executeRoute(route, payload);
    }

    return Response.json({ success: true, state });
  } catch (error: any) {
    console.error('Execute API error:', error);
    return Response.json(
      { error: error.message || 'Execution failed' },
      { status: 500 }
    );
  }
}
