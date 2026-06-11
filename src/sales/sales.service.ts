import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateCashSaleDto } from './dto/create-cash-sale.dto';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';
import { CreateVatCashSaleDto } from './dto/create-vat-cash-sale.dto';
import { CreateVatCreditSaleDto } from './dto/create-vat-credit-sale.dto';
import { SalesQueryDto } from './dto/sales-query.dto';
import { buildPaginationMeta } from '../common/helpers';
import type { PaginationMeta } from '../common/helpers';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  // ── Cash Sale (Non-VAT) ──────────────────────────────────────

  async createCashSale(dto: CreateCashSaleDto, userName: string) {
    const invoiceNo = dto.invoiceNo ?? await this.generateInvoiceNo('CS');

    const sale = await this.prisma.t_SOMstr.create({
      data: {
        somstrCode: invoiceNo,
        somstrDate: new Date(dto.invoiceDate),
        somstrTotalAmt: dto.totalAmount,
        somstrDiscAmt: dto.totalDiscount ?? 0,
        somstrNetAmt: dto.netAmount,
        somstrCustomerpay: dto.paidAmount,
        somstrChange: dto.changeAmount,
        branchId: dto.branchId,
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
            branchId: dto.branchId,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
    return sale;
  }

  // ── Credit Sale (Non-VAT) ─────────────────────────────────────

  async createCreditSale(dto: CreateCreditSaleDto, userName: string) {
    const existing = await this.prisma.cSMaster.findUnique({ where: { invNo: dto.invNo } });
    if (existing) throw new BadRequestException('Invoice number already exists');

    const sale = await this.prisma.cSMaster.create({
      data: {
        invNo: dto.invNo,
        invDate: new Date(dto.invDate),
        clientCode: dto.clientCode,
        poNo: dto.poNo,
        branchId: dto.branchId,
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

  async createVatCashSale(dto: CreateVatCashSaleDto, userName: string) {
    const invoiceNo = dto.invoiceNo ?? await this.generateInvoiceNo('VCS');

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
        branchId: dto.branchId,
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
            branchId: dto.branchId,
          })),
        },
      },
      include: { details: true },
    });

    await this.deductStock(dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
    return sale;
  }

  // ── VAT Credit Sale ───────────────────────────────────────────

  async createVatCreditSale(dto: CreateVatCreditSaleDto, userName: string) {
    const existing = await this.prisma.cSVMaster.findUnique({ where: { invNo: dto.invNo } });
    if (existing) throw new BadRequestException('Invoice number already exists');

    const sale = await this.prisma.cSVMaster.create({
      data: {
        invNo: dto.invNo,
        invDate: new Date(dto.invDate),
        clientCode: dto.clientCode,
        poNo: dto.poNo,
        branchId: dto.branchId,
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

  async findAll(query: SalesQueryDto): Promise<{ items: object[]; meta: PaginationMeta }> {
    const { page, limit, type, branchId } = query;
    const skip = (page - 1) * limit;

    if (type === 'cash') {
      const where = { somstrIsActive: true, ...(branchId && { branchId }) };
      const [items, total] = await Promise.all([
        this.prisma.t_SOMstr.findMany({ where, orderBy: { somstrDate: 'desc' }, skip, take: limit }),
        this.prisma.t_SOMstr.count({ where }),
      ]);
      return { items, meta: buildPaginationMeta(total, page, limit) };
    }
    if (type === 'credit') {
      const where = { isActive: 1, ...(branchId && { branchId }) };
      const [items, total] = await Promise.all([
        this.prisma.cSMaster.findMany({ where, include: { customer: true }, orderBy: { invDate: 'desc' }, skip, take: limit }),
        this.prisma.cSMaster.count({ where }),
      ]);
      return { items, meta: buildPaginationMeta(total, page, limit) };
    }
    if (type === 'vat-cash') {
      const where = { somstrIsActive: true, ...(branchId && { branchId }) };
      const [items, total] = await Promise.all([
        this.prisma.t_SOMstV.findMany({ where, orderBy: { somstrDate: 'desc' }, skip, take: limit }),
        this.prisma.t_SOMstV.count({ where }),
      ]);
      return { items, meta: buildPaginationMeta(total, page, limit) };
    }
    const where = branchId ? { branchId } : {};
    const [items, total] = await Promise.all([
      this.prisma.cSVMaster.findMany({ where, include: { customer: true }, orderBy: { invDate: 'desc' }, skip, take: limit }),
      this.prisma.cSVMaster.count({ where }),
    ]);
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

  private async generateInvoiceNo(prefix: string): Promise<string> {
    const date = new Date();
    const yyyymm = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.t_SOMstr.count();
    return `${prefix}-${yyyymm}-${String(count + 1).padStart(5, '0')}`;
  }
}
