import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface DateRangeQuery {
  fromDate: string;
  toDate: string;
  branchId?: number;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ── Sales Report ──────────────────────────────────────────────

  async getSalesReport(query: DateRangeQuery) {
    const from = new Date(query.fromDate);
    const to = new Date(query.toDate);
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const [cashSales, creditSales, vatCashSales, vatCreditSales] = await this.prisma.$transaction([
      this.prisma.t_SOMstr.aggregate({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        _sum: { somstrTotalAmt: true, somstrDiscAmt: true, somstrNetAmt: true },
        _count: true,
      }),
      this.prisma.cSMaster.aggregate({
        where: { invDate: { gte: from, lte: to }, isActive: 1, ...branchFilter },
        _sum: { totalAmount: true, totalDiscount: true, totalVat: true },
        _count: true,
      }),
      this.prisma.t_SOMstV.aggregate({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        _sum: { somstrTotalAmt: true, somstrDiscAmt: true, somstrNetAmt: true },
        _count: true,
      }),
      this.prisma.cSVMaster.aggregate({
        where: { invDate: { gte: from, lte: to }, ...branchFilter },
        _sum: { totalAmount: true, totalDiscount: true, totalVat: true },
        _count: true,
      }),
    ]);

    return { cashSales, creditSales, vatCashSales, vatCreditSales };
  }

  // ── Daily Summary ─────────────────────────────────────────────

  async getDailySummary(date: string, branchId?: number) {
    const day = new Date(date);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const branchFilter = branchId ? { branchId } : {};

    const [cashSales, ncAdjustments, assortments] = await this.prisma.$transaction([
      this.prisma.t_SOMstr.findMany({
        where: {
          somstrDate: { gte: day, lt: nextDay },
          somstrIsActive: true,
          ...branchFilter,
        },
        include: { details: true },
      }),
      this.prisma.t_NCMstr.findMany({
        where: {
          ncmstrDate: { gte: day, lt: nextDay },
          ncmstrIsActive: true,
          ...(branchId && { branchId }),
        },
        include: { details: true },
      }),
      this.prisma.asstMsrt.findMany({
        where: {
          date: { gte: day, lt: nextDay },
          isActive: true,
          ...(branchId && { branchId }),
        },
        include: { details: true },
      }),
    ]);

    return { cashSales, ncAdjustments, assortments, date };
  }

  // ── Stock Report ──────────────────────────────────────────────

  async getStockReport() {
    return this.prisma.inventory.findMany({
      include: {
        item: {
          include: {
            prices: { where: { priceIsActive: 1 }, take: 1 },
          },
        },
      },
      orderBy: { item: { itmName: 'asc' } },
    });
  }

  // ── Item-wise Sales ───────────────────────────────────────────

  async getItemSalesReport(query: DateRangeQuery) {
    const from = new Date(query.fromDate);
    const to = new Date(query.toDate);

    const cashItems = await this.prisma.t_SODet.groupBy({
      by: ['sodetItemOID'],
      where: {
        sale: {
          somstrDate: { gte: from, lte: to },
          somstrIsActive: true,
          ...(query.branchId && { branchId: query.branchId }),
        },
      },
      _sum: { sodetQTY: true, sodetNetAmount: true },
      orderBy: { sodetItemOID: 'asc' },
    });

    return { cashItems };
  }

  // ── Customer Statement ────────────────────────────────────────

  async getCustomerStatement(clientCode: string, query: DateRangeQuery) {
    const from = new Date(query.fromDate);
    const to = new Date(query.toDate);

    const [invoices, payments] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { clientCode, invDate: { gte: from, lte: to }, isActive: 1 },
        include: { details: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.client_Transaction.findMany({
        where: { clientCode, paymentDate: { gte: from, lte: to } },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    return { clientCode, invoices, payments };
  }

  // ── Packet Analysis ───────────────────────────────────────────

  async getPacketAnalysis(query: DateRangeQuery) {
    const from = new Date(query.fromDate);
    const to = new Date(query.toDate);

    const [receives, issues] = await Promise.all([
      this.prisma.packet_Receive.groupBy({
        by: ['code'],
        where: { receiveDate: { gte: from, lte: to }, isActive: 1 },
        _sum: { qty: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.packet_Issue.groupBy({
        by: ['code'],
        where: { issueDate: { gte: from, lte: to }, isActive: 1 },
        _sum: { qty: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    return { receives, issues };
  }
}
