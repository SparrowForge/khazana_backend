goryimport { Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';

export class PermissionItemDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'Menu UUID' })
  @IsUUID('4')
  menuId: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isEnable: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  canCreate: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  canEdit: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  canDelete: boolean;
}

export class UpsertPermissionDto extends PermissionItemDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'Role UUID' })
  @IsUUID('4')
  roleId: string;
}

export class SyncPermissionsDto {
  @ApiProperty({ type: [PermissionItemDto], description: 'Full replacement set for the role' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  permissions: PermissionItemDto[];
}

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.permission.findMany({ include: { menu: true, role: true } });
  }

  findByRole(roleId: string) {
    return this.prisma.permission.findMany({
      where: { roleId },
      include: { menu: true },
    });
  }

  /** Delete-then-insert in one transaction — the canonical save from the admin/permissions screen. */
  async syncByRole(roleId: string, permissions: PermissionItemDto[]) {
    return this.prisma.$transaction([
      this.prisma.permission.deleteMany({ where: { roleId } }),
      this.prisma.permission.createMany({
        data: permissions.map((p) => ({ roleId, ...p })),
      }),
    ]);
  }

  removeByRole(roleId: string) {
    return this.prisma.permission.deleteMany({ where: { roleId } });
  }

  async remove(id: string) {
    const perm = await this.prisma.permission.findUnique({ where: { id } });
    if (!perm) throw new NotFoundException('Permission not found');
    return this.prisma.permission.delete({ where: { id } });
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
}
