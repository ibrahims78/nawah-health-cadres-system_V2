/**
 * Shared (client + server) logic for conditional field visibility.
 * Moved here from client/src/lib/fieldVisibility.ts so the server can enforce
 * the exact same rules used by the public form UI — e.g. clearing values of
 * fields that become hidden, and validating only fields that are actually
 * visible given the current submission data.
 */
export interface FieldCondition {
  field: string;
  value?: string | null;
  negate?: boolean;
}

export interface VisibilityAwareField {
  conditions?: FieldCondition[] | null;
  conditionOperator?: "AND" | "OR" | null;
}

function evaluateCondition(condition: FieldCondition, watched: Record<string, any>): boolean {
  const triggerVal = watched[condition.field];
  let matches: boolean;
  if (condition.value === null || condition.value === undefined || condition.value === "") {
    matches = triggerVal !== "" && triggerVal !== null && triggerVal !== undefined;
  } else {
    matches = String(triggerVal ?? "") === condition.value;
  }
  return condition.negate ? !matches : matches;
}

/**
 * Determines whether a field should be visible given the current values of the form.
 * Supports multiple conditions combined with AND/OR, and per-condition negation (NOT).
 */
export function isFieldVisible(f: VisibilityAwareField, watched: Record<string, any>): boolean {
  const conditions = f.conditions;
  if (!conditions || conditions.length === 0) return true;
  const operator = f.conditionOperator || "AND";
  return operator === "OR"
    ? conditions.some(c => evaluateCondition(c, watched))
    : conditions.every(c => evaluateCondition(c, watched));
}
