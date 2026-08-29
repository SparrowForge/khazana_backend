import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { isFactoryBranch, roundPayable } from '../common/helpers';

export interface DateRangeQuery {
  fromDate?: string;
  toDate?: string;
  branchId?: string;
}

const num = (d: unknown): number => (d == null ? 0 : Number(d));

// Round to 2dp WITHOUT collapsing sign — a balance of -1 must stay -1.00, not
// become 0/abs. Used by the stock ledger roll-forward so opening/closing carry
// clean signed values free of float noise (e.g. -0.999999 → -1.00).
const r2signed = (n: number): number => Math.round(n * 100) / 100;

/** Client name for a POS terminal sale.
 *
 *  A running sale has no customer record — it is a walk-in — so the name comes
 *  from whichever of two fields holds one, in this order:
 *
 *   1. `SoMstr_GuestName`, typed on the POS checkout panel. Optional, available
 *      on every sale.
 *   2. `SoMstr_DiscountRemarks`, the discount authoriser. Only ever written when
 *      a discount was applied, which is why (1) exists — but it is still the
 *      best name available on every sale rung up before (1) was added.
 *
 *  Failing both, 'POS'. Not a blank: an empty cell looks like missing data on a
 *  sheet whose whole point is that every row is identified.
 *
 *  Blank and whitespace-only count as no name — the discount column does hold ''
 *  on some rows, which would otherwise print an empty cell. */
