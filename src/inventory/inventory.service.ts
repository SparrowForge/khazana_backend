import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { ReceiveStockDto, UpdateReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto, UpdateIssueStockDto } from './dto/issue-stock.dto';
import { BranchPaginationQueryDto, DateRangeQueryDto, dateRangeFilter } from '../common/dto';
import { ItemQueryDto } from './dto/item-query.dto';
import { assertStockAvailable, buildPaginationMeta, toBranchUuid } from '../common/helpers';
import { ProductionService } from '../production/production.service';
import type { Prisma } from '../generated/prisma';

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    // Stock Issue lines flagged `isProduction` are written to Production too.
    // The production side lives in ProductionService so both entry points obey
    // one set of rules (factory-only, VAT-inclusive rate, stock direction).
    private production: ProductionService,
  ) {}

  /** A branch transfer and a plain stock issue both write to Item_Issue — the
   *  only thing separating them is the serial prefix a transfer gets ('TRF'),
   *  plus the paired Item_Receive leg a transfer also writes. Without these
   *  filters the two history endpoints run the identical query and each screen
   *  lists the other's documents. Issues are "everything that isn't a transfer"
   *  so legacy rows with an unrecognised serial still show up somewhere. */
  private static readonly TRANSFER_PREFIX = 'TRF';
  private static readonly TRANSFER_ONLY = {
    serialNo: { startsWith: InventoryService.TRANSFER_PREFIX },
  };
  private static readonly ISSUE_ONLY = {
    NOT: { serialNo: { startsWith: InventoryService.TRANSFER_PREFIX } },
  };

  private isTransferSerial(serialNo?: string | null): boolean {
    return !!serialNo?.startsWith(InventoryService.TRANSFER_PREFIX);
  }

  /** A transfer's Item_Issue rows are one half of a paired document. Editing or
   *  deleting them through the issue endpoints would orphan the Item_Receive leg
   *  and skew both branches' stock, so refuse and point at the right screen. */
  private assertNotTransfer(serialNo: string, action: 'edited' | 'deleted') {
    if (this.isTransferSerial(serialNo)) {
      throw new BadRequestException(
        `${serialNo} is a branch transfer — it must be ${action} on the Stock Transfer screen`,
      );
    }
  }

  // ── Current Stock ─────────────────────────────────────────────

  async findAll(query: BranchPaginationQueryDto) {
    const { page, limit } = query;
    const [rows, total] = await Promise.all([
      this.prisma.inventory.findMany({
        include: { item: { include: { prices: { where: { priceIsActive: 1 }, orderBy: { priceFromDate: 'desc' }, take: 1 } } } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inventory.count(),
    ]);
    const items = rows.map((row) => {
      const price = Number(row.item?.prices?.[0]?.priceListPrice ?? 0);
      const qty = Number(row.quantity);
      return { ...row, unitCost: price, totalValue: price * qty };
    });
    return { items, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(itemCode: string) {
    const stock = await this.prisma.inventory.findUnique({
      where: { itemCode },
      include: { item: true },
    });
    if (!stock) throw new NotFoundException('Item not found in inventory');
    return stock;
  }

  // ── Items ─────────────────────────────────────────────────────

  async findAllItems(query: ItemQueryDto) {
    const { page, limit, isActive } = query;
    const where = isActive ? { isActive } : undefined;
    const [rows, total] = await Promise.all([
      this.prisma.item_Information.findMany({
        where,
        include: {
          inventory: true,
          image: true,
          prices: { where: { priceIsActive: 1 }, orderBy: { priceFromDate: 'desc' }, take: 1 },
        },
        orderBy: { itmName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.item_Information.count({ where }),
    ]);
    // vatPercentage rides along with price so sale forms (credit / NC) can compute
    // line VAT client-side the same way the POS terminal does. `stock` flattens
    // the joined Inventory row the same way, so the sale / issue / transfer forms
    // can show on-hand qty per item and refuse to over-commit it before the
    // server has to (0 when the item has never been received).
    const items = rows.map((row) => ({
      ...row,
      price: Number(row.prices?.[0]?.priceListPrice ?? 0),
      vatPercentage: Number(row.prices?.[0]?.priceVatPercent ?? 0),
      stock: Number(row.inventory?.quantity ?? 0),
    }));
    return { items, meta: buildPaginationMeta(total, page, limit) };
  }

  async findItem(id: string) {
    const item = await this.prisma.item_Information.findUnique({
      where: { id },
      include: { inventory: true, prices: true, costPrices: true, image: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  /** Suggests the next Item Code for a category: its first letter plus a
   *  4-digit running count, e.g. "Sweets" -> S0001, S0002... Scanned from
   *  existing codes rather than a stored counter, so it self-heals if a code
   *  was ever entered out of sequence or edited by hand. */
  async getNextItemCode(category: string) {
    const firstChar = category?.trim().charAt(0).toUpperCase();
    if (!firstChar) throw new BadRequestException('Category is required to generate an item code');

    const existing = await this.prisma.item_Information.findMany({
      where: { itmCode: { startsWith: firstChar, mode: 'insensitive' } },
      select: { itmCode: true },
    });

    const pattern = new RegExp(`^${firstChar}(\\d{4})$`, 'i');
    const maxSeq = existing.reduce((max, { itmCode }) => {
      const match = itmCode.match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return { itmCode: `${firstChar}${String(maxSeq + 1).padStart(4, '0')}` };
  }

  async createItem(data: {
    itmCode: string;
    itmName?: string;
    itmCategory?: string;
    itmType?: string;
    itmUOM?: string;
    itmRemarks?: string;
    imageId?: string;
    isActive?: string;
  }) {
    try {
      return await this.prisma.item_Information.create({
        data: {
          itmCode:    data.itmCode,
          itmName:    data.itmName,
          itmCategory: data.itmCategory,
          itmType:    data.itmType || null,
          itmUOM:     data.itmUOM,
          itmRemarks: data.itmRemarks,
          imageId:    data.imageId ?? null,
          isActive:   data.isActive ?? 'Y',
        },
        include: { image: true },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`Duplicate item found. Item code "${data.itmCode}" already exists`);
      }
      throw e;
    }
  }

  async updateItem(
    id: string,
    data: Partial<{
      itmName: string;
      itmCategory: string;
      itmType: string;
      itmUOM: string;
      itmRemarks: string;
      imageId: string;
      isActive: string;
    }>,
  ) {
    await this.findItem(id);
    return this.prisma.item_Information.update({
      where: { id },
      data,
      include: { image: true },
    });
  }

  async deleteItem(id: string) {
    await this.findItem(id);
    // Soft delete: items are referenced by sales/inventory, so deactivate instead of hard delete
    return this.prisma.item_Information.update({ where: { id }, data: { isActive: 'N' } });
  }

  // ── Transfer (between branches) ───────────────────────────────

  async transferStock(
    dto: {
      voucherNo?: string;
      issueDate: string;
      issueBranchId: string;
      receiveBranchId: string;
      items: { itemId: string; qty: number }[];
    },
    createdBy: string,
  ) {
    if (!dto.items?.length) throw new BadRequestException('No items to transfer');
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const branchCode = await this.resolveBranchCode(dto.issueBranchId);
    const baseCount = await this.prisma.item_Issue.count();
    // Every line in this request shares one serial number so the whole
    // document can be looked up / edited / deleted together later.
    const serialNo = this.buildSerialNo('TRF', branchCode, baseCount + 1);

    return this.prisma.$transaction(async (tx) => {
      await this.assertTransferable(tx, dto.items);

      const rows = [];
      for (const line of dto.items) {
        // Both legs of one transfer line share the same id so they stay paired.
        const id = randomUUID();
        // Stock leaves the issuing branch
        const issue = await tx.item_Issue.create({
          data: {
            id,
            serialNo,
            itemId: line.itemId,
            qty: line.qty,
            issueDate,
            issueBranchId: dto.issueBranchId,
            receiveBranchId: dto.receiveBranchId,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        });
        // Stock arrives at the receiving branch
        const receive = await tx.item_Receive.create({
          data: {
            id,
            serialNo,
            itemId: line.itemId,
            qty: line.qty,
            purDate: issueDate,
            branchId: dto.issueBranchId,
            receiveBranchID: dto.receiveBranchId,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        });
        rows.push(issue, receive);
      }
      return rows;
    });
  }

  /** A transfer is net-zero against `Inventory` — the table is keyed by itemCode
   *  alone, with no branch dimension, so moving units between branches leaves the
   *  balance untouched and there is nothing to deduct. What it must still not do
   *  is ship units that don't exist anywhere, so the lines are measured against
   *  the whole-company on-hand qty. Nothing is ever "released" back on an edit,
   *  for the same reason: the previous version never consumed anything. */
  private async assertTransferable(
    tx: Prisma.TransactionClient,
    items: { itemId: string; qty: number }[],
  ) {
    await assertStockAvailable(tx, items);
  }

  async findTransferHistory(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const issueDate = dateRangeFilter(fromDate, toDate);
    const where = {
      isActive: 1,
      ...InventoryService.TRANSFER_ONLY,
      ...(branchId && { issueBranchId: branchId }),
      ...(issueDate && { issueDate }),
    };
    const rows = await this.prisma.item_Issue.findMany({ where, orderBy: { createDate: 'desc' } });
    return this.groupBySerial(rows, page, limit);
  }

  /** Rows sharing one serialNo were all created in the same request, so header
   *  fields (voucher/date/branches) are identical — only qty differs per line.
   *  Groups in app code (rather than a DB groupBy) to keep header fields intact
   *  and dodge the DB's groupBy/distinct + skip/take edge cases. */
  private groupBySerial<T extends { serialNo?: string | null; id: string; qty?: unknown }>(
    rows: T[],
    page: number,
    limit: number,
  ) {
    const groups = new Map<string, T & { qty: number }>();
    for (const row of rows) {
      const key = row.serialNo || row.id;
      const existing = groups.get(key);
      if (existing) {
        existing.qty += Number(row.qty ?? 0);
      } else {
        groups.set(key, { ...row, serialNo: key, qty: Number(row.qty ?? 0) });
      }
    }
    const all = Array.from(groups.values());
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return { items, meta: buildPaginationMeta(all.length, page, limit) };
  }

  async findOneTransferBySerial(serialNo: string) {
    const rows = await this.findTransferRows(serialNo);
    const [first] = rows;
    const nameByItemId = await this.itemNamesByIds(rows.map((r) => r.itemId).filter((id): id is string => !!id));
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      issueDate: first.issueDate,
      issueBranchId: first.issueBranchId,
      receiveBranchId: first.receiveBranchId,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemId ? nameByItemId.get(r.itemId) : undefined,
        qty: Number(r.qty ?? 0),
      })),
    };
  }

  async updateTransferBySerial(
    serialNo: string,
    dto: {
      voucherNo?: string;
      issueDate?: string;
      issueBranchId?: string;
      receiveBranchId?: string;
      items: { itemId: string; qty: number }[];
    },
    updatedBy: string,
  ) {
    const existing = await this.findTransferRows(serialNo);
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const key = existing[0].serialNo || existing[0].id;

    return this.prisma.$transaction(async (tx) => {
      await this.assertTransferable(tx, dto.items);

      await tx.item_Issue.deleteMany({ where: { serialNo: key } });
      await tx.item_Receive.deleteMany({ where: { serialNo: key } });

      const rows = [];
      for (const line of dto.items) {
        const id = randomUUID();
        const issue = await tx.item_Issue.create({
          data: {
            id,
            serialNo: key,
            itemId: line.itemId,
            qty: line.qty,
            issueDate,
            issueBranchId: dto.issueBranchId ?? existing[0].issueBranchId,
            receiveBranchId: dto.receiveBranchId ?? existing[0].receiveBranchId,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: existing[0].createBy,
            createDate: existing[0].createDate,
            updateBy: updatedBy,
            updateDate: new Date(),
          },
        });
        await tx.item_Receive.create({
          data: {
            id,
            serialNo: key,
            itemId: line.itemId,
            qty: line.qty,
            purDate: issueDate,
            branchId: dto.issueBranchId ?? existing[0].issueBranchId,
            receiveBranchID: dto.receiveBranchId ?? existing[0].receiveBranchId,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: existing[0].createBy,
            createDate: existing[0].createDate,
            updateBy: updatedBy,
            updateDate: new Date(),
          },
        });
        rows.push(issue);
      }
      return rows;
    });
  }

  async removeTransferBySerial(serialNo: string) {
    const existing = await this.findTransferRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    await this.prisma.$transaction([
      this.prisma.item_Receive.deleteMany({ where: { serialNo: key } }),
      this.prisma.item_Issue.deleteMany({ where: { serialNo: key } }),
    ]);
    return { message: 'Transfer deleted successfully' };
  }

  /** Looks up transfer rows by serialNo, falling back to a single row by id
   *  for any pre-existing record that has a blank serialNo. */
  private async findTransferRows(serialNo: string) {
    let rows = await this.prisma.item_Issue.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.item_Issue.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Transfer record not found');
    return rows;
  }

  // ── Receive ───────────────────────────────────────────────────

  /** Inventory is still itemCode-keyed; resolve itemId -> itmCode in one batch
   *  before writing (same bridge pattern as assortment.service.ts /
   *  nc-adjustment.service.ts#adjustStock). */
  private async itemCodesByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.item_Information.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, itmCode: true } });
    const map = new Map(rows.map((r) => [r.id, r.itmCode]));
    const missing = uniqueIds.filter((id) => !map.has(id));
    if (missing.length) throw new BadRequestException(`Unknown item id(s): ${missing.join(', ')}`);
    return map;
  }

  /** Item_Issue doesn't store the item name denormalized (unlike Item_Receive),
   *  so the issue report looks it up from Item_Information for display. */
  private async itemNamesByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.prisma.item_Information.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, itmName: true } });
    return new Map(rows.map((r) => [r.id, r.itmName ?? '']));
  }

  async receiveStock(dto: ReceiveStockDto, createdBy: string, userBranchId: string) {
    const purDate = new Date(dto.purDate);
    // Item_Receive.branchId / receiveBranchID are NOT NULL Branch UUIDs. Resolve
    // from the request, else the session branch, else the default branch so the
    // insert always succeeds. receiveBranchID = login branch; branchId holds the
    // source ("from") branch.
    const receiveBranchId = toBranchUuid(dto.branchId ?? userBranchId);
    const fromBranchId = toBranchUuid(dto.fromBranchId, receiveBranchId);
    const branchCode = await this.resolveBranchCode(receiveBranchId);
    const baseCount = await this.prisma.item_Receive.count();
    // Every line in this request shares one serial number so the whole
    // document can be looked up / edited / deleted together later.
    const serialNo = dto.serialNo || this.buildSerialNo('GRN', branchCode, baseCount + 1);
    const codeByItemId = await this.itemCodesByIds(dto.items.map((i) => i.itemId));

    const results = await this.prisma.$transaction(async (tx) => {
      const receives = [];
      for (const line of dto.items) {
        const receive = await tx.item_Receive.create({
          data: {
            itemId: line.itemId,
            itemName: line.itemName,
            qty: line.qty,
            purDate,
            branchId: fromBranchId,
            receiveBranchID: receiveBranchId,
            serialNo,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        });

        const itemCode = codeByItemId.get(line.itemId)!;
        await tx.inventory.upsert({
          where: { itemCode },
          create: { itemCode, quantity: line.qty },
          update: { quantity: { increment: line.qty } },
        });

        receives.push(receive);
      }
      return receives;
    });

    return results;
  }

  async findReceiveHistory(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const purDate = dateRangeFilter(fromDate, toDate);
    // A transfer writes an Item_Receive leg too — it belongs to Stock Transfer,
    // not to goods-inward. Same split as findAllIssues.
    const where = {
      isActive: 1,
      ...InventoryService.ISSUE_ONLY,
      ...(branchId && { receiveBranchID: branchId }),
      ...(purDate && { purDate }),
    };
    const rows = await this.prisma.item_Receive.findMany({ where, orderBy: { createDate: 'desc' } });
    return this.groupBySerial(rows, page, limit);
  }

  /** Looks up receive rows by serialNo, falling back to a single row by id
   *  for any pre-existing record that has a blank serialNo. */
  private async findReceiveRows(serialNo: string) {
    let rows = await this.prisma.item_Receive.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.item_Receive.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Receive record not found');
    return rows;
  }

  async findOneReceive(serialNo: string) {
    const rows = await this.findReceiveRows(serialNo);
    const [first] = rows;
    // Item_Receive.itemName is a denormalized column the create/update flows
    // never populate (the frontend only ever sends itemId) — join through
    // Item_Information for the real name instead of trusting that column.
    const nameByItemId = await this.itemNamesByIds(rows.map((r) => r.itemId).filter((id): id is string => !!id));
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      purDate: first.purDate,
      branchId: first.receiveBranchID,
      fromBranchId: first.branchId,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: (r.itemId ? nameByItemId.get(r.itemId) : undefined) || r.itemName || undefined,
        qty: Number(r.qty ?? 0),
      })),
    };
  }

  async updateReceive(serialNo: string, dto: UpdateReceiveStockDto, updatedBy: string, userBranchId: string) {
    const existing = await this.findReceiveRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    this.assertNotTransfer(key, 'edited');
    const purDate = new Date(dto.purDate);
    const receiveBranchId = toBranchUuid(dto.branchId ?? existing[0].receiveBranchID ?? userBranchId);
    const fromBranchId = toBranchUuid(dto.fromBranchId, existing[0].branchId ?? receiveBranchId);
    const codeByItemId = await this.itemCodesByIds([
      ...existing.map((r) => r.itemId).filter((id): id is string => !!id),
      ...dto.items.map((i) => i.itemId),
    ]);

    return this.prisma.$transaction(async (tx) => {
      // Revert the stock this document previously added, then wipe its lines.
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { decrement: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Receive.deleteMany({ where: { serialNo: key } });

      const receives = [];
      for (const line of dto.items) {
        const receive = await tx.item_Receive.create({
          data: {
            itemId: line.itemId,
            itemName: line.itemName,
            qty: line.qty,
            purDate,
            branchId: fromBranchId,
            receiveBranchID: receiveBranchId,
            serialNo: key,
            voucharNo: dto.voucherNo,
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
        receives.push(receive);
      }
      return receives;
    });
  }

  async removeReceive(serialNo: string) {
    const existing = await this.findReceiveRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    this.assertNotTransfer(key, 'deleted');
    const codeByItemId = await this.itemCodesByIds(existing.map((r) => r.itemId).filter((id): id is string => !!id));
    await this.prisma.$transaction(async (tx) => {
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { decrement: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Receive.deleteMany({ where: { serialNo: key } });
    });
    return { message: 'Stock receive deleted successfully' };
  }

  // ── Issue ─────────────────────────────────────────────────────

  /** The lines this document also records as production. Anything with qty <= 0
   *  is dropped before it gets here, so "production checked but qty 0" simply
   *  produces nothing rather than an empty Production row. */
  private productionLines(items: IssueStockDto['items']) {
    return items
      .filter((l) => l.isProduction && Number(l.qty) > 0)
      .map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice }));
  }

  /** Flagging a line as production writes a Production row, so the session has
   *  to clear the very same factory-only gate the Production Entry screen does.
   *  Returns the branch (for its code) when there is production to write. */
  private async assertMayProduce(items: IssueStockDto['items'], branchId: string) {
    if (!this.productionLines(items).length) return null;
    return this.production.assertFactoryBranch(branchId);
  }

  async issueStock(dto: IssueStockDto, createdBy: string) {
    if (!dto.items?.length) throw new BadRequestException('No items to issue');
    const codeByItemId = await this.itemCodesByIds(dto.items.map((i) => i.itemId));

    const issueDate = new Date(dto.issueDate);
    const branchCode = await this.resolveBranchCode(dto.issueBranchId);
    const baseCount = await this.prisma.item_Issue.count();
    // Every line in this request shares one serial number so the whole
    // document can be looked up / edited / deleted together later.
    const serialNo = dto.serialNo || this.buildSerialNo('ISS', branchCode, baseCount + 1);
    const producedAt = await this.assertMayProduce(dto.items, dto.issueBranchId);

    return this.prisma.$transaction(async (tx) => {
      // Production runs FIRST, because it is what makes the goods this document
      // then issues out: an item produced and shipped the same day can be issued
      // on a zero opening balance, and the availability check below must see the
      // units the production side just added.
      if (producedAt) {
        await this.production.syncFromIssue(tx, {
          issueSerialNo: serialNo,
          branchId: producedAt.id,
          branchCode: producedAt.branchCode,
          date: issueDate,
          lines: this.productionLines(dto.items),
          user: createdBy,
        });
      }

      // Inside the transaction that decrements, so a concurrent issue can't pass
      // the same check on the same units. Sums repeated lines of one item too.
      await assertStockAvailable(tx, dto.items);

      const issues = [];
      for (const line of dto.items) {
        const issue = await tx.item_Issue.create({
          data: {
            itemId: line.itemId,
            qty: line.qty,
            unitPrice: line.unitPrice,
            issueDate,
            issueBranchId: dto.issueBranchId,
            receiveBranchId: dto.receiveBranchId,
            serialNo,
            // Column keeps the legacy misspelling; the API field does not.
            voucharNo: dto.voucherNo,
            isProduction: line.isProduction && Number(line.qty) > 0 ? 1 : 0,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        });

        const itemCode = codeByItemId.get(line.itemId)!;
        await tx.inventory.update({ where: { itemCode }, data: { quantity: { decrement: line.qty } } });
        issues.push(issue);
      }
      return issues;
    });
  }

  async findAllIssues(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const issueDate = dateRangeFilter(fromDate, toDate);
    const where = {
      isActive: 1,
      ...InventoryService.ISSUE_ONLY,
      ...(branchId && { issueBranchId: branchId }),
      ...(issueDate && { issueDate }),
    };
    const rows = await this.prisma.item_Issue.findMany({ where, orderBy: { createDate: 'desc' } });
    return this.groupBySerial(rows, page, limit);
  }

  /** Looks up issue rows by serialNo, falling back to a single row by id
   *  for any pre-existing record that has a blank serialNo. */
  private async findIssueRows(serialNo: string) {
    let rows = await this.prisma.item_Issue.findMany({ where: { serialNo }, orderBy: { createDate: 'asc' } });
    if (!rows.length && this.isUuid(serialNo)) {
      const fallback = await this.prisma.item_Issue.findUnique({ where: { id: serialNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Issue record not found');
    return rows;
  }

  async findOneIssue(serialNo: string) {
    const rows = await this.findIssueRows(serialNo);
    const [first] = rows;
    const nameByItemId = await this.itemNamesByIds(rows.map((r) => r.itemId).filter((id): id is string => !!id));
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      issueDate: first.issueDate,
      issueBranchId: first.issueBranchId,
      receiveBranchId: first.receiveBranchId,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemId ? nameByItemId.get(r.itemId) : undefined,
        qty: Number(r.qty ?? 0),
        unitPrice: Number(r.unitPrice ?? 0),
        isProduction: r.isProduction === 1,
      })),
    };
  }

  async updateIssue(serialNo: string, dto: UpdateIssueStockDto, updatedBy: string) {
    const existing = await this.findIssueRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    this.assertNotTransfer(key, 'edited');
    const codeByItemId = await this.itemCodesByIds([
      ...existing.map((r) => r.itemId).filter((id): id is string => !!id),
      ...dto.items.map((i) => i.itemId),
    ]);
    const issueDate = new Date(dto.issueDate);

    const issueBranchId = dto.issueBranchId ?? existing[0].issueBranchId;
    // The guard runs before the transaction opens, so a non-factory session is
    // refused without ever touching stock. `null` when this edit produces
    // nothing — the sync still runs, to clear whatever the last version did.
    const producedAt =
      (await this.assertMayProduce(dto.items, issueBranchId)) ??
      (await this.prisma.branch.findUnique({
        where: { id: issueBranchId },
        select: { id: true, branchCode: true },
      }));

    return this.prisma.$transaction(async (tx) => {
      // Editing is purge-and-replace. Reverse this document's whole previous
      // effect first, then apply the new one — every check below then reads the
      // real balance inside the transaction rather than a pre-computed net, so
      // the awkward cases (a line that moved from production to plain, or the
      // reverse) need no special handling.
      //
      // Step 1: issuing decrements stock, so give back what the old lines took.
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { increment: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Issue.deleteMany({ where: { serialNo: key } });

      // Step 2: withdraw the old production rows and write the new ones. Passing
      // an empty line set is how an edit that unticks every box removes the
      // production side altogether.
      if (producedAt) {
        await this.production.syncFromIssue(tx, {
          issueSerialNo: key,
          branchId: producedAt.id,
          branchCode: producedAt.branchCode,
          date: issueDate,
          lines: this.productionLines(dto.items),
          user: updatedBy,
        });
      }

      // Step 3: the replacement lines, checked against the balance those two
      // steps just left behind.
      await assertStockAvailable(tx, dto.items);

      const issues = [];
      for (const line of dto.items) {
        const issue = await tx.item_Issue.create({
          data: {
            itemId: line.itemId,
            qty: line.qty,
            unitPrice: line.unitPrice,
            issueDate,
            issueBranchId,
            receiveBranchId: dto.receiveBranchId ?? existing[0].receiveBranchId,
            serialNo: key,
            voucharNo: dto.voucherNo,
            isProduction: line.isProduction && Number(line.qty) > 0 ? 1 : 0,
            isActive: 1,
            createBy: existing[0].createBy,
            createDate: existing[0].createDate,
            updateBy: updatedBy,
            updateDate: new Date(),
          },
        });
        const itemCode = codeByItemId.get(line.itemId)!;
        await tx.inventory.update({ where: { itemCode }, data: { quantity: { decrement: line.qty } } });
        issues.push(issue);
      }
      return issues;
    });
  }

  async removeIssue(serialNo: string) {
    const existing = await this.findIssueRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    this.assertNotTransfer(key, 'deleted');
    const codeByItemId = await this.itemCodesByIds(existing.map((r) => r.itemId).filter((id): id is string => !!id));
    await this.prisma.$transaction(async (tx) => {
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { increment: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Issue.deleteMany({ where: { serialNo: key } });
      // An empty line set withdraws and deletes whatever this document produced.
      // No factory check here: deleting must stay possible even from a session
      // that could not have created the production rows in the first place.
      await this.production.syncFromIssue(tx, {
        issueSerialNo: key,
        branchId: existing[0].issueBranchId,
        date: existing[0].issueDate ?? new Date(),
        lines: [],
        user: 'system',
      });
    });
    return { message: 'Stock issue deleted successfully' };
  }

  // ── Adjust ────────────────────────────────────────────────────

  async adjustStock(
    body: {
      invNo?: string;
      date: string;
      branchId?: string;
      // Either a single line (legacy) or a list of lines (frontend)
      itmOId?: string;
      reject?: number;
      excess?: number;
      short?: number;
      assort?: number;
      items?: { itmOId: string; reject?: number; excess?: number; short?: number; assort?: number }[];
    },
    userBranchId?: string,
  ) {
    const lines =
      body.items && body.items.length
        ? body.items
        : [{ itmOId: body.itmOId!, reject: body.reject, excess: body.excess, short: body.short, assort: body.assort }];

    if (!lines.length || !lines[0].itmOId) throw new BadRequestException('No items to adjust');
    const date = body.date ? new Date(body.date) : new Date();
    const branchId = body.branchId ?? userBranchId;
    const branchCode = await this.resolveBranchCode(branchId);
    const baseCount = await this.prisma.itemReject.count();
    // Every line in this request shares one reference number so the whole
    // document can be looked up / edited / deleted together later.
    const invNo = body.invNo || this.buildSerialNo('ADJ', branchCode, baseCount + 1);

    const results = [];
    for (const line of lines) {
      const reject = await this.prisma.itemReject.create({
        data: {
          invNo,
          itmOId: line.itmOId,
          reject: line.reject ?? 0,
          excess: line.excess ?? 0,
          short: line.short ?? 0,
          assort: line.assort ?? 0,
          date,
          branchId,
          isActive: 1,
        },
      });

      // Net adjustment: excess adds to stock, reject/short/assort deducts
      const netChange = (line.excess ?? 0) - ((line.reject ?? 0) + (line.short ?? 0) + (line.assort ?? 0));
      if (netChange !== 0) {
        const item = await this.prisma.item_Information.findUnique({ where: { id: line.itmOId } });
        if (item?.itmCode) {
          await this.prisma.inventory.update({
            where: { itemCode: item.itmCode },
            data: { quantity: { increment: netChange } },
          });
        }
      }
      results.push(reject);
    }

    return results;
  }

  async findAllAdjustments(query: DateRangeQueryDto) {
    const { page, limit, branchId, fromDate, toDate } = query;
    const date = dateRangeFilter(fromDate, toDate);
    const where = { isActive: 1, ...(branchId && { branchId }), ...(date && { date }) };
    const rows = await this.prisma.itemReject.findMany({ where, orderBy: { date: 'desc' } });
    return this.groupAdjustments(rows, page, limit);
  }

  /** Rows sharing one invNo were all created in the same request, so header
   *  fields (date/branch) are identical — only the per-item reject/excess/
   *  short/assort figures differ. Groups in app code and sums each figure
   *  across lines, the same way groupBySerial sums qty for Receive/Issue/Transfer. */
  private groupAdjustments<
    T extends { invNo?: string | null; id: string; reject?: unknown; excess?: unknown; short?: unknown; assort?: unknown },
  >(rows: T[], page: number, limit: number) {
    const groups = new Map<string, T & { reject: number; excess: number; short: number; assort: number }>();
    for (const row of rows) {
      const key = row.invNo || row.id;
      const existing = groups.get(key);
      if (existing) {
        existing.reject += Number(row.reject ?? 0);
        existing.excess += Number(row.excess ?? 0);
        existing.short += Number(row.short ?? 0);
        existing.assort += Number(row.assort ?? 0);
      } else {
        groups.set(key, {
          ...row,
          invNo: key,
          reject: Number(row.reject ?? 0),
          excess: Number(row.excess ?? 0),
          short: Number(row.short ?? 0),
          assort: Number(row.assort ?? 0),
        });
      }
    }
    const all = Array.from(groups.values());
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return { items, meta: buildPaginationMeta(all.length, page, limit) };
  }

  /** Looks up adjustment rows by invNo, falling back to a single row by id
   *  for any pre-existing record that has a blank invNo. */
  private async findAdjustmentRows(invNo: string) {
    let rows = await this.prisma.itemReject.findMany({ where: { invNo }, orderBy: { id: 'asc' } });
    if (!rows.length && this.isUuid(invNo)) {
      const fallback = await this.prisma.itemReject.findUnique({ where: { id: invNo } });
      if (fallback) rows = [fallback];
    }
    if (!rows.length) throw new NotFoundException('Adjustment record not found');
    return rows;
  }

  async findOneAdjustment(invNo: string) {
    const rows = await this.findAdjustmentRows(invNo);
    const [first] = rows;
    const nameByItemId = await this.itemNamesByIds(rows.map((r) => r.itmOId).filter((id): id is string => !!id));
    return {
      invNo: first.invNo || first.id,
      date: first.date,
      branchId: first.branchId,
      items: rows.map((r) => ({
        itmOId: r.itmOId,
        itemName: r.itmOId ? nameByItemId.get(r.itmOId) : undefined,
        reject: Number(r.reject ?? 0),
        excess: Number(r.excess ?? 0),
        short: Number(r.short ?? 0),
        assort: Number(r.assort ?? 0),
      })),
    };
  }

  async updateAdjustment(
    invNo: string,
    dto: {
      date?: string;
      branchId?: string;
      items: { itmOId: string; reject?: number; excess?: number; short?: number; assort?: number }[];
    },
  ) {
    const existing = await this.findAdjustmentRows(invNo);
    const key = existing[0].invNo || existing[0].id;
    const date = dto.date ? new Date(dto.date) : (existing[0].date ?? new Date());
    const branchId = dto.branchId ?? existing[0].branchId ?? undefined;

    return this.prisma.$transaction(async (tx) => {
      // Reverse the net stock effect of every line this document previously held.
      for (const row of existing) {
        if (row.itmOId) {
          const netChange = Number(row.excess ?? 0) - (Number(row.reject ?? 0) + Number(row.short ?? 0) + Number(row.assort ?? 0));
          if (netChange !== 0) {
            const item = await tx.item_Information.findUnique({ where: { id: row.itmOId } });
            if (item?.itmCode) await tx.inventory.updateMany({ where: { itemCode: item.itmCode }, data: { quantity: { decrement: netChange } } });
          }
        }
      }
      await tx.itemReject.deleteMany({ where: { invNo: key } });

      const rows = [];
      for (const line of dto.items) {
        const row = await tx.itemReject.create({
          data: {
            invNo: key,
            itmOId: line.itmOId,
            reject: line.reject ?? 0,
            excess: line.excess ?? 0,
            short: line.short ?? 0,
            assort: line.assort ?? 0,
            date,
            branchId,
            isActive: 1,
          },
        });
        const netChange = (line.excess ?? 0) - ((line.reject ?? 0) + (line.short ?? 0) + (line.assort ?? 0));
        if (netChange !== 0) {
          const item = await tx.item_Information.findUnique({ where: { id: line.itmOId } });
          if (item?.itmCode) await tx.inventory.update({ where: { itemCode: item.itmCode }, data: { quantity: { increment: netChange } } });
        }
        rows.push(row);
      }
      return rows;
    });
  }

  async removeAdjustment(invNo: string) {
    const existing = await this.findAdjustmentRows(invNo);
    const key = existing[0].invNo || existing[0].id;
    await this.prisma.$transaction(async (tx) => {
      for (const row of existing) {
        if (row.itmOId) {
          const netChange = Number(row.excess ?? 0) - (Number(row.reject ?? 0) + Number(row.short ?? 0) + Number(row.assort ?? 0));
          if (netChange !== 0) {
            const item = await tx.item_Information.findUnique({ where: { id: row.itmOId } });
            if (item?.itmCode) await tx.inventory.updateMany({ where: { itemCode: item.itmCode }, data: { quantity: { decrement: netChange } } });
          }
        }
      }
      await tx.itemReject.deleteMany({ where: { invNo: key } });
    });
    return { message: 'Adjustment deleted successfully' };
  }

  // ── Serial number helpers ───────────────────────────────────────

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in generated serial numbers. Returns '' when the branch can't be
   *  resolved, so the number simply omits the code. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null || !this.isUuid(String(branchId))) return '';
    const branch = await this.prisma.branch.findUnique({ where: { id: String(branchId) }, select: { branchCode: true } }).catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private yyyymm(d = new Date()): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildSerialNo(prefix: string, branchCode: string, seq: number): string {
    return [prefix, branchCode, this.yyyymm(), String(seq).padStart(5, '0')].filter(Boolean).join('-');
  }
}
