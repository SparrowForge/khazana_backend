import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { DateRangeQueryDto, dateRangeFilter } from '../common/dto';
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

  async findAll(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const date = dateRangeFilter(fromDate, toDate);
    const where = { isActive: true, ...(branchId && { branchId }), ...(date && { date }) };
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

  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) return '';
    const branch = await this.prisma.branch
      .findUnique({ where: { id }, select: { branchCode: true } })
      .catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private ddmmyy(d = new Date()): string {
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  }

  // Auto-generates the assorted-sales (AS) code: AS-<FactoryCode>-<DDMMYY>-<001>.
  // The sequence resets per branch-code + day, derived from existing rows.
  private async generateAsCode(branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const datePart = this.ddmmyy();
    const prefix = ['AS', code, datePart].filter(Boolean).join('-');
    const count = await this.prisma.asstMsrt.count({
      where: { code: { startsWith: `${prefix}-` } },
    });
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  async create(dto: CreateAssortmentDto, userName: string, sessionBranchId?: string) {
    // branchId is session-authoritative (same as NC adjustment): prefer the
    // logged-in user's branch so the generated AS code always carries the
    // factory code; fall back to the payload only if the session lacks one.
    const branchId = sessionBranchId ?? dto.branchId;
    // A blank code means "auto-generate" (the UI sends "" for that),
    // mirroring the sales invoice-number convention.
    const code = dto.code || (await this.generateAsCode(branchId));
    const assort = await this.prisma.asstMsrt.create({
      data: {
        code,
        date: new Date(dto.date),
        type: dto.type,
        branchId,
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

  async update(id: string, dto: UpdateAssortmentDto, userName: string, sessionBranchId?: string) {
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    const existing = await this.prisma.asstMsrt.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing) throw new NotFoundException('Assortment not found');

    // Keep branchId session-authoritative and backfill it on edit so any older
    // record saved without a branch is repaired (same as NC adjustment).
    const branchId = dto.branchId ?? existing.branchId ?? sessionBranchId ?? undefined;
    // Backfill the code on edit so older records saved without one are repaired.
    const code = existing.code || (await this.generateAsCode(branchId));

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
          code,
          date: dto.date ? new Date(dto.date) : undefined,
          type: dto.type,
          branchId,
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

  async remove(id: string) {
    const existing = await this.prisma.asstMsrt.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing) throw new NotFoundException('Assortment not found');

    // Restore the stock this assortment deducted, then delete master + details.
    await this.prisma.$transaction(async (tx) => {
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
      await tx.asstMsrt.delete({ where: { id } });
    });

    return { message: 'Assortment deleted successfully' };
  }
}
