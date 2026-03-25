import { NextRequest } from 'next/server';
import { RequestExecutor } from '@/lib/request-executor';
import * as fs from 'fs';
import * as path from 'path';
import { VisualizerSchema } from '@/types/visualizer';

export async function POST(request: NextRequest) {
  try {
    const { routeId, payload, breakpointStep, modifiedPayload } = await request.json();

    console.log('Execute API called:', { routeId, payload });

    const schemaPath = path.join(process.cwd(), 'public', 'visualizer.json');
    const schema: VisualizerSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

    let route = null;
    let serverBaseUrl = 'http://localhost:3000';

    for (const server of schema.servers) {
      const foundRoute = server.routes.find(r => r.id === routeId);
      if (foundRoute) {
        route = foundRoute;
        // Use baseUrl if provided, otherwise construct from port
        serverBaseUrl = (server as any).baseUrl || `http://localhost:${server.port}`;
        console.log('Found route:', route.path, 'Base URL:', serverBaseUrl);
        break;
      }
    }

    if (!route) {
      return Response.json({ error: 'Route not found' }, { status: 404 });
    }

    const executor = new RequestExecutor(serverBaseUrl);

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
      { error: error.message || 'Execution failed', details: error.response?.data },
      { status: 500 }
    );
  }
}
