import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class CreateMenuDto {
  @IsString()
  @IsNotEmpty()
  menuName: string;

  @IsString()
  @IsNotEmpty()
  controlName: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsString()
  @IsOptional()
  parentMenu?: string;

  @IsString()
  @IsOptional()
  module?: string; // 'Sale' | 'Purchase' | 'Inventory'

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

@Injectable()
export class MenusService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [menus, total] = await Promise.all([
      this.prisma.menu.findMany({ orderBy: [{ parentMenu: 'asc' }, { order: 'asc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.menu.count(),
    ]);
    return { items: menus, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('Menu not found');
    return menu;
  }

  create(dto: CreateMenuDto) {
    return this.prisma.menu.create({ data: dto });
  }

  async update(id: string, dto: Partial<CreateMenuDto>) {
    await this.findOne(id);
    return this.prisma.menu.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.menu.delete({ where: { id } });
  }
}
