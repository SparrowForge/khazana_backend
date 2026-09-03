import { Injectable, NotFoundException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, IsUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { DateRangeQueryDto, dateRangeFilter } from '../common/dto';
import { assertStockAvailable, buildPaginationMeta, branchScope } from '../common/helpers';
import type { Prisma } from '../generated/prisma';

const r2 = (n: number) => Math.round(n * 100) / 100;

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

  // Name / contact / reference identify who the non-charge goods went to and why.
  // Mandatory: an NC with no attribution can't be audited.
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Contact No is required' })
  contactNo: string;

  @IsString()
  @IsNotEmpty({ message: 'Reference is required' })
  reference: string;

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

  // Optional to keep header-only/partial edits working, but non-empty when sent —
  // an edit must not be able to blank out the NC's attribution.
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'Name is required' })
  name?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'Contact No is required' })
  contactNo?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'Reference is required' })
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

  async findAll(query: DateRangeQueryDto, accessibleBranchIds?: string[]) {
    const { page, limit, branchId, fromDate, toDate } = query;
    // The list UI always sends a from/to range, so the query DTO has to declare
    // them — the global ValidationPipe runs with forbidNonWhitelisted.
    const ncmstrDate = dateRangeFilter(fromDate, toDate);
    const where = {
      ncmstrIsActive: true,
      ...branchScope(accessibleBranchIds, ['branchId'], branchId),
      ...(ncmstrDate && { ncmstrDate }),
    };
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

  /** Everything a printable NC invoice needs in one call: the branch letterhead
   *  (VAT Reg No / Mushak 6.3), the attribution header and the priced lines —
   *  the same shape the credit-sale invoice returns, so the NC document can be
   *  laid out exactly like a sales invoice. t_NCMstr.branchId has no Prisma
   *  relation, so the branch is looked up separately. */
  async getInvoice(id: string) {
    const nc = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: {
        details: {
          include: { item: { select: { id: true, itmCode: true, itmName: true, itmUOM: true } } },
        },
      },
    });
    if (!nc) throw new NotFoundException('NC adjustment not found');

    const branch = nc.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: nc.branchId },
          select: { branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;

    const items = nc.details.map((d) => ({
      itemCode: d.item?.itmCode ?? '',
      itemName: d.item?.itmName ?? '',
      uom: d.item?.itmUOM ?? d.ncdetUOM ?? '',
      quantity: Number(d.ncdetQTY ?? 0),
      rate: Number(d.ncdetPrice ?? 0),
      discount: Number(d.ncdetDiscount ?? 0),
      vat: Number(d.ncdetVATAmount ?? 0),
      // ncdetNetAmount is the line total with its discount already netted off —
      // the same basis CSDetail.total uses on a credit-sale invoice.
      total: Number(d.ncdetNetAmount ?? 0),
    }));

    const totalAmount = r2(items.reduce((s, i) => s + i.rate * i.quantity, 0));
    const totalDiscount = r2(items.reduce((s, i) => s + i.discount, 0));
    const totalVat = r2(items.reduce((s, i) => s + i.vat, 0));
    const netAmount = r2(items.reduce((s, i) => s + i.total, 0));

    return {
      id: nc.id,
      ncCode: nc.ncmstrCode,
      ncDate: nc.ncmstrDate,
      name: nc.ncmstrName,
      contactNo: nc.ncmstrContactNo,
      reference: nc.ncmstrReference,
      issuedBy: nc.ncmstrUpdateBy ?? nc.ncmstrCreator,
      branch: branch
        ? {
            name: branch.branchName,
            address: branch.address,
            vatNo: branch.vatNo,
            mobileNo: branch.mobileNo,
          }
        : null,
      items,
      totalAmount,
      totalDiscount,
      totalVat,
      netAmount,
      // What the goods are worth. An NC is non-charge, so nothing is collected
      // against it — the document prints this as the value issued, not a due.
      grossAmount: r2(netAmount + totalVat),
    };
  }

  async create(dto: CreateNcAdjustmentDto, userName: string, sessionBranchId?: string) {
    // branchId is session-authoritative: prefer the logged-in user's branch so
    // NC entries always carry a branch (and thus appear in the Daily Final
    // Report); fall back to the payload only if the session lacks one.
    const branchId = sessionBranchId ?? dto.branchId;
    // Treat a blank code as "auto-generate" (the UI sends "" to mean that),
    // mirroring the sales invoice-number convention.
    const code = dto.code || (await this.generateNcCode(branchId));

    // An NC hands the goods over without charging for them, so it moves stock
    // exactly like a sale: check availability, write, deduct — all in one
    // transaction so a concurrent document can't slip through on the same units.
    const stockLines = dto.items.map((i) => ({ itemId: i.itemId, qty: i.qty }));
    return this.prisma.$transaction(async (tx) => {
      await assertStockAvailable(tx, stockLines);
      const nc = await tx.t_NCMstr.create({
        data: {
          ncmstrCode: code,
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
      await this.adjustStock(tx, stockLines.map((i) => ({ ...i, qty: -i.qty })));
      return nc;
    });
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

    // What the saved version took out. An edit is purge-and-replace, so the new
    // lines are judged against (on hand + this), the same basis the sales edit
    // uses — otherwise re-saving an untouched NC would fail its own deduction.
    const heldLines = existing.details.map((d) => ({
      itemId: d.ncdetItemOID,
      qty: Number(d.ncdetQTY ?? 0),
    }));
    const newLines = (dto.items ?? []).map((i) => ({ itemId: i.itemId, qty: i.qty }));

    const data: Record<string, unknown> = {
      ncmstrUpdateBy: userName,
      ncmstrUpdateDate: new Date(),
      branchId,
    };
    if (dto.code) data.ncmstrCode = dto.code;
    // Backfill the code on edit so older records saved without one are repaired
    // (same approach as the branchId backfill above).
    else if (!existing.ncmstrCode) data.ncmstrCode = await this.generateNcCode(branchId);
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

    return this.prisma.$transaction(async (tx) => {
      // Only a lines edit moves stock — a header-only edit leaves it untouched.
      if (dto.items) {
        await assertStockAvailable(tx, newLines, heldLines);
        // Give back what the previous version took, then drop its rows so the
        // replacements below are the only lines left.
        await this.adjustStock(tx, heldLines);
        await tx.t_NCDet.deleteMany({ where: { t_NCMstr_id: id } });
      }

      const nc = await tx.t_NCMstr.update({
        where: { id },
        data,
        include: { details: true },
      });

      if (dto.items) {
        await this.adjustStock(tx, newLines.map((i) => ({ ...i, qty: -i.qty })));
      }
      return nc;
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: { details: true },
    });
    if (!existing) {
      throw new NotFoundException('NC adjustment not found');
    }

    // Give back the stock this NC issued, then hard-delete master + its details.
    await this.prisma.$transaction(async (tx) => {
      await this.adjustStock(
        tx,
        existing.details.map((d) => ({ itemId: d.ncdetItemOID, qty: Number(d.ncdetQTY ?? 0) })),
      );
      await tx.t_NCDet.deleteMany({ where: { t_NCMstr_id: id } });
      await tx.t_NCMstr.delete({ where: { id } });
    });

    return { message: 'NC adjustment deleted successfully' };
  }

  /** Resolve the branch UUID to its sanitized branch code for embedding in NC
   *  codes. Returns '' when the branch can't be resolved, so the number simply
   *  omits the code. Mirrors the sales invoice-number helpers. */
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

  private yyyymm(d = new Date()): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private async generateNcCode(branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.t_NCMstr.count();
    return ['NC', code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }

  /** Apply stock deltas keyed by item id (the Inventory primary key).
   *  Positive adds, negative removes. Takes a client so the deltas land in the
   *  same transaction as the availability check that authorised them. */
  private async adjustStock(
    db: Prisma.TransactionClient,
    deltas: { itemId: string; qty: number }[],
  ) {
    for (const d of deltas) {
      if (!d.qty) continue;
      await db.inventory.upsert({
        where: { itemId: d.itemId },
        create: { itemId: d.itemId, quantity: d.qty },
        update: { quantity: { increment: d.qty } },
      });
    }
  }
}
