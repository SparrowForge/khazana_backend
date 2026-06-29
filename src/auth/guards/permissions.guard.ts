import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRED_PERMISSION_KEY,
  RequiredPermissionMeta,
} from '../../common/decorators/required-permission.decorator';

interface UserRole {
  controlName: string;
  isEnable?: string | null;
  addAccess?: string | null;
  editAccess?: string | null;
  deleteAccess?: string | null;
}

/**
 * Enforces `@RequiredPermission({ control, action })` against the authenticated
 * user's permission grid (request.user.userRoles, populated by JwtStrategy).
 * Must run AFTER JwtAuthGuard so request.user exists — declare it second in the
 * controller's `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
 *
 * Routes without the decorator pass through untouched.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermissionMeta>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const role: UserRole | undefined = user.userRoles?.find(
      (r: UserRole) => r.controlName === required.control,
    );

    // Menu must be enabled and the specific action flag must be 'Y'.
    if (!role || role.isEnable !== 'Y' || role[required.action] !== 'Y') {
      throw new ForbiddenException(
        `No ${required.action} permission for ${required.control}`,
      );
    }

    return true;
  }
}
