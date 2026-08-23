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

/** True when a branch is the factory. There is no `isFactory` column, so the
 *  factory is identified by convention on its code/name — the same convention
 *  the Demand Order screen already uses. Live data has code 'FAC' / name
 *  'Factory'; prisma/seed.ts creates code 'Factory' / name 'Factory'. Matching
 *  either field keeps both shapes working. */
export function isFactoryBranch(branch?: { branchCode?: string | null; branchName?: string | null } | null): boolean {
  if (!branch) return false;
  const code = (branch.branchCode ?? '').trim();
  const name = (branch.branchName ?? '').trim();
  return /^fac(tory)?$/i.test(code) || /factory/i.test(name);
}

/**
 * Prisma `where` fragment restricting rows to the branches a user may see.
 *
 * `accessible` is the caller's branch set (`@CurrentUser('branchIds')`).
 * `fields` are the branch columns on the table — one for most, two for the
 * documents that have a source and a destination (an issue is visible to both
 * the branch that sent it and the branch it was sent to).
 * `requested` is an explicit branch filter from the query string, which can only
 * ever NARROW the set: asking for a branch you cannot see returns nothing rather
 * than everything.
 *
 * Passing `accessible` as undefined means "unrestricted" — for internal callers
 * and reports that do their own gating. Never pass undefined straight from a
 * request.
 */
export function branchScope(
  accessible: string[] | undefined,
  fields: string[],
  requested?: string | null,
): Record<string, unknown> {
  if (!accessible) {
    // Unrestricted caller: honour an explicit filter, otherwise no constraint.
    return requested ? { [fields[0]]: requested } : {};
  }
  const ids = requested ? (accessible.includes(requested) ? [requested] : []) : accessible;
  // An empty list is deliberate, not a no-op: Prisma turns `in: []` into a
  // always-false predicate, which is the right answer for a branch the user has
  // no access to.
  if (fields.length === 1) return { [fields[0]]: { in: ids } };
  return { OR: fields.map((field) => ({ [field]: { in: ids } })) };
}

/** True when at least one of a row's branch columns is in the caller's set. */
export function canAccessBranch(accessible: string[] | undefined, ...rowBranchIds: (string | null | undefined)[]): boolean {
  if (!accessible) return true;
  return rowBranchIds.some((id) => !!id && accessible.includes(id));
}
