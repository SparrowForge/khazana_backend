import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { ReceiveStockDto, UpdateReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto, UpdateIssueStockDto } from './dto/issue-stock.dto';
import { BranchPaginationQueryDto } from '../common/dto';
import { ItemQueryDto } from './dto/item-query.dto';
import { buildPaginationMeta, toBranchUuid } from '../common/helpers';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

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
    // line VAT client-side the same way the POS terminal does.
    const items = rows.map((row) => ({
      ...row,
      price: Number(row.prices?.[0]?.priceListPrice ?? 0),
      vatPercentage: Number(row.prices?.[0]?.priceVatPercent ?? 0),
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

    return this.prisma.$transaction(
      dto.items.flatMap((line) => {
        // Both legs of one transfer line share the same id so they stay paired.
        const id = randomUUID();
        return [
          // Stock leaves the issuing branch
          this.prisma.item_Issue.create({
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
          }),
          // Stock arrives at the receiving branch
          this.prisma.item_Receive.create({
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
          }),
        ];
      }),
    );
  }

  async findTransferHistory(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { issueBranchId: branchId }) };
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
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      issueDate: first.issueDate,
      issueBranchId: first.issueBranchId,
      receiveBranchId: first.receiveBranchId,
      items: rows.map((r) => ({ itemId: r.itemId, qty: Number(r.qty ?? 0) })),
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

  async findReceiveHistory(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { receiveBranchID: branchId }) };
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
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      purDate: first.purDate,
      branchId: first.receiveBranchID,
      fromBranchId: first.branchId,
      items: rows.map((r) => ({ itemId: r.itemId, itemName: r.itemName, qty: Number(r.qty ?? 0) })),
    };
  }

  async updateReceive(serialNo: string, dto: UpdateReceiveStockDto, updatedBy: string, userBranchId: string) {
    const existing = await this.findReceiveRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
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

  async issueStock(dto: IssueStockDto, createdBy: string) {
    if (!dto.items?.length) throw new BadRequestException('No items to issue');
    const codeByItemId = await this.itemCodesByIds(dto.items.map((i) => i.itemId));
    for (const line of dto.items) {
      const itemCode = codeByItemId.get(line.itemId)!;
      const inventory = await this.prisma.inventory.findUnique({ where: { itemCode } });
      if (!inventory || Number(inventory.quantity) < line.qty) {
        throw new BadRequestException(`Insufficient stock for item ${itemCode}`);
      }
    }

    const issueDate = new Date(dto.issueDate);
    const branchCode = await this.resolveBranchCode(dto.issueBranchId);
    const baseCount = await this.prisma.item_Issue.count();
    // Every line in this request shares one serial number so the whole
    // document can be looked up / edited / deleted together later.
    const serialNo = dto.serialNo || this.buildSerialNo('ISS', branchCode, baseCount + 1);

    return this.prisma.$transaction(async (tx) => {
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
            voucharNo: dto.voucharNo,
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

  async findAllIssues(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { issueBranchId: branchId }) };
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
    return {
      serialNo: first.serialNo || first.id,
      voucherNo: first.voucharNo,
      issueDate: first.issueDate,
      issueBranchId: first.issueBranchId,
      receiveBranchId: first.receiveBranchId,
      items: rows.map((r) => ({ itemId: r.itemId, qty: Number(r.qty ?? 0), unitPrice: Number(r.unitPrice ?? 0) })),
    };
  }

  async updateIssue(serialNo: string, dto: UpdateIssueStockDto, updatedBy: string) {
    const existing = await this.findIssueRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    const codeByItemId = await this.itemCodesByIds([
      ...existing.map((r) => r.itemId).filter((id): id is string => !!id),
      ...dto.items.map((i) => i.itemId),
    ]);
    for (const line of dto.items) {
      const stillHeld = existing
        .filter((r) => r.itemId === line.itemId)
        .reduce((sum, r) => sum + Number(r.qty ?? 0), 0);
      const itemCode = codeByItemId.get(line.itemId)!;
      const inventory = await this.prisma.inventory.findUnique({ where: { itemCode } });
      const available = Number(inventory?.quantity ?? 0) + stillHeld;
      if (available < line.qty) throw new BadRequestException(`Insufficient stock for item ${itemCode}`);
    }
    const issueDate = new Date(dto.issueDate);

    return this.prisma.$transaction(async (tx) => {
      // Issuing decrements stock; restore what this document previously took
      // out, then wipe its lines.
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { increment: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Issue.deleteMany({ where: { serialNo: key } });

      const issues = [];
      for (const line of dto.items) {
        const issue = await tx.item_Issue.create({
          data: {
            itemId: line.itemId,
            qty: line.qty,
            unitPrice: line.unitPrice,
            issueDate,
            issueBranchId: dto.issueBranchId ?? existing[0].issueBranchId,
            receiveBranchId: dto.receiveBranchId ?? existing[0].receiveBranchId,
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
        await tx.inventory.update({ where: { itemCode }, data: { quantity: { decrement: line.qty } } });
        issues.push(issue);
      }
      return issues;
    });
  }

  async removeIssue(serialNo: string) {
    const existing = await this.findIssueRows(serialNo);
    const key = existing[0].serialNo || existing[0].id;
    const codeByItemId = await this.itemCodesByIds(existing.map((r) => r.itemId).filter((id): id is string => !!id));
    await this.prisma.$transaction(async (tx) => {
      for (const row of existing) {
        if (row.itemId) {
          const itemCode = codeByItemId.get(row.itemId)!;
          await tx.inventory.updateMany({ where: { itemCode }, data: { quantity: { increment: Number(row.qty ?? 0) } } });
        }
      }
      await tx.item_Issue.deleteMany({ where: { serialNo: key } });
    });
    return { message: 'Stock issue deleted successfully' };
  }

  // ── Adjust ────────────────────────────────────────────────────

  async adjustStock(body: {
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
  }) {
    const lines =
      body.items && body.items.length
        ? body.items
        : [{ itmOId: body.itmOId!, reject: body.reject, excess: body.excess, short: body.short, assort: body.assort }];

    if (!lines.length || !lines[0].itmOId) throw new BadRequestException('No items to adjust');
    const date = body.date ? new Date(body.date) : new Date();

    const results = [];
    for (const line of lines) {
      const reject = await this.prisma.itemReject.create({
        data: {
          invNo: body.invNo,
          itmOId: line.itmOId,
          reject: line.reject ?? 0,
          excess: line.excess ?? 0,
          short: line.short ?? 0,
          assort: line.assort ?? 0,
          date,
          branchId: body.branchId,
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

  async findAllAdjustments(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { branchId }) };
    const [rows, total] = await Promise.all([
      this.prisma.itemReject.findMany({
        where,
        include: { item: { select: { itmCode: true, itmName: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.itemReject.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOneAdjustment(id: string) {
    const row = await this.prisma.itemReject.findUnique({
      where: { id },
      include: { item: { select: { itmCode: true, itmName: true } } },
    });
    if (!row) throw new NotFoundException('Adjustment record not found');
    return row;
  }

  async updateAdjustment(
    id: string,
    dto: {
      invNo?: string;
      date?: string;
      branchId?: string;
      itmOId?: string;
      reject?: number;
      excess?: number;
      short?: number;
      assort?: number;
    },
  ) {
    const existing = await this.findOneAdjustment(id);
    const oldNet =
      Number(existing.excess ?? 0) - (Number(existing.reject ?? 0) + Number(existing.short ?? 0) + Number(existing.assort ?? 0));
    const newItmOId = dto.itmOId ?? existing.itmOId!;
    const newNet =
      (dto.excess ?? Number(existing.excess ?? 0)) -
      ((dto.reject ?? Number(existing.reject ?? 0)) + (dto.short ?? Number(existing.short ?? 0)) + (dto.assort ?? Number(existing.assort ?? 0)));

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.itemReject.update({
        where: { id },
        data: {
          invNo: dto.invNo,
          date: dto.date ? new Date(dto.date) : undefined,
          branchId: dto.branchId,
          itmOId: dto.itmOId,
          reject: dto.reject,
          excess: dto.excess,
          short: dto.short,
          assort: dto.assort,
        },
      });

      // Reverse the old net stock change and apply the new one (handles an
      // item-code swap by moving the adjustment from one item's stock to another).
      const oldItem = await tx.item_Information.findUnique({ where: { id: existing.itmOId! } });
      if (existing.itmOId !== newItmOId) {
        const newItem = await tx.item_Information.findUnique({ where: { id: newItmOId } });
        if (oldItem?.itmCode) await tx.inventory.updateMany({ where: { itemCode: oldItem.itmCode }, data: { quantity: { decrement: oldNet } } });
        if (newItem?.itmCode) await tx.inventory.updateMany({ where: { itemCode: newItem.itmCode }, data: { quantity: { increment: newNet } } });
      } else if (newNet !== oldNet && oldItem?.itmCode) {
        await tx.inventory.updateMany({ where: { itemCode: oldItem.itmCode }, data: { quantity: { increment: newNet - oldNet } } });
      }

      return row;
    });
  }

  async removeAdjustment(id: string) {
    const existing = await this.findOneAdjustment(id);
    const netChange =
      Number(existing.excess ?? 0) - (Number(existing.reject ?? 0) + Number(existing.short ?? 0) + Number(existing.assort ?? 0));
    await this.prisma.$transaction(async (tx) => {
      if (existing.itmOId && netChange !== 0) {
        const item = await tx.item_Information.findUnique({ where: { id: existing.itmOId } });
        if (item?.itmCode) await tx.inventory.updateMany({ where: { itemCode: item.itmCode }, data: { quantity: { decrement: netChange } } });
      }
      await tx.itemReject.delete({ where: { id } });
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
