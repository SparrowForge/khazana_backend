import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreateNcAdjustmentDto {
  code?: string;
  date: string;
  name?: string;
  contactNo?: string;
  reference?: string;
  branchId?: number;
  items: {
    itemId: string;
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
export class NcAdjustmentService {
  constructor(private prisma: PrismaService) {}

  findAll(branchId?: number) {
    return this.prisma.t_NCMstr.findMany({
      where: { ncmstrIsActive: true, ...(branchId && { branchId }) },
      include: { details: true },
      orderBy: { ncmstrDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const nc = await this.prisma.t_NCMstr.findUnique({
      where: { id },
      include: { details: { include: { item: true } } },
    });
    if (!nc) throw new NotFoundException('NC adjustment not found');
    return nc;
  }

  async create(dto: CreateNcAdjustmentDto, userName: string) {
    const nc = await this.prisma.t_NCMstr.create({
      data: {
        ncmstrCode: dto.code,
        ncmstrDate: new Date(dto.date),
        ncmstrName: dto.name,
        ncmstrContactNo: dto.contactNo,
        ncmstrReference: dto.reference,
        branchId: dto.branchId,
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
            branchId: dto.branchId,
          })),
        },
      },
      include: { details: true },
    });

    // NC adjustment adds stock back
    for (const item of dto.items) {
      const itemInfo = await this.prisma.item_Information.findUnique({ where: { id: item.itemId } });
      if (itemInfo?.itmCode) {
        await this.prisma.inventory.upsert({
          where: { itemCode: itemInfo.itmCode },
          create: { itemCode: itemInfo.itmCode, quantity: item.qty },
          update: { quantity: { increment: item.qty } },
        });
      }
    }

    return nc;
  }
}
