import fs from 'fs/promises';
import path from 'path';
import { ComponentsGraph, PerServiceResult, CrossServiceCall, ExternalPackage } from './schema';
import { getModelName } from './claude';
import {
  readArtifacts,
  aggregateCompute,
  aggregateInputSchemas,
  aggregateClassifications,
} from './artifacts';

/** TraceLab project root — where all scan outputs are stored */
const TRACELAB_ROOT = process.cwd();
const SCANS_DIR = path.join(TRACELAB_ROOT, 'scans');

function deduplicatePackages(packages: ExternalPackage[]): ExternalPackage[] {
  const byName = new Map<string, ExternalPackage>();
  for (const pkg of packages) {
    const existing = byName.get(pkg.crate);
    if (existing) {
      const services = new Set([...existing.used_in_services, ...pkg.used_in_services]);
      existing.used_in_services = Array.from(services);
      if (pkg.purpose && !existing.purpose.includes(pkg.purpose)) {
        existing.purpose += `; ${pkg.purpose}`;
      }
    } else {
      byName.set(pkg.crate, { ...pkg });
    }
  }
  return Array.from(byName.values());
}

/**
 * Derive the output filename from the workspace.
 * e.g. /Users/dev/order-credentials -> order-credentials.tracelab.json
 */
export function getOutputFileName(workspacePath: string): string {
  const dirName = path.basename(workspacePath);
  const slug = dirName
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-');
  return `${slug}.tracelab.json`;
}

/**
 * Output path is inside TraceLab's scans/ directory, NOT in the scanned workspace.
 */
export function getOutputPath(workspacePath: string): string {
  return path.join(SCANS_DIR, getOutputFileName(workspacePath));
}

/**
 * Check if an existing tracelab JSON file exists in our scans/ directory.
 * Also checks for legacy components.json in the scanned workspace.
 */
export async function loadExisting(workspacePath: string): Promise<ComponentsGraph | null> {
  // Check scans/ directory first
  const outputPath = getOutputPath(workspacePath);
  try {
    const content = await fs.readFile(outputPath, 'utf-8');
    return JSON.parse(content) as ComponentsGraph;
  } catch {
    // Fall through
  }

  // Check legacy components.json in the scanned workspace
  try {
    const legacyPath = path.join(workspacePath, 'components.json');
    const content = await fs.readFile(legacyPath, 'utf-8');
    return JSON.parse(content) as ComponentsGraph;
  } catch {
    return null;
  }
}

export async function mergeAndWrite(
  workspacePath: string,
  perServiceResults: PerServiceResult[],
  crossServiceCalls: CrossServiceCall[],
): Promise<ComponentsGraph> {
  const totalFiles = perServiceResults.reduce(
    (sum, r) => sum + r.nodes.filter((n) => n.defined_in).length,
    0,
  );

  // Derive slug for artifact lookup
  const dirName = path.basename(workspacePath);
  const slug = dirName
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-');

  // Aggregate all nodes first
  const allNodes = perServiceResults.flatMap((r) => r.nodes);

  // Load and merge input schemas (from Phase 2)
  const inputSchemaArtifacts = await readArtifacts(slug, 'input_schemas');
  if (inputSchemaArtifacts.length > 0) {
    aggregateInputSchemas(allNodes, inputSchemaArtifacts);
  }

  // Load and merge compute definitions (from Phase 2b)
  const computeArtifacts = await readArtifacts(slug, 'compute');
  if (computeArtifacts.length > 0) {
    aggregateCompute(allNodes, computeArtifacts);
  }

  // Load and merge classifications (from Phase 2c)
  const classificationArtifacts = await readArtifacts(slug, 'classifications');
  if (classificationArtifacts.length > 0) {
    aggregateClassifications(allNodes, classificationArtifacts);
  }

  const graph: ComponentsGraph = {
    meta: {
      scanned_at: new Date().toISOString(),
      workspace_path: workspacePath,
      services_found: perServiceResults.map((r) => r.service.id),
      files_scanned: totalFiles,
      model: getModelName(),
    },
    services: perServiceResults.map((r) => r.service),
    nodes: allNodes,
    edges: perServiceResults.flatMap((r) => r.edges),
    mutations: perServiceResults.flatMap((r) => r.mutations),
    cross_service_calls: crossServiceCalls,
    external_packages: deduplicatePackages(perServiceResults.flatMap((r) => r.external_packages)),
    traces: perServiceResults.flatMap((r) => r.traces || []),
  };

  // Ensure scans/ directory exists
  await fs.mkdir(SCANS_DIR, { recursive: true });

  const outputPath = getOutputPath(workspacePath);
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2), 'utf-8');

  return graph;
}
