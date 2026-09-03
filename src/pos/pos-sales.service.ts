import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreatePosSaleDto, UpdatePosSaleDto } from './dto/create-pos-sale.dto';
import { allocateDiscount, assertStockAvailable, roundPayable, toBranchUuid } from '../common/helpers';
import { dateRangeFilter } from '../common/dto';
import { PosSalesQueryDto } from './dto/pos-sales-query.dto';
import type { Prisma, t_SOMstr, t_SODet, Item_Information, Sale_Payment } from '../generated/prisma';

type SaleWithDetails = t_SOMstr & {
  details: (t_SODet & { item: Item_Information | null })[];
  bank?: { name: string | null } | null;
  customer?: { id: string; code: string; name: string; mobile: string | null } | null;
  payments?: (Sale_Payment & { bank?: { name: string | null } | null })[];
};

/** One tender against a bill. Several of these are a "split payment". */
export interface SalePaymentInput {
  method: string;
  amount: number;
  bankId?: string | null;
  cardNo?: string | null;
  transactionRef?: string | null;
}

/** The mode stamped on `t_SOMstr.mtype` when a bill was settled more than one
 *  way. The real breakdown is in Sale_Payment; this keeps the legacy column
 *  populated so readers that predate split payments still see something. */
export const MULTI_PAY_MODE = 'Multiple';

/** The joined customer every read of a sale carries — a counter sale now names
 *  who it was billed to, and the invoice prints their code, name and mobile. */
const CUSTOMER_SELECT = { id: true, code: true, name: true, mobile: true, isWalkIn: true } as const;

/** What every read of a sale joins in. One definition, so the list, the single
 *  read and the row a write returns can't disagree about what a sale carries. */
