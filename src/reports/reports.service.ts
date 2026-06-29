import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface DateRangeQuery {
  fromDate?: string;
  toDate?: string;
  branchId?: string;
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
        id: s.id, invNo: s.invNo, date: s.invDate, customerName: s.customer?.name ?? '',
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

  async getDailySummary(date: string, branchId?: string) {
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
    branchFilter: { branchId?: string },
  ): Promise<{
    creditRows: { id: string; invNo: string; type: string; netAmount: number; net: number }[];
    orderCollection: number;
  }> {
    const todayCredit = await this.prisma.cSMaster.findMany({
      where: { invDate: { gte: day, lt: nextDay }, isActive: 1, ...branchFilter },
      select: { customer: { select: { code: true } } },
    });
    const custCodes = [...new Set(todayCredit.map((c) => c.customer?.code).filter((x): x is string => !!x))];
    if (!custCodes.length) return { creditRows: [], orderCollection: 0 };

    const [advances, allCredits] = await this.prisma.$transaction([
      this.prisma.orderReceive_Master.findMany({
        where: { clientCode: { in: custCodes }, isActive: 1, advance: { gt: 0 }, orderDate: { lt: nextDay }, ...branchFilter },
        select: { clientCode: true, advance: true, orderDate: true },
      }),
      this.prisma.cSMaster.findMany({
        where: { customer: { code: { in: custCodes } }, isActive: 1, invDate: { lt: nextDay }, ...branchFilter },
        select: { id: true, invNo: true, customer: { select: { code: true } }, totalAmount: true, totalDiscount: true, invDate: true },
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
      const code = c.customer?.code;
      if (!c.invDate || !code) continue;
      const today = c.invDate >= day && c.invDate < nextDay;
      push(code, { t: c.invDate.getTime(), kind: 'cr', amount: num(c.totalAmount) - num(c.totalDiscount), id: c.id, invNo: c.invNo, today });
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

  // ── Daily Final Report (full end-of-day counter report) ──────────────
  // Reproduces the legacy "Daily Final Report": per-category Qty (Kg/Pcs) and
  // amount, payment-mode split, card-bank split, discount/NC/credit breakdown,
  // sales corrections and an hourwise curve — all for a single branch + day.
  // The frontend always supplies `date` and `branchId`.
  //
  // Category sources (confirmed with the business):
  //   Regular  → t_SOMstr   (non-VAT cash running sales)
  //   Assorted → AsstMsrt   (assortment sales)
  //   Issue    → Item_Issue (stock issued to other branches, valued at unit price)
  //   Credit   → CSMaster   (non-VAT credit sales)
  // The VAT number is a header field only (Branch.vatNo); VAT sale tables are
  // out of scope for this report.
  async getDailyFinalReport(date: string, branchId: string) {
    const day = new Date(date);
    if (isNaN(day.getTime())) throw new BadRequestException('Valid `date` is required');
    if (!branchId) throw new BadRequestException('`branchId` is required');
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const window = { gte: day, lt: nextDay };

    const [branch, cash, assorted, issues, credit, nc] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { branchName: true, address: true, vatNo: true } }),
      this.prisma.t_SOMstr.findMany({
        where: { somstrDate: window, somstrIsActive: true, branchId },
        include: {
          bank: { select: { name: true } },
          details: { select: { sodetQTY: true, item: { select: { itmUOM: true } } } },
        },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.asstMsrt.findMany({
        where: { date: window, isActive: true, branchId },
        include: { details: { select: { qty: true, item: { select: { itmUOM: true } } } } },
      }),
      this.prisma.item_Issue.findMany({
        // Issue Sale = stock issued OUT of this branch to other branches.
        where: { issueDate: window, isActive: 1, issueBranchId: branchId },
        include: { item: { select: { itmUOM: true } } },
      }),
      this.prisma.cSMaster.findMany({
        where: { invDate: window, isActive: 1, branchId },
        include: {
          customer: { select: { name: true, mobile: true } },
          details: { select: { qty: true, itemOId: true } },
        },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.t_NCMstr.findMany({
        where: { ncmstrDate: window, ncmstrIsActive: true, branchId },
        include: { details: { select: { ncdetNetAmount: true } } },
      }),
    ]);

    // Credit detail lines reference items by id but carry no UOM, so resolve
    // UOM in one batched lookup to bucket their qty into Kg/Pcs.
    const creditItemIds = [...new Set(credit.flatMap((c) => c.details.map((d) => d.itemOId).filter((x): x is string => !!x)))];
    const creditItems = creditItemIds.length
      ? await this.prisma.item_Information.findMany({ where: { id: { in: creditItemIds } }, select: { id: true, itmUOM: true } })
      : [];
    const uomById = new Map(creditItems.map((i) => [i.id, i.itmUOM]));

    const isKg = (uom?: string | null) => /kg/i.test(uom ?? '');
    const qtyByUom = (lines: { qty: number; uom?: string | null }[]) =>
      lines.reduce(
        (acc, l) => {
          if (isKg(l.uom)) acc.kg += l.qty;
          else acc.pcs += l.qty;
          return acc;
        },
        { kg: 0, pcs: 0 },
      );

    // ── Category Qty (Kg/Pcs) + Sale amount ──────────────────────────────
    const regularQty = qtyByUom(cash.flatMap((s) => s.details.map((d) => ({ qty: num(d.sodetQTY), uom: d.item?.itmUOM }))));
    const regularAmt = cash.reduce((t, s) => t + num(s.somstrNetAmt), 0);

    const assortedQty = qtyByUom(assorted.flatMap((s) => s.details.map((d) => ({ qty: num(d.qty), uom: d.item?.itmUOM }))));
    const assortedAmt = assorted.reduce((t, s) => t + num(s.netAmt), 0);

    const issueQty = qtyByUom(issues.map((i) => ({ qty: num(i.qty), uom: i.item?.itmUOM })));
    const issueAmt = issues.reduce((t, i) => t + num(i.qty) * num(i.unitPrice), 0);

    const creditNet = (s: (typeof credit)[number]) => num(s.totalAmount) - num(s.totalDiscount);
    const creditQty = qtyByUom(credit.flatMap((s) => s.details.map((d) => ({ qty: num(d.qty), uom: uomById.get(d.itemOId ?? '') }))));
    const creditAmt = credit.reduce((t, s) => t + creditNet(s), 0);

    // ── Payment-mode split (cash running sales by mtype) ─────────────────
    const bucket = (mtype?: string | null, hasBank?: boolean) => {
      const m = (mtype ?? '').toLowerCase();
      if (/bkash|nagad|rocket|mfs/.test(m)) return 'bkash';
      if (/card|bank/.test(m) || hasBank) return 'card';
      return 'cash';
    };
    const payments = { bkash: 0, card: 0, cash: 0, credit: creditAmt };
    const cardBank = new Map<string, number>();
    for (const s of cash) {
      const amt = num(s.somstrNetAmt);
      const b = bucket(s.mtype, !!s.soMstrMBank);
      payments[b] += amt;
      if (b === 'card') cardBank.set(s.bank?.name ?? 'Unknown', (cardBank.get(s.bank?.name ?? 'Unknown') ?? 0) + amt);
    }

    // ── Totals ───────────────────────────────────────────────────────────
    const ncRows = nc.map((n) => ({
      name: n.ncmstrName ?? '',
      contact: n.ncmstrContactNo ?? '',
      amount: n.details.reduce((t, d) => t + num(d.ncdetNetAmount), 0),
    }));
    const ncSale = ncRows.reduce((t, r) => t + r.amount, 0);

    const discount =
      cash.reduce((t, s) => t + num(s.somstrDiscAmt), 0) +
      assorted.reduce((t, s) => t + num(s.discAmt), 0) +
      credit.reduce((t, s) => t + num(s.totalDiscount), 0);

    const totalSale = payments.bkash + payments.card + payments.cash + payments.credit;
    const grandTotal = totalSale + ncSale + discount;

    // ── Discount & NC breakdown lists ────────────────────────────────────
    // A discount row reproduces the legacy "(gross x pct%) = amount" detail.
    const pct = (amount: number, gross: number) => (gross > 0 ? Math.round((amount / gross) * 100) : 0);
    const discRow = (name: string, contact: string, amount: number, gross: number) => ({
      name,
      contact,
      amount,
      detail: `(${gross.toFixed(0)}x${pct(amount, gross)}%)=${amount.toFixed(0)}`,
    });

    const creditBreakdown = credit.map((s) => ({
      name: s.customer?.name ?? '',
      contact: s.customer?.mobile ?? '',
      amount: creditNet(s),
    }));

    const discountBreakdown = [
      ...cash
        .filter((s) => num(s.somstrDiscAmt) > 0)
        .map((s) => discRow(s.soMstrDiscountRemarks ?? '', s.soMstrDiscountContact ?? '', num(s.somstrDiscAmt), num(s.somstrTotalAmt))),
      ...credit
        .filter((s) => num(s.totalDiscount) > 0)
        .map((s) => discRow(s.customer?.name ?? s.discountRemarks ?? '', s.customer?.mobile ?? '', num(s.totalDiscount), num(s.totalAmount))),
      ...assorted
        .filter((s) => num(s.discAmt) > 0)
        .map((s) => discRow(s.discountRemarks ?? '', '', num(s.discAmt), num(s.totalAmt))),
    ];

    // ── Sales correction (cash sales carrying a modify remark) ───────────
    const salesCorrection = cash
      .filter((s) => !!s.soMstrModifyRemarks)
      .map((s) => ({ invNo: s.somstrCode ?? '', name: s.soMstrModifyRemarks ?? '', chgAmt: num(s.somstrNetAmt) }));

    // ── Hourwise curve (cash running sales) ──────────────────────────────
    const hours = new Map<number, { qty: number; amount: number }>();
    for (const s of cash) {
      if (!s.somstrDate) continue;
      const h = s.somstrDate.getHours();
      const cur = hours.get(h) ?? { qty: 0, amount: 0 };
      cur.qty += s.details.reduce((t, d) => t + num(d.sodetQTY), 0);
      cur.amount += num(s.somstrNetAmt);
      hours.set(h, cur);
    }
    const label = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
    const hourwise = [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, v]) => ({ hour: h, label: label(h), qty: v.qty, amount: v.amount }));

    return {
      date,
      branch: {
        name: branch?.branchName ?? '',
        address: branch?.address ?? '',
        vatNo: branch?.vatNo ?? '',
      },
      categories: {
        regular: { ...regularQty, amount: regularAmt },
        assorted: { ...assortedQty, amount: assortedAmt },
        issue: { ...issueQty, amount: issueAmt },
        credit: { ...creditQty, amount: creditAmt },
      },
      payments,
      totals: { totalSale, ncSale, discount, grandTotal },
      breakdown: { credit: creditBreakdown, discount: discountBreakdown, nc: ncRows },
      cardBank: [...cardBank.entries()].map(([bank, amount]) => ({ bank, amount })),
      salesCorrection,
      hourwise,
    };
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
        where: { customer: { code: clientCode }, invDate: { gte: from, lte: to }, isActive: 1 },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode, invDate: { gte: from, lte: to } },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.customer_Transaction.findMany({
        where: { customer: { code: clientCode }, receiveDate: { gte: from, lte: to } },
        orderBy: { receiveDate: 'asc' },
      }),
    ]);

    const entries = [
      ...invoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice', invoiceNo: i.invNo, debit: num(i.totalAmount) - num(i.totalDiscount), credit: 0 })),
      ...vatInvoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice (VAT)', invoiceNo: i.invNo, debit: num(i.totalAmount) - num(i.totalDiscount), credit: 0 })),
      ...payments.map((p) => ({ id: p.id, date: p.receiveDate, description: p.tType ?? 'Payment', invoiceNo: p.moneyReceptNo ?? '', debit: 0, credit: num(p.receiveAmount) })),
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
