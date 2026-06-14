import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePosSaleDto } from './dto/create-pos-sale.dto';
import type { t_SOMstr, t_SODet, Item_Information } from '../generated/prisma';

type SaleWithDetails = t_SOMstr & {
  details: (t_SODet & { item: Item_Information | null })[];
};

@Injectable()
export class PosSalesService {
  constructor(private prisma: PrismaService) {}

  private r2(n: number) {
    return Math.round(n * 100) / 100;
  }

  private async generateInvoiceNo(): Promise<string> {
    const date = new Date();
    const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.t_SOMstr.count({
      where: { somstrCode: { startsWith: 'DS-' } },
    });
    return `DS-${yyyymm}-${String(count + 1).padStart(5, '0')}`;
  }

  private toResponse(sale: SaleWithDetails) {
    const vatAmount = sale.details.reduce(
      (s, d) => s + Number(d.sodetVATAmount ?? 0),
      0,
    );

    return {
      id: sale.id,
      invoiceNo: sale.somstrCode ?? '',
      dateTime: (sale.somstrDate ?? sale.somstrCreationDate ?? new Date()).toISOString(),
      salesType: sale.mtype ?? 'Cash',
      totalAmount: Number(sale.somstrTotalAmt ?? 0),
      vatAmount: this.r2(vatAmount),
      payableAmount: Number(sale.somstrNetAmt ?? 0),
      paidAmount: Number(sale.somstrCustomerpay ?? 0),
      changeAmount: Number(sale.somstrChange ?? 0),
      servedBy: sale.somstrCreator ?? '',
      items: sale.details.map((d) => ({
        id: d.id,
        productName: d.item?.itmName ?? d.item?.itmCode ?? '',
        qty: Number(d.sodetQTY ?? 0),
        rate: Number(d.sodetPrice ?? 0),
        vatPct: Number(d.sodetVATValue ?? 0),
        vat: Number(d.sodetVATAmount ?? 0),
        total: Number(d.sodetAmount ?? 0),
      })),
    };
  }

  async create(dto: CreatePosSaleDto, userName: string) {
    if (!dto.items.length) throw new BadRequestException('Cart is empty');

    const today = new Date();
    const itemIds = dto.items.map((i) => i.itemId);

    // Load items with their active prices
    const dbItems = await this.prisma.item_Information.findMany({
      where: { id: { in: itemIds } },
      include: {
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
        },
      },
    });

    if (dbItems.length !== itemIds.length) {
      const found = new Set(dbItems.map((i) => i.id));
      const missing = itemIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Items not found: ${missing.join(', ')}`);
    }

    const itemMap = new Map(dbItems.map((i) => [i.id, i]));

    // Compute per-line totals
    const lines = dto.items.map((cartItem) => {
      const item = itemMap.get(cartItem.itemId)!;

      const price =
        item.prices.find((p) => {
          const from = p.priceFromDate;
          const to = p.priceToDate;
          return (!from || from <= today) && (!to || to >= today);
        }) ?? item.prices[0];

      if (!price?.priceListPrice) {
        throw new BadRequestException(
          `No active price found for item: ${item.itmName ?? item.itmCode}`,
        );
      }

      const rate = price.priceListPrice;
      const vatPct = price.priceVatPercent ?? 0;
      const qty = cartItem.qty;
      const amount = this.r2(rate * qty);
      const vatAmount = this.r2((amount * vatPct) / 100);
      const netAmount = this.r2(amount + vatAmount);

      return {
        itemId: item.id,
        sodetItemOID: item.id,
        sodetQTY: qty,
        sodetUOM: item.itmUOM,
        sodetPrice: rate,
        sodetAmount: amount,
        sodetVATValue: vatPct,
        sodetVATAmount: vatAmount,
        sodetDiscount: 0,
        sodetNetAmount: netAmount,
        branchId: dto.branchId ?? null,
      };
    });

    const totalAmount = this.r2(lines.reduce((s, l) => s + l.sodetAmount, 0));
    const vatTotal = this.r2(lines.reduce((s, l) => s + l.sodetVATAmount, 0));
    const netAmount = this.r2(totalAmount + vatTotal);
    const changeAmount = this.r2(dto.paidAmount - netAmount);

    if (dto.paidAmount < netAmount) {
      throw new BadRequestException(
        `Insufficient payment — payable: ৳${netAmount}, paid: ৳${dto.paidAmount}`,
      );
    }

    const invoiceNo = await this.generateInvoiceNo();

    const sale = await this.prisma.t_SOMstr.create({
      data: {
        somstrCode: invoiceNo,
        somstrDate: new Date(),
        somstrTotalAmt: totalAmount,
        somstrDiscAmt: 0,
        somstrNetAmt: netAmount,
        somstrCustomerpay: this.r2(dto.paidAmount),
        somstrChange: changeAmount,
        mtype: dto.salesType ?? 'Cash',
        somstrCreator: dto.servedBy || userName,
        somstrCreationDate: new Date(),
        somstrIsActive: true,
        branchId: dto.branchId ?? null,
        details: {
          create: lines.map((l, idx) => ({
            sodetItemSLNum: String(idx + 1),
            sodetItemOID: l.sodetItemOID,
            sodetQTY: l.sodetQTY,
            sodetUOM: l.sodetUOM,
            sodetPrice: l.sodetPrice,
            sodetAmount: l.sodetAmount,
            sodetVATValue: l.sodetVATValue,
            sodetVATAmount: l.sodetVATAmount,
            sodetDiscount: l.sodetDiscount,
            sodetNetAmount: l.sodetNetAmount,
            branchId: l.branchId,
          })),
        },
      },
      include: { details: { include: { item: true } } },
    });

    // Deduct inventory (same pattern as SalesService)
    await this.deductStock(lines.map((l) => ({ itemId: l.itemId, qty: l.sodetQTY })));

    return this.toResponse(sale as SaleWithDetails);
  }

  async findAll() {
    const sales = await this.prisma.t_SOMstr.findMany({
      where: { somstrCode: { startsWith: 'DS-' } },
      orderBy: { somstrDate: 'desc' },
      include: { details: { include: { item: true } } },
    });
    return sales.map((s) => this.toResponse(s as SaleWithDetails));
  }

  async findOne(id: string) {
    const sale = await this.prisma.t_SOMstr.findUnique({
      where: { id },
      include: { details: { include: { item: true } } },
    });
    if (!sale) throw new NotFoundException(`Invoice ${id} not found`);
    return this.toResponse(sale as SaleWithDetails);
  }

  private async deductStock(items: { itemId: string; qty: number }[]) {
    const ops = items.map((i) =>
      this.prisma.inventory.updateMany({
        where: { item: { id: i.itemId } },
        data: { quantity: { decrement: i.qty } },
      }),
    );
    await this.prisma.$transaction(ops);
  }
}
