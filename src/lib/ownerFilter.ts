/**
 * Owner filters default to the signed-in person. An unset `owner` in the URL
 * means "mine"; ANY_OWNER is the explicit "Anyone" choice, kept in the URL so
 * a shared everyone-view stays one.
 */
export const ANY_OWNER = 'any'

/** The owner id to filter on — '' means no owner filter. */
export function effectiveOwner(value: string, me: string | null): string {
  if (value === ANY_OWNER) return ''
  return value || me || ''
}

/** What the Owner select shows: the stored value, else me, else Anyone. */
export function ownerSelectValue(value: string, me: string | null): string {
  return value || me || ANY_OWNER
}

/** Choosing yourself clears the param, since that is the default. */
export function ownerParam(picked: string, me: string | null): string {
  return picked === me ? '' : picked
}
