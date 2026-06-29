import { Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class NcAdjustmentItemDto {
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsNumber()
  qty: number;

  @IsString()
  @IsOptional()
  uom?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsNumber()
  @IsOptional()
  vatValue?: number;

  @IsNumber()
  @IsOptional()
  vatAmount?: number;

  @IsNumber()
  @IsOptional()
  discount?: number;

  @IsNumber()
  @IsOptional()
  netAmount?: number;
}

export class CreateNcAdjustmentDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NcAdjustmentItemDto)
  items: NcAdjustmentItemDto[];
}

/** Update payload — all fields optional. Omit `items` to edit only the header
 *  (no stock change); supply `items` to replace the lines and re-reconcile stock. */
export class UpdateNcAdjustmentDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NcAdjustmentItemDto)
  items?: NcAdjustmentItemDto[];
}

@Injectable()
export class NcAdjustmentService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { ncmstrIsActive: true, ...(branchId && { branchId }) };
    const [rows, total] = await Promise.all([
      this.prisma.t_NCMstr.findMany({ where, include: { details: true }, orderBy: { ncmstrDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.t_NCMstr.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const nc = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: { details: { include: { item: true } } },
    });
    if (!nc) throw new NotFoundException('NC adjustment not found');
    return nc;
  }

  async create(dto: CreateNcAdjustmentDto, userName: string, sessionBranchId?: string) {
    // branchId is session-authoritative: prefer the logged-in user's branch so
    // NC entries always carry a branch (and thus appear in the Daily Final
    // Report); fall back to the payload only if the session lacks one.
    const branchId = sessionBranchId ?? dto.branchId;
    const nc = await this.prisma.t_NCMstr.create({
      data: {
        ncmstrCode: dto.code,
        ncmstrDate: new Date(dto.date),
        ncmstrName: dto.name,
        ncmstrContactNo: dto.contactNo,
        ncmstrReference: dto.reference,
        branchId,
        ncmstrIsActive: true,
        ncmstrCreator: userName,
        ncmstrCreationDate: new Date(),
        details: {
          create: dto.items.map((item, index) => ({
            ncdetItemSLNum: String(index + 1),
            ncdetItemOID: item.itemId,
            ncdetQTY: item.qty,
            ncdetUOM: item.uom,
            ncdetPrice: item.price ?? 0,
            ncdetAmount: item.amount ?? 0,
            ncdetVATValue: item.vatValue ?? 0,
            ncdetVATAmount: item.vatAmount ?? 0,
            ncdetDiscount: item.discount ?? 0,
            ncdetNetAmount: item.netAmount ?? 0,
            branchId,
          })),
        },
      },
      include: { details: true },
    });

    // NC adjustment adds stock back
    await this.adjustStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.qty })));

    return nc;
  }

  async update(id: string, dto: UpdateNcAdjustmentDto, userName: string, sessionBranchId?: string) {
    const existing = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing || existing.ncmstrIsActive === false) {
      throw new NotFoundException('NC adjustment not found');
    }

    // Keep branchId session-authoritative and backfill it on edit so any older
    // record saved without a branch is repaired.
    const branchId = existing.branchId ?? sessionBranchId ?? null;

    // When the lines change, reverse the previous stock additions and drop the
    // old detail rows before writing the new ones.
    if (dto.items) {
      await this.adjustStock(
        existing.details.map((d) => ({ itemId: d.ncdetItemOID, qty: -Number(d.ncdetQTY ?? 0) })),
      );
      await this.prisma.t_NCDet.deleteMany({ where: { t_NCMstr_id: id } });
    }

    const data: Record<string, unknown> = {
      ncmstrUpdateBy: userName,
      ncmstrUpdateDate: new Date(),
      branchId,
    };
    if (dto.code !== undefined) data.ncmstrCode = dto.code;
    if (dto.date !== undefined) data.ncmstrDate = new Date(dto.date);
    if (dto.name !== undefined) data.ncmstrName = dto.name;
    if (dto.contactNo !== undefined) data.ncmstrContactNo = dto.contactNo;
    if (dto.reference !== undefined) data.ncmstrReference = dto.reference;
    if (dto.items) {
      data.details = {
        create: dto.items.map((item, index) => ({
          ncdetItemSLNum: String(index + 1),
          ncdetItemOID: item.itemId,
          ncdetQTY: item.qty,
          ncdetUOM: item.uom,
          ncdetPrice: item.price ?? 0,
          ncdetAmount: item.amount ?? 0,
          ncdetVATValue: item.vatValue ?? 0,
          ncdetVATAmount: item.vatAmount ?? 0,
          ncdetDiscount: item.discount ?? 0,
          ncdetNetAmount: item.netAmount ?? 0,
          branchId,
        })),
      };
    }

    const nc = await this.prisma.t_NCMstr.update({
      where: { id },
      data,
      include: { details: true },
    });

    // Apply the new lines' stock additions.
    if (dto.items) {
      await this.adjustStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.qty })));
    }

    return nc;
  }

  async remove(id: string) {
    const existing = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing) {
      throw new NotFoundException('NC adjustment not found');
    }

    // Reverse the stock this NC added, then hard-delete master + its details.
    await this.adjustStock(
      existing.details.map((d) => ({ itemId: d.ncdetItemOID, qty: -Number(d.ncdetQTY ?? 0) })),
    );
    await this.prisma.$transaction([
      this.prisma.t_NCDet.deleteMany({ where: { t_NCMstr_id: id } }),
      this.prisma.t_NCMstr.delete({ where: { id } }),
    ]);

    return { message: 'NC adjustment deleted successfully' };
  }

  /** Apply stock deltas keyed by item id (inventory is keyed by itemCode).
   *  Positive adds, negative removes. Mirrors the non-transactional pattern of
   *  `create`. */
  private async adjustStock(deltas: { itemId: string; qty: number }[]) {
    for (const d of deltas) {
      if (!d.qty) continue;
      const item = await this.prisma.item_Information.findUnique({
        where: { id: d.itemId },
        select: { itmCode: true },
      });
      if (!item?.itmCode) continue;
      await this.prisma.inventory.upsert({
        where: { itemCode: item.itmCode },
        create: { itemCode: item.itmCode, quantity: d.qty },
        update: { quantity: { increment: d.qty } },
      });
    }
  }
}
