import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma';
import { CreateProductionDto, UpdateProductionDto, ProductionLineDto } from './dto/production.dto';
import { DateRangeQueryDto, dateRangeFilter } from '../common/dto';
import { assertStockAvailable, buildPaginationMeta, isFactoryBranch } from '../common/helpers';

/**
 * Production Entry — the factory's record of what it manufactured.
 *
 * Shaped after InventoryService's Stock Issue flow (one serial number per
 * document, every item line sharing it, purge-and-replace on edit) with two
 * deliberate differences:
 *
 *  - **Direction.** An issue takes stock out; production puts it in. Creating
 *    increments `Inventory.quantity`, editing gives back the previous version's
 *    contribution before applying the new one, and deleting takes it away.
 *  - **Rate.** `Production.rate` is the VAT-INCLUSIVE unit price. Item_Issue's
 *    `unitPrice` is the bare `t_Price.priceListPrice`; here the UI pre-fills
 *    `priceListPrice * (1 + priceVatPercent/100)` and the value is stored as
 *    entered.
 *
 * The whole feature is factory-only: every mutating call re-checks the session
 * branch, so a non-factory session can't reach it by calling the API directly.
 */
/** One item line another document wants recorded as production. `unitPrice` is
 *  the VAT-EXCLUSIVE price that document holds (Item_Issue.unitPrice); the
 *  VAT-inclusive `Production.rate` is derived from it. */
export interface IssueProductionLine {
  itemId: string;
  qty: number;
  unitPrice?: number | null;
}

@Injectable()
export class ProductionService {
  constructor(private prisma: PrismaService) {}

