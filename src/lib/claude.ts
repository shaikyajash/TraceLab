import { DiscoveredService, PerServiceResult, CrossServiceCall } from './schema';
import {
  buildPerServicePrompt,
  buildOutputCasesPrompt,
  buildCrossServicePrompt,
  buildTracesOnlyPrompt,
  SOURCE_CHAR_LIMITS,
  type ChunkInfo,
} from './prompts';
import { chat, getModelName as _getModelName, getConfig } from './llm';
import { resolveExternalTypes, type ResolvedExternalType } from './external-types';
import { validatePerServiceResult } from './validator';
import {
  writeArtifact,
  completedEntries,
  readArtifacts,
  aggregateStructure,
  aggregateOutputCases,
  aggregateTraces,
  cleanupArtifacts,
} from './artifacts';

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

// buildRepairPrompt is now inlined in runValidatedCall

// ─── Generic validated LLM call: parse → validate → retry ───────────

interface ValidatedCallOptions {
  system: string;
  user: string;
  label: string;
  maxRetries?: number;
  /** Parse raw JSON string into typed result. Throw if malformed. */
  parse: (jsonStr: string) => unknown;
  /** Validate parsed result. Return error strings or empty array if valid. */
  validate: (parsed: unknown) => string[];
  onProgress?: (msg: string) => void;
}

/**
 * Runs an LLM call with per-chunk validation and retry:
 * 1. Call LLM
 * 2. Parse JSON (retry with JSON-fix prompt if malformed)
 * 3. Validate against schema (retry with repair prompt if invalid)
 * 4. Only return after validation passes or retries exhausted
 */
