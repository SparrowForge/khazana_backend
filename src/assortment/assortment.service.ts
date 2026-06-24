import { Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested } from 'class-validator';
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

  @IsNumber()
  @IsOptional()
  branchId?: number;

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
      include: { details: true },
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
}
