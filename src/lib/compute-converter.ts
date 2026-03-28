/**
 * Utility to convert static output_cases to compute definitions.
 * Helps migrate existing JSON files to the new compute-based format.
 */

import type { NodeOutputCase, ComputeDefinition, ComputeStep } from './schema';

/**
 * Convert output_cases to a compute definition.
 * This is a best-effort conversion - complex cases may need manual adjustment.
 */
export function convertOutputCasesToCompute(
  outputCases: NodeOutputCase[],
): ComputeDefinition | null {
  if (!outputCases || outputCases.length === 0) return null;

  const steps: ComputeStep[] = [];
  const cases: Array<{ condition: any; value: unknown }> = [];

  // Convert each output_case to a priority_select case
  for (const oc of outputCases) {
    if (!oc.match || oc.match.length === 0) {
      // Catch-all case
      cases.push({
        condition: { field: '_always', op: 'exists' },
        value: oc.output,
      });
    } else if (oc.match.length === 1) {
      // Single condition
      cases.push({
        condition: oc.match[0],
        value: oc.output,
      });
    } else {
      // Multiple conditions - use AND
      cases.push({
        condition: {
          field: '_combined',
          op: 'and',
          conditions: oc.match,
        },
        value: oc.output,
      });
    }
  }

  // Create priority_select step
  steps.push({
    op: 'priority_select',
    cases,
    output_field: '$result',
  });

  // Determine output structure based on first case
  const firstOutput = outputCases[0]?.output;
  let outputMapping: Record<string, any>;

  if (typeof firstOutput === 'object' && firstOutput !== null && !Array.isArray(firstOutput)) {
    // Object output - map each field
    outputMapping = {};
    for (const key of Object.keys(firstOutput)) {
      outputMapping[key] = `$result.${key}`;
    }
  } else {
    // Primitive or array output
    outputMapping = { value: '$result' };
  }

  return {
    steps,
    output: outputMapping,
  };
}

/**
 * Analyze output_cases to suggest compute steps.
 * Returns a more sophisticated compute definition with explicit condition evaluation.
 */
export function suggestComputeSteps(
  outputCases: NodeOutputCase[],
  inputSchema?: Array<{ field: string; type: string; required: boolean }>,
): ComputeDefinition | null {
  if (!outputCases || outputCases.length === 0) return null;

  const steps: ComputeStep[] = [];
  const conditionFields = new Set<string>();

  // Collect all fields used in conditions
  for (const oc of outputCases) {
    if (!oc.match) continue;
    for (const cond of oc.match) {
      if (cond.field) {
        conditionFields.add(cond.field);
      }
    }
  }

  // Generate evaluate_condition steps for each unique field
  let condIndex = 0;
  const conditionVars = new Map<string, string>();
  
  for (const field of conditionFields) {
    const varName = `$cond_${condIndex++}`;
    conditionVars.set(field, varName);
    
    // Find a representative condition for this field
    const sampleCond = outputCases
      .flatMap((oc) => oc.match || [])
      .find((c) => c.field === field);
    
    if (sampleCond) {
      steps.push({
        op: 'evaluate_condition',
        condition: sampleCond,
        output_field: varName,
      });
    }
  }

  // Convert output_cases to priority_select cases
  const cases: Array<{ condition: any; value: unknown }> = [];
  
  for (const oc of outputCases) {
    if (!oc.match || oc.match.length === 0) {
      // Catch-all
      cases.push({
        condition: { field: '_always', op: 'exists' },
        value: oc.output,
      });
    } else {
      // Use the original conditions (they reference input fields)
      const condition =
        oc.match.length === 1
          ? oc.match[0]
          : { field: '_combined', op: 'and', conditions: oc.match };
      
      cases.push({
        condition,
        value: oc.output,
      });
    }
  }

  steps.push({
    op: 'priority_select',
    cases,
    output_field: '$result',
  });

  // Build output mapping
  const firstOutput = outputCases[0]?.output;
  let outputMapping: Record<string, any>;

  if (typeof firstOutput === 'object' && firstOutput !== null && !Array.isArray(firstOutput)) {
    outputMapping = {};
    for (const key of Object.keys(firstOutput)) {
      outputMapping[key] = `$result.${key}`;
    }
  } else {
    outputMapping = { value: '$result' };
  }

  return {
    steps,
    output: outputMapping,
  };
}

/**
 * Generate a compute definition for a filter operation.
 * Common pattern: filter array, count results, return filtered + count.
 */
export function generateFilterCompute(
  sourceField: string,
  filterCondition: any,
  outputFields: { filtered: string; count: string },
): ComputeDefinition {
  return {
    steps: [
      {
        op: 'filter',
        source: sourceField,
        condition: filterCondition,
        output_field: '$filtered',
      },
      {
        op: 'count',
        source: '$filtered',
        output_field: '$count',
      },
    ],
    output: {
      [outputFields.filtered]: '$filtered',
      [outputFields.count]: '$count',
    },
  };
}

/**
 * Generate a compute definition for a classifier.
 * Common pattern: evaluate multiple conditions, select first match.
 */
export function generateClassifierCompute(
  conditions: Array<{ field: string; op: string; value: any; output: string }>,
): ComputeDefinition {
  const steps: ComputeStep[] = [];

  // Evaluate each condition
  for (let i = 0; i < conditions.length; i++) {
    steps.push({
      op: 'evaluate_condition',
      condition: {
        field: conditions[i].field,
        op: conditions[i].op as any,
        value: conditions[i].value,
      },
      output_field: `$cond_${i}`,
    });
  }

  // Priority select based on evaluated conditions
  const cases = conditions.map((c, i) => ({
    condition: { field: `$cond_${i}`, op: 'eq' as const, value: true },
    value: { value: c.output },
  }));

  steps.push({
    op: 'priority_select',
    cases,
    output_field: '$result',
  });

  return {
    steps,
    output: {
      value: '$result.value',
    },
  };
}
