import { DiscoveredService, PerServiceResult, CrossServiceCall } from './schema';
import { buildPerServicePrompt, buildCrossServicePrompt, buildTracesOnlyPrompt, SOURCE_CHAR_LIMITS, type ChunkInfo } from './prompts';
import { chat, getModelName as _getModelName, getConfig } from './llm';
import { resolveExternalTypes, type ResolvedExternalType } from './external-types';
import { validatePerServiceResult } from './validator';

export { _getModelName as getModelName };

// ─── Helpers ─────────────────────────────────────────────────────────

function parseResult(jsonStr: string): PerServiceResult {
  const result = JSON.parse(jsonStr);
  return {
    service: result.service,
    nodes: result.nodes || [],
    edges: result.edges || [],
    mutations: result.mutations || [],
    external_packages: result.external_packages || [],
    traces: result.traces || [],
  };
}

function buildRepairPrompt(result: PerServiceResult, repairInstructions: string): string {
  return `The following JSON analysis has validation errors. Fix ALL of them and return the corrected FULL JSON.

ERRORS TO FIX:
${repairInstructions}

CURRENT JSON:
${JSON.stringify(result, null, 2)}`;
}

function mergePartialResults(parts: PerServiceResult[]): PerServiceResult {
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const seenMutations = new Set<string>();
  const seenPackages = new Set<string>();

  const nodes: PerServiceResult['nodes'] = [];
  const edges: PerServiceResult['edges'] = [];
  const mutations: PerServiceResult['mutations'] = [];
  const external_packages: PerServiceResult['external_packages'] = [];
  const traces: NonNullable<PerServiceResult['traces']> = [];

  for (const part of parts) {
    for (const n of part.nodes) {
      if (!seenNodes.has(n.id)) { seenNodes.add(n.id); nodes.push(n); }
    }
    for (const e of part.edges) {
      const key = `${e.from}→${e.to}`;
      if (!seenEdges.has(key)) { seenEdges.add(key); edges.push(e); }
    }
    for (const m of part.mutations) {
      if (!seenMutations.has(m.id)) { seenMutations.add(m.id); mutations.push(m); }
    }
    for (const p of part.external_packages) {
      if (!seenPackages.has(p.crate)) { seenPackages.add(p.crate); external_packages.push(p); }
    }
    for (const t of part.traces ?? []) {
      traces.push(t);
    }
  }

  return { service: parts[0].service, nodes, edges, mutations, external_packages, traces };
}

// ─── Single-chunk LLM call + parse + repair ──────────────────────────

