import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateRoleDto {
  name: string;
  description?: string;
}

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.role.findMany({ include: { permissions: { include: { menu: true } } } });
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { menu: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Role name already exists');
    return this.prisma.role.create({ data: dto });
  }

  async update(id: string, dto: Partial<CreateRoleDto>) {
    await this.findOne(id);
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.role.delete({ where: { id } });
  }
}
