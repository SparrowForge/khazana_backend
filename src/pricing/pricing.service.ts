import { Injectable, NotFoundException } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PriceQueryDto } from './dto/price-query.dto';
import { buildPaginationMeta, UUID_RE } from '../common/helpers';

export class CreatePriceDto {
  /** Item_Information.ID (uuid). A legacy item CODE is still accepted and
   *  resolved to the uuid — see PricingService#resolveItemId. */
  @IsString()
  @IsNotEmpty()
  itemId: string;

  @IsString()
  @IsNotEmpty()
  fromDate: string;

  @IsString()
  @IsOptional()
  toDate?: string;

  @IsNumber()
  listPrice: number;

  @IsNumber()
  @IsOptional()
  vatPercent?: number;

  @IsNumber()
  @IsOptional()
  vatPrice?: number;

  @IsNumber()
  @IsOptional()
  discPrice?: number;
}

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  /** t_Price / t_CostPr key on Item_Information.ID (uuid). Callers still holding
   *  an item CODE — an older client, a hand-run script — are translated here
   *  rather than rejected, so a rename of neither breaks the other. */
  private async resolveItemId(value: string): Promise<string | null> {
    const raw = (value ?? '').trim();
    if (!raw) return null;
    if (UUID_RE.test(raw)) return raw;
    const item = await this.prisma.item_Information.findUnique({
      where: { itmCode: raw },
      select: { id: true },
    });
    return item?.id ?? null;
  }

  private async requireItemId(value: string): Promise<string> {
    const id = await this.resolveItemId(value);
    if (!id) throw new NotFoundException(`Item "${value}" not found`);
    return id;
  }

  // ── Selling Prices ────────────────────────────────────────────

  async findAllPrices(query: PriceQueryDto) {
    const { page, limit } = query;
    const filter = query.itemId ?? query.itemCode;
    // An unknown item filters to nothing rather than 404-ing a list request.
    const itemId = filter ? await this.resolveItemId(filter) : null;
    if (filter && !itemId) return { items: [], meta: buildPaginationMeta(0, page, limit) };

    const where = { priceIsActive: 1, ...(itemId && { priceItemOId: itemId }) };
    const [rows, total] = await Promise.all([
      this.prisma.t_Price.findMany({ where, include: { item: true }, skip: (page - 1) * limit, take: limit }),
      this.prisma.t_Price.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async getCurrentPrice(item: string, date?: Date) {
    const itemId = await this.resolveItemId(item);
    if (!itemId) return null;
    const priceDate = date ?? new Date();
    return this.prisma.t_Price.findFirst({
      where: {
        priceItemOId: itemId,
        priceIsActive: 1,
        priceFromDate: { lte: priceDate },
        OR: [{ priceToDate: null }, { priceToDate: { gte: priceDate } }],
      },
    });
  }

  // Accepts both the original DTO field names and the frontend's price* field names
  private normalizeCreate(body: any) {
    return {
      item: body.itemId ?? body.priceItemOId ?? body.itemCode,
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
    const itemId = await this.requireItemId(dto.item);
    await this.prisma.t_Price.updateMany({
      where: { priceItemOId: itemId, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_Price.create({
      data: {
        priceItemOId: itemId,
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
  private async mapPriceUpdate(body: any) {
    const data: Record<string, unknown> = {};
    const item = body.itemId ?? body.priceItemOId;
    if (item !== undefined) data.priceItemOId = await this.requireItemId(item);
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
    const data = await this.mapPriceUpdate(body);
    return this.prisma.t_Price.update({
      where: { id },
      data: { ...data, priceUpdateBy: updatedBy, priceUpdateDate: new Date() },
    });
  }

  // ── Cost Prices ───────────────────────────────────────────────

  async findAllCostPrices(query: PriceQueryDto) {
    const { page, limit } = query;
    const filter = query.itemId ?? query.itemCode;
    const itemId = filter ? await this.resolveItemId(filter) : null;
    if (filter && !itemId) return { items: [], meta: buildPaginationMeta(0, page, limit) };

    const where = { priceIsActive: 1, ...(itemId && { priceItemOId: itemId }) };
    const [rows, total] = await Promise.all([
      this.prisma.t_CostPr.findMany({ where, include: { item: true }, skip: (page - 1) * limit, take: limit }),
      this.prisma.t_CostPr.count({ where }),
    ]);
    return { items: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createCostPrice(body: any, createdBy: string) {
    const dto = this.normalizeCreate(body);
    const itemId = await this.requireItemId(dto.item);
    await this.prisma.t_CostPr.updateMany({
      where: { priceItemOId: itemId, priceIsActive: 1 },
      data: { priceIsActive: 0 },
    });

    return this.prisma.t_CostPr.create({
      data: {
        priceItemOId: itemId,
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
    const data = await this.mapPriceUpdate(body);
    return this.prisma.t_CostPr.update({
      where: { id },
      data: { ...data, priceUpdateBy: updatedBy, priceUpdateDate: new Date() },
    });
  }
}
