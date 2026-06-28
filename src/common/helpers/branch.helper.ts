/** Default branch ('Factory') used when a branch identifier is missing or invalid.
 *  Several branch columns are NOT NULL, so a value must always be resolvable. */
export const DEFAULT_BRANCH_ID = '922f5942-43fc-41fc-87af-fcb8770bc3a8';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a branch identifier to a Branch UUID for the (now uuid) branch columns.
 *  The session branch is already a UUID, so this just validates and passes it
 *  through; anything missing/invalid falls back to the default branch so the
 *  NOT NULL branch columns always receive a valid value. */
export function toBranchUuid(value?: string | null, fallback: string = DEFAULT_BRANCH_ID): string {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim() : fallback;
}
