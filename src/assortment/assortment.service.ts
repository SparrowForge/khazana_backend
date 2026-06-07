import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateAssortmentDto {
  code?: string;
  date: string;
  type?: string;
  branchId?: number;
  totalAmt?: number;
  discAmt?: number;
  netAmt?: number;
  customerpay?: number;
  change?: number;
  discountRemarks?: string;
  items: {
    itemOID: string;
    qty: number;
    uom?: string;
    price?: number;
    amount?: number;
    vatValue?: number;
    vatAmount?: number;
    discount?: number;
    netAmount?: number;
  }[];
}

@Injectable()
export class AssortmentService {
  constructor(private prisma: PrismaService) {}

  findAll(branchId?: number) {
    return this.prisma.asstMsrt.findMany({
      where: { isActive: true, ...(branchId && { branchId }) },
      include: { details: true },
      orderBy: { date: 'desc' },
    });
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
