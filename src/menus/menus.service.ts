import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateMenuDto {
  menuName: string;
  controlName: string;
  description?: string;
  icon?: string;
  order?: number;
  parentMenu?: string;
  isActive?: boolean;
}

@Injectable()
export class MenusService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.menu.findMany({ orderBy: [{ parentMenu: 'asc' }, { order: 'asc' }] });
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
