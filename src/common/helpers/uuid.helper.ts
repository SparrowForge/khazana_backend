/** Canonical uuid shape. Used where a route or DTO accepts either an entity id
 *  or a legacy code in the same field, to tell the two apart without a lookup. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` looks like a uuid rather than a human-typed code. */
export const isUuid = (value: string | null | undefined): boolean =>
  !!value && UUID_RE.test(value.trim());
