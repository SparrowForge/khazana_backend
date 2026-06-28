import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateCashSaleDto } from './dto/create-cash-sale.dto';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';
import { CreateVatCashSaleDto } from './dto/create-vat-cash-sale.dto';
import { CreateVatCreditSaleDto } from './dto/create-vat-credit-sale.dto';
import { SalesQueryDto } from './dto/sales-query.dto';
import { buildPaginationMeta, toBranchUuid } from '../common/helpers';
import type { PaginationMeta } from '../common/helpers';

/** Normalized row for the unified sales report (all sale types in one shape). */
interface UnifiedSale {
  id: string;
  invoiceNo: string;
  date: Date | null;
  type: 'Cash' | 'VAT Cash' | 'Credit' | 'VAT Credit' | 'NC Adjustment';
  netAmount: number;
  customerName: string | null;
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  // ── Cash Sale (Non-VAT) ──────────────────────────────────────

  async createCashSale(
    dto: CreateCashSaleDto,
    userName: string,
    userBranchId?: string,
  ) {
    // Treat a blank invoiceNo as "auto-generate" (the UI sends "" to mean that).
    const invoiceNo = dto.invoiceNo || (await this.generateInvoiceNo('CS', dto.branchId ?? userBranchId));
    // Branch comes from the request, else the session branch, else the default
    // branch — t_SOMstr/t_SODet.branchId are now Branch UUIDs.
    const branchId = toBranchUuid(dto.branchId ?? userBranchId);

    const sale = await this.prisma.t_SOMstr.create({
      data: {
        somstrCode: invoiceNo,
        somstrDate: new Date(dto.invoiceDate),
        somstrTotalAmt: dto.totalAmount,
        somstrDiscAmt: dto.totalDiscount ?? 0,
        somstrNetAmt: dto.netAmount,
        somstrCustomerpay: dto.paidAmount,
        somstrChange: dto.changeAmount,
        branchId,
        mtype: dto.paymentMethod,
        soMstrMBank: dto.bankId,
        soMstrDiscountRemarks: dto.discountRemarks,
        somstrCreator: userName,
        somstrCreationDate: new Date(),
        somstrIsActive: true,
        details: {
          create: dto.items.map((item, index) => ({
            sodetItemSLNum: String(index + 1),
            sodetItemOID: item.itemId,
            sodetQTY: item.quantity,
            sodetPrice: item.rate,
            sodetAmount: item.rate * item.quantity,
            sodetDiscount: item.discount ?? 0,
            sodetVATValue: item.vat ?? 0,
            sodetNetAmount: item.total,
            branchId,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
    return sale;
  }

  // ── Credit Sale (Non-VAT) ─────────────────────────────────────

  async createCreditSale(dto: CreateCreditSaleDto, userName: string, userBranchId?: string) {
    // Auto-generate the invoice number when the UI leaves it blank (credit has
    // no central sequence otherwise, so blanks would collide on the 2nd sale).
    const invNo = dto.invNo || (await this.generateCreditInvoiceNo(dto.branchId ?? userBranchId));
    const branchId = toBranchUuid(dto.branchId ?? userBranchId);

    const existing = await this.prisma.cSMaster.findUnique({ where: { invNo } });
    if (existing) throw new BadRequestException('Invoice number already exists');

    const sale = await this.prisma.cSMaster.create({
      data: {
        invNo,
        invDate: new Date(dto.invDate),
        customerId: dto.customerId,
        poNo: dto.poNo,
        branchId,
        totalAmount: dto.totalAmount,
        totalDiscount: dto.totalDiscount ?? 0,
        totalVat: dto.totalVat ?? 0,
        discountRemarks: dto.discountRemarks,
        isActive: 1,
        invoiceBy: userName,
        createDate: new Date(),
        details: {
          create: dto.items.map((item) => ({
            itemOId: item.itemCode,
            rate: item.rate,
            qty: item.qty,
            value: item.rate * item.qty,
            disc: item.disc ?? 0,
            vat: item.vat ?? 0,
            total: item.total,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStockByCode(dto.items.map((i) => ({ itemCode: i.itemCode, qty: i.qty })));
    return sale;
  }

  // ── VAT Cash Sale ─────────────────────────────────────────────

  async createVatCashSale(dto: CreateVatCashSaleDto, userName: string, userBranchId?: string) {
    const invoiceNo = dto.invoiceNo ?? await this.generateInvoiceNo('VCS', dto.branchId ?? userBranchId);
    const branchId = toBranchUuid(dto.branchId ?? userBranchId);

    const sale = await this.prisma.t_SOMstV.create({
      data: {
        somstrCode: invoiceNo,
        somstrDate: new Date(dto.invoiceDate),
        somstrTotalAmt: dto.totalAmount,
        somstrDiscAmt: dto.totalDiscount ?? 0,
        somstrNetAmt: dto.netAmount,
        somstrVatClnNo: dto.vatClnNo,
        somstrCustomerpay: dto.paidAmount,
        somstrChange: dto.changeAmount,
        branchId,
        mtype: dto.paymentMethod,
        somstrCreator: userName,
        somstrCreationDate: new Date(),
        somstrIsActive: true,
        details: {
          create: dto.items.map((item, index) => ({
            sodetItemSLNum: String(index + 1),
            sodetItemOID: item.itemId,
            sodetQTY: item.quantity,
            sodetPrice: item.rate,
            sodetAmount: item.rate * item.quantity,
            sodetDiscount: item.discount ?? 0,
            sodetVATValue: item.vatValue,
            sodetVATAmount: item.vatAmount,
            sodetNetAmount: item.netAmount,
            branchId,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
    return sale;
  }

  // ── VAT Credit Sale ───────────────────────────────────────────

  async createVatCreditSale(dto: CreateVatCreditSaleDto, userName: string, userBranchId?: string) {
    const invNo = dto.invNo || (await this.generateVatCreditInvoiceNo(dto.branchId ?? userBranchId));
    const branchId = toBranchUuid(dto.branchId ?? userBranchId);

    const existing = await this.prisma.cSVMaster.findUnique({ where: { invNo } });
    if (existing) throw new BadRequestException('Invoice number already exists');

    const sale = await this.prisma.cSVMaster.create({
      data: {
        invNo,
        invDate: new Date(dto.invDate),
        clientCode: dto.clientCode,
        poNo: dto.poNo,
        branchId,
        totalAmount: dto.totalAmount,
        totalDiscount: dto.totalDiscount ?? 0,
        totalVat: dto.totalVat,
        invoiceBy: userName,
        details: {
          create: dto.items.map((item) => ({
            itemOId: item.itemCode,
            rate: item.rate,
            qty: item.qty,
            value: item.rate * item.qty,
            disc: item.disc ?? 0,
            vat: item.vatAmount,
            total: item.total,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStockByCode(dto.items.map((i) => ({ itemCode: i.itemCode, qty: i.qty })));
    return sale;
  }

  // ── List / Get ────────────────────────────────────────────────

  /**
   * Unified sales report. Returns a single normalized list across all sale
   * sources — cash (t_SOMstr), VAT cash (t_SOMstV), credit (cSMaster), VAT
   * credit (cSVMaster) and NC adjustments (t_NCMstr) — each mapped to a common
   * shape so the frontend reads one set of fields. `type` filters to a single
   * source; the default ('all') merges them. Sorted by date desc and paginated
   * in-memory (fine for POS-scale volumes).
   */
  async findAll(query: SalesQueryDto): Promise<{ items: object[]; meta: PaginationMeta }> {
    const { page, limit, type, branchId } = query;
    const all = !type || type === 'all';
    const num = (v: unknown): number => (v == null ? 0 : Number(v));

    const rows: UnifiedSale[] = [];

    if (all || type === 'cash') {
      const cash = await this.prisma.t_SOMstr.findMany({
        where: { somstrIsActive: true, ...(branchId && { branchId }) },
        select: { id: true, somstrCode: true, somstrDate: true, somstrNetAmt: true },
      });
      for (const r of cash)
        rows.push({ id: r.id, invoiceNo: r.somstrCode ?? '', date: r.somstrDate, type: 'Cash', netAmount: num(r.somstrNetAmt), customerName: null });
    }

    if (all || type === 'vat-cash') {
      const vcash = await this.prisma.t_SOMstV.findMany({
        where: { somstrIsActive: true, ...(branchId && { branchId }) },
        select: { id: true, somstrCode: true, somstrDate: true, somstrNetAmt: true },
      });
      for (const r of vcash)
        rows.push({ id: r.id, invoiceNo: r.somstrCode ?? '', date: r.somstrDate, type: 'VAT Cash', netAmount: num(r.somstrNetAmt), customerName: null });
    }

    if (all || type === 'credit') {
      const credit = await this.prisma.cSMaster.findMany({
        where: { isActive: 1, ...(branchId && { branchId }) },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true, customer: { select: { name: true } } },
      });
      for (const r of credit)
        rows.push({ id: r.id, invoiceNo: r.invNo, date: r.invDate, type: 'Credit', netAmount: num(r.totalAmount) + num(r.totalVat) - num(r.totalDiscount), customerName: r.customer?.name ?? null });
    }

    if (all || type === 'vat-credit') {
      const vcredit = await this.prisma.cSVMaster.findMany({
        where: { ...(branchId && { branchId }) },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true, customer: { select: { name: true } } },
      });
      for (const r of vcredit)
        rows.push({ id: r.id, invoiceNo: r.invNo, date: r.invDate, type: 'VAT Credit', netAmount: num(r.totalAmount) + num(r.totalVat) - num(r.totalDiscount), customerName: r.customer?.name ?? null });
    }

    if (all || type === 'nc') {
      const nc = await this.prisma.t_NCMstr.findMany({
        where: { ncmstrIsActive: true, ...(branchId && { branchId }) },
        select: { id: true, ncmstrCode: true, ncmstrDate: true, details: { select: { ncdetNetAmount: true } } },
      });
      for (const r of nc)
        rows.push({ id: r.id, invoiceNo: r.ncmstrCode ?? '', date: r.ncmstrDate, type: 'NC Adjustment', netAmount: r.details.reduce((s, d) => s + num(d.ncdetNetAmount), 0), customerName: null });
    }

    rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

    const total = rows.length;
    const skip = (page - 1) * limit;
    const items = rows.slice(skip, skip + limit);
    return { items, meta: buildPaginationMeta(total, page, limit) };
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async deductStock(items: { itemId: string; qty: number }[]) {
    const ops = items.map((i) =>
      this.prisma.inventory.updateMany({
        where: { item: { id: i.itemId } },
        data: { quantity: { decrement: i.qty } },
      }),
    );
    await this.prisma.$transaction(ops);
  }

  private async deductStockByCode(items: { itemCode: string; qty: number }[]) {
    const ops = items.map((i) =>
      this.prisma.inventory.updateMany({
        where: { itemCode: i.itemCode },
        data: { quantity: { decrement: i.qty } },
      }),
    );
    await this.prisma.$transaction(ops);
  }

  /** Resolve the session branch (a Branch UUID) to its sanitized branch code for
   *  embedding in invoice numbers. Returns '' when the branch can't be resolved,
   *  so the number simply omits the code. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUuid) return '';
    const branch = await this.prisma.branch
      .findUnique({ where: { id }, select: { branchCode: true } })
      .catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private yyyymm(d = new Date()): string {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private async generateCreditInvoiceNo(branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.cSMaster.count();
    return ['CR', code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }

  private async generateVatCreditInvoiceNo(branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.cSVMaster.count();
    return ['CRV', code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }

  private async generateInvoiceNo(prefix: string, branchId?: string | null): Promise<string> {
    const code = await this.resolveBranchCode(branchId);
    const count = await this.prisma.t_SOMstr.count();
    return [prefix, code, this.yyyymm(), String(count + 1).padStart(5, '0')].filter(Boolean).join('-');
  }
}
