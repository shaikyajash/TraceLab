import { NextRequest } from 'next/server';
import { validateWorkspacePath, discoverServices, readServiceSource } from '@/lib/scanner';
import { analyzeService, analyzeCrossService } from '@/lib/claude';
import { mergeAndWrite, loadExisting, getOutputFileName } from '@/lib/merger';
import { ScanProgress, PerServiceResult } from '@/lib/schema';
import { setProvider, type LLMProvider } from '@/lib/llm';

function encodeProgress(progress: ScanProgress): string {
  return JSON.stringify(progress) + '\n';
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const workspacePath: string = body.workspacePath;
  const provider: string | undefined = body.provider;
  const forceRescan: boolean = body.forceRescan === true;

  if (provider === 'claude' || provider === 'gemini' || provider === 'openai') {
    setProvider(provider as LLMProvider);
  }

  if (!workspacePath || typeof workspacePath !== 'string') {
    return new Response(JSON.stringify({ error: 'workspacePath is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (progress: ScanProgress) => {
        controller.enqueue(new TextEncoder().encode(encodeProgress(progress)));
      };

      try {
        // Step 1: Validate path
        await validateWorkspacePath(workspacePath);

        // Step 1.5: Check for existing scan
        if (!forceRescan) {
          const outputFileName = getOutputFileName(workspacePath);
          send({ phase: 'discovering', message: `Checking for existing ${outputFileName}...` });

          const existing = await loadExisting(workspacePath);
          if (existing) {
            send({
              phase: 'done',
              message: `Found existing scan (${outputFileName}). Loaded ${existing.nodes.length} components.`,
              summary: {
                services: existing.services.length,
                nodes: existing.nodes.length,
                edges: existing.edges.length,
                mutations: existing.mutations.length,
                crossServiceCalls: existing.cross_service_calls.length,
                externalPackages: existing.external_packages.length,
                outputPath: `${workspacePath}/${outputFileName}`,
              },
              cached: true,
            });
            controller.close();
            return;
          }
        }

        // Step 2: Discover services
        send({ phase: 'discovering', message: 'Scanning for Cargo.toml files...' });
        const services = await discoverServices(workspacePath);

        if (services.length === 0) {
          send({
            phase: 'error',
            message: 'No Rust services found. Make sure the path contains Cargo.toml files.',
          });
          controller.close();
          return;
        }

        send({
          phase: 'reading',
          message: `Found ${services.length} service(s). Reading source files...`,
          servicesFound: services.length,
        });

        // Step 3: Read source files for each service
        const servicesWithSource = await Promise.all(
          services.map((s) => readServiceSource(workspacePath, s)),
        );

        const totalFiles = servicesWithSource.reduce((sum, s) => sum + s.rsFiles.length, 0);
        send({
          phase: 'reading',
          message: `Read ${totalFiles} .rs files across ${services.length} service(s).`,
          servicesFound: services.length,
        });

        // Step 4: Analyze services in parallel (up to 5 concurrent)
        const CONCURRENCY = 5;
        let completed = 0;
        const total = servicesWithSource.length;
        const perServiceResults: PerServiceResult[] = new Array(total);

        send({
          phase: 'analyzing',
          message: `Analyzing ${total} service(s) in parallel...`,
          completedServices: 0,
          totalServices: total,
        });

        // Process in batches of CONCURRENCY
        for (let i = 0; i < total; i += CONCURRENCY) {
          const batch = servicesWithSource.slice(i, i + CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map(async (service, batchIdx) => {
              send({
                phase: 'analyzing',
                message: `Analyzing ${service.name} (${service.rsFiles.length} files)...`,
                currentService: service.name,
                completedServices: completed,
                totalServices: total,
              });
              const result = await analyzeService(service, {
                workspacePath,
                onProgress: (msg) =>
                  send({ phase: 'analyzing', message: `[${service.name}] ${msg}` }),
              });
              completed++;
              send({
                phase: 'analyzing',
                message: `Finished ${service.name}`,
                currentService: service.name,
                completedServices: completed,
                totalServices: total,
              });
              return { index: i + batchIdx, result };
            }),
          );
          for (const { index, result } of batchResults) {
            perServiceResults[index] = result;
          }
        }

        send({
          phase: 'analyzing',
          message: `Completed analysis of all ${total} service(s).`,
          completedServices: total,
          totalServices: total,
        });

        // Step 5: Cross-service analysis
        send({ phase: 'cross_service', message: 'Analyzing cross-service relationships...' });
        const serviceNames = servicesWithSource.map((s) => s.name);
        const crossServiceCalls = await analyzeCrossService(serviceNames, perServiceResults);

        // Step 6: Merge results and write to service-name.tracelab.json
        const outputFileName = getOutputFileName(workspacePath);
        send({ phase: 'merging', message: `Writing ${outputFileName}...` });
        const graph = await mergeAndWrite(workspacePath, perServiceResults, crossServiceCalls);

        // Step 7: Done
        send({
          phase: 'done',
          message: 'Scan complete!',
          summary: {
            services: graph.services.length,
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            mutations: graph.mutations.length,
            crossServiceCalls: graph.cross_service_calls.length,
            externalPackages: graph.external_packages.length,
            outputPath: `${workspacePath}/${outputFileName}`,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        send({ phase: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
