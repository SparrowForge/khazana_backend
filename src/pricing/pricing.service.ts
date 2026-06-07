import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export class CreatePriceDto {
  itemCode: string;
  fromDate: string;
  toDate?: string;
  listPrice: number;
  vatPercent?: number;
  vatPrice?: number;
  discPrice?: number;
}

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  // ── Selling Prices ────────────────────────────────────────────

  findAllPrices(itemCode?: string) {
    return this.prisma.t_Price.findMany({
      where: { priceIsActive: 1, ...(itemCode && { priceItemOId: itemCode }) },
      include: { item: true },
    });
  }

  async getCurrentPrice(itemCode: string, date?: Date) {
    const priceDate = date ?? new Date();
    return this.prisma.t_Price.findFirst({
      where: {
        priceItemOId: itemCode,
        priceIsActive: 1,
        priceFromDate: { lte: priceDate },
        OR: [{ priceToDate: null }, { priceToDate: { gte: priceDate } }],
      },
    });
  }

  async createPrice(dto: CreatePriceDto, createdBy: string) {
    await this.prisma.t_Price.updateMany({
      where: { priceItemOId: dto.itemCode, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_Price.create({
      data: {
        priceItemOId: dto.itemCode,
        priceFromDate: new Date(dto.fromDate),
        priceToDate: dto.toDate ? new Date(dto.toDate) : null,
        priceListPrice: dto.listPrice,
        priceVatPercent: dto.vatPercent,
        priceVatPrice: dto.vatPrice,
        priceDiscPrice: dto.discPrice,
        priceIsActive: 1,
        priceCreator: createdBy,
        priceCreationDate: new Date(),
      },
    });
  }

  // ── Cost Prices ───────────────────────────────────────────────

  findAllCostPrices(itemCode?: string) {
    return this.prisma.t_CostPr.findMany({
      where: { priceIsActive: 1, ...(itemCode && { priceItemOId: itemCode }) },
      include: { item: true },
    });
  }

  async createCostPrice(dto: CreatePriceDto, createdBy: string) {
    await this.prisma.t_CostPr.updateMany({
      where: { priceItemOId: dto.itemCode, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_CostPr.create({
      data: {
        priceItemOId: dto.itemCode,
        priceFromDate: new Date(dto.fromDate),
        priceToDate: dto.toDate ? new Date(dto.toDate) : null,
        priceListPrice: dto.listPrice,
        priceVatPercent: dto.vatPercent,
        priceVatPrice: dto.vatPrice,
        priceDiscPrice: dto.discPrice,
        priceIsActive: 1,
        priceCreator: createdBy,
        priceCreationDate: new Date(),
      },
    });
  }
}
