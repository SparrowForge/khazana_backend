import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateCashSaleDto } from './dto/create-cash-sale.dto';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';
import { CreateVatCashSaleDto } from './dto/create-vat-cash-sale.dto';
import { CreateVatCreditSaleDto } from './dto/create-vat-credit-sale.dto';
import { SalesQueryDto } from './dto/sales-query.dto';
import { UpdateSalesDto } from './dto/update-sales.dto';
import { allocateDiscount, assertStockAvailable, buildPaginationMeta, roundPayable, toBranchUuid, branchScope } from '../common/helpers';
import { dateRangeFilter } from '../common/dto';
import type { PaginationMeta } from '../common/helpers';
import type { Prisma } from '../generated/prisma';

/** Normalized row for the unified sales report (all sale types in one shape). */
interface UnifiedSale {
  id: string;
  invoiceNo: string;
  date: Date | null;
  type: 'Cash' | 'VAT Cash' | 'Credit' | 'VAT Credit' | 'NC Adjustment';
  netAmount: number;
  customerName: string | null;
}

/** Money rounding — 2dp, the same rounding the sale forms apply client-side. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

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

    await this.deductStock(this.prisma, dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
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

    // A credit sale ships the goods now and collects later, so it moves stock
    // exactly like a cash sale: check availability, write, deduct — all in one
    // transaction so a concurrent sale can't slip through on the same units.
    const stockLines = dto.items.map((i) => ({ itemId: i.itemId, qty: i.qty }));
    const detailLines = await this.distributeInvoiceDiscount(dto.items, dto.discountPercent ?? 0);
    const sale = await this.prisma.$transaction(async (tx) => {
      await assertStockAvailable(tx, stockLines);
      const created = await tx.cSMaster.create({
        data: {
          invNo,
          invDate: new Date(dto.invDate),
          customerId: dto.customerId,
          poNo: dto.poNo,
          branchId,
          totalAmount: dto.totalAmount,
          // totalDiscount is the money value (line discounts + the invoice-level
          // discount); discountPercent is kept so the invoice can be re-rendered
          // and re-edited from the rate it was actually given at.
          totalDiscount: dto.totalDiscount ?? 0,
          discountPercent: dto.discountPercent ?? 0,
          totalVat: dto.totalVat ?? 0,
          discountRemarks: dto.discountRemarks,
          isActive: 1,
          invoiceBy: userName,
          createDate: new Date(),
          details: { create: detailLines },
        },
        include: { details: true },
      });
      await this.deductStock(tx, stockLines);
      return created;
    });

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

    await this.deductStock(this.prisma, dto.items.map((i) => ({ itemId: i.itemId, qty: i.quantity })));
    return sale;
  }

  /**
   * Each line's share of the invoice-level discount, apportioned by its
   * VAT-inclusive value — the base the percent was charged on.
   *
   * Deliberately derived from `total` + `vat` alone, and `total` is stored
   * un-netted, so this is exactly as computable when reading a saved invoice
   * back as it was when writing it. That is what lets the share live inside
   * `disc` without being lost: `lineShares` reproduces it on demand, so the read
   * paths can subtract it back out again.
   */
  /**
   * Item ids that may NOT carry a discount, from `Item_Information`.
   *
   * Read as a set of exceptions rather than a flag per line: the flag lives on
   * the item, so a saved invoice re-read later resolves it the same way it did
   * when written, without storing a copy on the line that could go stale.
   */
  private async nonDiscountableItems(itemIds: (string | null | undefined)[]): Promise<Set<string>> {
    const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
    if (!ids.length) return new Set();
    const rows = await this.prisma.item_Information.findMany({
      where: { id: { in: ids }, isDiscountApplicable: false },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  // `vat`/`total` are typed loosely so this takes both the numbers a DTO carries
  // and the Prisma Decimals a loaded row does — Number() normalizes either.
  //
  // A line flagged not discountable is given a base of ZERO, which both keeps it
  // out of the total the percentage is charged on and denies it a share — the
  // item is billed in full. The flag is read off the LINE (stamped at write
  // time), never off the item as it stands now, so reopening an invoice
  // reproduces the split it was actually saved with.
  private lineShares(
    lines: { isDiscountApplicable?: boolean; vat?: unknown; total?: unknown }[],
    discountPercent: number,
  ): number[] {
    const lineGross = lines.map((l) =>
      l.isDiscountApplicable === false ? 0 : r2(Number(l.total ?? 0) + Number(l.vat ?? 0)),
    );
    const gross = r2(lineGross.reduce((s, g) => s + g, 0));
    const pct = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const invoiceDiscount = Math.min(r2((gross * pct) / 100), gross);
    return allocateDiscount(lineGross, invoiceDiscount);
  }

  /**
   * Build a credit sale's CSDetail rows with the invoice-level discount already
   * pushed down onto them.
   *
   * The share is folded into the line's own `disc`, so `sum(disc)` is the whole
   * discount and equals CSMaster.totalDiscount. An item-level sales report reads
   * the lines, and a discount parked on the master alone is invisible there —
   * the item rows then add up to more than the invoice was sold for.
   *
   * `total` is left exactly as entered, NOT reduced by the share. It is the
   * allocation base, so netting it here would destroy the only record of what
   * the split was apportioned on and make the fold irreversible — reopening the
   * invoice would then re-apply the percent on top of itself. Left alone, the
   * split is recomputed on read by `lineShares` and subtracted back out.
   */
  private async distributeInvoiceDiscount(
    items: { itemId: string; rate: number; qty: number; disc?: number; vat?: number; total: number }[],
    discountPercent: number,
  ) {
    // Resolved once, here at write time, and then stamped on every line — the
    // read paths use the stamp, not another lookup.
    const excluded = await this.nonDiscountableItems(items.map((i) => i.itemId));
    const stamped = items.map((item) => ({
      ...item,
      isDiscountApplicable: !excluded.has(item.itemId),
    }));
    const shares = this.lineShares(stamped, discountPercent);

    return stamped.map((item, i) => ({
      itemOId: item.itemId,
      rate: item.rate,
      qty: item.qty,
      value: r2(Number(item.rate ?? 0) * Number(item.qty ?? 0)),
      disc: r2(Number(item.disc ?? 0) + shares[i]),
      vat: item.vat ?? 0,
      total: r2(Number(item.total ?? 0)),
      isDiscountApplicable: item.isDiscountApplicable,
    }));
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
            itemOId: item.itemId,
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
  async findAll(query: SalesQueryDto, accessibleBranchIds?: string[]): Promise<{ items: object[]; meta: PaginationMeta }> {
    const { page, limit, type, branchId, fromDate, toDate } = query;
    // One scope fragment reused across all four sale ledgers, which each carry
    // the same `branchId` column.
    const scope = branchScope(accessibleBranchIds, ['branchId'], branchId);
    const all = !type || type === 'all';
    const num = (v: unknown): number => (v == null ? 0 : Number(v));
    // One range, applied to whichever date column each source uses.
    const range = dateRangeFilter(fromDate, toDate);
    const saleDate = range ? { somstrDate: range } : {};
    const invDate = range ? { invDate: range } : {};

    const rows: UnifiedSale[] = [];

    if (all || type === 'cash') {
      const cash = await this.prisma.t_SOMstr.findMany({
        where: { somstrIsActive: true, ...scope, ...saleDate },
        select: { id: true, somstrCode: true, somstrDate: true, somstrNetAmt: true },
      });
      for (const r of cash)
        rows.push({ id: r.id, invoiceNo: r.somstrCode ?? '', date: r.somstrDate, type: 'Cash', netAmount: num(r.somstrNetAmt), customerName: null });
    }

    if (all || type === 'vat-cash') {
      const vcash = await this.prisma.t_SOMstV.findMany({
        where: { somstrIsActive: true, ...scope, ...saleDate },
        select: { id: true, somstrCode: true, somstrDate: true, somstrNetAmt: true },
      });
      for (const r of vcash)
        rows.push({ id: r.id, invoiceNo: r.somstrCode ?? '', date: r.somstrDate, type: 'VAT Cash', netAmount: num(r.somstrNetAmt), customerName: null });
    }

    if (all || type === 'credit') {
      const credit = await this.prisma.cSMaster.findMany({
        where: { isActive: 1, ...scope, ...invDate },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true, customer: { select: { name: true } } },
      });
      for (const r of credit)
        rows.push({ id: r.id, invoiceNo: r.invNo, date: r.invDate, type: 'Credit', netAmount: num(r.totalAmount) + num(r.totalVat) - num(r.totalDiscount), customerName: r.customer?.name ?? null });
    }

    if (all || type === 'vat-credit') {
      const vcredit = await this.prisma.cSVMaster.findMany({
        where: { ...scope, ...invDate },
        select: { id: true, invNo: true, invDate: true, totalAmount: true, totalVat: true, totalDiscount: true, customer: { select: { name: true } } },
      });
      for (const r of vcredit)
        rows.push({ id: r.id, invoiceNo: r.invNo, date: r.invDate, type: 'VAT Credit', netAmount: num(r.totalAmount) + num(r.totalVat) - num(r.totalDiscount), customerName: r.customer?.name ?? null });
    }

    if (all || type === 'nc') {
      const nc = await this.prisma.t_NCMstr.findMany({
        where: { ncmstrIsActive: true, ...(branchId && { branchId }), ...(range && { ncmstrDate: range }) },
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

  // ── Cash sale edit / delete (t_SOMstr + t_SODet, stock keyed by item id) ──

  async updateCashSale(id: string, dto: UpdateSalesDto, userName: string) {
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    const existing = await this.prisma.t_SOMstr.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new BadRequestException('Cash sale not found');
    const branchId = toBranchUuid(existing.branchId);

    // Stock delta (sale deducts): increment by (oldQty − newQty) per item id.
    const delta = new Map<string, number>();
    for (const d of existing.details) if (d.sodetItemOID) delta.set(d.sodetItemOID, (delta.get(d.sodetItemOID) ?? 0) + Number(d.sodetQTY ?? 0));
    for (const it of dto.items) if (it.itemId) delta.set(it.itemId, (delta.get(it.itemId) ?? 0) - it.qty);

    await this.prisma.$transaction(async (tx) => {
      await tx.t_SODet.deleteMany({ where: { t_SOMstr_id: id } });
      await tx.t_SOMstr.update({
        where: { id },
        data: {
          somstrDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          somstrTotalAmt: dto.totalAmount,
          somstrDiscAmt: dto.totalDiscount,
          somstrNetAmt: dto.netAmount,
          somstrCustomerpay: dto.paidAmount,
          somstrChange: dto.changeAmount,
          mtype: dto.paymentMethod ?? undefined,
          somstrUpdateBy: userName,
          somstrUpdateDate: new Date(),
          details: {
            create: dto.items.map((it, i) => ({
              sodetItemSLNum: String(i + 1),
              sodetItemOID: it.itemId!,
              sodetQTY: it.qty,
              sodetPrice: it.rate ?? 0,
              sodetAmount: (it.rate ?? 0) * it.qty,
              sodetDiscount: it.discount ?? 0,
              sodetVATValue: it.vat ?? 0,
              sodetNetAmount: it.total ?? 0,
              branchId,
            })),
          },
        },
      });
      for (const [itemId, q] of delta) if (q) await tx.inventory.updateMany({ where: { itemId }, data: { quantity: { increment: q } } });
    });
    return this.prisma.t_SOMstr.findUnique({ where: { id }, include: { details: true } });
  }

  async removeCashSale(id: string) {
    const existing = await this.prisma.t_SOMstr.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new BadRequestException('Cash sale not found');
    await this.prisma.$transaction(async (tx) => {
      for (const d of existing.details) {
        const q = Number(d.sodetQTY ?? 0);
        if (q && d.sodetItemOID) await tx.inventory.updateMany({ where: { itemId: d.sodetItemOID }, data: { quantity: { increment: q } } });
      }
      await tx.t_SODet.deleteMany({ where: { t_SOMstr_id: id } });
      await tx.t_SOMstr.delete({ where: { id } });
    });
    return { message: 'Cash sale deleted successfully' };
  }

  // ── Credit sale edit / delete (cSMaster + cSDetail; itemOId is a uuid FK) ──

  /** Load a single credit sale shaped for the edit form (master + customer +
   *  detail lines with their item code/name resolved through the uuid FK). */
  async getCreditSale(id: string) {
    const sale = await this.prisma.cSMaster.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        details: { include: { item: { select: { id: true, itmCode: true, itmName: true } } } },
      },
    });
    if (!sale) throw new BadRequestException('Credit sale not found');
    const discountPercent = Number(sale.discountPercent ?? 0);
    // `disc` holds the line discount plus this line's share of the invoice-level
    // percent. The form applies that percent itself, on top of whatever line
    // discounts it is showing — so the share is taken back out here, or every
    // save would charge it again on the last save's result.
    const shares = this.lineShares(sale.details, discountPercent);
    return {
      id: sale.id,
      invoiceNo: sale.invNo,
      invoiceDate: sale.invDate,
      customerId: sale.customerId,
      customerName: sale.customer?.name ?? null,
      poNo: sale.poNo,
      totalAmount: Number(sale.totalAmount ?? 0),
      totalDiscount: Number(sale.totalDiscount ?? 0),
      discountPercent,
      totalVat: Number(sale.totalVat ?? 0),
      items: sale.details.map((d, i) => ({
        itemId: d.itemOId,
        itemCode: d.item?.itmCode ?? '',
        itemName: d.item?.itmName ?? '',
        quantity: Number(d.qty ?? 0),
        rate: Number(d.rate ?? 0),
        discount: Math.max(r2(Number(d.disc ?? 0) - shares[i]), 0),
        vat: Number(d.vat ?? 0),
        total: Number(d.total ?? 0),
      })),
    };
  }

  /** Everything a printable credit-sale invoice needs in one call: the customer's
   *  billing details, the branch letterhead (VAT Reg No / Mushak 6.3), and the
   *  priced lines. CSMaster.branchId has no Prisma relation, so the branch is
   *  looked up separately. */
  /**
   * The customer-facing copy, served without authentication.
   *
   * Everything here reaches anyone holding the link, so the payload is limited
   * to what is printed on the paper invoice the customer already has. The
   * internal row id is dropped: they have it in the URL, and echoing it in the
   * body invites it into logs, screenshots and forwarded pages as a *value*
   * rather than a secret.
   */
  async getPublicCreditSaleInvoice(id: string) {
    const { id: _internalId, ...invoice } = await this.getCreditSaleInvoice(id);
    return invoice;
  }

  async getCreditSaleInvoice(id: string) {
    const sale = await this.prisma.cSMaster.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, code: true, name: true, mobile: true, address: true },
        },
        details: { include: { item: { select: { id: true, itmCode: true, itmName: true, itmUOM: true } } } },
      },
    });
    if (!sale) throw new NotFoundException('Credit sale not found');

    const branch = sale.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: sale.branchId },
          select: { branchCode: true, branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;

    const discountPercent = Number(sale.discountPercent ?? 0);
    // The stored `disc` is both tiers together. The invoice prints them on
    // separate lines ("Item Discount" then "Discount (n%)"), so the same
    // recomputed shares that the edit path backs out are used here to split them
    // apart again.
    const shares = this.lineShares(sale.details, discountPercent);

    const items = sale.details.map((d, i) => ({
      itemCode: d.item?.itmCode ?? '',
      itemName: d.item?.itmName ?? '',
      uom: d.item?.itmUOM ?? '',
      quantity: Number(d.qty ?? 0),
      rate: Number(d.rate ?? 0),
      // The line's own discount, with its share of the invoice-level percent
      // taken back off — that part is reported below as `invoiceDiscount`.
      discount: Math.max(r2(Number(d.disc ?? 0) - shares[i]), 0),
      vat: Number(d.vat ?? 0),
      total: Number(d.total ?? 0),
    }));

    const netAmount = r2(items.reduce((s, i) => s + i.total, 0));
    const totalVat = Number(sale.totalVat ?? 0);
    const grossAmount = r2(netAmount + totalVat);
    // Invoices saved before the lines carried a share left the whole
    // invoice-level amount on the master alone, so their recomputed shares sum
    // to more than `disc` actually holds. `TotalDiscount` has always been both
    // tiers, so falling back to the shortfall against the line discounts covers
    // them; for a distributed invoice the two agree.
    const lineDiscount = r2(items.reduce((s, i) => s + i.discount, 0));
    const storedTotalDiscount = Number(sale.totalDiscount ?? 0);
    const invoiceDiscount = Math.min(
      Math.max(r2(storedTotalDiscount - lineDiscount), 0),
      grossAmount,
    );
    // Rounded to the whole taka, the same as a POS bill. A credit sale stores no
    // payable column — every consumer derives it — so the rounding is applied
    // here and in the two other places a customer is shown what they owe (the
    // ledger and the statement), and NOT to the stored line/master columns,
    // which item-level reporting reads.
    const payableAmount = roundPayable(grossAmount - invoiceDiscount);
    // A credit sale is unpaid at issue — the only money already collected is the
    // advance on the order it was raised against (PO No carries the order no).
    const paidAmount = await this.orderAdvanceFor(sale.poNo);

    return {
      id: sale.id,
      invoiceNo: sale.invNo,
      invoiceDate: sale.invDate,
      poNo: sale.poNo,
      invoiceBy: sale.invoiceBy,
      customer: sale.customer
        ? {
            code: sale.customer.code,
            name: sale.customer.name,
            mobile: sale.customer.mobile,
            address: sale.customer.address,
          }
        : null,
      branch: branch
        ? {
            code: branch.branchCode,
            name: branch.branchName,
            address: branch.address,
            vatNo: branch.vatNo,
            mobileNo: branch.mobileNo,
          }
        : null,
      items,
      totalAmount: Number(sale.totalAmount ?? 0),
      totalDiscount: Number(sale.totalDiscount ?? 0),
      lineDiscount,
      discountPercent,
      invoiceDiscount,
      totalVat,
      netAmount,
      grossAmount,
      payableAmount,
      paidAmount,
      dueAmount: r2(payableAmount - paidAmount),
    };
  }

  /** Advance already taken on the order a credit sale was raised against, or 0
   *  when the invoice carries no PO No / matches no order. */
  private async orderAdvanceFor(poNo?: string | null): Promise<number> {
    if (!poNo) return 0;
    const order = await this.prisma.orderReceive_Master.findFirst({
      where: { serialNo: poNo },
      select: { advance: true },
    });
    return Number(order?.advance ?? 0);
  }

  /** VAT credit sale invoice for printing. `CSVDetail.itemOId` has no Prisma
   *  relation defined (unlike CSDetail), so items are resolved with a
   *  separate batch lookup against Item_Information instead of an include. */
  async getVatCreditSaleInvoice(id: string) {
    const sale = await this.prisma.cSVMaster.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, code: true, name: true, mobile: true, address: true },
        },
        details: true,
      },
    });
    if (!sale) throw new NotFoundException('VAT credit sale not found');

    const itemIds = [...new Set(sale.details.map((d) => d.itemOId).filter((v): v is string => !!v))];
    const itemRows = itemIds.length
      ? await this.prisma.item_Information.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, itmCode: true, itmName: true, itmUOM: true },
        })
      : [];
    const itemById = new Map(itemRows.map((i) => [i.id, i]));

    const branch = sale.branchId
      ? await this.prisma.branch.findUnique({
          where: { id: sale.branchId },
          select: { branchCode: true, branchName: true, address: true, vatNo: true, mobileNo: true },
        })
      : null;

    const items = sale.details.map((d) => {
      const item = d.itemOId ? itemById.get(d.itemOId) : undefined;
      return {
        itemCode: item?.itmCode ?? '',
        itemName: item?.itmName ?? '',
        uom: item?.itmUOM ?? '',
        quantity: Number(d.qty ?? 0),
        rate: Number(d.rate ?? 0),
        discount: Number(d.disc ?? 0),
        vat: Number(d.vat ?? 0),
        total: Number(d.total ?? 0),
      };
    });

    const netAmount = items.reduce((s, i) => s + i.total, 0);
    const totalVat = Number(sale.totalVat ?? 0);

    return {
      id: sale.id,
      invoiceNo: sale.invNo,
      invoiceDate: sale.invDate,
      poNo: sale.poNo,
      invoiceBy: sale.invoiceBy,
      customer: sale.customer
        ? {
            code: sale.customer.code,
            name: sale.customer.name,
            mobile: sale.customer.mobile,
            address: sale.customer.address,
          }
        : null,
      branch: branch
        ? {
            code: branch.branchCode,
            name: branch.branchName,
            address: branch.address,
            vatNo: branch.vatNo,
            mobileNo: branch.mobileNo,
          }
        : null,
      items,
      totalAmount: Number(sale.totalAmount ?? 0),
      totalDiscount: Number(sale.totalDiscount ?? 0),
      totalVat,
      netAmount,
      payableAmount: netAmount + totalVat,
    };
  }

  async updateCreditSale(id: string, dto: UpdateSalesDto) {
    if (!dto.items?.length) throw new BadRequestException('At least one item is required');
    const existing = await this.prisma.cSMaster.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new BadRequestException('Credit sale not found');

    // Stock delta (a credit sale deducts): increment by (oldQty − newQty) per
    // item, the same shape updateCashSale uses.
    const released = existing.details.map((d) => ({ itemId: d.itemOId, qty: Number(d.qty ?? 0) }));
    const delta = new Map<string, number>();
    for (const d of released) if (d.itemId) delta.set(d.itemId, (delta.get(d.itemId) ?? 0) + d.qty);
    for (const it of dto.items) if (it.itemId) delta.set(it.itemId, (delta.get(it.itemId) ?? 0) - it.qty);

    // The replacement lines, with the invoice-level discount already pushed down
    // and each line stamped with whether it took part. Built before the
    // transaction opens: it reads Item_Information, and holding a transaction
    // open across an unrelated read only widens the window for a conflict.
    const detailLines = (
      await this.distributeInvoiceDiscount(
        dto.items.map((it) => ({
          itemId: it.itemId ?? '',
          rate: it.rate ?? 0,
          qty: it.qty,
          disc: it.discount ?? 0,
          vat: it.vat ?? 0,
          total: it.total ?? 0,
        })),
        dto.discountPercent ?? 0,
      )
    ).map((l) => ({ ...l, itemOId: l.itemOId || null }));

    // Purge-and-replace: master fields are updated in place; detail lines are
    // dropped and recreated. CSDetail.itemOId is a uuid FK — the UI sends each
    // line's Item_Information UUID in itemId, stored straight through.
    await this.prisma.$transaction(async (tx) => {
      // Judged against (on hand + what this invoice already took out), so
      // re-saving an unchanged invoice isn't blocked by its own deduction.
      await assertStockAvailable(
        tx,
        dto.items.map((it) => ({ itemId: it.itemId, qty: it.qty })),
        released,
      );
      await tx.cSDetail.deleteMany({ where: { invNo: existing.invNo } });
      await tx.cSMaster.update({
        where: { id },
        data: {
          invDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          customerId: dto.customerId ?? undefined,
          poNo: dto.poNo ?? undefined,
          totalAmount: dto.totalAmount,
          totalDiscount: dto.totalDiscount,
          discountPercent: dto.discountPercent,
          totalVat: dto.totalVat,
          details: {
            // Same push-down as create — the replacement lines carry the
            // invoice-level discount, not the master alone.
            create: detailLines,
          },
        },
      });
      for (const [itemId, q] of delta) {
        if (q) await tx.inventory.updateMany({ where: { itemId }, data: { quantity: { increment: q } } });
      }
    });
    return this.prisma.cSMaster.findUnique({ where: { id }, include: { details: true } });
  }

  async removeCreditSale(id: string) {
    const existing = await this.prisma.cSMaster.findUnique({ where: { id }, include: { details: true } });
    if (!existing) throw new BadRequestException('Credit sale not found');
    await this.prisma.$transaction(async (tx) => {
      for (const d of existing.details) {
        const q = Number(d.qty ?? 0);
        if (q && d.itemOId) await tx.inventory.updateMany({ where: { itemId: d.itemOId }, data: { quantity: { increment: q } } });
      }
      await tx.cSDetail.deleteMany({ where: { invNo: existing.invNo } });
      await tx.cSMaster.delete({ where: { id } });
    });
    return { message: 'Credit sale deleted successfully' };
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Takes the client so the deduction runs in the same transaction as the sale
   *  it belongs to (and the availability check that cleared it). */
  private async deductStock(db: Prisma.TransactionClient, items: { itemId: string; qty: number }[]) {
    for (const i of items) {
      await db.inventory.updateMany({
        where: { itemId: i.itemId },
        data: { quantity: { decrement: i.qty } },
      });
    }
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
