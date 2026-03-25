import { ComponentNode } from "./schema";

export function buildSimulationPrompt(
  node: ComponentNode,
  inputPayload: unknown
): { system: string; user: string } {
  const system = `You are a Rust runtime simulator. Given a Rust component's source code (or description) and an incoming JSON payload, you simulate what the component would produce as output.

You MUST respond with valid JSON only. No prose, no markdown fences.

Output schema:
{
  "output_payload": { ... },
  "explanation": "One or two sentences explaining what this component does to the data",
  "diff_summary": "Brief description of what changed between input and output (e.g., 'Added id field, removed password, hashed password into password_hash')"
}

Rules:
- If the component is a route_handler, simulate deserializing the request and passing it through
- If it's a transformer, show how the data shape changes
- If it's a validator, either pass the data through (valid) or show a validation error response
- If it's a db_call, simulate the query result (generate realistic mock data)
- If it's middleware, show what gets added/modified (e.g., auth headers, user context)
- If no source_code is available, use the component's kind, name, input/output types to make a reasonable simulation
- Always produce valid JSON output_payload
- Keep generated mock data realistic but concise`;

  const sourceInfo = node.source_code
    ? `Source code:\n\`\`\`rust\n${node.source_code}\n\`\`\``
    : `No source code available.`;

  const user = `Simulate the following Rust component:

Name: ${node.name}
Kind: ${node.kind}
Service: ${node.service}
Input type: ${node.input || "unknown"}
Output type: ${node.output || "unknown"}
${node.description ? `Description: ${node.description}` : ""}
${node.mutates_state ? `Mutates: ${node.mutation_target || "state"}` : ""}

${sourceInfo}

Input payload:
\`\`\`json
${JSON.stringify(inputPayload, null, 2)}
\`\`\`

What does this component output?`;

  return { system, user };
}
