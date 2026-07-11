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
    const items = rows.map((row) => ({ ...row, price: Number(row.prices?.[0]?.priceListPrice ?? 0) }));
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
      items: { itemCode: string; qty: number }[];
    },
    createdBy: string,
  ) {
    if (!dto.items?.length) throw new BadRequestException('No items to transfer');
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const branchCode = await this.resolveBranchCode(dto.issueBranchId);
    const baseCount = await this.prisma.item_Issue.count();

    return this.prisma.$transaction(
      dto.items.flatMap((line, i) => {
        // Both legs of one transfer line share the same id + serial number so
        // they can be looked up / edited / deleted together later.
        const id = randomUUID();
        const serialNo = this.buildSerialNo('TRF', branchCode, baseCount + i + 1);
        return [
          // Stock leaves the issuing branch
          this.prisma.item_Issue.create({
            data: {
              id,
              serialNo,
              itemCode: line.itemCode,
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
              itemCode: line.itemCode,
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
    const [rows, total] = await Promise.all([
      this.prisma.item_Issue.findMany({ where, orderBy: { createDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.item_Issue.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOneTransfer(id: string) {
    const row = await this.prisma.item_Issue.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Transfer record not found');
    return row;
  }

  async updateTransfer(
    id: string,
    dto: {
      voucherNo?: string;
      issueDate?: string;
      issueBranchId?: string;
      receiveBranchId?: string;
      itemCode?: string;
      qty?: number;
    },
    updatedBy: string,
  ) {
    await this.findOneTransfer(id);
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : undefined;
    const [row] = await this.prisma.$transaction([
      this.prisma.item_Issue.update({
        where: { id },
        data: {
          voucharNo: dto.voucherNo,
          issueDate,
          issueBranchId: dto.issueBranchId,
          receiveBranchId: dto.receiveBranchId,
          itemCode: dto.itemCode,
          qty: dto.qty,
          updateBy: updatedBy,
          updateDate: new Date(),
        },
      }),
      // The paired receive leg shares the same id; updateMany no-ops for legacy
      // rows created before the two legs were linked.
      this.prisma.item_Receive.updateMany({
        where: { id },
        data: {
          voucharNo: dto.voucherNo,
          purDate: issueDate,
          branchId: dto.issueBranchId,
          receiveBranchID: dto.receiveBranchId,
          itemCode: dto.itemCode,
          qty: dto.qty,
          updateBy: updatedBy,
          updateDate: new Date(),
        },
      }),
    ]);
    return row;
  }

  async removeTransfer(id: string) {
    await this.findOneTransfer(id);
    await this.prisma.$transaction([
      this.prisma.item_Receive.deleteMany({ where: { id } }),
      this.prisma.item_Issue.delete({ where: { id } }),
    ]);
    return { message: 'Transfer deleted successfully' };
  }

  // ── Receive ───────────────────────────────────────────────────

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

    const results = await this.prisma.$transaction(async (tx) => {
      const receives = [];
      for (let i = 0; i < dto.items.length; i++) {
        const line = dto.items[i];
        const serialNo = dto.serialNo || this.buildSerialNo('GRN', branchCode, baseCount + i + 1);
        const receive = await tx.item_Receive.create({
          data: {
            itemCode: line.itemCode,
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

        await tx.inventory.upsert({
          where: { itemCode: line.itemCode },
          create: { itemCode: line.itemCode, quantity: line.qty },
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
    const [rows, total] = await Promise.all([
      this.prisma.item_Receive.findMany({ where, orderBy: { createDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.item_Receive.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOneReceive(id: string) {
    const row = await this.prisma.item_Receive.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Receive record not found');
    return row;
  }

  async updateReceive(id: string, dto: UpdateReceiveStockDto, updatedBy: string) {
    const existing = await this.findOneReceive(id);
    const oldItemCode = existing.itemCode!;
    const oldQty = Number(existing.qty ?? 0);
    const newItemCode = dto.itemCode ?? oldItemCode;
    const newQty = dto.qty ?? oldQty;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.item_Receive.update({
        where: { id },
        data: {
          serialNo: dto.serialNo,
          voucharNo: dto.voucherNo,
          itemCode: dto.itemCode,
          itemName: dto.itemName,
          qty: dto.qty,
          purDate: dto.purDate ? new Date(dto.purDate) : undefined,
          branchId: dto.fromBranchId,
          receiveBranchID: dto.branchId,
          updateBy: updatedBy,
          updateDate: new Date(),
        },
      });

      // Keep the aggregate stock table in sync with whatever changed.
      if (oldItemCode !== newItemCode) {
        await tx.inventory.updateMany({ where: { itemCode: oldItemCode }, data: { quantity: { decrement: oldQty } } });
        await tx.inventory.upsert({
          where: { itemCode: newItemCode },
          create: { itemCode: newItemCode, quantity: newQty },
          update: { quantity: { increment: newQty } },
        });
      } else if (newQty !== oldQty) {
        await tx.inventory.updateMany({ where: { itemCode: newItemCode }, data: { quantity: { increment: newQty - oldQty } } });
      }

      return row;
    });
  }

  async removeReceive(id: string) {
    const existing = await this.findOneReceive(id);
    await this.prisma.$transaction(async (tx) => {
      if (existing.itemCode) {
        await tx.inventory.updateMany({ where: { itemCode: existing.itemCode }, data: { quantity: { decrement: Number(existing.qty ?? 0) } } });
      }
      await tx.item_Receive.delete({ where: { id } });
    });
    return { message: 'Stock receive deleted successfully' };
  }

  // ── Issue ─────────────────────────────────────────────────────

  async issueStock(dto: IssueStockDto, createdBy: string) {
    if (!dto.items?.length) throw new BadRequestException('No items to issue');
    for (const line of dto.items) {
      const inventory = await this.prisma.inventory.findUnique({ where: { itemCode: line.itemCode } });
      if (!inventory || Number(inventory.quantity) < line.qty) {
        throw new BadRequestException(`Insufficient stock for item ${line.itemCode}`);
      }
    }

    const issueDate = new Date(dto.issueDate);
    const branchCode = await this.resolveBranchCode(dto.issueBranchId);
    const baseCount = await this.prisma.item_Issue.count();

    return this.prisma.$transaction(async (tx) => {
      const issues = [];
      for (let i = 0; i < dto.items.length; i++) {
        const line = dto.items[i];
        const serialNo = dto.serialNo || this.buildSerialNo('ISS', branchCode, baseCount + i + 1);
        const issue = await tx.item_Issue.create({
          data: {
            itemCode: line.itemCode,
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

        await tx.inventory.update({ where: { itemCode: line.itemCode }, data: { quantity: { decrement: line.qty } } });
        issues.push(issue);
      }
      return issues;
    });
  }

  async findAllIssues(query: BranchPaginationQueryDto) {
    const { page, limit, branchId } = query;
    const where = { isActive: 1, ...(branchId && { issueBranchId: branchId }) };
    const [rows, total] = await Promise.all([
      this.prisma.item_Issue.findMany({ where, orderBy: { createDate: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.item_Issue.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOneIssue(id: string) {
    const row = await this.prisma.item_Issue.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Issue record not found');
    return row;
  }

  async updateIssue(id: string, dto: UpdateIssueStockDto, updatedBy: string) {
    const existing = await this.findOneIssue(id);
    const oldItemCode = existing.itemCode!;
    const oldQty = Number(existing.qty ?? 0);
    const newItemCode = dto.itemCode ?? oldItemCode;
    const newQty = dto.qty ?? oldQty;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.item_Issue.update({
        where: { id },
        data: {
          serialNo: dto.serialNo,
          voucharNo: dto.voucherNo,
          itemCode: dto.itemCode,
          qty: dto.qty,
          unitPrice: dto.unitPrice,
          issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
          issueBranchId: dto.issueBranchId,
          receiveBranchId: dto.receiveBranchId,
          updateBy: updatedBy,
          updateDate: new Date(),
        },
      });

      // Issuing decrements stock, so a bigger/changed line needs the extra
      // deducted and a smaller one needs the difference restored.
      if (oldItemCode !== newItemCode) {
        await tx.inventory.updateMany({ where: { itemCode: oldItemCode }, data: { quantity: { increment: oldQty } } });
        await tx.inventory.updateMany({ where: { itemCode: newItemCode }, data: { quantity: { decrement: newQty } } });
      } else if (newQty !== oldQty) {
        await tx.inventory.updateMany({ where: { itemCode: newItemCode }, data: { quantity: { decrement: newQty - oldQty } } });
      }

      return row;
    });
  }

  async removeIssue(id: string) {
    const existing = await this.findOneIssue(id);
    await this.prisma.$transaction(async (tx) => {
      if (existing.itemCode) {
        await tx.inventory.updateMany({ where: { itemCode: existing.itemCode }, data: { quantity: { increment: Number(existing.qty ?? 0) } } });
      }
      await tx.item_Issue.delete({ where: { id } });
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

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in generated serial numbers. Returns '' when the branch can't be
   *  resolved, so the number simply omits the code. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) return '';
    const branch = await this.prisma.branch.findUnique({ where: { id }, select: { branchCode: true } }).catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private yyyymm(d = new Date()): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildSerialNo(prefix: string, branchCode: string, seq: number): string {
    return [prefix, branchCode, this.yyyymm(), String(seq).padStart(5, '0')].filter(Boolean).join('-');
  }
}
