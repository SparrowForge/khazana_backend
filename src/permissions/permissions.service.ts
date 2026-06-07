import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class UpsertPermissionDto {
  roleId: string;
  menuId: string;
  isEnable: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  findByRole(roleId: string) {
    return this.prisma.permission.findMany({
      where: { roleId },
      include: { menu: true },
    });
  }

  async upsert(dto: UpsertPermissionDto) {
    return this.prisma.permission.upsert({
      where: { roleId_menuId: { roleId: dto.roleId, menuId: dto.menuId } },
      create: dto,
      update: {
        isEnable: dto.isEnable,
        canCreate: dto.canCreate,
        canEdit: dto.canEdit,
        canDelete: dto.canDelete,
      },
    });
  }

  async bulkUpsert(roleId: string, permissions: Omit<UpsertPermissionDto, 'roleId'>[]) {
    const ops = permissions.map((p) =>
      this.prisma.permission.upsert({
        where: { roleId_menuId: { roleId, menuId: p.menuId } },
        create: { roleId, ...p },
        update: { isEnable: p.isEnable, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete },
      }),
    );
    return this.prisma.$transaction(ops);
  }
}
