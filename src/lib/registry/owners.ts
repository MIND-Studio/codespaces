/**
 * Owner-level metadata not yet captured in the schema. For the prototype,
 * an "organization" is just a hardcoded list of owner names that the
 * dashboard renders with an ORG badge — there's no membership model, no
 * org-level settings, no separate auth surface. Add a name here and any
 * repo owned by it will be marked as an org repo.
 */
export const KNOWN_ORGS = new Set<string>(["mind"]);

export function isOrg(owner: string): boolean {
  return KNOWN_ORGS.has(owner);
}
