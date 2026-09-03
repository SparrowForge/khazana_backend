/**
 * Loads selling prices for the Fresh Sweets catalogue into t_Price.
 *
 * The figures below are the VAT-EXCLUSIVE list prices — what t_Price.
 * Price_ListPrice holds. Every one carries 10% VAT, so the shelf price the
 * customer pays (the MRP column on the Price Setup page) is list x 1.10:
 * 1,181.82 -> 1,300.00, 590.91 -> 650.00, and so on.
 *
 * Mirrors PricingService#createPrice: an item's previously active price is
 * deactivated (priceIsActive = 0) rather than overwritten, so invoices already
 * raised keep the rate they were billed at. Re-runnable — an item that already
 * carries an identical active price is left completely alone, so running this
 * twice does not stack duplicate history rows.
 *
 *   npx ts-node --transpile-only --project tsconfig.json scripts/seed-fresh-sweets-prices.ts
 */
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const VAT_PERCENT = 10;
const FROM_DATE = new Date('2026-09-03T00:00:00.000Z');
const TO_DATE = new Date('2099-12-31T00:00:00.000Z');
const CREATOR = 'catalogue-load';

/** [item code, VAT-exclusive list price] */
const PRICES: [string, number][] = [
  ['S-1002', 1181.82],
  ['S-1003', 590.91],
  ['S-1004', 727.27],
  ['S-1005', 863.64],
  ['S-1006', 727.27],
  ['S-1007', 1363.64],
  ['S-1008', 1727.27],
  ['S-1009', 863.64],
  ['S-1010', 136.36],
  ['S-1011', 136.36],
  ['S-1012', 2727.27],
  ['S-1013', 1272.73],
  ['S-1014', 636.36],
  ['S-1015', 681.82],
  ['S-1016', 909.09],
  ['S-1017', 727.27],
  ['S-1018', 1136.36],
  ['S-1019', 1181.82],
  ['S-1020', 772.73],
  ['S-1021', 1272.73],
  ['S-1022', 545.45],
  ['S-1023', 1090.91],
  ['S-1024', 1181.82],
  ['S-1025', 2909.09],
  ['S-1026', 1136.36],
  ['S-1027', 727.27],
  ['S-1028', 1000.0],
  ['S-1029', 909.09],
  ['S-1030', 454.55],
  ['S-1031', 681.82],
  ['S-1032', 954.55],
  ['S-1033', 954.55],
  ['S-1034', 590.91],
  ['S-1035', 1363.64],
  ['S-1036', 1000.0],
  ['S-1037', 1000.0],
  ['S-1038', 1272.73],
  ['S-1039', 181.82],
  ['S-1040', 909.09],
  ['S-1041', 863.64],
  ['S-1042', 1272.73],
  ['S-1043', 863.64],
  ['S-1044', 636.36],
  ['S-1045', 500.0],
  ['S-1046', 181.82],
  ['S-1047', 272.73],
  ['S-1048', 636.36],
];

const sameDay = (a: Date | null, b: Date) => !!a && a.getTime() === b.getTime();

async function main() {
  const codes = PRICES.map(([code]) => code);
  const items = await prisma.item_Information.findMany({
    where: { itmCode: { in: codes } },
    select: { id: true, itmCode: true },
  });
  const idByCode = new Map(items.map((i) => [i.itmCode, i.id]));

  const unknown = codes.filter((c) => !idByCode.has(c));
  if (unknown.length) {
    throw new Error(`No item for code(s): ${unknown.join(', ')} — load the catalogue first`);
  }

  let created = 0;
  let skipped = 0;
  let superseded = 0;

  for (const [code, listPrice] of PRICES) {
    const itemId = idByCode.get(code)!;
    const active = await prisma.t_Price.findMany({ where: { priceItemOId: itemId, priceIsActive: 1 } });

    const identical = active.find(
      (p) =>
        Number(p.priceListPrice) === listPrice &&
        Number(p.priceVatPercent) === VAT_PERCENT &&
        sameDay(p.priceFromDate, FROM_DATE) &&
        sameDay(p.priceToDate, TO_DATE),
    );
    if (identical) {
      skipped += 1;
      continue;
    }

    if (active.length) {
      // Retire the old rate rather than editing it — see PricingService.
      await prisma.t_Price.updateMany({
        where: { priceItemOId: itemId, priceIsActive: 1 },
        data: { priceIsActive: 0 },
      });
      superseded += active.length;
    }

    await prisma.t_Price.create({
      data: {
        priceItemOId: itemId,
        priceFromDate: FROM_DATE,
        priceToDate: TO_DATE,
        priceListPrice: listPrice,
        priceVatPercent: VAT_PERCENT,
        priceIsActive: 1,
        priceCreator: CREATOR,
        priceCreationDate: new Date(),
      },
    });
    created += 1;
  }

  console.log(`created ${created}, unchanged ${skipped}, superseded ${superseded} older active row(s)`);

  // Read back through the same join the Price Setup page uses.
  const rows = await prisma.t_Price.findMany({
    where: { priceIsActive: 1, item: { itmCode: { in: codes } } },
    include: { item: { select: { itmCode: true, itmName: true } } },
    orderBy: { item: { itmCode: 'asc' } },
  });
  console.log(`${rows.length} of ${PRICES.length} items now carry an active price`);

  const wrong: typeof rows = [];
  const mrp = (list: number, vat: number) => Math.round(list * (1 + vat / 100) * 100) / 100;
  const expected = new Map(PRICES);
  for (const r of rows) {
    const want = expected.get(r.item!.itmCode);
    if (want === undefined || Number(r.priceListPrice) !== want || Number(r.priceVatPercent) !== VAT_PERCENT) {
      wrong.push(r);
    }
  }
  if (wrong.length) {
    console.log('rows that do not match the requested figures:');
    console.table(wrong.map((r) => ({ code: r.item!.itmCode, list: r.priceListPrice, vat: r.priceVatPercent })));
  } else {
    console.log('every active price matches the requested list price and 10% VAT');
  }

  console.table(
    rows.slice(0, 6).map((r) => ({
      code: r.item!.itmCode,
      name: r.item!.itmName,
      list: Number(r.priceListPrice),
      vat: Number(r.priceVatPercent),
      MRP: mrp(Number(r.priceListPrice), Number(r.priceVatPercent)),
    })),
  );

  const unpriced = await prisma.item_Information.findMany({
    where: { itmCategory: 'Fresh Sweets', prices: { none: { priceIsActive: 1 } } },
    select: { itmCode: true, itmName: true },
    orderBy: { itmCode: 'asc' },
  });
  if (unpriced.length) {
    console.log(`\n${unpriced.length} Fresh Sweets item(s) still have NO active price:`);
    console.table(unpriced);
  }
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
