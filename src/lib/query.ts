/**
 * PostgREST `or()` filters are a comma-delimited, parenthesised expression, so
 * a user typing "Tata, Sons (Pvt)" would produce a malformed filter and a 400.
 * Strip the delimiters rather than trying to escape them.
 */
export function sanitizeSearch(term: string): string {
  return term.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()
}
