import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [categories, total] = await Promise.all([
      this.prisma.item_Category.findMany({ orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.item_Category.count(),
    ]);
    return { items: categories, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const category = await this.prisma.item_Category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(body: { code: string; name?: string; remarks?: string }) {
    const existing = await this.prisma.item_Category.findUnique({ where: { code: body.code } });
    if (existing) throw new ConflictException('Category code already exists');
    return this.prisma.item_Category.create({
      data: { code: body.code, name: body.name, remarks: body.remarks },
    });
  }

  async update(id: string, body: { name?: string; remarks?: string }) {
    await this.findOne(id);
    return this.prisma.item_Category.update({
      where: { id },
      data: { name: body.name, remarks: body.remarks },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.item_Category.delete({ where: { id } });
    return { message: 'Category deleted successfully' };
  }
}
