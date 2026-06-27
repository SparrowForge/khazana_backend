import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface DateRangeQuery {
  fromDate?: string;
  toDate?: string;
  branchId?: number;
}

const num = (d: unknown): number => (d == null ? 0 : Number(d));

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // Parse and validate a date range. Missing/invalid dates previously reached
  // Prisma as `Invalid Date` and surfaced as an opaque 500 — guard with a 400.
  private parseRange(query: DateRangeQuery) {
    const from = new Date(query.fromDate ?? '');
    const to = new Date(query.toDate ?? '');
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Valid `from` and `to` dates are required');
    }
    to.setHours(23, 59, 59, 999); // make the range inclusive of the whole end day
    return { from, to };
  }

  // ── Sales Report (invoice-level rows across all four sale ledgers) ────

  async getSalesReport(query: DateRangeQuery) {
    const { from, to } = this.parseRange(query);
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const [cash, credit, vatCash, vatCredit] = await this.prisma.$transaction([
      this.prisma.t_SOMstr.findMany({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.cSMaster.findMany({
        where: { invDate: { gte: from, lte: to }, isActive: 1, ...branchFilter },
        include: { customer: true },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.t_SOMstV.findMany({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { invDate: { gte: from, lte: to }, ...branchFilter },
        include: { customer: true },
        orderBy: { invDate: 'asc' },
      }),
    ]);

    const rows = [
      ...cash.map((s) => ({
        id: s.id, invNo: s.somstrCode, date: s.somstrDate, customerName: 'Cash Customer',
        totalAmount: num(s.somstrTotalAmt), discount: num(s.somstrDiscAmt), netAmount: num(s.somstrNetAmt),
        saleType: 'Cash',
      })),
      ...credit.map((s) => ({
        id: s.id, invNo: s.invNo, date: s.invDate, customerName: s.customer?.name ?? s.clientCode ?? '',
        totalAmount: num(s.totalAmount), discount: num(s.totalDiscount), netAmount: num(s.totalAmount) - num(s.totalDiscount),
        saleType: 'Credit',
      })),
      ...vatCash.map((s) => ({
        id: s.id, invNo: s.somstrCode, date: s.somstrDate, customerName: 'Cash Customer',
        totalAmount: num(s.somstrTotalAmt), discount: num(s.somstrDiscAmt), netAmount: num(s.somstrNetAmt),
        saleType: 'Cash (VAT)',
      })),
      ...vatCredit.map((s) => ({
        id: s.id, invNo: s.invNo, date: s.invDate, customerName: s.customer?.name ?? s.clientCode ?? '',
        totalAmount: num(s.totalAmount), discount: num(s.totalDiscount), netAmount: num(s.totalAmount) - num(s.totalDiscount),
        saleType: 'Credit (VAT)',
      })),
    ];

    rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    return rows;
  }

  // ── Daily Summary (totals + per-invoice details) ─────────────────────

  async getDailySummary(date: string, branchId?: number) {
    const day = new Date(date);
    if (isNaN(day.getTime())) throw new BadRequestException('Valid `date` is required');
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const branchFilter = branchId ? { branchId } : {};

    const [cash, nc] = await this.prisma.$transaction([
      this.prisma.t_SOMstr.findMany({
        where: { somstrDate: { gte: day, lt: nextDay }, somstrIsActive: true, ...branchFilter },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.t_NCMstr.findMany({
        where: { ncmstrDate: { gte: day, lt: nextDay }, ncmstrIsActive: true, ...branchFilter },
        include: { details: { select: { ncdetNetAmount: true } } },
        orderBy: { ncmstrDate: 'asc' },
      }),
    ]);

    const sum = (arr: { net: number }[]) => arr.reduce((s, r) => s + r.net, 0);
    const cashRows = cash.map((s) => ({ id: s.id, invNo: s.somstrCode, type: 'Cash', netAmount: num(s.somstrNetAmt), net: num(s.somstrNetAmt) }));

    // ── Credit sales netted against ALL-TIME outstanding order advances ──────
    // Each customer's order advances are consumed FIFO by their credit sales in
    // chronological order. We replay the full history (up to the report day) so
    // an advance is applied to exactly one credit sale and never double-counted
    // across days — stateless, so re-running the report is idempotent.
    const { creditRows, orderCollection } = await this.netCreditAgainstAdvances(day, nextDay, branchFilter);

    const ncRows = nc.map((s) => {
      const net = s.details.reduce((t, d) => t + num(d.ncdetNetAmount), 0);
      return { id: s.id, invNo: s.ncmstrCode, type: 'NC', netAmount: net, net };
    });

    const cashSales = sum(cashRows);
    const creditSales = sum(creditRows); // already net of advances
    const ncSales = sum(ncRows);

    const details = [...cashRows, ...creditRows, ...ncRows].map(({ net, ...r }) => r);

    return {
      date,
      summary: {
        cashSales, creditSales, ncSales, orderCollection,
        totalSales: details.length,
        // orderCollection + (net) creditSales == gross credit, so the total is balanced.
        totalRevenue: cashSales + creditSales + ncSales + orderCollection,
      },
      details,
    };
  }

  /**
   * Net each credit sale dated on the report day against the customer's
   * outstanding order-receive advances. Advances are consumed FIFO by the
   * customer's credit sales in chronological order across the full history (up
   * to the report day), so each advance is applied exactly once and never
   * double-deducted on later days. Returns only the report day's credit rows
   * (already net) plus the advance applied to them (Order Collection).
   */
  private async netCreditAgainstAdvances(
    day: Date,
    nextDay: Date,
    branchFilter: { branchId?: number },
  ): Promise<{
    creditRows: { id: string; invNo: string; type: string; netAmount: number; net: number }[];
    orderCollection: number;
  }> {
    const todayCredit = await this.prisma.cSMaster.findMany({
      where: { invDate: { gte: day, lt: nextDay }, isActive: 1, ...branchFilter },
      select: { clientCode: true },
    });
    const custCodes = [...new Set(todayCredit.map((c) => c.clientCode).filter((x): x is string => !!x))];
    if (!custCodes.length) return { creditRows: [], orderCollection: 0 };

    const [advances, allCredits] = await this.prisma.$transaction([
      this.prisma.orderReceive_Master.findMany({
        where: { clientCode: { in: custCodes }, isActive: 1, advance: { gt: 0 }, orderDate: { lt: nextDay }, ...branchFilter },
        select: { clientCode: true, advance: true, orderDate: true },
      }),
      this.prisma.cSMaster.findMany({
        where: { clientCode: { in: custCodes }, isActive: 1, invDate: { lt: nextDay }, ...branchFilter },
        select: { id: true, invNo: true, clientCode: true, totalAmount: true, totalDiscount: true, invDate: true },
      }),
    ]);

    type Ev =
      | { t: number; kind: 'adv'; amount: number }
      | { t: number; kind: 'cr'; amount: number; id: string; invNo: string; today: boolean };
    const byCust = new Map<string, Ev[]>();
    const push = (code: string, ev: Ev) => {
      const arr = byCust.get(code) ?? [];
      arr.push(ev);
      byCust.set(code, arr);
    };
    for (const a of advances) {
      if (!a.orderDate) continue;
      push(a.clientCode, { t: a.orderDate.getTime(), kind: 'adv', amount: num(a.advance) });
    }
    for (const c of allCredits) {
      if (!c.invDate || !c.clientCode) continue;
      const today = c.invDate >= day && c.invDate < nextDay;
      push(c.clientCode, { t: c.invDate.getTime(), kind: 'cr', amount: num(c.totalAmount) - num(c.totalDiscount), id: c.id, invNo: c.invNo, today });
    }

    const creditRows: { id: string; invNo: string; type: string; netAmount: number; net: number }[] = [];
    let orderCollection = 0;

    for (const evs of byCust.values()) {
      // chronological; on a tie, advances settle before credits so a same-day
      // advance can still offset a same-day credit.
      evs.sort((x, y) => x.t - y.t || (x.kind === 'adv' ? 0 : 1) - (y.kind === 'adv' ? 0 : 1));
      let balance = 0;
      for (const e of evs) {
        if (e.kind === 'adv') { balance += e.amount; continue; }
        const applied = Math.min(e.amount, balance);
        balance -= applied;
        if (e.today) {
          orderCollection += applied;
          const net = e.amount - applied;
          creditRows.push({ id: e.id, invNo: e.invNo, type: 'Credit', netAmount: net, net });
        }
      }
    }

    return { creditRows, orderCollection };
  }

  // ── Stock Report ──────────────────────────────────────────────
  // Returns per-item movement summary: all-time receives vs all-time issues,
  // with the current quantity as the closing balance.

  async getStockReport() {
    const [inventory, receives, issues] = await Promise.all([
      this.prisma.inventory.findMany({
        include: { item: true },
        orderBy: { item: { itmName: 'asc' } },
      }),
      this.prisma.item_Receive.groupBy({
        by: ['itemCode'],
        where: { isActive: 1 },
        _sum: { qty: true },
      }),
      this.prisma.item_Issue.groupBy({
        by: ['itemCode'],
        where: { isActive: 1 },
        _sum: { qty: true },
      }),
    ]);

    const inMap = new Map(receives.map((r) => [r.itemCode, num(r._sum.qty)]));
    const outMap = new Map(issues.map((i) => [i.itemCode, num(i._sum.qty)]));

    return inventory.map((row) => {
      const inwardQty = inMap.get(row.itemCode) ?? 0;
      const outwardQty = outMap.get(row.itemCode) ?? 0;
      const closingQty = num(row.quantity);
      // Opening is derived: closing - in + out (what it was before all movements)
      const openingQty = closingQty - inwardQty + outwardQty;
      return {
        id: row.itemCode,
        itemCode: row.itemCode,
        itemName: row.item?.itmName ?? '',
        uom: row.item?.itmUOM ?? '',
        openingQty: Math.max(0, openingQty),
        inwardQty,
        outwardQty,
        closingQty,
      };
    });
  }

  // ── Item-wise Sales (qty + amount per item, cash + vat merged) ───────

  async getItemSalesReport(query: DateRangeQuery) {
    const { from, to } = this.parseRange(query);
    const branchScope = query.branchId ? { branchId: query.branchId } : {};

    const [cashItems, vatItems] = await Promise.all([
      this.prisma.t_SODet.groupBy({
        by: ['sodetItemOID'],
        where: { sale: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchScope } },
        _sum: { sodetQTY: true, sodetNetAmount: true },
      }),
      this.prisma.t_SODeV.groupBy({
        by: ['sodetItemOID'],
        where: { sale: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchScope } },
        _sum: { sodetQTY: true, sodetNetAmount: true },
      }),
    ]);

    const totals = new Map<string, { totalQty: number; totalAmount: number }>();
    for (const g of [...cashItems, ...vatItems]) {
      const cur = totals.get(g.sodetItemOID) ?? { totalQty: 0, totalAmount: 0 };
      cur.totalQty += num(g._sum.sodetQTY);
      cur.totalAmount += num(g._sum.sodetNetAmount);
      totals.set(g.sodetItemOID, cur);
    }

    const ids = [...totals.keys()];
    const items = ids.length
      ? await this.prisma.item_Information.findMany({ where: { id: { in: ids } } })
      : [];
    const itemById = new Map(items.map((i) => [i.id, i]));

    return ids
      .map((id) => {
        const t = totals.get(id)!;
        const item = itemById.get(id);
        return {
          id,
          itemCode: item?.itmCode ?? '',
          itemName: item?.itmName ?? '(unknown)',
          uom: item?.itmUOM ?? '',
          totalQty: t.totalQty,
          totalAmount: t.totalAmount,
        };
      })
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  // ── Customer Statement (running ledger of invoices and payments) ─────

  async getCustomerStatement(clientCode: string | undefined, query: DateRangeQuery) {
    if (!clientCode) throw new BadRequestException('`customerCode` is required');
    const { from, to } = this.parseRange(query);

    const [invoices, vatInvoices, payments] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { clientCode, invDate: { gte: from, lte: to }, isActive: 1 },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode, invDate: { gte: from, lte: to } },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.client_Transaction.findMany({
        where: { clientCode, paymentDate: { gte: from, lte: to } },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const entries = [
      ...invoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice', invoiceNo: i.invNo, debit: num(i.totalAmount) - num(i.totalDiscount), credit: 0 })),
      ...vatInvoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice (VAT)', invoiceNo: i.invNo, debit: num(i.totalAmount) - num(i.totalDiscount), credit: 0 })),
      ...payments.map((p) => ({ id: p.id, date: p.paymentDate, description: p.tType ?? 'Payment', invoiceNo: p.moneyReceptNo ?? '', debit: 0, credit: num(p.paymentAmount) })),
    ];

    entries.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

    let balance = 0;
    return entries.map((e) => {
      balance += e.debit - e.credit;
      return { ...e, balance };
    });
  }

  // ── Packet Analysis (received vs issued per packet) ──────────────────

  async getPacketAnalysis(query: DateRangeQuery) {
    const { from, to } = this.parseRange(query);

    const [receives, issues, packets] = await Promise.all([
      this.prisma.packet_Receive.groupBy({
        by: ['code'],
        where: { receiveDate: { gte: from, lte: to }, isActive: 1 },
        _sum: { qty: true },
      }),
      this.prisma.packet_Issue.groupBy({
        by: ['code'],
        where: { issueDate: { gte: from, lte: to }, isActive: 1 },
        _sum: { qty: true },
      }),
      this.prisma.packetInfo.findMany(),
    ]);

    const nameByCode = new Map(packets.map((p) => [p.code, p.name ?? '']));
    const totals = new Map<string, { received: number; issued: number }>();
    for (const r of receives) {
      if (!r.code) continue;
      const cur = totals.get(r.code) ?? { received: 0, issued: 0 };
      cur.received += num(r._sum.qty);
      totals.set(r.code, cur);
    }
    for (const i of issues) {
      if (!i.code) continue;
      const cur = totals.get(i.code) ?? { received: 0, issued: 0 };
      cur.issued += num(i._sum.qty);
      totals.set(i.code, cur);
    }

    return [...totals.entries()]
      .map(([code, t]) => ({
        id: code,
        code,
        name: nameByCode.get(code) ?? '',
        received: t.received,
        issued: t.issued,
        balance: t.received - t.issued,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}
