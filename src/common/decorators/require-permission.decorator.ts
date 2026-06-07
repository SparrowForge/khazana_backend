import { SetMetadata } from '@nestjs/common';

export type PermissionAction = 'read' | 'create' | 'edit' | 'delete';

export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (action: PermissionAction) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, action);
