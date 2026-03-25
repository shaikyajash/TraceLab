import { NextRequest } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { validateWorkspacePath, discoverServices, readServiceSource } from '@/lib/scanner';
import { analyzeService, analyzeCrossService } from '@/lib/claude';
import { mergeAndWrite, loadExisting, getOutputPath } from '@/lib/merger';
import { ScanProgress, PerServiceResult } from '@/lib/schema';
import { setProvider, type LLMProvider } from '@/lib/llm';

function encode(progress: ScanProgress): string {
  return JSON.stringify(progress) + '\n';
}

/**
 * Extract a slug from any git URL.
 * https://github.com/user/repo -> user-repo
 * https://gitea.example.com/org/repo/ -> org-repo
 * git@host:user/repo.git -> user-repo
 */
function repoSlug(url: string): string {
  /* try path-based: ...host/user/repo or ...host/org/sub/repo */
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '');
  const pathMatch = cleaned.match(/\/([^/]+)\/([^/]+)$/);
  if (pathMatch) {
    return `${pathMatch[1]}-${pathMatch[2]}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-');
  }
  /* try git@host:user/repo.git */
  const sshMatch = cleaned.match(/:([^/]+)\/([^/]+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}-${sshMatch[2]}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-');
  }
  /* fallback: hash the url */
  return 'repo-' + Buffer.from(url).toString('base64url').slice(0, 16).toLowerCase();
}

/**
 * Normalize a git URL for cloning.
 * Adds .git suffix if missing, handles trailing slashes.
 */
function normalizeGitUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, '');
  if (!normalized.endsWith('.git') && !normalized.startsWith('git@')) {
    normalized += '.git';
  }
  return normalized;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const repoUrl: string = body.url;
  const provider: string | undefined = body.provider;
  const forceRescan: boolean = body.forceRescan === true;

  if (provider === 'claude' || provider === 'gemini' || provider === 'openai') {
    setProvider(provider as LLMProvider);
  }

  if (!repoUrl || typeof repoUrl !== 'string') {
    return new Response(JSON.stringify({ error: 'url is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /* basic validation: must look like a URL or git@ address */
  const trimmed = repoUrl.trim();
  if (!trimmed.match(/^(https?:\/\/|git@)/) && !trimmed.match(/^ssh:\/\//)) {
    return new Response(
      JSON.stringify({
        error: 'Please provide a valid Git URL (e.g. https://gitea.example.com/org/repo)',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const slug = repoSlug(trimmed);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (progress: ScanProgress) => {
        controller.enqueue(new TextEncoder().encode(encode(progress)));
      };

      let clonePath = '';

      try {
        /* check for existing scan first */
        if (!forceRescan) {
          /* We need a workspace path to check cache. Use temp path format. */
          const tempCheck = path.join(os.tmpdir(), 'tracelab-' + slug);
          const existing = await loadExisting(tempCheck);
          if (existing) {
            const outputPath = getOutputPath(tempCheck);
            send({
              phase: 'done',
              message: `Found cached scan for ${slug}. Loaded ${existing.nodes.length} components.`,
              summary: {
                services: existing.services.length,
                nodes: existing.nodes.length,
                edges: existing.edges.length,
                mutations: existing.mutations.length,
                crossServiceCalls: existing.cross_service_calls.length,
                externalPackages: existing.external_packages.length,
                outputPath,
              },
              cached: true,
            });
            controller.close();
            return;
          }
        }

        /* clone the repo into temp */
        clonePath = path.join(os.tmpdir(), 'tracelab-' + slug);

        /* remove any leftover from a previous run */
        await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});

        send({ phase: 'discovering', message: `Cloning ${trimmed}...` });
        const gitUrl = normalizeGitUrl(trimmed);
        execSync(`git clone --depth 1 ${gitUrl} ${clonePath}`, {
          timeout: 120000,
          stdio: 'pipe',
        });
        send({ phase: 'discovering', message: 'Clone complete.' });

        /* validate workspace */
        await validateWorkspacePath(clonePath);

        /* discover services */
        send({ phase: 'discovering', message: 'Scanning for Cargo.toml files...' });
        const services = await discoverServices(clonePath);

        if (services.length === 0) {
          send({
            phase: 'error',
            message: 'No Rust services found. Make sure the repo contains Cargo.toml files.',
          });
          controller.close();
          return;
        }

        send({
          phase: 'reading',
          message: `Found ${services.length} service(s). Reading source files...`,
          servicesFound: services.length,
        });

        /* read source files */
        const servicesWithSource = await Promise.all(
          services.map((s) => readServiceSource(clonePath, s)),
        );

        const totalFiles = servicesWithSource.reduce((sum, s) => sum + s.rsFiles.length, 0);
        send({
          phase: 'reading',
          message: `Read ${totalFiles} .rs files across ${services.length} service(s).`,
          servicesFound: services.length,
        });

        /* analyze services in parallel */
        const CONCURRENCY = 5;
        let completed = 0;
        const total = servicesWithSource.length;
        const perServiceResults: PerServiceResult[] = new Array(total);

        send({
          phase: 'analyzing',
          message: `Analyzing ${total} service(s)...`,
          completedServices: 0,
          totalServices: total,
        });

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
                workspacePath: clonePath,
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

        /* cross-service analysis */
        send({ phase: 'cross_service', message: 'Analyzing cross-service relationships...' });
        const serviceNames = servicesWithSource.map((s) => s.name);
        const crossServiceCalls = await analyzeCrossService(serviceNames, perServiceResults);

        /* merge and write */
        send({ phase: 'merging', message: 'Writing scan results...' });
        const graph = await mergeAndWrite(clonePath, perServiceResults, crossServiceCalls);
        const outputPath = getOutputPath(clonePath);

        /* clean up cloned repo — we have the JSON now */
        if (clonePath) {
          send({ phase: 'merging', message: 'Cleaning up cloned repo...' });
          await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
        }

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
            outputPath,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        send({ phase: 'error', message });
        /* clean up on error too */
        if (clonePath) {
          await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
        }
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