const SALE_INCLUDE = {
  details: { include: { item: true } },
  bank: { select: { name: true } },
  customer: { select: CUSTOMER_SELECT },
  payments: { include: { bank: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class PosSalesService {
  constructor(private prisma: PrismaService) {}

  private r2(n: number) {
    return Math.round(n * 100) / 100;
  }


  /** Resolve the session branch (Branch UUID) to its sanitized code, or '' when
   *  it can't be resolved. */
  private async resolveBranchCode(branchId?: string | null): Promise<string> {
    if (branchId == null) return '';
    const id = String(branchId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '';
    const branch = await this.prisma.branch
      .findUnique({ where: { id }, select: { branchCode: true } })
      .catch(() => null);
    return (branch?.branchCode ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private async generateInvoiceNo(branchId?: string | null): Promise<string> {
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
      bankId: sale.soMstrMBank ?? null,
      bankName: sale.bank?.name ?? null,
      // Who the sale was billed to. Null across all three is the walk-in case.
      customerId: sale.customerId ?? null,
      customerCode: sale.customer?.code ?? null,
      customerName: sale.customer?.name ?? null,
      customerMobile: sale.customer?.mobile ?? null,
      // Last 4 digits of the card, on a Card sale only.
      cardNo: sale.soMstrCardNo ?? null,
      discountRemarks: sale.soMstrDiscountRemarks ?? null,
      discountContact: sale.soMstrDiscountContact ?? null,
      modifyRemarks: sale.soMstrModifyRemarks ?? null,
      totalAmount: Number(sale.somstrTotalAmt ?? 0),
      discountAmount: Number(sale.somstrDiscAmt ?? 0),
      vatAmount: this.r2(vatAmount),
      payableAmount: Number(sale.somstrNetAmt ?? 0),
      paidAmount: Number(sale.somstrCustomerpay ?? 0),
      changeAmount: Number(sale.somstrChange ?? 0),
      // What the tenders actually settled, and what (if anything) is still owed.
      // Null on invoices raised before split payments — those were always paid
      // in full, so they read back as the bill total with nothing due.
      settledAmount: Number(sale.soMstrPaidAmt ?? sale.somstrNetAmt ?? 0),
      dueAmount: Number(sale.soMstrDueAmt ?? 0),
      paymentStatus: sale.soMstrPaymentStatus ?? 'PAID',
      /** The tender breakdown. EMPTY for a sale raised before split payments —
       *  callers that need a mode for those fall back to `salesType`. */
      payments: (sale.payments ?? []).map((t) => ({
        id: t.id,
        method: t.method,
        amount: Number(t.amount ?? 0),
        bankId: t.bankId ?? null,
        bankName: t.bank?.name ?? null,
        cardNo: t.cardNo ?? null,
        transactionRef: t.transactionRef ?? null,
      })),
      servedBy: sale.somstrCreator ?? '',
      items: sale.details.map((d) => ({
        id: d.id,
        itemId: d.sodetItemOID,
        productName: d.item?.itmName ?? d.item?.itmCode ?? '',
        // Code and unit are surplus to the 80mm receipt but the A4 invoice
        // prints the code beside the name and the challan prints the unit
        // beside the quantity.
        itemCode: d.item?.itmCode ?? '',
        uom: d.item?.itmUOM ?? d.sodetUOM ?? '',
        qty: Number(d.sodetQTY ?? 0),
        rate: Number(d.sodetPrice ?? 0),
        vatPct: Number(d.sodetVATValue ?? 0),
        vat: Number(d.sodetVATAmount ?? 0),
        total: Number(d.sodetAmount ?? 0),
      })),
    };
  }

  /** The customer a sale is billed to. When the till sends nobody this falls
   *  back to the walk-in customer, so every sale carries a CustomerID rather
   *  than the NULL that used to stand for "counter sale".
   *
   *  Resolved from the database rather than trusted from the body: the sale
   *  denormalises the customer's name and mobile onto the legacy audit columns
   *  the reports read, and those have to be what is actually on file.
   *
   *  Returns null only when no customer was named AND no walk-in row is flagged
   *  — an unconfigured database, where the old NULL behaviour is the safe
   *  landing rather than refusing the sale. */
  private async loadCustomer(customerId?: string | null) {
    if (!customerId) return this.walkInCustomer();
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: CUSTOMER_SELECT,
    });
    if (!customer) throw new BadRequestException(`Customer not found: ${customerId}`);
    return customer;
  }

  /** The row flagged Customer.isWalkIn — the counter customer the POS bills to
   *  when the cashier picks nobody. At most one row can carry the flag (partial
   *  unique index), so this is unambiguous. */
  private walkInCustomer() {
    return this.prisma.customer.findFirst({ where: { isWalkIn: true }, select: CUSTOMER_SELECT });
  }

  /**
   * Turn whatever the till sent into the tender rows to write.
   *
   * Three cases, in order:
   *  - an explicit `payments` list (the split case) — validated against the bill
   *    and returned as-is;
   *  - no list, which is every existing caller — synthesised as ONE row for the
   *    single mode that was picked, so reports can read tenders uniformly
   *    instead of special-casing single vs split;
   *  - a bill of zero, which gets no rows at all.
   *
   * `netAmount` is the payable. The rows must sum to it: a split that does not
   * add up is a keying mistake, and letting it through would put the shortfall
   * nowhere. `allowPartial` is the deliberate exception — the caller says a
   * partial settlement is intended, and the remainder becomes the due.
   */
  private buildPayments(
    netAmount: number,
    p: {
      payments?: SalePaymentInput[];
      salesType?: string;
      bankId?: string | null;
      cardNo?: string | null;
      allowPartial?: boolean;
    },
  ): { rows: SalePaymentInput[]; mode: string; settled: number; due: number } {
    const list = p.payments ?? [];

    if (!list.length) {
      const mode = p.salesType ?? 'Cash';
      const rows: SalePaymentInput[] =
        netAmount > 0
          ? [{
              method: mode,
              amount: netAmount,
              bankId: mode === 'Card' ? (p.bankId ?? null) : null,
              cardNo: this.cardNoFor(mode, p.cardNo),
              transactionRef: null,
            }]
          : [];
      return { rows, mode, settled: netAmount, due: 0 };
    }

    const rows = list.map((t, i) => {
      const method = (t.method ?? '').trim();
      if (!method) throw new BadRequestException(`Payment ${i + 1}: pick a payment method`);
      const amount = this.r2(Number(t.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(`Payment ${i + 1} (${method}): amount must be greater than zero`);
      }
      return {
        method,
        amount,
        bankId: method === 'Card' ? (t.bankId ?? null) : null,
        cardNo: this.cardNoFor(method, t.cardNo),
        transactionRef: (t.transactionRef ?? '').trim() || null,
      };
    });

    const settled = this.r2(rows.reduce((sum, t) => sum + t.amount, 0));
    if (settled > netAmount) {
      throw new BadRequestException(
        `Payments total ৳${settled} but the bill is ৳${netAmount} — overpayment is not accepted, reduce a split by ৳${this.r2(settled - netAmount)}`,
      );
    }
    if (settled < netAmount && !p.allowPartial) {
      throw new BadRequestException(
        `Payments total ৳${settled} but the bill is ৳${netAmount} — ৳${this.r2(netAmount - settled)} is unaccounted for`,
      );
    }

    // One tender is not a split: name the mode outright so the legacy column and
    // every report that reads it stay exactly as accurate as before.
    const mode = rows.length === 1 ? rows[0].method : MULTI_PAY_MODE;
    return { rows, mode, settled, due: this.r2(netAmount - settled) };
  }

  /** Last 4 digits of the card, kept only on a Card sale. Anything else is
   *  discarded rather than stored against a cash bill, so switching the pay mode
   *  away from Card can't leave a stale card number behind. */
  private cardNoFor(salesType: string | undefined, cardNo?: string | null): string | null {
    if ((salesType ?? 'Cash') !== 'Card') return null;
    return (cardNo ?? '').trim() || null;
  }

  /** Who served a sale: the signed-in user's full name, falling back to their
   *  login name when the account has none. Never taken from the request body —
   *  the terminal has no Served By field, so the person logged in IS the
   *  server, and a client cannot bill a sale under someone else's name. */
  private servedByName(userName: string, displayName?: string | null): string {
    return (displayName ?? '').trim() || userName;
  }

  async create(dto: CreatePosSaleDto, userName: string, userBranchId?: string, displayName?: string | null) {
    if (!dto.items.length) throw new BadRequestException('Cart is empty');

    // Branch comes from the request body when supplied, otherwise the
    // authenticated session branch — persistSale resolves it to a Branch UUID so
    // t_SOMstr.branchId / t_SODet.branchId are always populated.
    const branchId = dto.branchId ?? userBranchId ?? null;
    const invoiceNo = await this.generateInvoiceNo(branchId);
    return this.persistSale({
      invoiceNo,
      saleDate: new Date(),
      items: dto.items,
      paidAmount: dto.paidAmount,
      servedBy: this.servedByName(userName, displayName),
      salesType: dto.salesType,
      bankId: dto.bankId,
      branchId,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      discountRemarks: dto.discountRemarks,
      discountContact: dto.discountContact,
      customerId: dto.customerId,
      cardNo: dto.cardNo,
      payments: dto.payments,
      allowPartial: dto.allowPartial,
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
   *
   * `enforceStock` guards against overselling. It is on for the live terminal and
   * deliberately off for `PosSyncService`: a synced order was rung up hours ago
   * and the goods have already left the shelf, so rejecting it would strand a
   * completed sale in the client's queue forever rather than prevent anything.
   */
  async persistSale(p: {
    invoiceNo: string;
    saleDate: Date;
    items: { itemId: string; qty: number }[];
    paidAmount: number;
    servedBy?: string;
    salesType?: string;
    bankId?: string | null;
    branchId?: string | null;
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    /** @deprecated Typed authoriser name/contact. Only read when no `customerId`
     *  is supplied — i.e. an offline sale queued before the picker existed. */
    discountRemarks?: string;
    discountContact?: string;
    /** The customer this sale is billed to. Null/absent is a walk-in, which is
     *  the default at the till and fine — until a discount is applied. */
    customerId?: string | null;
    /** Last 4 digits of the card; kept only when `salesType` is 'Card'. */
    cardNo?: string | null;
    /**
     * Split payment: how the bill was settled, one entry per tender. Omit it and
     * the sale behaves exactly as it always has — `salesType`/`bankId`/`cardNo`
     * describe the single tender, and one payment row is synthesised from them.
     *
     * Supplied, the entries must sum to the payable (see `allowPartial`), and
     * `salesType` is ignored: the mode is derived from the rows.
     */
    payments?: SalePaymentInput[];
    /** Accept a `payments` total below the bill and record the remainder as due.
     *  Off by default — a short split is a keying mistake far more often than an
     *  intended part-payment. */
    allowPartial?: boolean;
    createdBy: string;
    enforceStock?: boolean;
    /**
     * Whether a discounted sale is required to name a customer. On for the live
     * terminal — a discount has to be given to somebody, and the discount audit
     * is worthless if that somebody is 'POS'.
     *
     * Deliberately off for `PosSyncService`, for the same reason `enforceStock`
     * is: a synced order was rung up hours ago on a terminal that may predate
     * the picker, and refusing it now would strand a completed sale in the
     * client's queue forever rather than prevent anything.
     */
    requireCustomerForDiscount?: boolean;
  }) {
    if (!p.items.length) throw new BadRequestException('Cart is empty');

    // Resolve the branch for the legacy Int columns once, here at the single
    // write chokepoint shared by online (`create`) and offline (`PosSyncService`)
    // sales. A UUID session branch has no Int mapping, so it falls back — but the
    // value is never null, which is what kept t_SOMstr/t_SODet.branchId empty.
    const branchId = toBranchUuid(p.branchId);

    // Price the lines as-of the sale date: `now` for online, the historical
    // save timestamp for synced offline orders.
    const lines = (await this.priceLines(p.items, p.saleDate)).map((l) => ({ ...l, branchId }));

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

    // Items flagged not discountable are outside the discount entirely: their
    // value is not part of what a percentage is charged on, and a fixed amount
    // cannot be spent against them either. On an all-discountable basket this
    // is the invoice gross, exactly as before.
    const discountableGross = this.discountableGross(lines);

    const discountAmount =
      discType === 'percentage'
        ? this.r2(discountableGross * discValue / 100)
        : this.r2(discValue);

    if (discountAmount > discountableGross) {
      throw new BadRequestException(
        discountableGross < grossAmount
          ? `Discount (৳${discountAmount}) cannot exceed the discountable total (৳${discountableGross}) — this sale includes items that are not discountable`
          : `Discount (৳${discountAmount}) cannot exceed the total (৳${grossAmount})`,
      );
    }

    // Who the sale is billed to. The walk-in customer is the norm at the counter
    // — but not for a discounted bill: the Daily Final Report and the Discount
    // Log both exist to say who each discount went to. Note the test is on the
    // walk-in FLAG, not on the absence of a customer: now that walk-in is a real
    // Customer row, "has a customerId" no longer means "was given to somebody".
    const customer = await this.loadCustomer(p.customerId);
    if (discountAmount > 0 && (!customer || customer.isWalkIn) && p.requireCustomerForDiscount !== false) {
      throw new BadRequestException(
        'A discounted sale must be billed to a customer — select one instead of walk-in',
      );
    }

    const netAmount = roundPayable(grossAmount - discountAmount);

    // How the bill was settled. Validates the split against the payable and, for
    // a single-tender sale, synthesises the one row from salesType/bankId/cardNo.
    const tender = this.buildPayments(netAmount, p);
    const isSplit = (p.payments?.length ?? 0) > 0;

    // A split settles the bill exactly — each row is the amount PUT AGAINST the
    // bill, so there is nothing to give back. Cash overtender and its change
    // remain the single-payment story they have always been: the cashier keys
    // what the customer handed over and the till works out the change.
    const changeAmount = isSplit ? 0 : this.r2(p.paidAmount - netAmount);
    const customerPay = isSplit ? tender.settled : this.r2(p.paidAmount);

    // Push the invoice-level discount down onto the lines, pro-rata by each
    // line's VAT-inclusive value — the base the percentage was charged on. Held
    // only on the master it would be invisible to any item-level report, which
    // would then show the basket as worth more than it was sold for.
    const pricedLines = this.applyLineDiscounts(lines, discountAmount);

    // Only meaningful for a single tender; a split has already been measured
    // against the bill by buildPayments.
    if (!isSplit && p.paidAmount < netAmount) {
      throw new BadRequestException(
        `Insufficient payment — payable: ৳${netAmount}, paid: ৳${p.paidAmount}`,
      );
    }

    // Availability check, the write and the deduction all share one transaction:
    // checking outside it leaves a window for two terminals to both pass the
    // check on the last unit and both sell it.
    const sale = await this.prisma.$transaction(async (tx) => {
      const stockLines = lines.map((l) => ({ itemId: l.itemId, qty: l.sodetQTY }));
      if (p.enforceStock !== false) await assertStockAvailable(tx, stockLines);

      const created = await tx.t_SOMstr.create({
        data: {
          somstrCode: p.invoiceNo,
          somstrDate: p.saleDate,
          somstrTotalAmt: totalAmount,
          somstrDiscAmt: discountAmount,
          somstrNetAmt: netAmount,
          somstrCustomerpay: customerPay,
          somstrChange: changeAmount,
          // 'Multiple' when the bill was split — the breakdown is in `payments`.
          mtype: tender.mode,
          // The master's bank/card columns describe a SINGLE tender. On a split
          // they are left null: each row carries its own, and picking one of
          // them to promote here would misreport the others.
          soMstrMBank: tender.rows.length === 1 ? (tender.rows[0].bankId ?? null) : null,
          soMstrCardNo: tender.rows.length === 1 ? (tender.rows[0].cardNo ?? null) : null,
          soMstrPaidAmt: tender.settled,
          soMstrDueAmt: tender.due,
          soMstrPaymentStatus: tender.due > 0 ? 'PARTIAL' : 'PAID',
          payments: {
            create: tender.rows.map((t) => ({
              method: t.method,
              amount: t.amount,
              bankId: t.bankId ?? null,
              cardNo: t.cardNo ?? null,
              transactionRef: t.transactionRef ?? null,
              createdAt: new Date(),
            })),
          },
          customerId: customer?.id ?? null,
          // Discount audit (only meaningful when a discount applied). Filled
          // from the picked customer — who the discount was given to — so the
          // Daily Final Report breakdown and the Discount Log, both of which
          // read these two columns, keep working untouched. The typed values
          // are the fallback for a sale that carries no customer, which now
          // only happens on an offline order queued before the picker existed.
          soMstrDiscountRemarks: discountAmount > 0 ? (customer?.name ?? p.discountRemarks ?? null) : null,
          soMstrDiscountContact: discountAmount > 0 ? (customer?.mobile ?? p.discountContact ?? null) : null,
          somstrCreator: p.servedBy || p.createdBy,
          somstrCreationDate: new Date(),
          somstrIsActive: true,
          branchId,
          details: {
            create: pricedLines.map((l, idx) => ({
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
        include: SALE_INCLUDE,
      });

      await this.deductStock(tx, stockLines);
      return created;
    });

    return this.toResponse(sale as SaleWithDetails);
  }

  /**
   * Each line's VAT-inclusive value AS A DISCOUNT BASE — its own value, or zero
   * when the item is flagged not discountable.
   *
   * A zero base does both jobs at once: the line is left out of the total a
   * percentage is charged on, and `allocateDiscount` gives a zero base no
   * share, so the line is billed in full. One definition, so the amount charged
   * and the amount shared out can never disagree.
   */
  private discountBases(lines: { sodetAmount: number; sodetVATAmount: number; isDiscountApplicable?: boolean }[]): number[] {
    return lines.map((l) =>
      l.isDiscountApplicable === false ? 0 : this.r2(l.sodetAmount + l.sodetVATAmount),
    );
  }

  /** The part of a basket a discount may be taken off: the discountable lines'
   *  VAT-inclusive value. This is the cap on a fixed discount and the base a
   *  percentage is charged on — NOT the invoice gross, which may include items
   *  that are never discounted. */
  private discountableGross(lines: { sodetAmount: number; sodetVATAmount: number; isDiscountApplicable?: boolean }[]): number {
    return this.r2(this.discountBases(lines).reduce((s, b) => s + b, 0));
  }

  /** Stamp each line with its share of the invoice-level discount and restate
   *  its net accordingly, so `sum(sodetNetAmount)` equals the invoice's net and
   *  `sum(sodetDiscount)` equals `somstrDiscAmt`. `sodetNetAmount` stays
   *  VAT-inclusive, which is the convention `priceLines` established. */
  private applyLineDiscounts<T extends { sodetAmount: number; sodetVATAmount: number; isDiscountApplicable?: boolean }>(
    lines: T[],
    discountAmount: number,
  ): T[] {
    const shares = allocateDiscount(this.discountBases(lines), discountAmount);
    return lines.map((l, i) => ({
      ...l,
      sodetDiscount: shares[i],
      sodetNetAmount: this.r2(l.sodetAmount + l.sodetVATAmount - shares[i]),
    }));
  }

  async findAll(query: PosSalesQueryDto = {}) {
    const somstrDate = dateRangeFilter(query.fromDate, query.toDate);
    const sales = await this.prisma.t_SOMstr.findMany({
      where: { somstrCode: { startsWith: 'DS-' }, ...(somstrDate && { somstrDate }) },
      orderBy: { somstrDate: 'desc' },
      include: SALE_INCLUDE,
    });
    return sales.map((s) => this.toResponse(s as SaleWithDetails));
  }

  async findOne(id: string) {
    const sale = await this.prisma.t_SOMstr.findUnique({
      where: { id },
      include: SALE_INCLUDE,
    });
    if (!sale) throw new NotFoundException(`Invoice ${id} not found`);
    // Branch header for the printed invoice (VAT Reg No + Tel). t_SOMstr.branchId
    // has no Prisma relation to Branch, so resolve it with a separate lookup.
    const branch = sale.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: sale.branchId },
          select: { branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;
    return {
      ...this.toResponse(sale as SaleWithDetails),
      branch: {
        name: branch?.branchName ?? '',
        address: branch?.address ?? '',
        vatNo: branch?.vatNo ?? '',
        mobileNo: branch?.mobileNo ?? '',
      },
    };
  }

  /** Takes the client so the deduction runs in the same transaction as the
   *  availability check that cleared it. */
  private async deductStock(db: Prisma.TransactionClient, items: { itemId: string; qty: number }[]) {
    for (const i of items) {
      await db.inventory.updateMany({
        where: { itemId: i.itemId },
        data: { quantity: { decrement: i.qty } },
      });
    }
  }

  /** Re-price {itemId, qty} lines from the active t_Price as-of a date.
   *  Shared by create (`persistSale`) and `update`. Caller stamps branchId. */
  private async priceLines(items: { itemId: string; qty: number }[], asOf: Date) {
    const itemIds = items.map((i) => i.itemId);
    const dbItems = await this.prisma.item_Information.findMany({
      where: { id: { in: itemIds } },
      include: { prices: { where: { priceIsActive: 1 }, orderBy: { priceFromDate: 'desc' } } },
    });
    if (dbItems.length !== new Set(itemIds).size) {
      const found = new Set(dbItems.map((i) => i.id));
      const missing = itemIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Items not found: ${missing.join(', ')}`);
    }
    const itemMap = new Map(dbItems.map((i) => [i.id, i]));
    return items.map((cartItem) => {
      const item = itemMap.get(cartItem.itemId)!;
      const price =
        item.prices.find((pr) => {
          const from = pr.priceFromDate;
          const to = pr.priceToDate;
          return (!from || from <= asOf) && (!to || to >= asOf);
        }) ?? item.prices[0];
      if (!price?.priceListPrice) {
        throw new BadRequestException(`No active price found for item: ${item.itmName ?? item.itmCode}`);
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
        // Item-level rule, carried onto the line so the discount maths below
        // never has to look the item up again.
        isDiscountApplicable: item.isDiscountApplicable,
      };
    });
  }

  /**
   * Edit a POS sale (purge-and-replace). Atomic: re-prices the lines, deletes the
   * old t_SODet rows, re-inserts the new ones, updates the t_SOMstr master, and
   * delta-adjusts stock by (oldQty − newQty) per item (sale deducts stock).
   */
  async update(id: string, dto: UpdatePosSaleDto, userName: string) {
    if (!dto.items.length) throw new BadRequestException('Cart is empty');
    const existing = await this.prisma.t_SOMstr.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new NotFoundException(`Invoice ${id} not found`);

    const branchId = toBranchUuid(existing.branchId);
    const lines = (await this.priceLines(dto.items, existing.somstrDate ?? new Date())).map((l) => ({ ...l, branchId }));

    const totalAmount = this.r2(lines.reduce((s, l) => s + l.sodetAmount, 0));
    const vatTotal = this.r2(lines.reduce((s, l) => s + l.sodetVATAmount, 0));
    const grossAmount = this.r2(totalAmount + vatTotal);

    const discType = dto.discountType ?? 'fixed';
    const discValue = dto.discountValue ?? 0;
    if (discValue < 0) throw new BadRequestException('Discount value cannot be negative');
    if (discType === 'percentage' && discValue > 100) throw new BadRequestException('Percentage discount cannot exceed 100%');
    // Same rule as a new sale: non-discountable items are outside the discount,
    // so an edit that adds one must not keep charging a percentage on it.
    const discountableGross = this.discountableGross(lines);
    const discountAmount = discType === 'percentage' ? this.r2((discountableGross * discValue) / 100) : this.r2(discValue);
    if (discountAmount > discountableGross) {
      throw new BadRequestException(
        discountableGross < grossAmount
          ? `Discount (৳${discountAmount}) cannot exceed the discountable total (৳${discountableGross}) — this sale includes items that are not discountable`
          : `Discount (৳${discountAmount}) cannot exceed the total (৳${grossAmount})`,
      );
    }
    // Same rule as a new sale: a discount has to be given to somebody, so an
    // edit that applies one has to name the customer it was given to — and the
    // walk-in customer is not somebody.
    const customer = await this.loadCustomer(dto.customerId);
    if (discountAmount > 0 && (!customer || customer.isWalkIn)) {
      throw new BadRequestException(
        'A discounted sale must be billed to a customer — select one instead of walk-in',
      );
    }

    const netAmount = roundPayable(grossAmount - discountAmount);
    // Same settlement rules as a new sale — an edit may change how the bill was
    // paid as freely as it changes what was on it.
    const tender = this.buildPayments(netAmount, dto);
    const isSplit = (dto.payments?.length ?? 0) > 0;
    const changeAmount = isSplit ? 0 : this.r2(dto.paidAmount - netAmount);
    const customerPay = isSplit ? tender.settled : this.r2(dto.paidAmount);
    if (!isSplit && dto.paidAmount < netAmount) throw new BadRequestException(`Insufficient payment — payable: ৳${netAmount}, paid: ৳${dto.paidAmount}`);

    // Re-spread the (re-applied) discount over the replacement lines.
    const pricedLines = this.applyLineDiscounts(lines, discountAmount);

    // Stock delta: restore old, apply new → increment by (old − new) per item.
    const delta = new Map<string, number>();
    for (const d of existing.details) delta.set(d.sodetItemOID, (delta.get(d.sodetItemOID) ?? 0) + Number(d.sodetQTY ?? 0));
    for (const l of lines) delta.set(l.itemId, (delta.get(l.itemId) ?? 0) - l.sodetQTY);

    await this.prisma.$transaction(async (tx) => {
      // An edit is purge-and-replace, so the qty this invoice already took out
      // is available to it again — otherwise re-saving an unchanged cart would
      // fail the check against its own deduction.
      await assertStockAvailable(
        tx,
        lines.map((l) => ({ itemId: l.itemId, qty: l.sodetQTY })),
        existing.details.map((d) => ({ itemId: d.sodetItemOID, qty: Number(d.sodetQTY ?? 0) })),
      );
      await tx.t_SODet.deleteMany({ where: { t_SOMstr_id: id } });
      await tx.t_SOMstr.update({
        where: { id },
        data: {
          somstrTotalAmt: totalAmount,
          somstrDiscAmt: discountAmount,
          somstrNetAmt: netAmount,
          somstrCustomerpay: customerPay,
          somstrChange: changeAmount,
          // 'Multiple' when the edit leaves the bill split.
          mtype: tender.mode,
          // Bank and card describe a SINGLE tender, so both are cleared unless
          // exactly one row remains — that also handles Card→Cash and
          // split→single edits without leaving a stale value behind.
          soMstrMBank: tender.rows.length === 1 ? (tender.rows[0].bankId ?? null) : null,
          soMstrCardNo: tender.rows.length === 1 ? (tender.rows[0].cardNo ?? null) : null,
          soMstrPaidAmt: tender.settled,
          soMstrDueAmt: tender.due,
          soMstrPaymentStatus: tender.due > 0 ? 'PARTIAL' : 'PAID',
          // Purge-and-replace, the same shape the lines use: an edit restates
          // how the bill was settled rather than merging into what was there.
          payments: {
            deleteMany: {},
            create: tender.rows.map((t) => ({
              method: t.method,
              amount: t.amount,
              bankId: t.bankId ?? null,
              cardNo: t.cardNo ?? null,
              transactionRef: t.transactionRef ?? null,
              createdAt: new Date(),
            })),
          },
          customerId: customer?.id ?? null,
          // Mandatory audit trail for the Daily Final Report Sales Correction section.
          soMstrModifyRemarks: dto.modifyRemarks,
          // Discount audit — the picked customer, kept in step with the
          // (re-applied) discount. Same fallback order as a new sale.
          soMstrDiscountRemarks: discountAmount > 0 ? (customer?.name ?? dto.discountRemarks ?? null) : null,
          soMstrDiscountContact: discountAmount > 0 ? (customer?.mobile ?? dto.discountContact ?? null) : null,
          somstrUpdateBy: userName,
          somstrUpdateDate: new Date(),
          details: {
            create: pricedLines.map((l, idx) => ({
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
      });
      for (const [itemId, qty] of delta) {
        if (!qty) continue;
        await tx.inventory.updateMany({ where: { itemId }, data: { quantity: { increment: qty } } });
      }
    });

    return this.findOne(id);
  }

  /** Delete a POS sale (cascade): removes t_SODet + t_SOMstr and restores the
   *  deducted stock back to inventory. Atomic. */
  async remove(id: string) {
    const existing = await this.prisma.t_SOMstr.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new NotFoundException(`Invoice ${id} not found`);

    await this.prisma.$transaction(async (tx) => {
      for (const d of existing.details) {
        const q = Number(d.sodetQTY ?? 0);
        if (q) await tx.inventory.updateMany({ where: { itemId: d.sodetItemOID }, data: { quantity: { increment: q } } });
      }
      await tx.t_SODet.deleteMany({ where: { t_SOMstr_id: id } });
      await tx.t_SOMstr.delete({ where: { id } });
    });

    return { message: 'Sale deleted successfully' };
  }
}
