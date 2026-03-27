/**
 * Intermediate artifact persistence for multi-stage pipeline.
 * Each phase writes validated JSON artifacts to disk.
 * Failures are isolated and retryable per-artifact.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  PerServiceResult,
  ComponentNode,
  NodeOutputCase,
  InputFieldSchema,
  RouteTrace,
} from './schema';

const TRACELAB_ROOT = process.cwd();
const SCANS_DIR = path.join(TRACELAB_ROOT, 'scans');

export interface PhaseArtifact {
  phase: 'structure' | 'output_cases' | 'traces';
  service: string;
  entry_point?: string;
  timestamp: string;
  data: unknown;
}

function artifactDir(slug: string): string {
  return path.join(SCANS_DIR, `.artifacts-${slug}`);
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
}

/** Write a phase artifact to disk — independently retryable */
export async function writeArtifact(
  slug: string,
  phase: PhaseArtifact['phase'],
  label: string,
  data: unknown,
): Promise<string> {
  const dir = artifactDir(slug);
  await fs.mkdir(dir, { recursive: true });

  const artifact: PhaseArtifact = {
    phase,
    service: slug,
    entry_point: label,
    timestamp: new Date().toISOString(),
    data,
  };

  const filename = `${phase}-${sanitize(label)}.json`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, JSON.stringify(artifact, null, 2), 'utf-8');
  return filepath;
}

/** Read all artifacts for a phase */
export async function readArtifacts(
  slug: string,
  phase: PhaseArtifact['phase'],
): Promise<PhaseArtifact[]> {
  const dir = artifactDir(slug);
  try {
    const files = await fs.readdir(dir);
    const phaseFiles = files.filter((f) => f.startsWith(`${phase}-`) && f.endsWith('.json'));
    const artifacts: PhaseArtifact[] = [];
    for (const f of phaseFiles) {
      const content = await fs.readFile(path.join(dir, f), 'utf-8');
      artifacts.push(JSON.parse(content));
    }
    return artifacts;
  } catch {
    return [];
  }
}

/** Check which entry points already have artifacts (for retry skip) */
export async function completedEntries(
  slug: string,
  phase: PhaseArtifact['phase'],
): Promise<Set<string>> {
  const artifacts = await readArtifacts(slug, phase);
  return new Set(artifacts.map((a) => a.entry_point ?? ''));
}

/** Aggregate Phase 1 artifacts into a merged PerServiceResult */
export function aggregateStructure(artifacts: PhaseArtifact[]): PerServiceResult | null {
  if (artifacts.length === 0) return null;

  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  const seenMutations = new Set<string>();
  const seenPackages = new Set<string>();

  const nodes: PerServiceResult['nodes'] = [];
  const edges: PerServiceResult['edges'] = [];
  const mutations: PerServiceResult['mutations'] = [];
  const external_packages: PerServiceResult['external_packages'] = [];
  let service = (artifacts[0].data as PerServiceResult).service;

  for (const art of artifacts) {
    const part = art.data as PerServiceResult;
    if (part.service) service = part.service;
    for (const n of part.nodes || []) {
      if (!seenNodes.has(n.id)) {
        seenNodes.add(n.id);
        nodes.push(n);
      }
    }
    for (const e of part.edges || []) {
      const key = `${e.from}→${e.to}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push(e);
      }
    }
    for (const m of part.mutations || []) {
      if (!seenMutations.has(m.id)) {
        seenMutations.add(m.id);
        mutations.push(m);
      }
    }
    for (const p of part.external_packages || []) {
      if (!seenPackages.has(p.crate)) {
        seenPackages.add(p.crate);
        external_packages.push(p);
      }
    }
  }

  return { service, nodes, edges, mutations, external_packages, traces: [] };
}

/** Aggregate Phase 2 artifacts — attach output_cases + input_schemas to nodes */
export function aggregateOutputCases(nodes: ComponentNode[], artifacts: PhaseArtifact[]): void {
  for (const art of artifacts) {
    const data = art.data as {
      output_cases?: Record<string, NodeOutputCase[]>;
      input_schemas?: Record<string, InputFieldSchema[]>;
    };
    if (data.output_cases) {
      for (const node of nodes) {
        const cases = data.output_cases[node.id];
        if (cases && Array.isArray(cases)) {
          node.output_cases = cases;
        }
      }
    }
    if (data.input_schemas) {
      for (const node of nodes) {
        const schema = data.input_schemas[node.id];
        if (schema && Array.isArray(schema)) {
          node.input_schema = schema;
        }
      }
    }
  }
}

/** Aggregate Phase 3 artifacts — collect all traces */
export function aggregateTraces(artifacts: PhaseArtifact[]): RouteTrace[] {
  const traces: RouteTrace[] = [];
  for (const art of artifacts) {
    const data = art.data as { traces?: RouteTrace[] };
    if (data.traces && Array.isArray(data.traces)) {
      traces.push(...data.traces);
    }
  }
  return traces;
}

/** Clean up intermediate artifacts after final merge */
export async function cleanupArtifacts(slug: string): Promise<void> {
  const dir = artifactDir(slug);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
