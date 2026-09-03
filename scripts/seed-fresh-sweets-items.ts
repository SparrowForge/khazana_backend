/**
 * Loads the Fresh Sweets catalogue into Item_Information.
 *
 * Every item shares the same attributes — category "Fresh Sweets", type FG,
 * UOM KG, active, discount applicable — so only code and name vary below.
 *
 * Stored values follow what the item form actually writes, not the labels it
 * shows:
 *   - itmCategory holds the category NAME ("Fresh Sweets"), because the
 *     Category picker uses `c.name ?? c.code` as its option value. The matching
 *     Item_Category row is code "Sweets" / name "Fresh Sweets".
 *   - itmType holds the short CODE ("FG"). Storing the label instead would
 *     leave the Item Type dropdown blank when the item is reopened.
 *   - itmUOM holds the UOM CODE ("KG") — see useUomOptions.
 *
 * Re-runnable: skipDuplicates means an item code already present is left alone,
 * so this never overwrites an item someone has since edited.
 *
 *   npx ts-node --transpile-only --project tsconfig.json scripts/seed-fresh-sweets-items.ts
 */
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const CATEGORY = 'Fresh Sweets';
const TYPE = 'FG';
const UOM = 'KG';

const ITEMS: [string, string][] = [
  ['S-1001', 'Apple Sandesh'],
  ['S-1002', 'Assorted Box (Pcs)'],
  ['S-1003', 'Balu Sai'],
  ['S-1004', 'Black Cherry'],
  ['S-1005', 'Cham Cham'],
  ['S-1006', 'Chanar Jelabi'],
  ['S-1007', 'Chanar Laddu'],
  ['S-1008', 'Chocolate Barfi'],
  ['S-1009', 'Cream Jam'],
  ['S-1010', 'Cup Doi (Hari)'],
  ['S-1011', 'Cup Rabri'],
  ['S-1012', 'Date & Honey Laddu'],
  ['S-1013', 'Delhi Cham Cham'],
  ['S-1014', 'Doi (Big)'],
  ['S-1015', 'Dry Rosogolla'],
  ['S-1016', 'Gulab Jamun'],
  ['S-1017', 'Gulab Jamun (Can)'],
  ['S-1018', 'Gurer Kacha Golla'],
  ['S-1019', 'Gurer Kala Kand'],
  ['S-1020', 'Gurer Rosogolla'],
  ['S-1021', 'Gurer Sandesh (Big)'],
  ['S-1022', 'Hari Vanga (Box)'],
  ['S-1023', 'Irani Bhog'],
  ['S-1024', 'Kacha Chana'],
  ['S-1025', 'Kaju Barfi'],
  ['S-1026', 'Kala Kand'],
  ['S-1027', 'Kalo Jam'],
  ['S-1028', "Khazana's Sp Rasmalai"],
  ['S-1029', 'Khir Malai Curry'],
  ['S-1030', 'Laccha Semai (500gm)'],
  ['S-1031', 'Lal Cham Cham'],
  ['S-1032', 'Malai Chop'],
  ['S-1033', 'Malai Kari'],
  ['S-1034', 'Malai Pastry (Box)'],
  ['S-1035', 'Malai Toast'],
  ['S-1036', 'Mawa Laddu'],
  ['S-1037', 'Mihi Dana Rabri (Big)'],
  ['S-1038', 'Milk Cake'],
  ['S-1039', 'Mini Singara (200gm)'],
  ['S-1040', 'Moti Pak'],
  ['S-1041', 'Motichur Ka Laddu'],
  ['S-1042', 'Pera'],
  ['S-1043', 'Ras Malai'],
  ['S-1044', 'Rosogolla'],
  ['S-1045', 'Shor Malai Box'],
  ['S-1046', 'Small Nimki Jar (250gm)'],
  ['S-1047', 'Soan Papri (200gm) Pkt'],
  ['S-1048', 'Soan Papri (500gm) Pkt'],
];

async function main() {
  const codes = ITEMS.map(([code]) => code);
  const before = await prisma.item_Information.findMany({
    where: { itmCode: { in: codes } },
    select: { itmCode: true },
  });
  if (before.length) {
    console.log(`${before.length} of ${ITEMS.length} codes already exist — those are left untouched.`);
  }

  const result = await prisma.item_Information.createMany({
    data: ITEMS.map(([itmCode, itmName]) => ({
      itmCode,
      itmName,
      itmCategory: CATEGORY,
      itmType: TYPE,
      itmUOM: UOM,
      isActive: 'Y',
      isDiscountApplicable: true,
    })),
    skipDuplicates: true,
  });
  console.log(`inserted ${result.count} item(s)`);

  const after = await prisma.item_Information.findMany({
    where: { itmCode: { in: codes } },
    select: { itmCode: true, itmName: true, itmCategory: true, itmType: true, itmUOM: true, isActive: true, isDiscountApplicable: true },
    orderBy: { itmCode: 'asc' },
  });
  console.log(`${after.length} of ${ITEMS.length} present after the run`);
  const odd = after.filter(
    (r) =>
      r.itmCategory !== CATEGORY ||
      r.itmType !== TYPE ||
      r.itmUOM !== UOM ||
      r.isActive !== 'Y' ||
      r.isDiscountApplicable !== true,
  );
  if (odd.length) {
    console.log('rows not matching the requested attributes:');
    console.table(odd);
  } else {
    console.log('all rows carry category/type/UOM/active/discount as requested');
  }
  console.table(after.slice(0, 5));
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