  private static readonly SERIAL_PREFIX = 'PRD';

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /** Production may only be posted from the factory. Resolves the session branch
   *  and refuses anything else — the sidebar and the route guard hide the page,
   *  this closes the direct-API path. Returns the branch so the caller can reuse
   *  its code for the serial number.
   *
   *  Public because Stock Issue has to apply the same rule before it accepts a
   *  line flagged `isProduction` — the flag writes a Production row, so it must
   *  clear the very same gate a direct Production Entry would. */
  async assertFactoryBranch(branchId?: string | null) {
    const branch =
      branchId && this.isUuid(branchId)
        ? await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true, branchCode: true, branchName: true },
          })
        : null;
    if (!isFactoryBranch(branch)) {
      throw new ForbiddenException('Production Entry is available only at the Factory branch');
    }
    return branch!;
  }

  /** Inventory is still itemCode-keyed; resolve itemId -> itmCode in one batch
   *  before writing (same bridge pattern as InventoryService#itemCodesByIds). */
  private async itemCodesByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.item_Information.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, itmCode: true },
    });
    const map = new Map(rows.map((r) => [r.id, r.itmCode]));
    const missing = uniqueIds.filter((id) => !map.has(id));
    if (missing.length) throw new BadRequestException(`Unknown item id(s): ${missing.join(', ')}`);
    return map;
  }

  private async itemNamesByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.item_Information.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, itmName: true },
    });
    return new Map(rows.map((r) => [r.id, r.itmName ?? '']));
  }

  private buildSerialNo(branchCode: string, seq: number): string {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const code = (branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return [ProductionService.SERIAL_PREFIX, code, yyyymm, String(seq).padStart(5, '0')].filter(Boolean).join('-');
  }

  /** Rows sharing one serialNo were written by the same request, so the header
   *  fields are identical — only the item line differs. Collapse them to one
   *  list row carrying the summed qty and total value. */
  private groupBySerial<
    T extends { serialNo?: string | null; id: string; qty?: unknown; rate?: unknown },
  >(rows: T[], page: number, limit: number) {
    const groups = new Map<string, T & { serialNo: string; qty: number; totalValue: number }>();
    for (const row of rows) {
      const key = row.serialNo || row.id;
      const qty = Number(row.qty ?? 0);
      const value = qty * Number(row.rate ?? 0);
      const existing = groups.get(key);
      if (existing) {
        existing.qty += qty;
        existing.totalValue += value;
      } else {
        groups.set(key, { ...row, serialNo: key, qty, totalValue: value });
      }
    }
    const all = Array.from(groups.values());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), meta: buildPaginationMeta(all.length, page, limit) };
  }

  /** Looks up production rows by serialNo, falling back to a single row by id
   *  for any record whose serialNo was left blank. */
  private async findRows(serialNo: string) {
    let rows = await this.prisma.production.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.production.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Production entry not found');
    return rows;
  }

  private toStockLines(lines: ProductionLineDto[]) {
    return lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
  }

  // ── Create ────────────────────────────────────────────────────

  async create(dto: CreateProductionDto, createdBy: string, sessionBranchId: string) {
    if (!dto.items?.length) throw new BadRequestException('No items to produce');
    const branch = await this.assertFactoryBranch(sessionBranchId);
    const codeByItemId = await this.itemCodesByIds(dto.items.map((i) => i.itemId));

    const productionDate = new Date(dto.productionDate);
    const baseCount = await this.prisma.production.count();
    // Every line in this request shares one serial number so the whole document
    // can be looked up / edited / deleted together later.
    const serialNo = dto.serialNo || this.buildSerialNo(branch.branchCode ?? '', baseCount + 1);

    return this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const line of dto.items) {
        const row = await tx.production.create({
          data: {
            serialNo,
            branchId: branch.id,
            productionDate,
            itemId: line.itemId,
            rate: line.rate,
            qty: line.qty,
            remarks: dto.remarks,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        });
        const itemCode = codeByItemId.get(line.itemId)!;
        // upsert, not update: an item can be produced before it has ever been
        // received, so its Inventory row may not exist yet.
        await tx.inventory.upsert({
          where: { itemCode },
          create: { itemCode, quantity: line.qty },
          update: { quantity: { increment: line.qty } },
        });
        created.push(row);
      }
      return created;
    });
  }

  // ── Read ──────────────────────────────────────────────────────

  async findAll(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const productionDate = dateRangeFilter(fromDate, toDate);
    const rows = await this.prisma.production.findMany({
      where: {
        isActive: 1,
        ...(branchId && { branchId }),
        ...(productionDate && { productionDate }),
      },
      orderBy: { createDate: 'desc' },
    });
    return this.groupBySerial(rows, page, limit);
  }

  async findOne(serialNo: string) {
    const rows = await this.findRows(serialNo);
    const [first] = rows;
    const nameByItemId = await this.itemNamesByIds(rows.map((r) => r.itemId).filter((id): id is string => !!id));
    return {
      serialNo: first.serialNo || first.id,
      branchId: first.branchId,
      productionDate: first.productionDate,
      remarks: first.remarks,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemId ? nameByItemId.get(r.itemId) : undefined,
        qty: Number(r.qty ?? 0),
        rate: Number(r.rate ?? 0),
      })),
    };
  }

  // ── Update ────────────────────────────────────────────────────

  async update(serialNo: string, dto: UpdateProductionDto, updatedBy: string, sessionBranchId: string) {
    if (!dto.items?.length) throw new BadRequestException('No items to produce');
    const branch = await this.assertFactoryBranch(sessionBranchId);
    const existing = await this.findRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    const codeByItemId = await this.itemCodesByIds([
      ...existing.map((r) => r.itemId).filter((id): id is string => !!id),
      ...dto.items.map((i) => i.itemId),
    ]);
    const productionDate = new Date(dto.productionDate);

    return this.prisma.$transaction(async (tx) => {
      // Editing is purge-and-replace, so the previous version's contribution is
      // withdrawn from Inventory first. That withdrawal is the risky direction —
      // the produced units may already have been sold — so it is checked the
      // same way an issue is, with the replacement lines counted as what the
      // document gives back. Net effect per item: on hand + new - old >= 0.
      await assertStockAvailable(
        tx,
        existing.map((r) => ({ itemId: r.itemId, qty: Number(r.qty ?? 0) })),
        this.toStockLines(dto.items),
      );

      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { decrement: Number(row.qty ?? 0) } } });
        }
      }
      await tx.production.deleteMany({ where: { serialNo: key } });

      const rewritten = [];
      for (const line of dto.items) {
        const row = await tx.production.create({
          data: {
            serialNo: key,
            branchId: existing[0].branchId ?? branch.id,
            productionDate,
            itemId: line.itemId,
            rate: line.rate,
            qty: line.qty,
            remarks: dto.remarks,
            isActive: 1,
            createBy: existing[0].createBy,
            createDate: existing[0].createDate,
            updateBy: updatedBy,
            updateDate: new Date(),
          },
        });
        const itemCode = codeByItemId.get(line.itemId)!;
        await tx.inventory.upsert({
          where: { itemCode },
          create: { itemCode, quantity: line.qty },
          update: { quantity: { increment: line.qty } },
        });
        rewritten.push(row);
      }
      return rewritten;
    });
  }

  // ── Delete ────────────────────────────────────────────────────

  async remove(serialNo: string, sessionBranchId: string) {
    await this.assertFactoryBranch(sessionBranchId);
    const existing = await this.findRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    const codeByItemId = await this.itemCodesByIds(existing.map((r) => r.itemId).filter((id): id is string => !!id));

    await this.prisma.$transaction(async (tx) => {
      // Deleting withdraws what this entry added; refuse if those units are gone
      // rather than driving Inventory negative.
      await assertStockAvailable(
        tx,
        existing.map((r) => ({ itemId: r.itemId, qty: Number(r.qty ?? 0) })),
      );
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { decrement: Number(row.qty ?? 0) } } });
        }
      }
      await tx.production.deleteMany({ where: { serialNo: key } });
    });
    return { message: 'Production entry deleted successfully' };
  }

  // ── Reusable: production driven by another document ────────────

  /**
   * Write the Production side of a source document (currently Stock Issue),
   * inside that document's own transaction.
   *
   * Purge-and-replace, keyed on `issueSerialNo`: every Production row this
   * source previously created is withdrawn from Inventory and deleted, then the
   * given lines are inserted fresh. Passing an empty `lines` therefore removes
   * the production side entirely — which is exactly what deleting the source
   * document needs, so create / update / delete all route through this one
   * method and can't drift apart.
   *
   * Takes a `tx` rather than reaching for `this.prisma` so the production write
   * commits or rolls back with the document that triggered it — a half-applied
   * pair would leave Inventory wrong with no way to tell which side is missing.
   */
  async syncFromIssue(
    tx: Prisma.TransactionClient,
    opts: {
      issueSerialNo: string;
      branchId: string;
      branchCode?: string | null;
      date: Date;
      lines: IssueProductionLine[];
      user: string;
    },
  ) {
    const previous = await tx.production.findMany({
      where: { issueSerialNo: opts.issueSerialNo },
      orderBy: { createDate: 'asc' },
    });
    const lines = opts.lines.filter((l) => l.itemId && Number(l.qty) > 0);

    if (previous.length) {
      // Withdrawing produced units is the risky direction — they may already
      // have been sold. Judged with the replacement lines counted as what the
      // document gives back, so re-saving an unchanged line can't fail against
      // its own earlier contribution. Same rule as `update()`.
      await assertStockAvailable(
        tx,
        previous.map((r) => ({ itemId: r.itemId, qty: Number(r.qty ?? 0) })),
        lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      );
      const codes = await this.itemCodesByIds(previous.map((r) => r.itemId).filter((id): id is string => !!id));
      for (const row of previous) {
        if (!row.itemId) continue;
        await tx.inventory.updateMany({
          where: { itemCode: codes.get(row.itemId)! },
          data: { quantity: { decrement: Number(row.qty ?? 0) } },
        });
      }
      await tx.production.deleteMany({ where: { issueSerialNo: opts.issueSerialNo } });
    }

    if (!lines.length) return [];

    // Keep the Production document's own identity across edits of the source —
    // only mint a new serial the first time this issue produces anything.
    const serialNo =
      previous[0]?.serialNo ||
      this.buildSerialNo(opts.branchCode ?? '', (await tx.production.count()) + 1);
    const rateByItemId = await this.vatInclusiveRates(tx, lines);
    const codeByItemId = await this.itemCodesByIds(lines.map((l) => l.itemId));

    const created = [];
    for (const line of lines) {
      const row = await tx.production.create({
        data: {
          serialNo,
          issueSerialNo: opts.issueSerialNo,
          branchId: opts.branchId,
          productionDate: opts.date,
          itemId: line.itemId,
          rate: rateByItemId.get(line.itemId) ?? 0,
          qty: line.qty,
          remarks: `Auto-created from Stock Issue ${opts.issueSerialNo}`,
          isActive: 1,
          createBy: previous[0]?.createBy ?? opts.user,
          createDate: previous[0]?.createDate ?? new Date(),
          ...(previous.length ? { updateBy: opts.user, updateDate: new Date() } : {}),
        },
      });
      // upsert, not update: an item can be produced before it has ever been
      // received, so its Inventory row may not exist yet.
      await tx.inventory.upsert({
        where: { itemCode: codeByItemId.get(line.itemId)! },
        create: { itemCode: codeByItemId.get(line.itemId)!, quantity: line.qty },
        update: { quantity: { increment: line.qty } },
      });
      created.push(row);
    }
    return created;
  }

  /** `Production.rate` is VAT-INCLUSIVE while the source document's unitPrice is
   *  not, so gross the line price up by the item's VAT percent — the same sum
   *  the Production Entry screen pre-fills. Falls back to the item's own active
   *  list price for a line that carries no price at all. */
  private async vatInclusiveRates(
    tx: Prisma.TransactionClient,
    lines: IssueProductionLine[],
  ): Promise<Map<string, number>> {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const rows = await tx.item_Information.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          take: 1,
          select: { priceListPrice: true, priceVatPercent: true },
        },
      },
    });
    const priceById = new Map(rows.map((r) => [r.id, r.prices[0]]));
    const rates = new Map<string, number>();
    for (const line of lines) {
      const price = priceById.get(line.itemId);
      const vat = Number(price?.priceVatPercent ?? 0);
      const base = Number(line.unitPrice ?? 0) || Number(price?.priceListPrice ?? 0);
      rates.set(line.itemId, Math.round(base * (1 + vat / 100) * 1e6) / 1e6);
    }
    return rates;
  }
}
