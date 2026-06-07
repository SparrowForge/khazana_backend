import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_MENU_KEY } from '../../common/decorators/require-menu.decorator';
import { REQUIRE_PERMISSION_KEY, PermissionAction } from '../../common/decorators/require-permission.decorator';

@Injectable()
export class MenuAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const menuControlName = this.reflector.getAllAndOverride<string>(
      REQUIRE_MENU_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!menuControlName) return true;

    const requiredAction = this.reflector.getAllAndOverride<PermissionAction>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    const role = user.userRoles?.find(
      (r: any) => r.controlName === menuControlName,
    );

    if (!role || role.isEnable !== 'Y') {
      throw new ForbiddenException('Access denied to this menu');
    }

    if (requiredAction === 'create' && role.addAccess !== 'Y') {
      throw new ForbiddenException('No create permission');
    }
    if (requiredAction === 'edit' && role.editAccess !== 'Y') {
      throw new ForbiddenException('No edit permission');
    }
    if (requiredAction === 'delete' && role.deleteAccess !== 'Y') {
      throw new ForbiddenException('No delete permission');
    }

    return true;
  }
}