async function runValidatedCall<T>(opts: ValidatedCallOptions): Promise<T> {
  const { system, user, label, maxRetries = 2, parse, validate, onProgress } = opts;

  // Step 1: LLM call
  let jsonStr: string;
  try {
    jsonStr = await chat({ system, user });
  } catch (err) {
    throw new Error(
      `LLM call failed for ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Step 2: Parse (with JSON-fix retry)
  let result: unknown;
  try {
    result = parse(jsonStr);
  } catch {
    onProgress?.(`  ${label}: malformed JSON, attempting fix...`);
    try {
      const fixed = await chat({
        system: 'Fix the following invalid JSON. Return ONLY valid JSON, nothing else.',
        user: jsonStr,
      });
      result = parse(fixed);
    } catch (fixErr) {
      throw new Error(
        `${label}: JSON parse failed after fix attempt: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`,
      );
    }
  }

  // Step 3: Validate + repair loop
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const errors = validate(result);
    if (errors.length === 0) break; // valid

    if (attempt === maxRetries) {
      onProgress?.(
        `  ${label}: ${errors.length} validation error(s) remain after ${maxRetries} retries`,
      );
      break;
    }

    onProgress?.(
      `  ${label}: ${errors.length} error(s), repairing (attempt ${attempt + 1}/${maxRetries})...`,
    );
    try {
      const repairStr = await chat({
        system:
          'You are fixing a JSON output that has validation errors. Return ONLY the corrected full JSON. No prose, no markdown fences.',
        user: `ERRORS TO FIX:\n${errors.join('\n')}\n\nCURRENT JSON:\n${JSON.stringify(result, null, 2)}`,
      });
      result = parse(repairStr);
    } catch {
      break;
    }
  }

  return result as T;
}

// ─── Phase 1: Structure extraction call ─────────────────────────────

async function runAnalysisCall(
  service: DiscoveredService,
  externalTypes: ResolvedExternalType[],
  chunkInfo: ChunkInfo | undefined,
  options: AnalyzeOptions | undefined,
  label: string,
): Promise<PerServiceResult> {
  const { system, user } = buildPerServicePrompt(service, externalTypes, chunkInfo);

  return runValidatedCall<PerServiceResult>({
    system,
    user,
    label,
    maxRetries: options?.maxRepairAttempts ?? 2,
    parse: (jsonStr) => parseResult(jsonStr),
    validate: (parsed) => {
      const v = validatePerServiceResult(parsed as PerServiceResult, externalTypes);
      return v.errors
        .filter((e) => e.severity === 'error')
        .map((e) => `[${e.category}] ${e.message}`);
    },
    onProgress: options?.onProgress,
  });
}

// ─── Phase 2/3 validators ───────────────────────────────────────────

interface OutputCasesResult {
  output_cases?: Record<string, unknown[]>;
  input_schemas?: Record<string, unknown[]>;
}

function validateOutputCasesResult(parsed: unknown): string[] {
  const errors: string[] = [];
  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('Response is not a JSON object');
    return errors;
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.output_cases || typeof obj.output_cases !== 'object') {
    errors.push('Missing "output_cases" object in response');
  } else {
    const oc = obj.output_cases as Record<string, unknown>;
    for (const [nodeId, cases] of Object.entries(oc)) {
      if (!Array.isArray(cases)) {
        errors.push(`output_cases["${nodeId}"] is not an array`);
        continue;
      }
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i] as Record<string, unknown>;
        if (c.output === undefined) {
          errors.push(`output_cases["${nodeId}"][${i}] missing "output" field`);
        }
        if (c.match !== undefined && !Array.isArray(c.match)) {
          errors.push(`output_cases["${nodeId}"][${i}] "match" must be an array`);
        }
        if (c.terminates !== undefined && typeof c.terminates !== 'boolean') {
          errors.push(`output_cases["${nodeId}"][${i}] "terminates" must be boolean`);
        }
      }
    }
  }
  return errors;
}

interface TracesResult {
  traces?: unknown[];
}

function validateTracesResult(parsed: unknown): string[] {
  const errors: string[] = [];
  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('Response is not a JSON object');
    return errors;
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.traces || !Array.isArray(obj.traces)) {
    errors.push('Missing "traces" array in response');
    return errors;
  }
  for (let i = 0; i < obj.traces.length; i++) {
    const t = obj.traces[i] as Record<string, unknown>;
    if (!t.route_id || typeof t.route_id !== 'string') {
      errors.push(`traces[${i}] missing or invalid "route_id"`);
    }
    if (!t.steps || !Array.isArray(t.steps)) {
      errors.push(`traces[${i}] missing or invalid "steps" array`);
    } else {
      for (let s = 0; s < (t.steps as unknown[]).length; s++) {
        const step = (t.steps as Record<string, unknown>[])[s];
        if (!step.node_id || typeof step.node_id !== 'string') {
          errors.push(`traces[${i}].steps[${s}] missing "node_id"`);
        }
      }
    }
  }
  return errors;
}

// ─── Concurrency helper ─────────────────────────────────────────────

async function runParallel<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Subgraph extraction for per-entry-point Phase 2/3 ──────────────

interface EntrySubgraph {
  entryId: string;
  nodeIds: Set<string>;
}

function extractEntrySubgraphs(
  nodes: PerServiceResult['nodes'],
  edges: PerServiceResult['edges'],
): EntrySubgraph[] {
  const adj = new Map<string, string[]>();
  const incomingNodes = new Set<string>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
    incomingNodes.add(e.to);
  }

  const ENTRY_KINDS = new Set([
    'route_handler',
    'function',
    'business_logic',
    'background_process',
    'message_queue',
  ]);
  const entryPoints = nodes.filter(
    (n) => ENTRY_KINDS.has(n.kind) && (!incomingNodes.has(n.id) || n.kind === 'route_handler'),
  );

  return entryPoints.map((ep) => {
    const visited = new Set<string>();
    const queue = [ep.id];
    visited.add(ep.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of adj.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return { entryId: ep.id, nodeIds: visited };
  });
}

// ─── Service analysis ────────────────────────────────────────────────

export interface AnalyzeOptions {
  workspacePath?: string;
  maxRepairAttempts?: number;
  onProgress?: (message: string) => void;
  /** Slug used for artifact persistence (derived from repo URL) */
  slug?: string;
}

/** Max parallel LLM calls per phase */
const PHASE_CONCURRENCY = 3;

export async function analyzeService(
  service: DiscoveredService,
  options?: AnalyzeOptions,
): Promise<PerServiceResult> {
  const slug = options?.slug || service.name;

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

  // ── Phase 0: Resolve external types ──
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

  // ── Phase 1: Structure extraction (parallel chunks, persisted) ──
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

  // Check which chunks already have artifacts (retry-safe)
  const doneChunks = await completedEntries(slug, 'structure');

  options?.onProgress?.(
    `Phase 1: ${chunks.length} chunk(s), ${doneChunks.size} already done — extracting structure...`,
  );

  const chunkTasks = chunks.map((chunk, i) => async () => {
    const label = chunks.length > 1 ? `chunk-${i + 1}` : 'full';
    if (doneChunks.has(label)) {
      options?.onProgress?.(`  Chunk ${i + 1}/${chunks.length} — cached, skipping`);
      return; // already persisted from a previous run
    }

    const chunkInfo: ChunkInfo | undefined =
      chunks.length > 1 ? { index: i + 1, total: chunks.length, allFileNames } : undefined;

    options?.onProgress?.(`  Chunk ${i + 1}/${chunks.length} (${chunk.length} files)...`);

    const chunkService: DiscoveredService = { ...service, rsFiles: chunk };
    const result = await runAnalysisCall(
      chunkService,
      externalTypes,
      chunkInfo,
      options,
      chunks.length > 1 ? `${service.name} chunk ${i + 1}/${chunks.length}` : service.name,
    );

    // Persist artifact — independently retryable
    await writeArtifact(slug, 'structure', label, result);
    options?.onProgress?.(`  Chunk ${i + 1} → artifact saved`);
  });

  await runParallel(chunkTasks, PHASE_CONCURRENCY);

  // Aggregate all structure artifacts
  const structureArtifacts = await readArtifacts(slug, 'structure');
  const merged = aggregateStructure(structureArtifacts);
  if (!merged) throw new Error(`Phase 1 produced no results for ${service.name}`);

  options?.onProgress?.(
    `Phase 1 complete: ${merged.nodes.length} nodes, ${merged.edges.length} edges`,
  );

  // ── Phase 2: Output cases + input schemas (parallel per entry, persisted) ──
  const subgraphs = extractEntrySubgraphs(merged.nodes, merged.edges);
  const SKIP_KINDS = new Set(['struct', 'enum']);
  const nodeMap = new Map(merged.nodes.map((n) => [n.id, n]));

  if (subgraphs.length > 0) {
    const doneOC = await completedEntries(slug, 'output_cases');

    options?.onProgress?.(
      `Phase 2: ${subgraphs.length} entry point(s), ${doneOC.size} already done — generating output_cases...`,
    );

    const phase2Tasks = subgraphs.map((sg) => async () => {
      if (doneOC.has(sg.entryId)) {
        options?.onProgress?.(
          `  ${nodeMap.get(sg.entryId)?.name || sg.entryId} — cached, skipping`,
        );
        return;
      }

      const sgNodes = merged.nodes.filter((n) => sg.nodeIds.has(n.id) && !SKIP_KINDS.has(n.kind));
      const sgEdges = merged.edges.filter((e) => sg.nodeIds.has(e.from) && sg.nodeIds.has(e.to));
      if (sgNodes.length === 0) return;

      const entryNode = nodeMap.get(sg.entryId);
      options?.onProgress?.(`  output_cases for ${entryNode?.name || sg.entryId}...`);

      try {
        const { system, user } = buildOutputCasesPrompt(
          service.name,
          sgNodes.map((n) => ({
            id: n.id,
            kind: n.kind,
            name: n.name,
            description: n.description ?? '',
            input: n.input,
            output: n.output,
            source_code: n.source_code,
          })),
          sgEdges,
        );

        const parsed = await runValidatedCall<OutputCasesResult>({
          system,
          user,
          label: `output_cases:${entryNode?.name || sg.entryId}`,
          maxRetries: 2,
          parse: (str) => JSON.parse(str),
          validate: (p) => validateOutputCasesResult(p),
          onProgress: options?.onProgress,
        });

        await writeArtifact(slug, 'output_cases', sg.entryId, parsed);
        options?.onProgress?.(`  ${entryNode?.name || sg.entryId} → artifact saved`);
      } catch (err) {
        options?.onProgress?.(
          `  Warning: output_cases failed for ${sg.entryId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    await runParallel(phase2Tasks, PHASE_CONCURRENCY);

    // Aggregate and attach to nodes
    const ocArtifacts = await readArtifacts(slug, 'output_cases');
    aggregateOutputCases(merged.nodes, ocArtifacts);

    options?.onProgress?.(
      `Phase 2 complete: ${merged.nodes.filter((n) => n.output_cases?.length).length} nodes with output_cases`,
    );
  }

  // ── Phase 3: Traces (parallel per entry, persisted) ──
  if (subgraphs.length > 0) {
    const doneTraces = await completedEntries(slug, 'traces');

    options?.onProgress?.(
      `Phase 3: ${subgraphs.length} entry point(s), ${doneTraces.size} already done — generating traces...`,
    );

    const phase3Tasks = subgraphs.map((sg) => async () => {
      if (doneTraces.has(sg.entryId)) {
        options?.onProgress?.(
          `  ${nodeMap.get(sg.entryId)?.name || sg.entryId} — cached, skipping`,
        );
        return;
      }

      const sgNodes = merged.nodes.filter((n) => sg.nodeIds.has(n.id));
      const sgEdges = merged.edges.filter((e) => sg.nodeIds.has(e.from) && sg.nodeIds.has(e.to));
      if (sgNodes.length === 0) return;

      const entryNode = nodeMap.get(sg.entryId);
      options?.onProgress?.(`  traces for ${entryNode?.name || sg.entryId}...`);

      try {
        const { system, user } = buildTracesOnlyPrompt(
          service.name,
          sgNodes.map((n) => ({ ...n, description: n.description ?? '' })),
          sgEdges,
        );

        const parsed = await runValidatedCall<TracesResult>({
          system,
          user,
          label: `traces:${entryNode?.name || sg.entryId}`,
          maxRetries: 2,
          parse: (str) => JSON.parse(str),
          validate: (p) => validateTracesResult(p),
          onProgress: options?.onProgress,
        });

        await writeArtifact(slug, 'traces', sg.entryId, parsed);
        options?.onProgress?.(`  ${entryNode?.name || sg.entryId} → artifact saved`);
      } catch (err) {
        options?.onProgress?.(
          `  Warning: traces failed for ${sg.entryId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    await runParallel(phase3Tasks, PHASE_CONCURRENCY);

    // Aggregate traces
    const traceArtifacts = await readArtifacts(slug, 'traces');
    merged.traces = aggregateTraces(traceArtifacts);

    options?.onProgress?.(`Phase 3 complete: ${merged.traces.length} traces generated`);
  }

  // Clean up intermediate artifacts
  await cleanupArtifacts(slug);

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
