import { ComponentNode } from './schema';

export interface TraceStepContext {
  /** Label of the selected trace, e.g. "Generate Credentials (EVM-to-EVM)" */
  traceLabel: string;
  /** One-line description of the end-to-end trace */
  traceDescription: string;
  /** The trace step summary — explains what should happen HERE and why */
  stepSummary: string;
  /** The edge label — describes data flowing into this step */
  edgeLabel: string;
  /** Stringified enum/struct definitions for type awareness */
  typeContext: string;
  /** Current step index (0-based) */
  stepIndex: number;
  /** Total steps in the trace */
  totalSteps: number;
}

export function buildSimulationPrompt(
  node: ComponentNode,
  inputPayload: unknown,
  traceContext?: TraceStepContext,
): { system: string; user: string } {
  // ── Base system prompt ──
  let system = `You are a Rust runtime simulator. Given a Rust component's source code and an incoming JSON payload, you simulate exactly what the component would produce as output.

You MUST respond with valid JSON only. No prose, no markdown fences.

Output schema:
{
  "output_payload": { ... },
  "explanation": "One or two sentences explaining what this component does to the data",
  "diff_summary": "Brief description of what changed between input and output"
}`;

  // ── Trace-aware rules (the key upgrade) ──
  if (traceContext) {
    system += `

═══════════════════════════════════════════
TRACE CONTEXT — YOU ARE SIMULATING A SPECIFIC EXECUTION PATH
═══════════════════════════════════════════

Trace: "${traceContext.traceLabel}"
Path description: ${traceContext.traceDescription}
You are at step ${traceContext.stepIndex + 1} of ${traceContext.totalSteps}.

WHAT SHOULD HAPPEN AT THIS STEP:
${traceContext.stepSummary}

${traceContext.edgeLabel ? `DATA FLOWING IN: ${traceContext.edgeLabel}` : ''}

CRITICAL RULES FOR TRACE-AWARE SIMULATION:
1. Follow the step summary EXACTLY. It describes the specific branch taken and why.
2. The step summary includes condition evaluations (e.g. "needs_private_key=false") — reflect these in your output.
3. If the step says a value is skipped, null, or None, output null/None — do NOT generate mock data for it.
4. If the step says an error/validation failure occurs, output an error response — do NOT produce success data.
5. If the input payload contains values that don't match known enum variants, reflect that accurately (validation error, unknown type, etc).
6. Carry forward all fields from the input that aren't explicitly modified at this step.`;
  }

  // ── Kind-specific rules ──
  system += `

COMPONENT-KIND RULES:
- route_handler: Deserialize the request body. Pass through the parsed fields. If the route dispatches to sub-handlers based on a match/enum, output the selected branch and the parsed sub-request.
- middleware: Show what gets added/modified in the request (auth type, headers, user context). Pass through the original payload with additions.
- validator: If input is VALID per the validation rules and source code, pass data through unchanged. If INVALID, output an error response with the specific validation message from the source code.
- transformer: Show exactly how the data shape changes. Include field additions, removals, type conversions.
- business_logic: Orchestrate the logic. Show intermediate decisions (flags, conditions) and the data passed to the next component.
- db_call: Simulate the query. For INSERT: return the stored record. For SELECT: return realistic mock data matching the schema. For UPDATE: confirm rows affected.
- function: Compute and return the result based on the input and source code logic.
- If no source_code is available, use the component's kind, name, input/output types, and description.`;

  // ── Type context ──
  if (traceContext?.typeContext) {
    system += `

═══════════════════════════════════════════
KNOWN TYPES AND ENUMS (from the codebase)
═══════════════════════════════════════════
${traceContext.typeContext}

Use these definitions to validate input values. If the input contains a value like "evm" that isn't an exact enum variant but is semantically close to one (e.g. "Ethereum"), map it to the closest variant. If no variant matches at all, treat it as invalid input.`;
  }

  // ── User message ──
  const sourceInfo = node.source_code
    ? `Source code:\n\`\`\`rust\n${node.source_code}\n\`\`\``
    : `No source code available.`;

  const user = `Simulate this Rust component:

Name: ${node.name}
Kind: ${node.kind}
Service: ${node.service}
Input type: ${node.input || 'unknown'}
Output type: ${node.output || 'unknown'}
${node.description ? `Description: ${node.description}` : ''}
${node.mutates_state ? `Mutates: ${node.mutation_target || 'state'}` : ''}

${sourceInfo}

Input payload:
\`\`\`json
${JSON.stringify(inputPayload, null, 2)}
\`\`\`

What does this component output?`;

  return { system, user };
}