async function runAnalysisCall(
  service: DiscoveredService,
  externalTypes: ResolvedExternalType[],
  chunkInfo: ChunkInfo | undefined,
  options: AnalyzeOptions | undefined,
  label: string,
): Promise<PerServiceResult> {
  const { system, user } = buildPerServicePrompt(service, externalTypes, chunkInfo);

  let jsonStr: string;
  try {
    jsonStr = await chat({ system, user });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM call failed for ${label}: ${reason}`);
  }

  let result: PerServiceResult;
  try {
    result = parseResult(jsonStr);
  } catch {
    const fixed = await chat({
      system: 'Fix the following invalid JSON. Return ONLY valid JSON, nothing else.',
      user: jsonStr,
    });
    result = parseResult(fixed);
  }

  const maxAttempts = options?.maxRepairAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const validation = validatePerServiceResult(result, externalTypes);
    if (validation.valid) break;

    options?.onProgress?.(
      `Validation found ${validation.errors.length} error(s) in ${label}, repairing (attempt ${attempt + 1}/${maxAttempts})...`,
    );
    try {
      const repairStr = await chat({
        system: 'You are fixing a JSON analysis that has validation errors. Return ONLY the corrected full JSON. No prose, no markdown fences.',
        user: buildRepairPrompt(result, validation.repairInstructions),
      });
      result = parseResult(repairStr);
    } catch {
      break;
    }
  }

  return result;
}

// ─── Service analysis ────────────────────────────────────────────────

export interface AnalyzeOptions {
  workspacePath?: string;
  maxRepairAttempts?: number;
  onProgress?: (message: string) => void;
}

export async function analyzeService(
  service: DiscoveredService,
  options?: AnalyzeOptions,
): Promise<PerServiceResult> {
  if (service.rsFiles.length === 0) {
    return {
      service: {
        id: service.name,
        kind: 'service',
        path: service.path,
        description: 'Empty service (no .rs files found)',
      },
      nodes: [],
      edges: [],
      mutations: [],
      external_packages: [],
    };
  }

  // Step 1: Resolve external types
  let externalTypes: ResolvedExternalType[] = [];
  if (options?.workspacePath) {
    try {
      options.onProgress?.(`Resolving external types for ${service.name}...`);
      externalTypes = await resolveExternalTypes(options.workspacePath, service);
      if (externalTypes.length > 0) {
        options.onProgress?.(
          `Found ${externalTypes.length} external type(s): ${externalTypes.map((t) => t.typeName).join(', ')}`,
        );
      }
    } catch {
      // Non-fatal
    }
  }

  // Step 2: Split into chunks if service exceeds the provider's budget
  const { provider } = getConfig();
  const chunkBudget = SOURCE_CHAR_LIMITS[provider] ?? Infinity;
  const allFileNames = service.rsFiles.map((f) => f.relativePath);

  const chunks: DiscoveredService['rsFiles'][] = [];
  let current: DiscoveredService['rsFiles'] = [];
  let currentSize = 0;

  for (const file of service.rsFiles) {
    const fileSize = file.content.length + file.relativePath.length + 40;
    if (currentSize + fileSize > chunkBudget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += fileSize;
  }
  if (current.length > 0) chunks.push(current);

  // Step 3: Analyze each chunk (sequentially to respect rate limits)
  const partialResults: PerServiceResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkInfo: ChunkInfo | undefined = chunks.length > 1
      ? { index: i + 1, total: chunks.length, allFileNames }
      : undefined;

    if (chunkInfo) {
      options?.onProgress?.(`Analyzing chunk ${i + 1}/${chunks.length} of ${service.name} (${chunks[i].length} files)...`);
    }

    const chunkService: DiscoveredService = { ...service, rsFiles: chunks[i] };
    const result = await runAnalysisCall(
      chunkService,
      externalTypes,
      chunkInfo,
      options,
      chunks.length > 1 ? `${service.name} chunk ${i + 1}/${chunks.length}` : service.name,
    );
    partialResults.push(result);
  }

  // Step 4: Merge if chunked, otherwise return directly
  if (chunks.length === 1) return partialResults[0];

  const merged = mergePartialResults(partialResults);

  // Step 5: Generate traces in a separate pass now that the full call graph is available
  options?.onProgress?.(`Generating traces for ${service.name} from merged call graph...`);
  try {
    const { system, user } = buildTracesOnlyPrompt(
      service.name,
      merged.nodes.map((n) => ({ ...n, description: n.description ?? '' })),
      merged.edges,
    );
    const jsonStr = await chat({ system, user });
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.traces)) {
      merged.traces = parsed.traces;
    }
  } catch {
    // Non-fatal — merged result still has nodes/edges, traces just stay empty
  }

  return merged;
}

// ─── Cross-service analysis ──────────────────────────────────────────

export async function analyzeCrossService(
  serviceNames: string[],
  perServiceResults: PerServiceResult[],
): Promise<CrossServiceCall[]> {
  if (serviceNames.length < 2) return [];

  const summaries = perServiceResults.map((r) => ({
    serviceName: r.service.id,
    nodes: r.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name })),
  }));

  const { system, user } = buildCrossServicePrompt(serviceNames, summaries);

  try {
    const jsonStr = await chat({ system, user });
    const result = JSON.parse(jsonStr);
    return result.cross_service_calls || [];
  } catch {
    return [];
  }
}
