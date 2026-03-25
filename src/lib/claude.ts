import {
  DiscoveredService,
  PerServiceResult,
  CrossServiceCall,
} from "./schema";
import { buildPerServicePrompt, buildCrossServicePrompt } from "./prompts";
import { chat, getModelName as _getModelName } from "./llm";
import {
  resolveExternalTypes,
  type ResolvedExternalType,
} from "./external-types";
import { validatePerServiceResult } from "./validator";

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

function buildRepairPrompt(
  result: PerServiceResult,
  repairInstructions: string,
): string {
  return `The following JSON analysis has validation errors. Fix ALL of them and return the corrected FULL JSON.

ERRORS TO FIX:
${repairInstructions}

CURRENT JSON:
${JSON.stringify(result, null, 2)}`;
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
        kind: "service",
        path: service.path,
        description: "Empty service (no .rs files found)",
      },
      nodes: [],
      edges: [],
      mutations: [],
      external_packages: [],
    };
  }

  // Step 1: Resolve external type definitions
  let externalTypes: ResolvedExternalType[] = [];
  if (options?.workspacePath) {
    try {
      options.onProgress?.(
        `Resolving external types for ${service.name}...`,
      );
      externalTypes = await resolveExternalTypes(
        options.workspacePath,
        service,
      );
      if (externalTypes.length > 0) {
        options.onProgress?.(
          `Found ${externalTypes.length} external type(s): ${externalTypes.map((t) => t.typeName).join(", ")}`,
        );
      }
    } catch {
      // Non-fatal — proceed without external type context
    }
  }

  // Step 2: Build prompt with external type context
  const { system, user } = buildPerServicePrompt(service, externalTypes);

  // Step 3: Call LLM
  let jsonStr: string;
  try {
    jsonStr = await chat({ system, user });
  } catch {
    throw new Error(`LLM call failed for service ${service.name}`);
  }

  // Step 4: Parse (with JSON-fix retry)
  let result: PerServiceResult;
  try {
    result = parseResult(jsonStr);
  } catch {
    // JSON was malformed — ask LLM to fix it
    const fixed = await chat({
      system:
        "Fix the following invalid JSON. Return ONLY valid JSON, nothing else.",
      user: jsonStr,
    });
    result = parseResult(fixed);
  }

  // Step 5: Validate and repair loop
  const maxAttempts = options?.maxRepairAttempts ?? 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const validation = validatePerServiceResult(result, externalTypes);

    if (validation.valid) {
      if (attempt === 0 && validation.errors.length > 0) {
        options?.onProgress?.(
          `Validation passed with ${validation.errors.length} warning(s)`,
        );
      }
      break;
    }

    options?.onProgress?.(
      `Validation found ${validation.errors.length} error(s), repairing (attempt ${attempt + 1}/${maxAttempts})...`,
    );

    try {
      const repairStr = await chat({
        system:
          "You are fixing a JSON analysis that has validation errors. Return ONLY the corrected full JSON. No prose, no markdown fences.",
        user: buildRepairPrompt(result, validation.repairInstructions),
      });
      result = parseResult(repairStr);
    } catch {
      // Repair failed — use what we have
      break;
    }
  }

  return result;
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
