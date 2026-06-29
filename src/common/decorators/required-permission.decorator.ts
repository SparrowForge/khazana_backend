import { SetMetadata } from '@nestjs/common';

/** Per-user access flags on t_UserRole (and the login `permissions[]`). */
export type PermissionFlag = 'addAccess' | 'editAccess' | 'deleteAccess';

export interface RequiredPermissionMeta {
  /** The permission block's controlName, e.g. 'Items'. */
  control: string;
  /** The action flag that must equal 'Y'. */
  action: PermissionFlag;
}

export const REQUIRED_PERMISSION_KEY = 'required_permission';

/**
 * Declares the permission a route requires, e.g.
 *   `@RequiredPermission({ control: 'Items', action: 'editAccess' })`
 * Enforced by PermissionsGuard against the authenticated user's permission grid.
 */
export const RequiredPermission = (meta: RequiredPermissionMeta) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, meta);
