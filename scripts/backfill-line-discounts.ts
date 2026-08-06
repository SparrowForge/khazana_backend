/**
 * Backfill: push already-saved invoice-level discounts down onto detail lines.
 *
 * Documents saved before the line-distribution change kept the whole discount on
 * the master row, leaving every detail line at full price. Item-level reports
 * read the lines, so those baskets still add up to more than they were sold for.
 * This walks the three ledgers that take a whole-document discount and writes
 * each line's share, using the same `allocateDiscount` rule the services now
 * apply at save time — so a backfilled document is indistinguishable from one
 * saved today.
 *
 *   t_SOMstr / t_SODet            → SODet_Discount, SODet_NetAmount
 *   CSMaster / CSDetail           → InvDisc
 *   OrderReceive_Master / _Detail → Discount (and Amount / VatPrice when unset)
 *
 * Idempotent: a document whose lines already carry the full discount is skipped,
 * so re-running changes nothing.
 *
 * Run after prisma/migrations/line_discount_distribution.sql:
 *   npx ts-node --transpile-only -P tsconfig.json scripts/backfill-line-discounts.ts
 *
 * Pass --dry to report what would change without writing.
 */
import { PrismaClient } from '../src/generated/prisma';
import { allocateDiscount } from '../src/common/helpers/discount.helper';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

const r2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): number => Number(v ?? 0);
/** Rounding noise, not a real shortfall — below this a document is "done". */
const EPSILON = 0.005;

async function backfillPosSales(): Promise<{ scanned: number; changed: number }> {
  const sales = await prisma.t_SOMstr.findMany({
    where: { somstrDiscAmt: { gt: 0 } },
    include: { details: true },
  });

  let changed = 0;
  for (const sale of sales) {
    const discount = num(sale.somstrDiscAmt);
    const onLines = r2(sale.details.reduce((s, d) => s + num(d.sodetDiscount), 0));
    const pending = r2(discount - onLines);
    if (pending <= EPSILON || !sale.details.length) continue;

    // The percent was charged on the VAT-inclusive value, so that is the base
    // the share is apportioned on — the same base persistSale uses.
    const bases = sale.details.map((d) => r2(num(d.sodetAmount) + num(d.sodetVATAmount)));
    const shares = allocateDiscount(bases, pending);

    console.log(
      `  ${sale.somstrCode ?? sale.id}: ${discount} over ${sale.details.length} line(s) → ${shares.join(', ')}`,
    );
    if (!DRY) {
      await prisma.$transaction(
        sale.details.map((d, i) =>
          prisma.t_SODet.update({
            where: { id: d.id },
            data: {
              sodetDiscount: r2(num(d.sodetDiscount) + shares[i]),
              sodetNetAmount: r2(bases[i] - num(d.sodetDiscount) - shares[i]),
            },
          }),
        ),
      );
    }
    changed++;
  }
  return { scanned: sales.length, changed };
}

async function backfillCreditSales(): Promise<{ scanned: number; changed: number }> {
  const sales = await prisma.cSMaster.findMany({
    where: { totalDiscount: { gt: 0 } },
    include: { details: true },
  });

  let changed = 0;
  for (const sale of sales) {
    // TotalDiscount is the per-line discounts plus the invoice-level amount, so
    // what is missing from the lines is exactly the invoice-level part.
    const lineDiscount = r2(sale.details.reduce((s, d) => s + num(d.disc), 0));
    const pending = r2(num(sale.totalDiscount) - lineDiscount);
    if (pending <= EPSILON || !sale.details.length) continue;

    // Apportioned by (total + vat) — the same base the service uses, and one
    // these rows still carry because `total` is never netted down.
    const bases = sale.details.map((d) => r2(num(d.total) + num(d.vat)));
    const shares = allocateDiscount(bases, pending);

    console.log(`  ${sale.invNo}: ${pending} over ${sale.details.length} line(s) → ${shares.join(', ')}`);
    if (!DRY) {
      await prisma.$transaction(
        sale.details.map((d, i) =>
          prisma.cSDetail.update({
            where: { id: d.id },
            data: { disc: r2(num(d.disc) + shares[i]) },
          }),
        ),
      );
    }
    changed++;
  }
  return { scanned: sales.length, changed };
}

async function backfillOrders(): Promise<{ scanned: number; changed: number }> {
  const orders = await prisma.orderReceive_Master.findMany({
    where: { discount: { gt: 0 } },
    include: { details: true },
  });

  // Orders saved before the change stored neither Amount nor VatPrice, so the
  // VAT-inclusive base has to be re-priced from the catalog to apportion on.
  const itemIds = [...new Set(orders.flatMap((o) => o.details.map((d) => d.itemId ?? '')).filter(Boolean))];
  const priced = itemIds.length
    ? await prisma.item_Information.findMany({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          prices: { where: { priceIsActive: 1 }, orderBy: { priceFromDate: 'desc' }, select: { priceVatPercent: true }, take: 1 },
        },
      })
    : [];
  const vatPct = new Map(priced.map((p) => [p.id, num(p.prices[0]?.priceVatPercent)]));

  let changed = 0;
  for (const order of orders) {
    const onLines = r2(order.details.reduce((s, d) => s + num(d.discount), 0));
    if (onLines > EPSILON || !order.details.length) continue;

    const lines = order.details.map((d) => {
      const amount = num(d.amount) || r2(num(d.qty) * num(d.unitPrice));
      const vatPrice = num(d.vatPrice) || r2((amount * (vatPct.get(d.itemId ?? '') ?? 0)) / 100);
      return { detail: d, amount, vatPrice };
    });

    const bases = lines.map((l) => r2(l.amount + l.vatPrice));
    const gross = r2(bases.reduce((s, b) => s + b, 0));
    const pct = Math.min(Math.max(num(order.discount), 0), 100);
    const orderDiscount = Math.min(r2((gross * pct) / 100), gross);
    if (orderDiscount <= EPSILON) continue;
    const shares = allocateDiscount(bases, orderDiscount);

    console.log(`  ${order.serialNo ?? order.id}: ${pct}% = ${orderDiscount} over ${lines.length} line(s) → ${shares.join(', ')}`);
    if (!DRY) {
      await prisma.$transaction(
        lines.map((l, i) =>
          prisma.orderReceive_Detail.update({
            where: { id: l.detail.id },
            data: { amount: l.amount, vatPrice: l.vatPrice, discount: shares[i] },
          }),
        ),
      );
    }
    changed++;
  }
  return { scanned: orders.length, changed };
}

async function main() {
  if (DRY) console.log('DRY RUN — nothing will be written\n');

  console.log('POS / cash sales (t_SOMstr):');
  const pos = await backfillPosSales();
  console.log(`  ${pos.changed} of ${pos.scanned} discounted invoice(s) updated\n`);

  console.log('Credit sales (CSMaster):');
  const credit = await backfillCreditSales();
  console.log(`  ${credit.changed} of ${credit.scanned} discounted invoice(s) updated\n`);

  console.log('Orders (OrderReceive_Master):');
  const orders = await backfillOrders();
  console.log(`  ${orders.changed} of ${orders.scanned} discounted order(s) updated\n`);

  console.log(`Done — ${pos.changed + credit.changed + orders.changed} document(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
