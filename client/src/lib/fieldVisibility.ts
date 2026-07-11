// Re-exported from shared/ so the exact same visibility logic is enforced
// both in the browser (hiding fields) and on the server (validation +
// clearing values of hidden fields on submit). Keep this file so existing
// imports (`@/lib/fieldVisibility`) across the client keep working.
export { isFieldVisible, type FieldCondition, type VisibilityAwareField } from "@shared/fieldVisibility";
