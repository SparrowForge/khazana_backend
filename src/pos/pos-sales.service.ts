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

  /** Resolve the session branch (Branch UUID) to its sanitized code, or '' when
   *  it can't be resolved (number simply omits the branch segment). */
  private async resolveBranchCode(branchId?: number | string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '';
    const branch = await this.prisma.branch
      .findUnique({ where: { id }, select: { branchCode: true } })
      .catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private async generateInvoiceNo(branchId?: number | string | null): Promise<string> {
    const date = new Date();
    const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.t_SOMstr.count({
      where: { somstrCode: { startsWith: 'DS-' } },
    });
    return ['DS', code, yyyymm, String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
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
      discountAmount: Number(sale.somstrDiscAmt ?? 0),
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

  async create(dto: CreatePosSaleDto, userName: string, userBranchId?: number | string) {
    if (!dto.items.length) throw new BadRequestException('Cart is empty');

    const invoiceNo = await this.generateInvoiceNo(dto.branchId ?? userBranchId);
    return this.persistSale({
      invoiceNo,
      saleDate: new Date(),
      items: dto.items,
      paidAmount: dto.paidAmount,
      servedBy: dto.servedBy,
      salesType: dto.salesType,
      branchId: dto.branchId ?? null,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      createdBy: userName,
    });
  }

  /**
   * Core sale writer shared by the online terminal (`create`) and the offline
   * sync engine (`PosSyncService`). Recomputes line totals/VAT from t_Price,
   * validates discount + payment, writes t_SOMstr + t_SODet, deducts stock, and
   * returns the receipt response. The caller supplies the invoice number and the
   * sale date — online passes a freshly generated number + `now`; offline passes
   * the client-generated prefixed number + the historical save timestamp.
   */
  async persistSale(p: {
    invoiceNo: string;
    saleDate: Date;
    items: { itemId: string; qty: number }[];
    paidAmount: number;
    servedBy?: string;
    salesType?: string;
    branchId?: number | null;
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    createdBy: string;
  }) {
    if (!p.items.length) throw new BadRequestException('Cart is empty');

    // Price the lines as-of the sale date: `now` for online, the historical
    // save timestamp for synced offline orders.
    const asOf = p.saleDate;
    const itemIds = p.items.map((i) => i.itemId);

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
    const lines = p.items.map((cartItem) => {
      const item = itemMap.get(cartItem.itemId)!;

      const price =
        item.prices.find((pr) => {
          const from = pr.priceFromDate;
          const to = pr.priceToDate;
          return (!from || from <= asOf) && (!to || to >= asOf);
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
        branchId: p.branchId ?? null,
      };
    });

    const totalAmount = this.r2(lines.reduce((s, l) => s + l.sodetAmount, 0));
    const vatTotal = this.r2(lines.reduce((s, l) => s + l.sodetVATAmount, 0));
    const grossAmount = this.r2(totalAmount + vatTotal);

    // ── Discount validation & server-side recalculation ────────────────────
    const discType = p.discountType ?? 'fixed';
    const discValue = p.discountValue ?? 0;

    if (discValue < 0) {
      throw new BadRequestException('Discount value cannot be negative');
    }
    if (discType === 'percentage' && discValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }

    const discountAmount =
      discType === 'percentage'
        ? this.r2(grossAmount * discValue / 100)
        : this.r2(discValue);

    if (discountAmount > grossAmount) {
      throw new BadRequestException(
        `Discount (৳${discountAmount}) cannot exceed the total (৳${grossAmount})`,
      );
    }

    const netAmount = this.r2(grossAmount - discountAmount);
    const changeAmount = this.r2(p.paidAmount - netAmount);

    if (p.paidAmount < netAmount) {
      throw new BadRequestException(
        `Insufficient payment — payable: ৳${netAmount}, paid: ৳${p.paidAmount}`,
      );
    }

    const sale = await this.prisma.t_SOMstr.create({
      data: {
        somstrCode: p.invoiceNo,
        somstrDate: p.saleDate,
        somstrTotalAmt: totalAmount,
        somstrDiscAmt: discountAmount,
        somstrNetAmt: netAmount,
        somstrCustomerpay: this.r2(p.paidAmount),
        somstrChange: changeAmount,
        mtype: p.salesType ?? 'Cash',
        somstrCreator: p.servedBy || p.createdBy,
        somstrCreationDate: new Date(),
        somstrIsActive: true,
        branchId: p.branchId ?? null,
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
