import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PriceQueryDto } from './dto/price-query.dto';
import { buildPaginationMeta } from '../common/helpers';

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

  async findAllPrices(query: PriceQueryDto) {
    const { page, limit, itemCode } = query;
    const where = { priceIsActive: 1, ...(itemCode && { priceItemOId: itemCode }) };
    const [rows, total] = await Promise.all([
      this.prisma.t_Price.findMany({ where, include: { item: true }, skip: (page - 1) * limit, take: limit }),
      this.prisma.t_Price.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
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

  // Accepts both the original DTO field names and the frontend's price* field names
  private normalizeCreate(body: any) {
    return {
      itemCode: body.itemCode ?? body.priceItemOId,
      fromDate: body.fromDate ?? body.priceFromDate,
      toDate: body.toDate ?? body.priceToDate,
      listPrice: body.listPrice ?? body.priceListPrice,
      vatPercent: body.vatPercent ?? body.priceVatPercent,
      vatPrice: body.vatPrice ?? body.priceVatPrice,
      discPrice: body.discPrice ?? body.priceDiscPrice,
    };
  }

  async createPrice(body: any, createdBy: string) {
    const dto = this.normalizeCreate(body);
    await this.prisma.t_Price.updateMany({
      where: { priceItemOId: dto.itemCode, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_Price.create({
      data: {
        priceItemOId: dto.itemCode,
        priceFromDate: dto.fromDate ? new Date(dto.fromDate) : null,
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

  // Accepts the frontend price field names (priceListPrice, priceFromDate, ...)
  private mapPriceUpdate(body: any) {
    const data: Record<string, unknown> = {};
    if (body.priceItemOId !== undefined) data.priceItemOId = body.priceItemOId;
    if (body.priceFromDate !== undefined) data.priceFromDate = body.priceFromDate ? new Date(body.priceFromDate) : null;
    if (body.priceToDate !== undefined) data.priceToDate = body.priceToDate ? new Date(body.priceToDate) : null;
    if (body.priceListPrice !== undefined) data.priceListPrice = body.priceListPrice;
    if (body.priceVatPercent !== undefined) data.priceVatPercent = body.priceVatPercent;
    if (body.priceVatPrice !== undefined) data.priceVatPrice = body.priceVatPrice;
    if (body.priceDiscPrice !== undefined) data.priceDiscPrice = body.priceDiscPrice;
    if (body.priceIsActive !== undefined) data.priceIsActive = body.priceIsActive;
    return data;
  }

  async updatePrice(id: string, body: any, updatedBy: string) {
    const existing = await this.prisma.t_Price.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Price record not found');
    return this.prisma.t_Price.update({
      where: { id },
      data: { ...this.mapPriceUpdate(body), priceUpdateBy: updatedBy, priceUpdateDate: new Date() },
    });
  }

  // ── Cost Prices ───────────────────────────────────────────────

  async findAllCostPrices(query: PriceQueryDto) {
    const { page, limit, itemCode } = query;
    const where = { priceIsActive: 1, ...(itemCode && { priceItemOId: itemCode }) };
    const [rows, total] = await Promise.all([
      this.prisma.t_CostPr.findMany({ where, include: { item: true }, skip: (page - 1) * limit, take: limit }),
      this.prisma.t_CostPr.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createCostPrice(body: any, createdBy: string) {
    const dto = this.normalizeCreate(body);
    await this.prisma.t_CostPr.updateMany({
      where: { priceItemOId: dto.itemCode, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_CostPr.create({
      data: {
        priceItemOId: dto.itemCode,
        priceFromDate: dto.fromDate ? new Date(dto.fromDate) : null,
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

  async updateCostPrice(id: string, body: any, updatedBy: string) {
    const existing = await this.prisma.t_CostPr.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Cost price record not found');
    return this.prisma.t_CostPr.update({
      where: { id },
      data: { ...this.mapPriceUpdate(body), priceUpdateBy: updatedBy, priceUpdateDate: new Date() },
    });
  }
}
