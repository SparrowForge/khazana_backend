import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { BranchPaginationQueryDto } from '../common/dto';
import { buildPaginationMeta } from '../common/helpers';

export class AssortmentItemDto {
  @IsString()
  @IsNotEmpty()
  itemOID: string;

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

export class CreateAssortmentDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsNumber()
  @IsOptional()
  totalAmt?: number;

  @IsNumber()
  @IsOptional()
  discAmt?: number;

  @IsNumber()
  @IsOptional()
  netAmt?: number;

  @IsNumber()
  @IsOptional()
  customerpay?: number;

  @IsNumber()
  @IsOptional()
  change?: number;

  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssortmentItemDto)
  items: AssortmentItemDto[];
}

export class UpdateAssortmentDto {
  @IsString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsNumber()
  @IsOptional()
  totalAmt?: number;

  @IsNumber()
  @IsOptional()
  discAmt?: number;

  @IsNumber()
  @IsOptional()
  netAmt?: number;

  @IsNumber()
  @IsOptional()
  customerpay?: number;

  @IsNumber()
  @IsOptional()
  change?: number;

  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssortmentItemDto)
  items: AssortmentItemDto[];
}

@Injectable()
export class AssortmentService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: true, ...(branchId && { branchId }) };
    const [rows, total] = await Promise.all([
      this.prisma.asstMsrt.findMany({ where, include: { details: true }, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.asstMsrt.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const assort = await this.prisma.asstMsrt.findUnique({
      where: { id },
      include: { details: { include: { item: true } } },
    });
    if (!assort) throw new NotFoundException('Assortment not found');
    return assort;
  }

  async create(dto: CreateAssortmentDto, userName: string) {
    const assort = await this.prisma.asstMsrt.create({
      data: {
        code: dto.code,
        date: new Date(dto.date),
        type: dto.type,
        branchId: dto.branchId,
        totalAmt: dto.totalAmt,
        discAmt: dto.discAmt,
        netAmt: dto.netAmt,
        customerpay: dto.customerpay,
        change: dto.change,
        discountRemarks: dto.discountRemarks,
        isActive: true,
        creator: userName,
        creationDate: new Date(),
        details: {
          create: dto.items.map((item, index) => ({
            itemSLNum: String(index + 1),
            itemOID: item.itemOID,
            qty: item.qty,
            uom: item.uom,
            price: item.price ?? 0,
            amount: item.amount ?? 0,
            vatValue: item.vatValue ?? 0,
            vatAmount: item.vatAmount ?? 0,
            discount: item.discount ?? 0,
            netAmount: item.netAmount ?? 0,
          })),
        },
      },
      include: { details: true },
    });

    // Deduct stock for assorted items
    for (const item of dto.items) {
      const itemInfo = await this.prisma.item_Information.findUnique({ where: { id: item.itemOID } });
      if (itemInfo?.itmCode) {
        await this.prisma.inventory.updateMany({
          where: { itemCode: itemInfo.itmCode },
          data: { quantity: { decrement: item.qty } },
        });
      }
    }

    return assort;
  }

  async update(id: string, dto: UpdateAssortmentDto, userName: string) {
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    const existing = await this.prisma.asstMsrt.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing) throw new NotFoundException('Assortment not found');

    // Purge-and-replace: master fields update in place; detail lines are dropped
    // and recreated. Stock is reconciled by restoring every old line then
    // deducting every new line (net delta), keyed by Item_Information → itmCode.
    await this.prisma.$transaction(async (tx) => {
      // Restore stock held by the previous detail lines.
      for (const d of existing.details) {
        const itemInfo = await tx.item_Information.findUnique({ where: { id: d.itemOID } });
        const q = Number(d.qty ?? 0);
        if (itemInfo?.itmCode && q) {
          await tx.inventory.updateMany({
            where: { itemCode: itemInfo.itmCode },
            data: { quantity: { increment: q } },
          });
        }
      }

      await tx.asstDet.deleteMany({ where: { AsstMsrt_id: id } });

      await tx.asstMsrt.update({
        where: { id },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          type: dto.type,
          branchId: dto.branchId ?? undefined,
          totalAmt: dto.totalAmt,
          discAmt: dto.discAmt,
          netAmt: dto.netAmt,
          customerpay: dto.customerpay,
          change: dto.change,
          discountRemarks: dto.discountRemarks,
          updateBy: userName,
          updateDate: new Date(),
          details: {
            create: dto.items.map((item, index) => ({
              itemSLNum: String(index + 1),
              itemOID: item.itemOID,
              qty: item.qty,
              uom: item.uom,
              price: item.price ?? 0,
              amount: item.amount ?? 0,
              vatValue: item.vatValue ?? 0,
              vatAmount: item.vatAmount ?? 0,
              discount: item.discount ?? 0,
              netAmount: item.netAmount ?? 0,
            })),
          },
        },
      });

      // Deduct stock for the new detail lines.
      for (const item of dto.items) {
        const itemInfo = await tx.item_Information.findUnique({ where: { id: item.itemOID } });
        if (itemInfo?.itmCode) {
          await tx.inventory.updateMany({
            where: { itemCode: itemInfo.itmCode },
            data: { quantity: { decrement: item.qty } },
          });
        }
      }
    });

    return this.prisma.asstMsrt.findUnique({ where: { id }, include: { details: { include: { item: true } } } });
  }
}
