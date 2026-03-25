import { ComponentNode } from './schema';

/**
 * Collects enum and struct definitions from the graph nodes
 * to give the LLM simulation context about valid values and types.
 */
export function collectTypeContext(nodes: ComponentNode[]): string {
  const typeNodes = nodes.filter((n) => n.kind === 'enum' || n.kind === 'struct');
  if (typeNodes.length === 0) return '';

  return typeNodes
    .map((n) => {
      const code = n.source_code || '';
      const fields = n.fields?.map((f) => `  ${f.name}: ${f.type}`).join('\n');
      return `${n.kind} ${n.name}${fields ? `\n${fields}` : ''}${code ? `\n${code}` : ''}`;
    })
    .join('\n\n');
}
