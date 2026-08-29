import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';
import { CreateUomDto, UpdateUomDto } from './dto/uom.dto';

/**
 * Units of measure. A lookup list, the same shape as Item_Category — the item
 * form reads it to fill its UOM dropdown.
 *
 * The unit is stored on the item as text, not as a foreign key (that is how
 * itmUOM has always worked), so this table is the list of what may be PICKED.
 * Nothing here rewrites items, which is why the code cannot be edited and why
 * deleting a unit still in use is refused.
 */
@Injectable()
export class UomsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto) {
    const { page, limit } = query;
    const [items, total] = await Promise.all([
      this.prisma.item_UOM.findMany({
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.item_UOM.count(),
    ]);
    return { items, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const uom = await this.prisma.item_UOM.findUnique({ where: { id } });
    if (!uom) throw new NotFoundException('UOM not found');
    return uom;
  }

  async create(dto: CreateUomDto) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('UOM code is required');
    const existing = await this.prisma.item_UOM.findUnique({ where: { code } });
    if (existing) throw new ConflictException('UOM code already exists');
    return this.prisma.item_UOM.create({
      data: { code, name: dto.name?.trim() || code, remarks: dto.remarks },
    });
  }

  async update(id: string, dto: UpdateUomDto) {
    await this.findOne(id);
    return this.prisma.item_UOM.update({
      where: { id },
      data: { name: dto.name, remarks: dto.remarks },
    });
  }

  async remove(id: string) {
    const uom = await this.findOne(id);
    // Items keep the unit as text, so deleting a unit in use would not break
    // them — it would just leave a value the dropdown can no longer offer, and
    // an item edited afterwards would silently lose it. Refuse instead.
    const inUse = await this.prisma.item_Information.count({ where: { itmUOM: uom.code } });
    if (inUse > 0) {
      throw new ConflictException(`${uom.code} is used by ${inUse} item(s) and cannot be deleted`);
    }
    await this.prisma.item_UOM.delete({ where: { id } });
    return { message: 'UOM deleted successfully' };
  }
}