const posClientName = (guestName?: string | null, discountAuthoriser?: string | null): string =>
  (guestName ?? '').trim() || (discountAuthoriser ?? '').trim() || 'POS';

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

    // somstrTotalAmt is stored net of VAT, while somstrNetAmt is the final
    // VAT-inclusive amount actually charged (post-discount) — Gross needs to be
    // VAT-inclusive too, so derive it as netAmt + discAmt rather than reading
    // somstrTotalAmt directly (see getDailyFinalReport for the same distinction).
    const cashGross = (s: { somstrNetAmt: unknown; somstrDiscAmt: unknown }) => num(s.somstrNetAmt) + num(s.somstrDiscAmt);
    // totalAmount on CSMaster/CSVMaster is stored net of VAT — add totalVat back
    // so Gross/Net reflect what was actually billed (see getDailyFinalReport's
    // identical creditNet helper).
    const creditGross = (s: { totalAmount: unknown; totalVat: unknown }) => num(s.totalAmount) + num(s.totalVat);

    const rows = [
      // POS/counter sales carry the teller's actual pay-mode selection
      // (Cash/Card/Bkash/Rocket/...) in `mtype` — show that instead of a
      // generic "Cash" bucket label.
      ...cash.map((s) => ({
        id: s.id, invNo: s.somstrCode, date: s.somstrDate, customerName: 'Cash Customer',
        totalAmount: cashGross(s), discount: num(s.somstrDiscAmt), netAmount: num(s.somstrNetAmt),
        saleType: s.mtype || 'Cash',
      })),
      ...credit.map((s) => ({
        id: s.id, invNo: s.invNo, date: s.invDate, customerName: s.customer?.name ?? '',
        totalAmount: creditGross(s), discount: num(s.totalDiscount), netAmount: creditGross(s) - num(s.totalDiscount),
        saleType: 'Credit',
      })),
      ...vatCash.map((s) => ({
        id: s.id, invNo: s.somstrCode, date: s.somstrDate, customerName: 'Cash Customer',
        totalAmount: cashGross(s), discount: num(s.somstrDiscAmt), netAmount: num(s.somstrNetAmt),
        saleType: s.mtype ? `${s.mtype} (VAT)` : 'Cash (VAT)',
      })),
      ...vatCredit.map((s) => ({
        id: s.id, invNo: s.invNo, date: s.invDate, customerName: s.customer?.name ?? s.clientCode ?? '',
        totalAmount: creditGross(s), discount: num(s.totalDiscount), netAmount: creditGross(s) - num(s.totalDiscount),
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
        include: { details: { select: { ncdetNetAmount: true, ncdetVATAmount: true } } },
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

    // ncdetNetAmount is stored net of VAT — add ncdetVATAmount back so NC value
    // matches what the goods would actually have sold for (see getDailyFinalReport).
    const ncRows = nc.map((s) => {
      const net = s.details.reduce((t, d) => t + num(d.ncdetNetAmount) + num(d.ncdetVATAmount), 0);
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
      select: { customerId: true },
    });
    const custIds = [...new Set(todayCredit.map((c) => c.customerId).filter((x): x is string => !!x))];
    if (!custIds.length) return { creditRows: [], orderCollection: 0 };

    const [advances, allCredits] = await this.prisma.$transaction([
      this.prisma.orderReceive_Master.findMany({
        where: { clientId: { in: custIds }, isActive: 1, advance: { gt: 0 }, orderDate: { lt: nextDay }, ...branchFilter },
        select: { clientId: true, advance: true, orderDate: true },
      }),
      this.prisma.cSMaster.findMany({
        where: { customerId: { in: custIds }, isActive: 1, invDate: { lt: nextDay }, ...branchFilter },
        select: { id: true, invNo: true, customerId: true, totalAmount: true, totalDiscount: true, totalVat: true, invDate: true },
      }),
    ]);

    type Ev =
      | { t: number; kind: 'adv'; amount: number }
      | { t: number; kind: 'cr'; amount: number; id: string; invNo: string; today: boolean };
    const byCust = new Map<string, Ev[]>();
    const push = (custId: string, ev: Ev) => {
      const arr = byCust.get(custId) ?? [];
      arr.push(ev);
      byCust.set(custId, arr);
    };
    for (const a of advances) {
      if (!a.orderDate || !a.clientId) continue;
      push(a.clientId, { t: a.orderDate.getTime(), kind: 'adv', amount: num(a.advance) });
    }
    for (const c of allCredits) {
      const custId = c.customerId;
      if (!c.invDate || !custId) continue;
      const today = c.invDate >= day && c.invDate < nextDay;
      // totalAmount is stored net of VAT — add totalVat back so the amount netted
      // against advances (and shown as the credit row) is the actual billed value.
      push(custId, { t: c.invDate.getTime(), kind: 'cr', amount: num(c.totalAmount) + num(c.totalVat) - num(c.totalDiscount), id: c.id, invNo: c.invNo, today });
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
        include: { details: { select: { ncdetNetAmount: true, ncdetVATAmount: true } } },
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

    // `totalAmount` is stored net of VAT (the allocation base for the invoice-level
    // discount — see distributeInvoiceDiscount), so the actual billed value needs
    // `totalVat` added back, exactly as the customer ledger does.
    const creditNet = (s: (typeof credit)[number]) => num(s.totalAmount) + num(s.totalVat) - num(s.totalDiscount);
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
    // ncdetNetAmount is stored net of VAT — add ncdetVATAmount back so an NC's
    // value matches what the goods would actually have sold for.
    const ncRows = nc.map((n) => ({
      name: n.ncmstrName ?? '',
      contact: n.ncmstrContactNo ?? '',
      amount: n.details.reduce((t, d) => t + num(d.ncdetNetAmount) + num(d.ncdetVATAmount), 0),
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
        .map((s) => discRow(s.customer?.name ?? s.discountRemarks ?? '', s.customer?.mobile ?? '', num(s.totalDiscount), num(s.totalAmount) + num(s.totalVat))),
      ...assorted
        .filter((s) => num(s.discAmt) > 0)
        .map((s) => discRow(s.discountRemarks ?? '', '', num(s.discAmt), num(s.totalAmt))),
    ];

    // ── Sales correction (cash sales carrying a modify remark) ───────────
    const salesCorrection = cash
      .filter((s) => !!s.soMstrModifyRemarks)
      .map((s) => ({ invNo: s.somstrCode ?? '', name: s.soMstrModifyRemarks ?? '', chgAmt: num(s.somstrNetAmt) }));

    // ── Hourwise curve (cash running sales) ──────────────────────────────
    // Timestamps are stored as UTC; the counter reports in Bangladesh time
    // (GMT+6), so shift +6h and read the UTC hour to get the local hour-of-day
    // regardless of the server's timezone.
    const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
    const hours = new Map<number, { qty: number; amount: number }>();
    for (const s of cash) {
      if (!s.somstrDate) continue;
      const h = new Date(s.somstrDate.getTime() + BD_OFFSET_MS).getUTCHours();
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

  // ── Stock Analysis Report (per-item, single branch + day) ───────────
  // Reproduces the legacy "Stock Analysis" sheet: per item it shows opening
  // stock, the day's goods-receive, sales, and adjustments (assorted / NC /
  // reject / issue / short / excess), and the derived closing stock — plus a
  // sales-summary footer identical in spirit to the Daily Final Report.
  //
  // Stock is global in `Inventory`, so per-branch quantities are DERIVED from
  // movement records (confirmed with the business):
  //   Open Stock = (production + receives − issues − sales − assorted − NC
  //                 − reject − short + excess) over everything dated BEFORE the
  //                 day, for the branch.
  //   Closing    = (Open + Production + G.Receive) − sales − assorted − NC
  //                 − reject − issue − short + excess  (the day's movements).
  // Sources: Production ← Production (branchId; factory-only, zero elsewhere),
  //   G.Receive ← Item_Receive (receiveBranchID), Issue ← Item_Issue
  //   (issueBranchId), Sales ← t_SODet, NC ← t_NCDet, and assorted/reject/short/
  //   excess ← ItemReject.{assort,reject,short,excess}.
  // `branchId` omitted ⇒ aggregate ALL branches together (the "All Branches"
  // checkbox); a value scopes every movement query to that branch.
  async getStockAnalysis(fromDate: string, toDate: string, branchId?: string) {
    const from = new Date(fromDate);
    if (isNaN(from.getTime())) throw new BadRequestException('Valid `fromDate` is required');
    // `toDate` defaults to `fromDate` (single-day report) when omitted.
    const to = toDate ? new Date(toDate) : new Date(fromDate);
    if (isNaN(to.getTime())) throw new BadRequestException('Valid `toDate` is required');
    // Inclusive end: roll the window to the start of the day AFTER `to`.
    const toExclusive = new Date(to);
    toExclusive.setDate(toExclusive.getDate() + 1);
    // Opening = balance BEFORE the range start; "during" spans the whole range.
    const day = from;
    const before = { lt: from };
    const during = { gte: from, lt: toExclusive };

    // ── Catalog + as-of-date rate ────────────────────────────────────────
    const items = await this.prisma.item_Information.findMany({
      orderBy: { itmName: 'asc' },
      select: {
        id: true, itmCode: true, itmName: true, itmUOM: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          select: { priceListPrice: true, priceVatPercent: true, priceFromDate: true, priceToDate: true },
        },
      },
    });
    // priceListPrice is the VAT-exclusive list rate — fold priceVatPercent in so
    // the report's Rate column matches what a unit actually sells for.
    const rateOf = (i: (typeof items)[number]) => {
      const p =
        i.prices.find((pr) => (!pr.priceFromDate || pr.priceFromDate <= day) && (!pr.priceToDate || pr.priceToDate >= day)) ??
        i.prices[0];
      const listPrice = num(p?.priceListPrice);
      return r2signed(listPrice * (1 + num(p?.priceVatPercent) / 100));
    };

    // ── Movement aggregates (before-day for opening, during-day for columns) ──
    // When a branch is selected, scope by it; otherwise aggregate all branches.
    const recvWhere = (w: object) => ({ ...(branchId ? { receiveBranchID: branchId } : {}), isActive: 1, purDate: w });
    const issueWhere = (w: object) => ({ ...(branchId ? { issueBranchId: branchId } : {}), isActive: 1, issueDate: w });
    const saleWhere = (w: object) => ({ sale: { ...(branchId ? { branchId } : {}), somstrIsActive: true, somstrDate: w } });
    const ncWhere = (w: object) => ({ sale: { ...(branchId ? { branchId } : {}), ncmstrIsActive: true, ncmstrDate: w } });
    const rejWhere = (w: object) => ({ ...(branchId ? { branchId } : {}), isActive: 1, date: w });
    const prodWhere = (w: object) => ({ ...(branchId ? { branchId } : {}), isActive: 1, productionDate: w });

    const [
      recvBefore, recvDuring, issueBefore, issueDuring,
      saleBefore, saleDuring, ncBefore, ncDuring, rejBefore, rejDuring,
      prodBefore, prodDuring,
    ] = await Promise.all([
      this.prisma.item_Receive.groupBy({ by: ['itemId'], where: recvWhere(before), _sum: { qty: true } }),
      this.prisma.item_Receive.groupBy({ by: ['itemId'], where: recvWhere(during), _sum: { qty: true } }),
      this.prisma.item_Issue.groupBy({ by: ['itemId'], where: issueWhere(before), _sum: { qty: true } }),
      this.prisma.item_Issue.groupBy({ by: ['itemId'], where: issueWhere(during), _sum: { qty: true } }),
      this.prisma.t_SODet.groupBy({ by: ['sodetItemOID'], where: saleWhere(before), _sum: { sodetQTY: true, sodetNetAmount: true } }),
      this.prisma.t_SODet.groupBy({ by: ['sodetItemOID'], where: saleWhere(during), _sum: { sodetQTY: true, sodetNetAmount: true } }),
      this.prisma.t_NCDet.groupBy({ by: ['ncdetItemOID'], where: ncWhere(before), _sum: { ncdetQTY: true } }),
      this.prisma.t_NCDet.groupBy({ by: ['ncdetItemOID'], where: ncWhere(during), _sum: { ncdetQTY: true } }),
      this.prisma.itemReject.groupBy({ by: ['itmOId'], where: rejWhere(before), _sum: { assort: true, reject: true, short: true, excess: true } }),
      this.prisma.itemReject.groupBy({ by: ['itmOId'], where: rejWhere(during), _sum: { assort: true, reject: true, short: true, excess: true } }),
      // Factory-only movement: manufactured output. Zero for every other branch,
      // but it must be in the roll-forward or the factory's balances under-report.
      this.prisma.production.groupBy({ by: ['itemId'], where: prodWhere(before), _sum: { qty: true } }),
      this.prisma.production.groupBy({ by: ['itemId'], where: prodWhere(during), _sum: { qty: true } }),
    ]);

    // Index every aggregate by item UUID.
    const byId = (rows: { sodetItemOID?: string; ncdetItemOID?: string; itmOId?: string | null }[], pick: (r: never) => number) => {
      const m = new Map<string, number>();
      for (const r of rows as never[]) {
        const id = (r as { sodetItemOID?: string; ncdetItemOID?: string; itmOId?: string | null }).sodetItemOID
          ?? (r as { ncdetItemOID?: string }).ncdetItemOID
          ?? (r as { itmOId?: string | null }).itmOId;
        if (id) m.set(id, (m.get(id) ?? 0) + pick(r as never));
      }
      return m;
    };
    const byItemId = (rows: { itemId: string | null; _sum: { qty: unknown } }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        if (r.itemId) m.set(r.itemId, (m.get(r.itemId) ?? 0) + num(r._sum.qty));
      }
      return m;
    };

    const recvB = byItemId(recvBefore), recvD = byItemId(recvDuring);
    const issB = byItemId(issueBefore), issD = byItemId(issueDuring);
    const prodB = byItemId(prodBefore), prodD = byItemId(prodDuring);
    const salB = byId(saleBefore, (r: { _sum: { sodetQTY: number | null } }) => num(r._sum.sodetQTY));
    const salD = byId(saleDuring, (r: { _sum: { sodetQTY: number | null } }) => num(r._sum.sodetQTY));
    const salAmtD = byId(saleDuring, (r: { _sum: { sodetNetAmount: number | null } }) => num(r._sum.sodetNetAmount));
    const ncB = byId(ncBefore, (r: { _sum: { ncdetQTY: number | null } }) => num(r._sum.ncdetQTY));
    const ncD = byId(ncDuring, (r: { _sum: { ncdetQTY: number | null } }) => num(r._sum.ncdetQTY));
    const rej = (rows: typeof rejBefore, field: 'assort' | 'reject' | 'short' | 'excess') =>
      byId(rows, (r: { _sum: Record<string, number | null> }) => num(r._sum[field]));
    const assortB = rej(rejBefore, 'assort'), assortD = rej(rejDuring, 'assort');
    const rejectB = rej(rejBefore, 'reject'), rejectD = rej(rejDuring, 'reject');
    const shortB = rej(rejBefore, 'short'), shortD = rej(rejDuring, 'short');
    const excessB = rej(rejBefore, 'excess'), excessD = rej(rejDuring, 'excess');

    const g = (m: Map<string, number>, id: string) => m.get(id) ?? 0;

    // ── Per-item rows ────────────────────────────────────────────────────
    const rows = items.map((it, idx) => {
      const id = it.id;
      // Opening = the previous day's raw closing = the SIGNED roll-forward of all
      // movements dated BEFORE the day, for this branch:
      //   Produced + Received + Excess
      //     − (Sales + Assorted + NC + Reject + Issue + Short)
      // Deficits are real: if the item closed yesterday at -1.00 it MUST open at
      // -1.00. Never clamp/abs/default-to-0 — r2signed only trims float noise.
      const openStock = r2signed(
        g(prodB, id) + g(recvB, id) + g(excessB, id)
        - (g(issB, id) + g(salB, id) + g(assortB, id) + g(ncB, id) + g(rejectB, id) + g(shortB, id)),
      );
      const production = g(prodD, id);
      const gReceive = g(recvD, id);
      const totalStock = r2signed(openStock + production + gReceive);
      const salesQty = g(salD, id);
      const salesAmt = g(salAmtD, id);
      const assorted = g(assortD, id);
      const nc = g(ncD, id);
      const reject = g(rejectD, id);
      const issueQty = g(issD, id);
      const short = g(shortD, id);
      const excess = g(excessD, id);
      // Same signed formula applied to the day's movements; may be negative.
      const closing = r2signed(
        totalStock + excess - (salesQty + assorted + nc + reject + issueQty + short),
      );
      return {
        sl: idx + 1,
        itemCode: it.itmCode,
        itemName: it.itmName ?? '',
        uom: it.itmUOM ?? '',
        rate: rateOf(it),
        openStock, production, gReceive, totalStock, salesQty, salesAmt,
        assorted, nc, reject, issueQty, short, excess, closing,
      };
    });

    // Column totals are signed too — r2signed keeps a net deficit negative.
    const sum = (k: keyof (typeof rows)[number]) => r2signed(rows.reduce((s, r) => s + (r[k] as number), 0));
    const totals = {
      openStock: sum('openStock'), production: sum('production'), gReceive: sum('gReceive'), totalStock: sum('totalStock'),
      salesQty: sum('salesQty'), salesAmt: sum('salesAmt'), assorted: sum('assorted'),
      nc: sum('nc'), reject: sum('reject'), issueQty: sum('issueQty'),
      short: sum('short'), excess: sum('excess'), closing: sum('closing'),
    };

    const [branch, footer] = await Promise.all([
      branchId
        ? this.prisma.branch.findUnique({ where: { id: branchId }, select: { branchName: true, address: true, vatNo: true } })
        : Promise.resolve(null),
      this.stockAnalysisFooter(from, toExclusive, branchId),
    ]);

    return {
      fromDate,
      toDate: toDate || fromDate,
      branch: branchId
        ? { name: branch?.branchName ?? '', address: branch?.address ?? '', vatNo: branch?.vatNo ?? '' }
        : { name: 'All Branches', address: '', vatNo: '' },
      items: rows,
      totals,
      ...footer,
    };
  }

  // ── Production & Delivery Report (factory only) ───────────────
  // The factory's view of the same ledger Stock Analysis derives, laid out as
  // paired Qty/Tk columns and grouped the way the business reads it:
  //
  //   Total Stock    = Opening + Production Of + Item Return Receive
  //   Total Delivery = Sales + Stock Issue + NC + Assorted   (everything that
  //                    left as finished goods; NC/Assorted are normally zero at
  //                    the factory but are included so the sheet stays closed)
  //   Closing        = Total Stock − Total Delivery − Reject − Short + Over
  //
  // That closing is arithmetically identical to Stock Analysis's, so the two
  // reports agree for the factory branch.
  //
  // Money columns are Qty × Rate (VAT-inclusive list rate, as in Stock
  // Analysis) with two exceptions that use real recorded money instead:
  //   * Sales Tk       — the actual net sale amount (price at time of sale,
  //                      after discount), which is not qty × list rate.
  //   * Production Tk  — the rate captured on each Production row, which the
  //                      Production Entry screen records VAT-inclusive and
  //                      leaves editable as a costing decision.
  /**
   * Sales that do NOT live in t_SODet: credit, VAT cash and VAT credit. The
   * Production & Delivery sheet's "Sales" column has to count all four ledgers —
   * reading only the cash counter table made a factory that sells on credit look
   * like it sold nothing.
   *
   * Money is the VAT-INCLUSIVE line value net of every discount, which is what
   * `sodetNetAmount` already holds for cash sales (`amount + vat - discount
   * share`, see PosSalesService#priceLines) and what the sheet's VAT-inclusive
   * `rate` needs to stay comparable. For the credit ledgers that is
   * `value + vat - disc`: `value` is rate x qty net of VAT, `disc` carries the
   * line discount AND its share of the invoice-level one, so the three together
   * sum to exactly `totalAmount + totalVat - totalDiscount` off the master row.
   * `CSDetail.total` is deliberately NOT used — it is left un-netted so the
   * invoice-discount fold stays reversible (see distributeInvoiceDiscount).
   *
   * No groupBy can express that sum, so the lines are added up here.
   */
  private async otherSalesInWindow(branchId: string, window: object) {
    const [credit, vatCash, vatCredit] = await Promise.all([
      this.prisma.cSDetail.findMany({
        where: { sale: { branchId, isActive: 1, invDate: window } },
        select: { itemOId: true, qty: true, value: true, vat: true, disc: true },
      }),
      this.prisma.t_SODeV.findMany({
        where: { sale: { branchId, somstrIsActive: true, somstrDate: window } },
        select: { sodetItemOID: true, sodetQTY: true, sodetNetAmount: true },
      }),
      // CSVMaster has no IsActive column — matches how getDiscountSummary reads it.
      this.prisma.cSVDetail.findMany({
        where: { sale: { branchId, invDate: window } },
        select: { itemOId: true, qty: true, value: true, vat: true, disc: true },
      }),
    ]);

    const qty = new Map<string, number>();
    const amount = new Map<string, number>();
    const add = (id: string | null | undefined, q: number, money: number) => {
      if (!id) return;
      qty.set(id, (qty.get(id) ?? 0) + q);
      amount.set(id, (amount.get(id) ?? 0) + money);
    };
    for (const d of credit) add(d.itemOId, num(d.qty), num(d.value) + num(d.vat) - num(d.disc));
    for (const d of vatCredit) add(d.itemOId, num(d.qty), num(d.value) + num(d.vat) - num(d.disc));
    for (const d of vatCash) add(d.sodetItemOID, num(d.sodetQTY), num(d.sodetNetAmount));
    return { qty, amount };
  }

  async getProductionDeliveryReport(fromDate: string, toDate: string, branchId: string) {
    // Factory-only. The sidebar and the route guard hide the page; this closes
    // the direct-API path, exactly as ProductionService#assertFactoryBranch does.
    const sessionBranch = branchId
      ? await this.prisma.branch
          .findUnique({ where: { id: branchId }, select: { branchCode: true, branchName: true } })
          .catch(() => null)
      : null;
    if (!isFactoryBranch(sessionBranch)) {
      throw new ForbiddenException('The Production & Delivery report is available only at the Factory branch');
    }

    const from = new Date(fromDate);
    if (isNaN(from.getTime())) throw new BadRequestException('Valid `fromDate` is required');
    const to = toDate ? new Date(toDate) : new Date(fromDate);
    if (isNaN(to.getTime())) throw new BadRequestException('Valid `toDate` is required');
    const toExclusive = new Date(to);
    toExclusive.setDate(toExclusive.getDate() + 1);
    const day = from;
    const before = { lt: from };
    const during = { gte: from, lt: toExclusive };

    const items = await this.prisma.item_Information.findMany({
      orderBy: { itmName: 'asc' },
      select: {
        id: true, itmCode: true, itmName: true, itmUOM: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          select: { priceListPrice: true, priceVatPercent: true, priceFromDate: true, priceToDate: true },
        },
      },
    });
    const rateOf = (i: (typeof items)[number]) => {
      const p =
        i.prices.find((pr) => (!pr.priceFromDate || pr.priceFromDate <= day) && (!pr.priceToDate || pr.priceToDate >= day)) ??
        i.prices[0];
      return r2signed(num(p?.priceListPrice) * (1 + num(p?.priceVatPercent) / 100));
    };

    const prodWhere = (w: object) => ({ branchId, isActive: 1, productionDate: w });
    const recvWhere = (w: object) => ({ receiveBranchID: branchId, isActive: 1, purDate: w });
    const issueWhere = (w: object) => ({ issueBranchId: branchId, isActive: 1, issueDate: w });
    const saleWhere = (w: object) => ({ sale: { branchId, somstrIsActive: true, somstrDate: w } });
    const ncWhere = (w: object) => ({ sale: { branchId, ncmstrIsActive: true, ncmstrDate: w } });
    const rejWhere = (w: object) => ({ branchId, isActive: 1, date: w });

    const [
      prodBefore, prodDuring, recvBefore, recvDuring, issueBefore, issueDuring,
      saleBefore, saleDuring, ncBefore, ncDuring, rejBefore, rejDuring,
    ] = await Promise.all([
      // `_sum.rate` is deliberately absent: money is Σ(qty × rate) per row, which
      // a groupBy on rate alone cannot produce. Handled by prodValue below.
      this.prisma.production.groupBy({ by: ['itemId'], where: prodWhere(before), _sum: { qty: true } }),
      this.prisma.production.groupBy({ by: ['itemId'], where: prodWhere(during), _sum: { qty: true } }),
      this.prisma.item_Receive.groupBy({ by: ['itemId'], where: recvWhere(before), _sum: { qty: true } }),
      this.prisma.item_Receive.groupBy({ by: ['itemId'], where: recvWhere(during), _sum: { qty: true } }),
      this.prisma.item_Issue.groupBy({ by: ['itemId'], where: issueWhere(before), _sum: { qty: true } }),
      this.prisma.item_Issue.groupBy({ by: ['itemId'], where: issueWhere(during), _sum: { qty: true } }),
      this.prisma.t_SODet.groupBy({ by: ['sodetItemOID'], where: saleWhere(before), _sum: { sodetQTY: true, sodetNetAmount: true } }),
      this.prisma.t_SODet.groupBy({ by: ['sodetItemOID'], where: saleWhere(during), _sum: { sodetQTY: true, sodetNetAmount: true } }),
      this.prisma.t_NCDet.groupBy({ by: ['ncdetItemOID'], where: ncWhere(before), _sum: { ncdetQTY: true } }),
      this.prisma.t_NCDet.groupBy({ by: ['ncdetItemOID'], where: ncWhere(during), _sum: { ncdetQTY: true } }),
      this.prisma.itemReject.groupBy({ by: ['itmOId'], where: rejWhere(before), _sum: { assort: true, reject: true, short: true, excess: true } }),
      this.prisma.itemReject.groupBy({ by: ['itmOId'], where: rejWhere(during), _sum: { assort: true, reject: true, short: true, excess: true } }),
    ]);

    // Production value at the rate each entry actually recorded, not the list
    // rate — Σ(qty × rate) per item, which groupBy can't express.
    // Credit / VAT sales, for the same two windows the groupBys above cover.
    const [otherBefore, otherDuring] = await Promise.all([
      this.otherSalesInWindow(branchId, before),
      this.otherSalesInWindow(branchId, during),
    ]);

    const prodRows = await this.prisma.production.findMany({
      where: prodWhere(during),
      select: { itemId: true, qty: true, rate: true },
    });
    const prodValue = new Map<string, number>();
    for (const r of prodRows) {
      if (!r.itemId) continue;
      prodValue.set(r.itemId, (prodValue.get(r.itemId) ?? 0) + num(r.qty) * num(r.rate));
    }

    const byId = (rows: { sodetItemOID?: string; ncdetItemOID?: string; itmOId?: string | null }[], pick: (r: never) => number) => {
      const m = new Map<string, number>();
      for (const r of rows as never[]) {
        const id = (r as { sodetItemOID?: string; ncdetItemOID?: string; itmOId?: string | null }).sodetItemOID
          ?? (r as { ncdetItemOID?: string }).ncdetItemOID
          ?? (r as { itmOId?: string | null }).itmOId;
        if (id) m.set(id, (m.get(id) ?? 0) + pick(r as never));
      }
      return m;
    };
    const byItemId = (rows: { itemId: string | null; _sum: { qty: unknown } }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.itemId) m.set(r.itemId, (m.get(r.itemId) ?? 0) + num(r._sum.qty));
      return m;
    };

    const prodB = byItemId(prodBefore), prodD = byItemId(prodDuring);
    const recvB = byItemId(recvBefore), recvD = byItemId(recvDuring);
    const issB = byItemId(issueBefore), issD = byItemId(issueDuring);

    /** Fold one ledger's per-item totals into another's, in place. */
    const addInto = (target: Map<string, number>, extra: Map<string, number>) => {
      for (const [id, value] of extra) target.set(id, (target.get(id) ?? 0) + value);
      return target;
    };
    // Cash counter sales, then everything else on top — the opening balance
    // roll-forward uses `salB`, so credit sales have to count there too or the
    // opening comes out overstated by every credit invoice ever raised.
    const salB = addInto(
      byId(saleBefore, (r: { _sum: { sodetQTY: number | null } }) => num(r._sum.sodetQTY)),
      otherBefore.qty,
    );
    const salD = addInto(
      byId(saleDuring, (r: { _sum: { sodetQTY: number | null } }) => num(r._sum.sodetQTY)),
      otherDuring.qty,
    );
    const salAmtD = addInto(
      byId(saleDuring, (r: { _sum: { sodetNetAmount: number | null } }) => num(r._sum.sodetNetAmount)),
      otherDuring.amount,
    );
    const ncB = byId(ncBefore, (r: { _sum: { ncdetQTY: number | null } }) => num(r._sum.ncdetQTY));
    const ncD = byId(ncDuring, (r: { _sum: { ncdetQTY: number | null } }) => num(r._sum.ncdetQTY));
    const rej = (rows: typeof rejBefore, field: 'assort' | 'reject' | 'short' | 'excess') =>
      byId(rows, (r: { _sum: Record<string, number | null> }) => num(r._sum[field]));
    const assortB = rej(rejBefore, 'assort'), assortD = rej(rejDuring, 'assort');
    const rejectB = rej(rejBefore, 'reject'), rejectD = rej(rejDuring, 'reject');
    const shortB = rej(rejBefore, 'short'), shortD = rej(rejDuring, 'short');
    const excessB = rej(rejBefore, 'excess'), excessD = rej(rejDuring, 'excess');

    const g = (m: Map<string, number>, id: string) => m.get(id) ?? 0;

    const rows = items.map((it, idx) => {
      const id = it.id;
      const rate = rateOf(it);
      // Money for a quantity column: valued at the list rate. Signed, so a
      // deficit carries its sign through to the Tk column too.
      const tk = (qty: number) => r2signed(qty * rate);

      // Opening = signed roll-forward of every factory movement dated BEFORE the
      // range — the same formula Stock Analysis uses, so the two agree.
      const openingQty = r2signed(
        g(prodB, id) + g(recvB, id) + g(excessB, id)
        - (g(issB, id) + g(salB, id) + g(assortB, id) + g(ncB, id) + g(rejectB, id) + g(shortB, id)),
      );
      const productionQty = g(prodD, id);
      const returnQty = g(recvD, id);
      const totalStockQty = r2signed(openingQty + productionQty + returnQty);

      const salesQty = g(salD, id);
      const salesTk = g(salAmtD, id);
      const issueQty = g(issD, id);
      const ncQty = g(ncD, id);
      const assortedQty = g(assortD, id);
      const rejectQty = g(rejectD, id);
      const shortQty = g(shortD, id);
      const overQty = g(excessD, id);

      const deliveryQty = r2signed(salesQty + issueQty + ncQty + assortedQty);
      // Sales carry their real money; the rest is valued at the list rate.
      const deliveryTk = r2signed(salesTk + (issueQty + ncQty + assortedQty) * rate);
      const closingQty = r2signed(totalStockQty - deliveryQty - rejectQty - shortQty + overQty);
      // Production is valued at the rate keyed on each entry; the list rate is
      // only a fallback for an item with no production rows in range.
      const productionTk = prodValue.has(id) ? r2signed(prodValue.get(id)!) : tk(productionQty);

      return {
        sl: idx + 1,
        itemCode: it.itmCode,
        itemName: it.itmName ?? '',
        uom: it.itmUOM ?? '',
        rate,
        openingQty, openingTk: tk(openingQty),
        productionQty, productionTk,
        returnQty, returnTk: tk(returnQty),
        totalStockQty, totalStockTk: r2signed(tk(openingQty) + productionTk + tk(returnQty)),
        salesQty, salesTk,
        rejectQty, rejectTk: tk(rejectQty),
        shortQty, shortTk: tk(shortQty),
        overQty, overTk: tk(overQty),
        deliveryQty, deliveryTk,
        closingQty, closingTk: tk(closingQty),
      };
    });

    const sum = (k: keyof (typeof rows)[number]) => r2signed(rows.reduce((s, r) => s + (r[k] as number), 0));
    const totals = {
      openingQty: sum('openingQty'), openingTk: sum('openingTk'),
      productionQty: sum('productionQty'), productionTk: sum('productionTk'),
      returnQty: sum('returnQty'), returnTk: sum('returnTk'),
      totalStockQty: sum('totalStockQty'), totalStockTk: sum('totalStockTk'),
      salesQty: sum('salesQty'), salesTk: sum('salesTk'),
      rejectQty: sum('rejectQty'), rejectTk: sum('rejectTk'),
      shortQty: sum('shortQty'), shortTk: sum('shortTk'),
      overQty: sum('overQty'), overTk: sum('overTk'),
      deliveryQty: sum('deliveryQty'), deliveryTk: sum('deliveryTk'),
      closingQty: sum('closingQty'), closingTk: sum('closingTk'),
    };

    const [branch, company] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId }, select: { branchName: true, address: true, vatNo: true } }),
      this.prisma.setup_System.findFirst({ select: { companyName: true, companyAddress: true } }),
    ]);

    return {
      fromDate,
      toDate: toDate || fromDate,
      company: {
        name: company?.companyName ?? 'Khazana Mithai',
        address: company?.companyAddress ?? '',
      },
      branch: { name: branch?.branchName ?? '', address: branch?.address ?? '', vatNo: branch?.vatNo ?? '' },
      items: rows,
      totals,
    };
  }

  /** Sales-summary footer for the Stock Analysis sheet: cash/card/credit totals
   *  plus the Regular/Assorted/Issue/Credit Qty (Kg/Pcs/Amount) block. "Card
   *  Sale" here means every non-cash counter payment (card + mobile wallets). */
  private async stockAnalysisFooter(day: Date, nextDay: Date, branchId?: string) {
    const window = { gte: day, lt: nextDay };
    const branchFilter = branchId ? { branchId } : {};
    const [cash, assorted, issues, credit, nc] = await Promise.all([
      this.prisma.t_SOMstr.findMany({
        where: { somstrDate: window, somstrIsActive: true, ...branchFilter },
        include: { details: { select: { sodetQTY: true, item: { select: { itmUOM: true } } } } },
      }),
      this.prisma.asstMsrt.findMany({
        where: { date: window, isActive: true, ...branchFilter },
        include: { details: { select: { qty: true, item: { select: { itmUOM: true } } } } },
      }),
      this.prisma.item_Issue.findMany({
        where: { issueDate: window, isActive: 1, ...(branchId ? { issueBranchId: branchId } : {}) },
        include: { item: { select: { itmUOM: true } } },
      }),
      this.prisma.cSMaster.findMany({
        where: { invDate: window, isActive: 1, ...branchFilter },
        include: { details: { select: { qty: true, itemOId: true } } },
      }),
      this.prisma.t_NCMstr.findMany({
        where: { ncmstrDate: window, ncmstrIsActive: true, ...branchFilter },
        include: { details: { select: { ncdetNetAmount: true, ncdetVATAmount: true } } },
      }),
    ]);

    const creditItemIds = [...new Set(credit.flatMap((c) => c.details.map((d) => d.itemOId).filter((x): x is string => !!x)))];
    const creditItems = creditItemIds.length
      ? await this.prisma.item_Information.findMany({ where: { id: { in: creditItemIds } }, select: { id: true, itmUOM: true } })
      : [];
    const uomById = new Map(creditItems.map((i) => [i.id, i.itmUOM]));

    const isKg = (uom?: string | null) => /kg/i.test(uom ?? '');
    const qtyByUom = (lines: { qty: number; uom?: string | null }[]) =>
      lines.reduce((acc, l) => { if (isKg(l.uom)) acc.kg += l.qty; else acc.pcs += l.qty; return acc; }, { kg: 0, pcs: 0 });

    // Sales buckets: cash vs card (= every non-cash tender) vs credit.
    const isCashMode = (m?: string | null) => !m || /^cash$/i.test(m.trim());
    let cashSale = 0, cardSale = 0;
    for (const s of cash) {
      const amt = num(s.somstrNetAmt);
      if (isCashMode(s.mtype)) cashSale += amt; else cardSale += amt;
    }
    // `totalAmount` is stored net of VAT, so add `totalVat` back for the actual
    // billed value — see the identical note in getDailyFinalReport.
    const creditNet = (s: (typeof credit)[number]) => num(s.totalAmount) + num(s.totalVat) - num(s.totalDiscount);
    const creditSale = credit.reduce((t, s) => t + creditNet(s), 0);
    const totalSale = cashSale + cardSale + creditSale;

    const ncSale = nc.reduce((t, n) => t + n.details.reduce((x, d) => x + num(d.ncdetNetAmount) + num(d.ncdetVATAmount), 0), 0);
    const discount =
      cash.reduce((t, s) => t + num(s.somstrDiscAmt), 0) +
      assorted.reduce((t, s) => t + num(s.discAmt), 0) +
      credit.reduce((t, s) => t + num(s.totalDiscount), 0);
    const grandTotal = totalSale + ncSale + discount;

    const regularQty = qtyByUom(cash.flatMap((s) => s.details.map((d) => ({ qty: num(d.sodetQTY), uom: d.item?.itmUOM }))));
    const assortedQty = qtyByUom(assorted.flatMap((s) => s.details.map((d) => ({ qty: num(d.qty), uom: d.item?.itmUOM }))));
    const issueQty = qtyByUom(issues.map((i) => ({ qty: num(i.qty), uom: i.item?.itmUOM })));
    const creditQty = qtyByUom(credit.flatMap((s) => s.details.map((d) => ({ qty: num(d.qty), uom: uomById.get(d.itemOId ?? '') }))));

    return {
      summary: { cashSale, cardSale, creditSale, totalSale, ncSale, discount, grandTotal },
      categories: {
        regular: { ...regularQty, amount: cash.reduce((t, s) => t + num(s.somstrNetAmt), 0) },
        assorted: { ...assortedQty, amount: assorted.reduce((t, s) => t + num(s.netAmt), 0) },
        issue: { ...issueQty, amount: issues.reduce((t, i) => t + num(i.qty) * num(i.unitPrice), 0) },
        credit: { ...creditQty, amount: creditSale },
      },
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
        by: ['itemId'],
        where: { isActive: 1 },
        _sum: { qty: true },
      }),
      this.prisma.item_Issue.groupBy({
        by: ['itemId'],
        where: { isActive: 1 },
        _sum: { qty: true },
      }),
    ]);

    const inMap = new Map(receives.map((r) => [r.itemId, num(r._sum.qty)]));
    const outMap = new Map(issues.map((i) => [i.itemId, num(i._sum.qty)]));

    return inventory.map((row) => {
      const inwardQty = inMap.get(row.item?.id ?? '') ?? 0;
      const outwardQty = outMap.get(row.item?.id ?? '') ?? 0;
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

  /** What a credit invoice actually adds to the customer's outstanding.
   *  TotalAmount is net of VAT, so the VAT must be added back before the
   *  discount comes off — the same formula the sales list and the invoice
   *  print use. Omitting TotalVat under-states every invoice on the
   *  statement. */
  private static invoiceDebit(m: { totalAmount?: unknown; totalVat?: unknown; totalDiscount?: unknown }): number {
    // Rounded to the whole taka, the same as the invoice itself charges and the
    // customer ledger records. Takes ONE invoice — never a _sum aggregate, since
    // the sum of the rounded amounts is not the rounding of the sum.
    return roundPayable(r2signed(num(m.totalAmount) + num(m.totalVat) - num(m.totalDiscount)));
  }

  /**
   * Customer statement for a date range.
   *
   * Returns the opening balance (everything dated before `from`), the debit /
   * credit entries inside the range with a running balance carried on from that
   * opening, and the period totals. Debits are credit sales (CSMaster +
   * CSVMaster); credits are money receipts and order advances — the same three
   * components as the customer ledger, so the closing balance here agrees with
   * the customer's outstanding.
   */
  async getCustomerStatement(clientCode: string | undefined, query: DateRangeQuery) {
    if (!clientCode) throw new BadRequestException('`customerCode` is required');
    const { from, to } = this.parseRange(query);

    const customer = await this.prisma.customer.findFirst({
      where: { code: clientCode },
      select: { id: true, code: true, name: true },
    });
    if (!customer) throw new BadRequestException(`Customer '${clientCode}' not found`);

    // Everything strictly before the range start rolls up into one figure.
    const [openInv, openVatInv, openPay, openAdv] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customerId: customer.id, invDate: { lt: from }, isActive: 1 },
        select: { totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: customer.code, invDate: { lt: from } },
        select: { totalAmount: true, totalVat: true, totalDiscount: true },
      }),
      this.prisma.customer_Transaction.aggregate({
        where: { customerId: customer.id, receiveDate: { lt: from } },
        _sum: { receiveAmount: true },
      }),
      this.prisma.orderReceive_Master.aggregate({
        where: { clientId: customer.id, orderDate: { lt: from }, isActive: 1, advance: { gt: 0 } },
        _sum: { advance: true },
      }),
    ]);

    const openedDebit = (rows: { totalAmount: unknown; totalVat: unknown; totalDiscount: unknown }[]) =>
      rows.reduce((sum, r) => sum + ReportsService.invoiceDebit(r), 0);
    const openingBalance = r2signed(
      openedDebit(openInv) +
        openedDebit(openVatInv) -
        num(openPay._sum.receiveAmount) -
        num(openAdv._sum.advance),
    );

    const [invoices, vatInvoices, payments, advances] = await this.prisma.$transaction([
      this.prisma.cSMaster.findMany({
        where: { customerId: customer.id, invDate: { gte: from, lte: to }, isActive: 1 },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { clientCode: customer.code, invDate: { gte: from, lte: to } },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.customer_Transaction.findMany({
        where: { customerId: customer.id, receiveDate: { gte: from, lte: to } },
        orderBy: { receiveDate: 'asc' },
      }),
      this.prisma.orderReceive_Master.findMany({
        where: { clientId: customer.id, orderDate: { gte: from, lte: to }, isActive: 1, advance: { gt: 0 } },
        orderBy: { orderDate: 'asc' },
      }),
    ]);

    const entries = [
      ...invoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice', invoiceNo: i.invNo, debit: ReportsService.invoiceDebit(i), credit: 0 })),
      ...vatInvoices.map((i) => ({ id: i.id, date: i.invDate, description: 'Invoice (VAT)', invoiceNo: i.invNo, debit: ReportsService.invoiceDebit(i), credit: 0 })),
      ...payments.map((p) => ({ id: p.id, date: p.receiveDate, description: p.tType ?? 'Payment', invoiceNo: p.moneyReceptNo ?? '', debit: 0, credit: r2signed(num(p.receiveAmount)) })),
      ...advances.map((o) => ({ id: o.id, date: o.orderDate, description: 'Order Advance', invoiceNo: o.serialNo ?? '', debit: 0, credit: r2signed(num(o.advance)) })),
    ];

    entries.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));

    let balance = openingBalance;
    const items = entries.map((e) => {
      balance = r2signed(balance + e.debit - e.credit);
      return { ...e, balance };
    });

    const totalDebit = r2signed(items.reduce((s, e) => s + e.debit, 0));
    const totalCredit = r2signed(items.reduce((s, e) => s + e.credit, 0));

    return {
      customer,
      openingBalance,
      items,
      totals: { debit: totalDebit, credit: totalCredit, closingBalance: balance },
    };
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

  // ── Sales History Summary (item-level rows with payment breakdown) ────────

  /** Payment columns the sheet breaks each line's money across. Cash-type modes
   *  and the card-issuing banks are mutually exclusive; the delivery channels
   *  (fpanda/pathao/foodi) are not — an aggregator order is booked as credit, so
   *  it fills its channel column *and* Credit, which is how the legacy sheet
   *  reads. Don't sum across the row expecting Total Amt. */
  private static readonly PAY_COLUMNS = [
    'cash', 'bkash', 'nagad', 'brac', 'ucb', 'city', 'ebl',
    'fpanda', 'pathao', 'foodi', 'credit',
  ] as const;

  private static zeroPayments(): Record<string, number> {
    return Object.fromEntries(ReportsService.PAY_COLUMNS.map((c) => [c, 0]));
  }

  /** Which column a counter sale's money belongs in. `mtype` carries the mode
   *  picked at the till; a card payment is split further by the bank it was
   *  swiped on. Anything unrecognised stays in Cash — the column this report has
   *  always defaulted to. */
  private static cashPayColumn(mtype?: string | null, bankName?: string | null): string {
    const m = (mtype ?? '').toLowerCase();
    if (/bkash/.test(m)) return 'bkash';
    if (/nagad/.test(m)) return 'nagad';
    if (/card|bank/.test(m) || bankName) {
      const b = (bankName ?? '').toLowerCase();
      if (/brac/.test(b)) return 'brac';
      if (/ucb|united commercial/.test(b)) return 'ucb';
      if (/city/.test(b)) return 'city';
      if (/ebl|eastern/.test(b)) return 'ebl';
    }
    return 'cash';
  }

  /** Delivery-aggregator sales are raised as credit invoices to a customer named
   *  for the channel, so the channel column is filled alongside Credit. */
  private static channelColumn(customerName?: string | null): string | null {
    const c = (customerName ?? '').toLowerCase();
    if (/panda/.test(c)) return 'fpanda';
    if (/pathao/.test(c)) return 'pathao';
    if (/foodi/.test(c)) return 'foodi';
    return null;
  }

  /** Push an invoice-level discount down onto its lines, pro-rata by line
   *  amount, so the item rows still add up to the invoice's net. Line-level
   *  discounts already sit on the lines — only the remainder is spread, and the
   *  last line absorbs the rounding so the parts equal the whole exactly. */
  private static spreadInvoiceDiscount(
    lines: { amount: number; discount: number }[],
    invoiceDiscount: number,
  ): void {
    if (!lines.length) return;
    const onLines = lines.reduce((s, l) => s + l.discount, 0);
    const remainder = r2signed(invoiceDiscount - onLines);
    if (remainder <= 0) return;
    const gross = lines.reduce((s, l) => s + l.amount, 0);
    if (gross <= 0) return;
    let placed = 0;
    lines.forEach((line, i) => {
      const share =
        i === lines.length - 1
          ? r2signed(remainder - placed)
          : r2signed((line.amount / gross) * remainder);
      line.discount = r2signed(line.discount + share);
      placed = r2signed(placed + share);
    });
  }

  async getSalesHistory(query: DateRangeQuery) {
    const { from, to } = this.parseRange(query);
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};
    const itemSelect = { select: { itmCode: true, itmName: true, itmUOM: true } };

    // Every ledger is pulled with its detail lines: this sheet reports one row
    // per item sold, not one row per invoice.
    const [cashSales, creditSales, vatCashSales, vatCreditSales, branchesData] =
      await this.prisma.$transaction([
        this.prisma.t_SOMstr.findMany({
          where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
          include: { bank: { select: { name: true } }, details: { include: { item: itemSelect } } },
          orderBy: { somstrDate: 'asc' },
        }),
        this.prisma.cSMaster.findMany({
          where: { invDate: { gte: from, lte: to }, isActive: 1, ...branchFilter },
          include: {
            customer: { select: { name: true } },
            details: { include: { item: itemSelect } },
          },
          orderBy: { invDate: 'asc' },
        }),
        this.prisma.t_SOMstV.findMany({
          where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
          include: { details: { include: { item: itemSelect } } },
          orderBy: { somstrDate: 'asc' },
        }),
        this.prisma.cSVMaster.findMany({
          where: { invDate: { gte: from, lte: to }, ...branchFilter },
          include: { customer: { select: { name: true } }, details: true },
          orderBy: { invDate: 'asc' },
        }),
        this.prisma.branch.findMany(),
      ]);

    const branchMap = new Map(branchesData.map((b) => [b.id, b.branchName ?? '']));

    // CSVDetail.itemOId is a plain string with no Prisma relation, so VAT credit
    // lines are named through a separate lookup. Non-uuid values are dropped
    // rather than handed to Prisma, which would reject the whole query.
    const isUuid = (v: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    const vatCreditItemIds = [
      ...new Set(
        vatCreditSales
          .flatMap((s) => s.details.map((d) => d.itemOId ?? ''))
          .filter((id) => id && isUuid(id)),
      ),
    ];
    const vatCreditItems = vatCreditItemIds.length
      ? await this.prisma.item_Information.findMany({
          where: { id: { in: vatCreditItemIds } },
          select: { id: true, itmCode: true, itmName: true, itmUOM: true },
        })
      : [];
    const vatItemById = new Map(vatCreditItems.map((i) => [i.id, i]));

    interface HistoryLine extends Record<string, unknown> {
      date: Date | null;
      invoiceNo: string;
      /** Customer on the invoice. Blank on running (POS) sales — t_SOMstr and
       *  t_SOMstV carry no customer at all, those are walk-in counter sales. */
      clientName: string;
      itemName: string;
      uom: string;
      qty: number;
      price: number;
      amount: number;
      discount: number;
      vat: number;
      totalAmount: number;
    }

    const allItems: HistoryLine[] = [];

    /** Turn one invoice into its item rows. `pay` names the column(s) each
     *  line's total is booked into; the caller decides them from the ledger. */
    const pushInvoice = (
      header: { date: Date | null; invoiceNo: string; clientName?: string; branchId: string | null },
      rawLines: { itemName: string; uom: string; qty: number; price: number; amount: number; discount: number; vat: number }[],
      invoiceDiscount: number,
      payColumns: string[],
    ) => {
      ReportsService.spreadInvoiceDiscount(rawLines, invoiceDiscount);
      for (const line of rawLines) {
        const totalAmount = r2signed(line.amount - line.discount + line.vat);
        const payments = ReportsService.zeroPayments();
        for (const col of payColumns) payments[col] = totalAmount;
        allItems.push({
          date: header.date,
          invoiceNo: header.invoiceNo,
          clientName: header.clientName ?? '',
          itemName: line.itemName,
          uom: line.uom,
          qty: line.qty,
          price: line.price,
          amount: line.amount,
          discount: line.discount,
          vat: line.vat,
          totalAmount,
          ...payments,
          branchName: branchMap.get(header.branchId ?? '') ?? '',
          branchId: header.branchId,
        });
      }
    };

    // ── Cash (running) sales ─────────────────────────────────────────────
    for (const s of cashSales) {
      pushInvoice(
        { date: s.somstrDate, invoiceNo: s.somstrCode ?? '', clientName: posClientName(s.soMstrGuestName, s.soMstrDiscountRemarks), branchId: s.branchId },
        s.details.map((d) => ({
          itemName: d.item?.itmName || d.item?.itmCode || '',
          uom: d.item?.itmUOM ?? d.sodetUOM ?? '',
          qty: num(d.sodetQTY),
          price: num(d.sodetPrice),
          amount: num(d.sodetAmount) || r2signed(num(d.sodetPrice) * num(d.sodetQTY)),
          discount: num(d.sodetDiscount),
          vat: num(d.sodetVATAmount),
        })),
        num(s.somstrDiscAmt),
        [ReportsService.cashPayColumn(s.mtype, s.bank?.name)],
      );
    }

    // ── VAT cash (running) sales ─────────────────────────────────────────
    for (const s of vatCashSales) {
      pushInvoice(
        // t_SOMstV carries no guest name: it is written by the VAT cash form,
        // not the POS terminal, so only the discount authoriser is available.
        { date: s.somstrDate, invoiceNo: s.somstrCode ?? '', clientName: posClientName(null, s.soMstrDiscountRemarks), branchId: s.branchId },
        s.details.map((d) => ({
          itemName: d.item?.itmName || d.item?.itmCode || '',
          uom: d.item?.itmUOM ?? d.sodetUOM ?? '',
          qty: num(d.sodetQTY),
          price: num(d.sodetPrice),
          amount: num(d.sodetAmount) || r2signed(num(d.sodetPrice) * num(d.sodetQTY)),
          discount: num(d.sodetDiscount),
          vat: num(d.sodetVATAmount),
        })),
        num(s.somstrDiscAmt),
        [ReportsService.cashPayColumn(s.mtype)],
      );
    }

    // ── Credit sales ─────────────────────────────────────────────────────
    for (const s of creditSales) {
      const channel = ReportsService.channelColumn(s.customer?.name);
      pushInvoice(
        { date: s.invDate, invoiceNo: s.invNo ?? '', clientName: s.customer?.name ?? '', branchId: s.branchId },
        s.details.map((d) => ({
          itemName: d.item?.itmName || d.item?.itmCode || '',
          uom: d.item?.itmUOM ?? '',
          qty: num(d.qty),
          price: num(d.rate),
          amount: num(d.value) || r2signed(num(d.rate) * num(d.qty)),
          // Both tiers: `disc` carries the discount typed against the line plus
          // its share of the invoice-level percent. Older invoices hold only the
          // per-line part — for those `spreadInvoiceDiscount` still apportions
          // the shortfall against TotalDiscount below.
          discount: num(d.disc),
          vat: num(d.vat),
        })),
        num(s.totalDiscount),
        channel ? ['credit', channel] : ['credit'],
      );
    }

    // ── VAT credit sales ─────────────────────────────────────────────────
    for (const s of vatCreditSales) {
      const channel = ReportsService.channelColumn(s.customer?.name);
      pushInvoice(
        { date: s.invDate, invoiceNo: s.invNo ?? '', clientName: s.customer?.name ?? '', branchId: s.branchId },
        s.details.map((d) => {
          const item = vatItemById.get(d.itemOId ?? '');
          return {
            itemName: item?.itmName || item?.itmCode || '',
            uom: item?.itmUOM ?? '',
            qty: num(d.qty),
            price: num(d.rate),
            amount: num(d.value) || r2signed(num(d.rate) * num(d.qty)),
            discount: num(d.disc),
            vat: num(d.vat),
          };
        }),
        num(s.totalDiscount),
        channel ? ['credit', channel] : ['credit'],
      );
    }

    // Sort by date then invoice, so an invoice's lines stay contiguous and the
    // sheet can print its date/invoice no once per group.
    allItems.sort((a, b) => {
      const dateCompare = (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0);
      if (dateCompare !== 0) return dateCompare;
      return a.invoiceNo.localeCompare(b.invoiceNo);
    });

    // ── Daily subtotals ──────────────────────────────────────────────────
    const dailyMap = new Map<string, Record<string, unknown>>();
    for (const item of allItems) {
      if (!item.date) continue;
      const dateStr = item.date.toISOString().split('T')[0];
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          date: item.date,
          qty: 0,
          amount: 0,
          discount: 0,
          vat: 0,
          totalAmount: 0,
          ...ReportsService.zeroPayments(),
        });
      }
      const daily = dailyMap.get(dateStr)!;
      for (const key of ['qty', 'amount', 'discount', 'vat', 'totalAmount', ...ReportsService.PAY_COLUMNS]) {
        daily[key] = r2signed(Number(daily[key]) + Number(item[key] ?? 0));
      }
    }

    return {
      branchName: query.branchId ? branchMap.get(query.branchId) ?? 'All Branches' : 'All Branches',
      branchAddress: '',
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      items: allItems,
      dailySubTotals: Array.from(dailyMap.values()),
    };
  }

  // ── Item Receive Report (per-item, datewise columns) ─────────────────
  // Reproduces the legacy "Branch Wise Item Received Report": one row per item,
  // one column per day in the range, quantity received that day, with a
  // TotalQty + Amount (TotalQty × current VAT-inclusive price) at the end.
  // `receiveBranchId` = the branch the goods were received INTO (Item_Receive.
  // receiveBranchID); `fromBranchId` = the branch they were received FROM
  // (Item_Receive.branchId — yes, the column names are swapped vs. the human
  // meaning; see receiveStock in inventory.service.ts). Both are optional: omit
  // `receiveBranchId` to aggregate every branch, omit `fromBranchId` to include
  // receipts from any source.
  //
  // A branch TRANSFER also writes an Item_Receive row (serialNo prefixed
  // 'TRF') for its destination leg. The dedicated Stock Receive screen
  // (findReceiveHistory) excludes those so it only shows goods-inward
  // documents, not the receive-side of internal transfers — this report
  // mirrors that so the two stay in agreement.
  async getItemReceiveReport(query: {
    fromDate?: string;
    toDate?: string;
    receiveBranchId?: string;
    fromBranchId?: string;
  }) {
    const { from, to } = this.parseRange({ fromDate: query.fromDate, toDate: query.toDate });

    const rows = await this.prisma.item_Receive.findMany({
      where: {
        isActive: 1,
        purDate: { gte: from, lte: to },
        NOT: { serialNo: { startsWith: 'TRF' } },
        ...(query.receiveBranchId ? { receiveBranchID: query.receiveBranchId } : {}),
        ...(query.fromBranchId ? { branchId: query.fromBranchId } : {}),
      },
      select: { itemId: true, qty: true, purDate: true },
    });

    // ── Date columns (inclusive, one per calendar day in the range) ──────
    // Stepped in UTC to match how `purDate` is keyed below (toISOString date
    // part) — date-only values are stored at UTC midnight, so local-timezone
    // arithmetic here could drift the cursor onto the wrong calendar day.
    const dates: string[] = [];
    for (
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      cursor <= to;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      dates.push(cursor.toISOString().split('T')[0]);
    }

    // ── Qty per item per day ──────────────────────────────────────────────
    const qtyMap = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!r.itemId || !r.purDate) continue;
      const dateStr = r.purDate.toISOString().split('T')[0];
      if (!qtyMap.has(r.itemId)) qtyMap.set(r.itemId, new Map());
      const byDate = qtyMap.get(r.itemId)!;
      byDate.set(dateStr, r2signed((byDate.get(dateStr) ?? 0) + num(r.qty)));
    }

    // ── Catalog + current VAT-inclusive rate, for the items actually received ──
    const itemIds = [...qtyMap.keys()];
    const items = await this.prisma.item_Information.findMany({
      where: { id: { in: itemIds } },
      orderBy: { itmName: 'asc' },
      select: {
        id: true, itmCode: true, itmName: true, itmUOM: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          take: 1,
          select: { priceListPrice: true, priceVatPercent: true },
        },
      },
    });
    // "Current price with VAT" = the latest active price row's list price
    // grossed up by its VAT% — the same VAT-inclusive unit price a sale line
    // charges (see priceLines in pos-sales.service.ts).
    const currentRate = (i: (typeof items)[number]) => {
      const p = i.prices[0];
      return r2signed(num(p?.priceListPrice) * (1 + num(p?.priceVatPercent) / 100));
    };

    const itemRows = items.map((it, idx) => {
      const byDate = qtyMap.get(it.id) ?? new Map<string, number>();
      const qtyByDate: Record<string, number> = {};
      let totalQty = 0;
      for (const d of dates) {
        const q = byDate.get(d) ?? 0;
        qtyByDate[d] = q;
        totalQty = r2signed(totalQty + q);
      }
      const price = currentRate(it);
      return {
        sl: idx + 1,
        itemCode: it.itmCode,
        itemName: it.itmName ?? '',
        uom: it.itmUOM ?? '',
        price,
        qtyByDate,
        totalQty,
        amount: r2signed(totalQty * price),
      };
    });

    const totalsByDate: Record<string, number> = {};
    for (const d of dates) {
      totalsByDate[d] = r2signed(itemRows.reduce((s, r) => s + (r.qtyByDate[d] ?? 0), 0));
    }
    const totals = {
      byDate: totalsByDate,
      totalQty: r2signed(itemRows.reduce((s, r) => s + r.totalQty, 0)),
      amount: r2signed(itemRows.reduce((s, r) => s + r.amount, 0)),
    };

    const [receiveBranch, fromBranch] = await Promise.all([
      query.receiveBranchId
        ? this.prisma.branch.findUnique({ where: { id: query.receiveBranchId }, select: { branchName: true } })
        : Promise.resolve(null),
      query.fromBranchId
        ? this.prisma.branch.findUnique({ where: { id: query.fromBranchId }, select: { branchName: true } })
        : Promise.resolve(null),
    ]);

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      receiveBranch: query.receiveBranchId
        ? { id: query.receiveBranchId, name: receiveBranch?.branchName ?? '' }
        : { id: '', name: 'All Branches' },
      fromBranch: query.fromBranchId
        ? { id: query.fromBranchId, name: fromBranch?.branchName ?? '' }
        : { id: '', name: 'All Branches' },
      dates,
      items: itemRows,
      totals,
    };
  }

  // ── Item Reject Report (per-item, datewise columns) ───────────────────
  // Same datewise-pivot shape as the Item Receive report, but sourced from
  // `ItemReject.reject` — the reject quantity recorded on a Stock Adjustment
  // document (adjustStock in inventory.service.ts), not Item_Receive. Unlike
  // Item Receive there is only one branch dimension here (ItemReject has a
  // single `branchId`, no separate "from" branch).
  async getItemRejectReport(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    const { from, to } = this.parseRange({ fromDate: query.fromDate, toDate: query.toDate });

    const rows = await this.prisma.itemReject.findMany({
      where: {
        isActive: 1,
        date: { gte: from, lte: to },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      select: { itmOId: true, reject: true, date: true },
    });

    // ── Date columns (inclusive, one per calendar day in the range) ──────
    // Stepped in UTC — see the matching comment in getItemReceiveReport.
    const dates: string[] = [];
    for (
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      cursor <= to;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      dates.push(cursor.toISOString().split('T')[0]);
    }

    // ── Reject qty per item per day ───────────────────────────────────────
    const qtyMap = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!r.itmOId || !r.date) continue;
      const dateStr = r.date.toISOString().split('T')[0];
      if (!qtyMap.has(r.itmOId)) qtyMap.set(r.itmOId, new Map());
      const byDate = qtyMap.get(r.itmOId)!;
      byDate.set(dateStr, r2signed((byDate.get(dateStr) ?? 0) + num(r.reject)));
    }

    // ── Catalog + current VAT-inclusive rate, for the items actually rejected ──
    const itemIds = [...qtyMap.keys()];
    const items = await this.prisma.item_Information.findMany({
      where: { id: { in: itemIds } },
      orderBy: { itmName: 'asc' },
      select: {
        id: true, itmCode: true, itmName: true, itmUOM: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          take: 1,
          select: { priceListPrice: true, priceVatPercent: true },
        },
      },
    });
    const currentRate = (i: (typeof items)[number]) => {
      const p = i.prices[0];
      return r2signed(num(p?.priceListPrice) * (1 + num(p?.priceVatPercent) / 100));
    };

    const itemRows = items.map((it, idx) => {
      const byDate = qtyMap.get(it.id) ?? new Map<string, number>();
      const qtyByDate: Record<string, number> = {};
      let totalQty = 0;
      for (const d of dates) {
        const q = byDate.get(d) ?? 0;
        qtyByDate[d] = q;
        totalQty = r2signed(totalQty + q);
      }
      const price = currentRate(it);
      return {
        sl: idx + 1,
        itemCode: it.itmCode,
        itemName: it.itmName ?? '',
        uom: it.itmUOM ?? '',
        price,
        qtyByDate,
        totalQty,
        amount: r2signed(totalQty * price),
      };
    });

    const totalsByDate: Record<string, number> = {};
    for (const d of dates) {
      totalsByDate[d] = r2signed(itemRows.reduce((s, r) => s + (r.qtyByDate[d] ?? 0), 0));
    }
    const totals = {
      byDate: totalsByDate,
      totalQty: r2signed(itemRows.reduce((s, r) => s + r.totalQty, 0)),
      amount: r2signed(itemRows.reduce((s, r) => s + r.amount, 0)),
    };

    const branch = query.branchId
      ? await this.prisma.branch.findUnique({ where: { id: query.branchId }, select: { branchName: true } })
      : null;

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      branch: query.branchId
        ? { id: query.branchId, name: branch?.branchName ?? '' }
        : { id: '', name: 'All Branches' },
      dates,
      items: itemRows,
      totals,
    };
  }

  // ── Reject / Excess Report (POS) — the legacy "History ... Report" ───
  // Same ItemReject source as getItemRejectReport, turned inside out: that one
  // is an items × dates pivot for an A4 sheet, these are the 80mm receipts the
  // counter prints — a date-grouped list with a Sub Total per day and a Grand
  // Total. Only days that actually have movement appear; an empty day is a
  // blank line on a roll, not a column that must be held open.
  //
  // Reject, Excess and Short are three columns of the same row and print on
  // the same form, so they share one implementation rather than being kept in
  // step by hand. `field` picks which column is being reported.
  private async posAdjustmentReport(
    field: 'reject' | 'excess' | 'short',
    query: { fromDate?: string; toDate?: string; branchId?: string },
  ) {
    const { from, to } = this.parseRange({ fromDate: query.fromDate, toDate: query.toDate });

    const rows = await this.prisma.itemReject.findMany({
      where: {
        isActive: 1,
        date: { gte: from, lte: to },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      select: { itmOId: true, reject: true, excess: true, short: true, date: true },
    });

    // date -> itemId -> qty. Several entries for one item on one day are one
    // printed line, the way the legacy sheet reads. A row whose column for this
    // report is zero/NULL is not a line at all — it was written for one of the
    // OTHER columns, and printing it would put a 0.00 line on the receipt.
    const byDate = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!r.itmOId || !r.date) continue;
      const qty = num(r[field]);
      if (qty === 0) continue;
      const dateStr = r.date.toISOString().split('T')[0];
      if (!byDate.has(dateStr)) byDate.set(dateStr, new Map());
      const items = byDate.get(dateStr)!;
      items.set(r.itmOId, r2signed((items.get(r.itmOId) ?? 0) + qty));
    }

    // Catalogue + current VAT-inclusive rate, for the items actually affected —
    // the same basis the A4 Item Reject Report prices its Amount column on, so
    // the reports can never disagree on a total.
    const itemIds = [...new Set([...byDate.values()].flatMap((m) => [...m.keys()]))];
    const items = itemIds.length
      ? await this.prisma.item_Information.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true, itmCode: true, itmName: true, itmUOM: true,
            prices: {
              where: { priceIsActive: 1 },
              orderBy: { priceFromDate: 'desc' },
              take: 1,
              select: { priceListPrice: true, priceVatPercent: true },
            },
          },
        })
      : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const rateOf = (i: (typeof items)[number] | undefined) => {
      const p = i?.prices[0];
      return r2signed(num(p?.priceListPrice) * (1 + num(p?.priceVatPercent) / 100));
    };

    const days = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, itemQty]) => {
        const lines = [...itemQty.entries()]
          .map(([itemId, qty]) => {
            const it = byId.get(itemId);
            const rate = rateOf(it);
            return {
              itemCode: it?.itmCode ?? '',
              itemName: it?.itmName ?? it?.itmCode ?? '',
              uom: it?.itmUOM ?? '',
              qty,
              rate,
              amount: r2signed(qty * rate),
            };
          })
          .sort((a, b) => a.itemName.localeCompare(b.itemName));

        return {
          date,
          items: lines,
          // Qty is summed across mixed units (KG and Pcs on one day) exactly as
          // the legacy report does — the Sub Total is a count of lines' worth of
          // goods, not a weight.
          subTotalQty: r2signed(lines.reduce((s, l) => s + l.qty, 0)),
          subTotalAmount: r2signed(lines.reduce((s, l) => s + l.amount, 0)),
        };
      });

    const branch = query.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: query.branchId },
          select: { branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;

    return {
      kind: field,
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      // The receipt header prints the branch's own address/VAT/cell block, so
      // those travel with the report rather than being looked up again client-side.
      branch: query.branchId
        ? {
            id: query.branchId,
            name: branch?.branchName ?? '',
            address: branch?.address ?? '',
            vatNo: branch?.vatNo ?? '',
            mobileNo: branch?.mobileNo ?? '',
          }
        : { id: '', name: 'All Branches', address: '', vatNo: '', mobileNo: '' },
      days,
      grandTotal: {
        qty: r2signed(days.reduce((s, d) => s + d.subTotalQty, 0)),
        amount: r2signed(days.reduce((s, d) => s + d.subTotalAmount, 0)),
      },
    };
  }

  getRejectReportPos(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    return this.posAdjustmentReport('reject', query);
  }

  getExcessReportPos(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    return this.posAdjustmentReport('excess', query);
  }

  getShortReportPos(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    return this.posAdjustmentReport('short', query);
  }

  // ── NC Report (per-line list, one row per NC line item) ───────────────
  // Reproduces the legacy "Branch Wise NC Report": a flat list of every NC
  // (non-charge) line in the range — Date/Invoice/Item/Qty/Amount plus the
  // document's attribution (Name/Reference) and its branch (Outlet). Unlike
  // Item Receive/Reject this isn't a datewise pivot — dates repeat per line,
  // same as the source sheet and the same shape getSalesHistory already uses.
  async getNCReport(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    const { from, to } = this.parseRange({ fromDate: query.fromDate, toDate: query.toDate });

    const ncs = await this.prisma.t_NCMstr.findMany({
      where: {
        ncmstrDate: { gte: from, lte: to },
        ncmstrIsActive: true,
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      include: { details: { include: { item: { select: { itmName: true, itmUOM: true } } } } },
      orderBy: { ncmstrDate: 'asc' },
    });

    const branchIds = [...new Set(ncs.map((n) => n.branchId).filter((id): id is string => !!id))];
    const branches = branchIds.length
      ? await this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, branchName: true } })
      : [];
    const branchNameById = new Map(branches.map((b) => [b.id, b.branchName ?? '']));

    // ncdetNetAmount is stored net of discount but EXCLUDING VAT — the same
    // convention getDailySummary/getDailyFinalReport already rely on. Add
    // ncdetVATAmount back so "Amount" is the VAT-inclusive line value.
    const rows = ncs.flatMap((nc) =>
      nc.details.map((d) => ({
        date: nc.ncmstrDate,
        invoiceNo: nc.ncmstrCode ?? '',
        itemName: d.item?.itmName ?? '',
        uom: d.item?.itmUOM ?? d.ncdetUOM ?? '',
        qty: num(d.ncdetQTY),
        amount: r2signed(num(d.ncdetNetAmount) + num(d.ncdetVATAmount)),
        name: nc.ncmstrName ?? '',
        reference: nc.ncmstrReference ?? '',
        outlet: nc.branchId ? branchNameById.get(nc.branchId) ?? '' : '',
      })),
    );

    const totals = {
      qty: r2signed(rows.reduce((s, r) => s + r.qty, 0)),
      amount: r2signed(rows.reduce((s, r) => s + r.amount, 0)),
    };

    const branch = query.branchId
      ? await this.prisma.branch.findUnique({ where: { id: query.branchId }, select: { branchName: true } })
      : null;

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      branch: query.branchId
        ? { id: query.branchId, name: branch?.branchName ?? '' }
        : { id: '', name: 'All Branches' },
      items: rows,
      totals,
    };
  }

  // ── Discount Summary (one row per discounted sale invoice) ────────────
  // Reproduces the legacy "Daily Discount Summary": every invoice in the range
  // that was sold at a discount, with the amount it would have fetched, the
  // rate, the money given away, and who authorised it.
  //
  // All four sale ledgers are covered — POS/cash and VAT cash (t_SOMstr /
  // t_SOMstV) plus credit and VAT credit (CSMaster / CSVMaster) — because a
  // discount is a discount whichever counter gave it. Invoices with no discount
  // are dropped: this is the giveaway list, not a sales list.
  async getDiscountSummary(query: { fromDate?: string; toDate?: string; branchId?: string }) {
    const { from, to } = this.parseRange({ fromDate: query.fromDate, toDate: query.toDate });
    const branchFilter = query.branchId ? { branchId: query.branchId } : {};

    const [cash, vatCash, credit, vatCredit] = await this.prisma.$transaction([
      this.prisma.t_SOMstr.findMany({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.t_SOMstV.findMany({
        where: { somstrDate: { gte: from, lte: to }, somstrIsActive: true, ...branchFilter },
        orderBy: { somstrDate: 'asc' },
      }),
      this.prisma.cSMaster.findMany({
        where: { invDate: { gte: from, lte: to }, isActive: 1, ...branchFilter },
        include: { customer: { select: { name: true, mobile: true } } },
        orderBy: { invDate: 'asc' },
      }),
      this.prisma.cSVMaster.findMany({
        where: { invDate: { gte: from, lte: to }, ...branchFilter },
        include: { customer: { select: { name: true, mobile: true } } },
        orderBy: { invDate: 'asc' },
      }),
    ]);

    // "Amount" is what the invoice would have come to before the discount, and
    // VAT-inclusive — the base the counter's percentage was actually charged on.
    // somstrTotalAmt is stored net of VAT, so derive it from the VAT-inclusive
    // net instead (the same distinction getSalesReport/getDailyFinalReport draw).
    const cashGross = (s: { somstrNetAmt: unknown; somstrDiscAmt: unknown }) =>
      r2signed(num(s.somstrNetAmt) + num(s.somstrDiscAmt));
    // CSMaster/CSVMaster.totalAmount is likewise net of VAT — add totalVat back.
    const creditGross = (s: { totalAmount: unknown; totalVat: unknown }) =>
      r2signed(num(s.totalAmount) + num(s.totalVat));

    /** The rate the discount represents. Derived from the money rather than read
     *  off the document: only credit sales store a rate, and a fixed-amount POS
     *  discount has none at all. */
    const pctOf = (discount: number, amount: number) =>
      amount > 0 ? r2signed((discount / amount) * 100) : 0;

    type Row = {
      date: Date | null;
      invoiceNo: string;
      amount: number;
      discountPercent: number;
      discount: number;
      contactNo: string;
      remarks: string;
      outlet: string;
    };

    const branchIds = [
      ...new Set(
        [...cash, ...vatCash, ...credit, ...vatCredit]
          .map((s) => s.branchId)
          .filter((id): id is string => !!id),
      ),
    ];
    const branches = branchIds.length
      ? await this.prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, branchName: true } })
      : [];
    const branchNameById = new Map(branches.map((b) => [b.id, b.branchName ?? '']));
    const outletOf = (branchId: string | null) => (branchId ? branchNameById.get(branchId) ?? '' : '');

    const rows: Row[] = [
      // Counter sales carry the discount authoriser's name and phone number in
      // the SoMstr_Discount* audit columns — that is exactly what the legacy
      // report's Contact No./Remarks columns hold.
      ...[...cash, ...vatCash]
        .filter((s) => num(s.somstrDiscAmt) > 0)
        .map((s) => {
          const amount = cashGross(s);
          const discount = r2signed(num(s.somstrDiscAmt));
          return {
            date: s.somstrDate,
            invoiceNo: s.somstrCode ?? '',
            amount,
            discountPercent: pctOf(discount, amount),
            discount,
            contactNo: s.soMstrDiscountContact ?? '',
            remarks: s.soMstrDiscountRemarks ?? '',
            outlet: outletOf(s.branchId),
          };
        }),
      // A credit invoice has no authoriser audit — the customer it was billed to
      // is who the discount was given to, so their name and mobile stand in.
      ...[...credit, ...vatCredit]
        .filter((s) => num(s.totalDiscount) > 0)
        .map((s) => {
          const amount = creditGross(s);
          const discount = r2signed(num(s.totalDiscount));
          // Credit sales do store the rate they were billed at; prefer it, since
          // it also covers the line discounts folded into totalDiscount.
          const stored = 'discountPercent' in s ? num(s.discountPercent) : 0;
          return {
            date: s.invDate,
            invoiceNo: s.invNo,
            amount,
            discountPercent: stored > 0 ? r2signed(stored) : pctOf(discount, amount),
            discount,
            contactNo: s.customer?.mobile ?? '',
            remarks: s.discountRemarks || s.customer?.name || '',
            outlet: outletOf(s.branchId),
          };
        }),
    ];

    rows.sort(
      (a, b) =>
        (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.invoiceNo.localeCompare(b.invoiceNo),
    );

    const totals = {
      amount: r2signed(rows.reduce((s, r) => s + r.amount, 0)),
      discount: r2signed(rows.reduce((s, r) => s + r.discount, 0)),
    };

    const branch = query.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: query.branchId },
          select: { branchName: true, address: true },
        })
      : null;

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      branch: query.branchId
        ? { id: query.branchId, name: branch?.branchName ?? '', address: branch?.address ?? '' }
        : { id: '', name: 'All Branches', address: '' },
      items: rows,
      totals,
    };
  }

  // ── Branchwise Delivery Report ────────────────────────────────
  // A day-column pivot of Item_Issue: one row per item delivered out of the
  // issuing branch, one column per day of the range, plus total qty and money.
  // The legacy sheet runs a whole calendar month (columns 1..31), but any range
  // works — the columns follow whatever was asked for.

  /** A range wider than this makes an unreadable sheet (and a very wide print),
   *  so it is refused rather than silently truncated. A quarter is already well
   *  past the monthly run the report is designed around. */
  private static readonly MAX_DELIVERY_DAYS = 92;

  async getBranchwiseDeliveryReport(query: {
    fromDate?: string;
    toDate?: string;
    issueBranchId: string;
    receiveBranchId?: string;
    sessionBranchId?: string;
  }) {
    // Factory-only, like the Production & Delivery report it sits beside in the
    // Factory Report menu: the sidebar and the route guard hide the page, and
    // this closes the direct-API path. The *session* branch is what's checked —
    // the issuing branch is a free parameter that merely defaults to it.
    const sessionBranch = query.sessionBranchId
      ? await this.prisma.branch
          .findUnique({ where: { id: query.sessionBranchId }, select: { branchCode: true, branchName: true } })
          .catch(() => null)
      : null;
    if (!isFactoryBranch(sessionBranch)) {
      throw new ForbiddenException('The Branchwise Delivery report is available only at the Factory branch');
    }

    const from = new Date(query.fromDate ?? '');
    if (isNaN(from.getTime())) throw new BadRequestException('Valid `fromDate` is required');
    const to = new Date(query.toDate || (query.fromDate ?? ''));
    if (isNaN(to.getTime())) throw new BadRequestException('Valid `toDate` is required');
    if (to < from) throw new BadRequestException('`toDate` must not be earlier than `fromDate`');
    if (!query.issueBranchId) throw new BadRequestException('`issueBranchId` is required');

    // Day buckets, in UTC — the dates arrive as bare `YYYY-MM-DD` (parsed as UTC
    // midnight) and the sheet prints them in UTC, so bucketing in UTC keeps the
    // column a row lands in the same one the frontend labels it with.
    const dayKey = (d: Date) => d.toISOString().split('T')[0];
    const days: string[] = [];
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(dayKey(d));
    if (days.length > ReportsService.MAX_DELIVERY_DAYS) {
      throw new BadRequestException(
        `The date range is too wide — at most ${ReportsService.MAX_DELIVERY_DAYS} days (one column per day) can be printed`,
      );
    }
    // Exclusive upper bound, so the whole of `toDate` is included regardless of
    // the time-of-day stored on the issue.
    const toExclusive = new Date(to);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const issues = await this.prisma.item_Issue.findMany({
      where: {
        isActive: 1,
        issueDate: { gte: from, lt: toExclusive },
        issueBranchId: query.issueBranchId,
        // Omitted = every receiving branch, i.e. the "All Branch" option.
        ...(query.receiveBranchId ? { receiveBranchId: query.receiveBranchId } : {}),
      },
      select: {
        itemId: true,
        qty: true,
        unitPrice: true,
        issueDate: true,
        item: { select: { itmCode: true, itmName: true, itmUOM: true } },
      },
    });

    // The issue screen fills `unitPrice` from the item's list price, but rows
    // saved before it did carry none — and a delivery valued at 0 would print a
    // blank Rate and Amount. Fall back to the list price in force on the issue
    // date. VAT is deliberately NOT added back: Item_Issue.unitPrice is the
    // ex-VAT list price (unlike Production.rate), and the sheet's Rate column
    // is ex-VAT too, so the two must be valued the same way.
    const itemIds = [...new Set(issues.map((i) => i.itemId).filter((id): id is string => !!id))];
    const priceRows = itemIds.length
      ? await this.prisma.item_Information.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true,
            prices: {
              where: { priceIsActive: 1 },
              orderBy: { priceFromDate: 'desc' },
              select: { priceListPrice: true, priceVatPercent: true, priceFromDate: true, priceToDate: true },
            },
          },
        })
      : [];
    const pricesById = new Map(priceRows.map((i) => [i.id, i.prices]));
    /** The price row in force on a given date — list price and VAT percent read
     *  together, so a rate can never be grossed up by another row's VAT. */
    const priceOn = (itemId: string, on: Date) => {
      const prices = pricesById.get(itemId) ?? [];
      const p =
        prices.find((pr) => (!pr.priceFromDate || pr.priceFromDate <= on) && (!pr.priceToDate || pr.priceToDate >= on)) ??
        prices[0];
      return { list: num(p?.priceListPrice), vatPercent: num(p?.priceVatPercent) };
    };

    type Row = {
      sl: number;
      itemCode: string;
      itemName: string;
      uom: string;
      rate: number;
      /** Qty per day, keyed by the same `YYYY-MM-DD` strings as `days`. Days the
       *  item wasn't delivered on are simply absent. */
      qtyByDate: Record<string, number>;
      totalQty: number;
      amount: number;
    };

    const acc = new Map<string, Omit<Row, 'sl' | 'rate'>>();
    for (const i of issues) {
      if (!i.itemId) continue;
      const row =
        acc.get(i.itemId) ??
        {
          itemCode: i.item?.itmCode ?? '',
          itemName: i.item?.itmName ?? '',
          uom: i.item?.itmUOM ?? '',
          qtyByDate: {} as Record<string, number>,
          totalQty: 0,
          amount: 0,
        };
      const qty = num(i.qty);
      const key = i.issueDate ? dayKey(i.issueDate) : '';
      if (key) row.qtyByDate[key] = r2signed((row.qtyByDate[key] ?? 0) + qty);
      row.totalQty += qty;
      // Money is Σ(qty × unitPrice) off each issue line, so a rate that changed
      // mid-range still values every delivery at what it actually went out at.
      //
      // The sheet prints Rate and Amount INCLUSIVE of VAT, but Item_Issue's
      // unitPrice is the bare ex-VAT t_Price.priceListPrice (unlike
      // Production.rate, which is already gross) — so it is grossed up here by
      // the VAT percent on the price row in force that day. The fallback for a
      // line saved without a price is that same row's list price, grossed up
      // identically so both paths agree.
      // Rounded to 2dp BEFORE multiplying: the stored ex-VAT price is itself a
      // 2dp figure (1636.36, not 1636.3636...), so grossing up leaves 1799.996 —
      // which would print as Rate 1,800.00 against an Amount of 53,999.88 for 30
      // units and read as an arithmetic error on the sheet. Rounding the unit
      // price first keeps Rate x TotalQty = Amount exactly, as it did before VAT
      // was added.
      const price = priceOn(i.itemId, i.issueDate ?? from);
      const unitPrice = r2signed((num(i.unitPrice) || price.list) * (1 + price.vatPercent / 100));
      row.amount += qty * unitPrice;
      acc.set(i.itemId, row);
    }

    const rows: Row[] = [...acc.values()]
      .sort((a, b) => a.itemName.localeCompare(b.itemName))
      .map((r, idx) => ({
        ...r,
        sl: idx + 1,
        totalQty: r2signed(r.totalQty),
        amount: r2signed(r.amount),
        // The printed "Rate" column is the effective VAT-INCLUSIVE unit price —
        // derived from the money rather than read off one line, so it stays
        // consistent with Amount even when lines went out at different prices.
        rate: r.totalQty !== 0 ? r2signed(r.amount / r.totalQty) : 0,
      }));

    const totals = {
      qtyByDate: days.reduce<Record<string, number>>((m, d) => {
        const t = rows.reduce((s, r) => s + (r.qtyByDate[d] ?? 0), 0);
        if (t !== 0) m[d] = r2signed(t);
        return m;
      }, {}),
      totalQty: r2signed(rows.reduce((s, r) => s + r.totalQty, 0)),
      amount: r2signed(rows.reduce((s, r) => s + r.amount, 0)),
    };

    const [issueBranch, receiveBranch, company] = await Promise.all([
      this.prisma.branch.findUnique({
        where: { id: query.issueBranchId },
        select: { branchName: true, address: true, vatNo: true },
      }),
      query.receiveBranchId
        ? this.prisma.branch.findUnique({ where: { id: query.receiveBranchId }, select: { branchName: true } })
        : null,
      this.prisma.setup_System.findFirst({ select: { companyName: true, companyAddress: true } }),
    ]);

    return {
      fromDate: dayKey(from),
      toDate: dayKey(to),
      days,
      company: {
        name: company?.companyName ?? 'Khazana Mithai',
        address: company?.companyAddress ?? '',
      },
      // The letterhead names the issuing branch; the title line names where the
      // delivery went, which is 'All Branches' when no receiver was picked.
      issueBranch: {
        id: query.issueBranchId,
        name: issueBranch?.branchName ?? '',
        address: issueBranch?.address ?? '',
        vatNo: issueBranch?.vatNo ?? '',
      },
      receiveBranch: query.receiveBranchId
        ? { id: query.receiveBranchId, name: receiveBranch?.branchName ?? '' }
        : { id: '', name: 'All Branches' },
      items: rows,
      totals,
    };
  }

  // ── Demand Report ─────────────────────────────────────────────
  // The legacy sheet is a single page: every item down the side, one column per
  // demanding branch (by branch CODE), the quantity demanded in the cell. Ported
  // from the printed "Invoice" form, retitled "Demand Report of <date>".

  async getDemandReport(query: {
    fromDate?: string;
    toDate?: string;
    /** The branch that raised the demand. Omitted = every branch, one column each. */
    fromBranchId?: string;
    /** The branch the demand was raised ON — defaults to the session branch. */
    toBranchId?: string;
    /** Demand round: 'First' | 'Second' | 'Special'. Omitted = every round. */
    orderType?: string;
    sessionBranchId?: string;
  }) {
    // Factory-only, like its siblings in the Factory Report menu. The session
    // branch is what's checked; the two branch parameters stay free.
    const sessionBranch = query.sessionBranchId
      ? await this.prisma.branch
          .findUnique({ where: { id: query.sessionBranchId }, select: { branchCode: true, branchName: true } })
          .catch(() => null)
      : null;
    if (!isFactoryBranch(sessionBranch)) {
      throw new ForbiddenException('The Demand Report is available only at the Factory branch');
    }

    const from = new Date(query.fromDate ?? '');
    if (isNaN(from.getTime())) throw new BadRequestException('Valid `fromDate` is required');
    const to = new Date(query.toDate || (query.fromDate ?? ''));
    if (isNaN(to.getTime())) throw new BadRequestException('Valid `toDate` is required');
    if (to < from) throw new BadRequestException('`toDate` must not be earlier than `fromDate`');
    const toExclusive = new Date(to);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    const toBranchId = query.toBranchId || query.sessionBranchId;

    const demands = await this.prisma.demandOrder_Master.findMany({
      where: {
        isActive: 1,
        demandDate: { gte: from, lt: toExclusive },
        ...(toBranchId ? { toBranchId } : {}),
        ...(query.fromBranchId ? { fromBranchId: query.fromBranchId } : {}),
        // Every historical order was back-filled as 'First', so a filtered run
        // covers the whole history; only a row that had its type cleared by hand
        // would fall outside every filter.
        ...(query.orderType ? { orderType: query.orderType } : {}),
      },
      select: { fromBranchId: true, details: { select: { itemId: true, qty: true } } },
    });

    // Columns: every branch that can raise a demand — not just the ones that did,
    // so the sheet keeps the same shape run to run, exactly like the printed form
    // with its fixed outlet columns. Narrowed to one column when a specific
    // "Demand From" branch was chosen.
    //
    // Ordered by Branch.SortingNo — the reading order of the printed form, which
    // is not alphabetical. A branch with no SortingNo sorts last rather than
    // first, so a newly created branch lands at the end of the sheet.
    const allBranches = await this.prisma.branch.findMany({
      where: query.fromBranchId ? { id: query.fromBranchId } : {},
      select: { id: true, branchCode: true, branchName: true, sortingNo: true },
      orderBy: [{ sortingNo: { sort: 'asc', nulls: 'last' } }, { branchCode: 'asc' }],
    });
    // A branch that actually raised a demand ALWAYS gets a column, even when it
    // is the branch being demanded from — the factory does raise demands on
    // itself, and dropping its column would silently hide those quantities from
    // a sheet whose whole job is to show them.
    const demanded = new Set(demands.map((d) => d.fromBranchId).filter((id): id is string => !!id));
    const columns = allBranches
      .filter((b) => query.fromBranchId || b.id !== toBranchId || demanded.has(b.id))
      .map((b) => ({ id: b.id, code: b.branchCode ?? '', name: b.branchName ?? '' }));

    // qty[itemId][branchId]
    const demandByItem = new Map<string, Map<string, number>>();
    for (const master of demands) {
      if (!master.fromBranchId) continue;
      for (const line of master.details) {
        if (!line.itemId) continue;
        const perBranch = demandByItem.get(line.itemId) ?? new Map<string, number>();
        perBranch.set(master.fromBranchId, (perBranch.get(master.fromBranchId) ?? 0) + num(line.qty));
        demandByItem.set(line.itemId, perBranch);
      }
    }

    // Only the items actually demanded in the window. The sheet used to list the
    // whole catalogue, blank cells and all, the way the paper form does — but on
    // screen that buries a handful of real lines in hundreds of empty ones, and
    // every blank Amount reads as a broken column rather than an absent demand.
    const items = await this.prisma.item_Information.findMany({
      where: { id: { in: [...demandByItem.keys()] } },
      orderBy: { itmName: 'asc' },
      select: {
        id: true,
        itmCode: true,
        itmName: true,
        itmUOM: true,
        prices: {
          where: { priceIsActive: 1 },
          orderBy: { priceFromDate: 'desc' },
          take: 1,
          select: { priceListPrice: true, priceVatPercent: true },
        },
      },
    });

    const rows = items.map((it, idx) => {
      const price = it.prices[0];
      // VAT-INCLUSIVE, like the printed sheet's Rate column (1,800 not 1,636.36)
      // and the rest of the factory reports.
      const rate = r2signed(num(price?.priceListPrice) * (1 + num(price?.priceVatPercent) / 100));
      const perBranch = demandByItem.get(it.id);
      const qtyByBranch: Record<string, number> = {};
      let totalQty = 0;
      for (const col of columns) {
        const qty = perBranch?.get(col.id) ?? 0;
        // Absent rather than 0 — the sheet prints blanks, not a wall of zeros.
        if (qty !== 0) qtyByBranch[col.id] = r2signed(qty);
        totalQty += qty;
      }
      return {
        sl: idx + 1,
        itemCode: it.itmCode,
        itemName: it.itmName ?? '',
        uom: it.itmUOM ?? '',
        rate,
        qtyByBranch,
        totalQty: r2signed(totalQty),
        amount: r2signed(totalQty * rate),
      };
    });

    const totals = {
      qtyByBranch: columns.reduce<Record<string, number>>((acc, col) => {
        const t = rows.reduce((sum, r) => sum + (r.qtyByBranch[col.id] ?? 0), 0);
        if (t !== 0) acc[col.id] = r2signed(t);
        return acc;
      }, {}),
      totalQty: r2signed(rows.reduce((t, r) => t + r.totalQty, 0)),
      amount: r2signed(rows.reduce((t, r) => t + r.amount, 0)),
    };

    const [toBranch, company] = await Promise.all([
      toBranchId
        ? this.prisma.branch.findUnique({ where: { id: toBranchId }, select: { branchCode: true, branchName: true } })
        : null,
      this.prisma.setup_System.findFirst({ select: { companyName: true, companyAddress: true } }),
    ]);

    return {
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
      company: {
        name: company?.companyName ?? 'Khazana Mithai',
        address: company?.companyAddress ?? '',
      },
      toBranch: { id: toBranchId ?? '', code: toBranch?.branchCode ?? '', name: toBranch?.branchName ?? '' },
      fromBranch: query.fromBranchId
        ? { id: query.fromBranchId, name: columns[0]?.name ?? '' }
        : { id: '', name: 'All Branches' },
      /** One table column each, in branch-code order. */
      branches: columns,
      items: rows,
      totals,
    };
  }
}
