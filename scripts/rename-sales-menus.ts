/**
 * Menu rename + removal, applied to the live Menu table.
 *
 *   POS Terminal -> Cash Sales          (controlName POSTerminal)
 *   POS Sales    -> Cash Sales List     (controlName POSSales)
 *   Sales List   -> Credit Sales List   (controlName SalesList)
 *   Cash Sales   -> DELETED             (controlName CashSales)
 *
 * Only `menuName` changes — the controlName is what @RequiredPermission and the
 * frontend navRegistry key on, so renaming those would silently revoke every
 * role's access to the page. Display name only.
 *
 * The old CashSales row has to go before POSTerminal can take its name, and its
 * Permission rows go with it (nothing cascades them automatically). Its screen
 * and its /sales/cash endpoints were removed in the same change.
 *
 * Re-runnable: each step is skipped when it has already been applied.
 *
 *   npx ts-node --transpile-only --project tsconfig.json scripts/rename-sales-menus.ts
 */
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const RENAMES: { controlName: string; from: string; to: string }[] = [
  { controlName: 'POSTerminal', from: 'POS Terminal', to: 'Cash Sales' },
  { controlName: 'POSSales', from: 'POS Sales', to: 'Cash Sales List' },
  { controlName: 'SalesList', from: 'Sales List', to: 'Credit Sales List' },
];

const DROP = 'CashSales';

async function main() {
  // Drop first: POSTerminal cannot take the name while the old row still holds it.
  const dead = await prisma.menu.findFirst({ where: { controlName: DROP } });
  if (dead) {
    const perms = await prisma.permission.deleteMany({ where: { menuId: dead.id } });
    await prisma.menu.delete({ where: { id: dead.id } });
    console.log(`deleted menu "${dead.menuName}" (${DROP}) and ${perms.count} permission row(s)`);
  } else {
    console.log(`no ${DROP} menu row — already removed`);
  }

  for (const r of RENAMES) {
    const row = await prisma.menu.findFirst({ where: { controlName: r.controlName } });
    if (!row) {
      console.log(`! ${r.controlName}: no menu row found`);
      continue;
    }
    if (row.menuName === r.to) {
      console.log(`= ${r.controlName}: already "${r.to}"`);
      continue;
    }
    await prisma.menu.update({ where: { id: row.id }, data: { menuName: r.to } });
    console.log(`~ ${r.controlName}: "${row.menuName}" -> "${r.to}"`);
  }

  const after = await prisma.menu.findMany({
    where: { controlName: { in: [...RENAMES.map((r) => r.controlName), DROP] } },
    orderBy: { menuName: 'asc' },
  });
  console.log('\nresulting rows:');
  console.table(after.map((m) => ({ menuName: m.menuName, controlName: m.controlName, parent: m.parentMenu })));

  const orphanPerms = await prisma.permission.count({ where: { menu: { is: null } } }).catch(() => 0);
  console.log('permission rows with no menu:', orphanPerms);
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
