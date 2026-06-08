import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // ── Current Stock ─────────────────────────────────────────────

  async findAll(branchId?: number) {
    return this.prisma.inventory.findMany({
      include: { item: { include: { prices: { where: { priceIsActive: 1 } } } } },
    });
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

  async findAllItems() {
    return this.prisma.item_Information.findMany({
      where: { isActive: 'Y' },
      include: { inventory: true },
      orderBy: { itmName: 'asc' },
    });
  }

  async findItem(id: string) {
    const item = await this.prisma.item_Information.findUnique({
      where: { id },
      include: { inventory: true, prices: true, costPrices: true },
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async createItem(data: {
    itmCode: string;
    itmName: string;
    itmCategory?: string;
    itmType?: string;
    itmUOM?: string;
    itmRemarks?: string;
  }) {
    return this.prisma.item_Information.create({ data: { ...data, isActive: 'Y' } });
  }

  async updateItem(id: string, data: Partial<{ itmName: string; itmCategory: string; isActive: string }>) {
    await this.findItem(id);
    return this.prisma.item_Information.update({ where: { id }, data });
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
      issueBranchId: number;
      receiveBranchId: number;
      items: { itemCode: string; qty: number }[];
    },
    createdBy: string,
  ) {
    if (!dto.items?.length) throw new BadRequestException('No items to transfer');
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();

    return this.prisma.$transaction(
      dto.items.flatMap((line) => [
        // Stock leaves the issuing branch
        this.prisma.item_Issue.create({
          data: {
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
            itemCode: line.itemCode,
            qty: line.qty,
            purDate: issueDate,
            branchId: dto.receiveBranchId,
            receiveBranchID: dto.receiveBranchId,
            voucharNo: dto.voucherNo,
            isActive: 1,
            createBy: createdBy,
            createDate: new Date(),
          },
        }),
      ]),
    );
  }

  // ── Receive ───────────────────────────────────────────────────

  async receiveStock(dto: ReceiveStockDto, createdBy: string) {
    const receive = await this.prisma.item_Receive.create({
      data: {
        itemCode: dto.itemCode,
        itemName: dto.itemName,
        qty: dto.qty,
        purDate: new Date(dto.purDate),
        branchId: dto.branchId,
        receiveBranchID: dto.receiveBranchID,
        serialNo: dto.serialNo,
        voucharNo: dto.voucharNo,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
      },
    });

    await this.prisma.inventory.upsert({
      where: { itemCode: dto.itemCode },
      create: { itemCode: dto.itemCode, quantity: dto.qty },
      update: { quantity: { increment: dto.qty } },
    });

    return receive;
  }

  // ── Issue / Transfer ──────────────────────────────────────────

  async issueStock(dto: IssueStockDto, createdBy: string) {
    const inventory = await this.prisma.inventory.findUnique({ where: { itemCode: dto.itemCode } });
    if (!inventory || Number(inventory.quantity) < dto.qty) {
      throw new BadRequestException('Insufficient stock');
    }

    const issue = await this.prisma.item_Issue.create({
      data: {
        itemCode: dto.itemCode,
        qty: dto.qty,
        unitPrice: dto.unitPrice,
        issueDate: new Date(dto.issueDate),
        issueBranchId: dto.issueBranchId,
        receiveBranchId: dto.receiveBranchId,
        serialNo: dto.serialNo,
        voucharNo: dto.voucharNo,
        isActive: 1,
        createBy: createdBy,
        createDate: new Date(),
      },
    });

    await this.prisma.inventory.update({
      where: { itemCode: dto.itemCode },
      data: { quantity: { decrement: dto.qty } },
    });

    return issue;
  }

  // ── Adjust ────────────────────────────────────────────────────

  async adjustStock(body: {
    invNo?: string;
    date: string;
    branchId?: number;
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

  async findReceiveHistory(branchId?: number) {
    return this.prisma.item_Receive.findMany({
      where: { isActive: 1, ...(branchId && { branchId }) },
      orderBy: { createDate: 'desc' },
      take: 100,
    });
  }

  async findIssueHistory(branchId?: number) {
    return this.prisma.item_Issue.findMany({
      where: { isActive: 1, ...(branchId && { issueBranchId: branchId }) },
      orderBy: { createDate: 'desc' },
      take: 100,
    });
  }
}
