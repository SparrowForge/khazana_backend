/**
 * One-off, NON-DESTRUCTIVE insert of the per-page leaf menus.
 *
 * Unlike `seed.ts` (which resets role permissions via non-empty `update:`
 * clauses), this script only ADDS the new leaf menu rows and their grants.
 * Every write is an upsert with `update: {}`, so existing menus, permissions
 * and custom role configurations are left untouched.
 *
 * Run: npm run db:seed  -> no; use:
 *   npx ts-node --project tsconfig.seed.json prisma/insert-all-menus.ts
 */
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

// New per-page leaf menus (must match the additions in seed.ts / navRegistry).
const newMenus = [
  { menuName: 'Sales List', controlName: 'SalesList', order: 5, parentMenu: 'Sales', module: 'Sale' },
  { menuName: 'New NC', controlName: 'NCNew', order: 1, parentMenu: 'NCAdjustment', module: 'Sale' },
  { menuName: 'NC List', controlName: 'NCList', order: 2, parentMenu: 'NCAdjustment', module: 'Sale' },
  { menuName: 'New Assortment', controlName: 'AssortmentNew', order: 1, parentMenu: 'Assortment', module: 'Sale' },
  { menuName: 'Assortment List', controlName: 'AssortmentList', order: 2, parentMenu: 'Assortment', module: 'Sale' },
  { menuName: 'Categories', controlName: 'Categories', order: 7, parentMenu: 'Inventory', module: 'Inventory' },
  { menuName: 'Packet Info', controlName: 'PacketInfo', order: 1, parentMenu: 'Packets', module: 'Sale' },
  { menuName: 'Packet Receive', controlName: 'PacketReceive', order: 2, parentMenu: 'Packets', module: 'Sale' },
  { menuName: 'Packet Issue', controlName: 'PacketIssue', order: 3, parentMenu: 'Packets', module: 'Sale' },
  { menuName: 'Packet Stock', controlName: 'PacketStock', order: 4, parentMenu: 'Packets', module: 'Sale' },
  { menuName: 'Customer List', controlName: 'CustomerList', order: 1, parentMenu: 'Customers', module: 'Sale' },
  { menuName: 'Customer Money Receipt', controlName: 'CustomerPayments', order: 2, parentMenu: 'Customers', module: 'Sale' },
  { menuName: 'Orders List', controlName: 'OrdersList', order: 1, parentMenu: 'Orders', module: 'Sale' },
  { menuName: 'VAT Orders', controlName: 'VatOrders', order: 2, parentMenu: 'Orders', module: 'Sale' },
  { menuName: 'Demand Order', controlName: 'DemandOrders', order: 3, parentMenu: 'Orders', module: 'Sale' },
  { menuName: 'Price Setup', controlName: 'PriceSetup', order: 1, parentMenu: 'Pricing', module: 'Sale' },
  { menuName: 'Cost Price Setup', controlName: 'CostPriceSetup', order: 2, parentMenu: 'Pricing', module: 'Sale' },
  { menuName: 'Cash Purchase', controlName: 'CashPurchase', order: 1, parentMenu: 'Finance', module: null },
  { menuName: 'Sales Report', controlName: 'SalesReport', order: 1, parentMenu: 'Reports', module: null },
  { menuName: 'Sales History Summary', controlName: 'SalesHistorySummary', order: 2, parentMenu: 'Reports', module: null },
  { menuName: 'Stock Report', controlName: 'StockReport', order: 3, parentMenu: 'Reports', module: null },
  { menuName: 'Stock Analysis', controlName: 'StockAnalysis', order: 4, parentMenu: 'Reports', module: null },
  { menuName: 'Item Receive Report', controlName: 'ItemReceiveReport', order: 10, parentMenu: 'Reports', module: null },
  { menuName: 'Item Reject Report', controlName: 'ItemRejectReport', order: 11, parentMenu: 'Reports', module: null },
  { menuName: 'NC Report', controlName: 'NCReport', order: 12, parentMenu: 'Reports', module: null },
  { menuName: 'Customer Statement', controlName: 'CustomerStatement', order: 5, parentMenu: 'Reports', module: null },
  { menuName: 'Daily Summary', controlName: 'DailySummary', order: 6, parentMenu: 'Reports', module: null },
  { menuName: 'Daily Final Report', controlName: 'DailyFinalReport', order: 7, parentMenu: 'Reports', module: null },
  { menuName: 'Item-wise Sales', controlName: 'ItemSales', order: 8, parentMenu: 'Reports', module: null },
  { menuName: 'Packet Analysis', controlName: 'PacketAnalysis', order: 9, parentMenu: 'Reports', module: null },
  { menuName: 'Roles', controlName: 'Roles', order: 5, parentMenu: 'Admin', module: null },
  { menuName: 'Permissions', controlName: 'Permissions', order: 6, parentMenu: 'Admin', module: null },
  { menuName: 'User Menu Permission', controlName: 'UserMenuPermission', order: 7, parentMenu: 'Admin', module: null },
  { menuName: 'User Role Assignment', controlName: 'UserRoleAssignment', order: 8, parentMenu: 'Admin', module: null },
  { menuName: 'Branches', controlName: 'Branches', order: 9, parentMenu: 'Admin', module: null },
  { menuName: 'Audit Log', controlName: 'AuditLog', order: 10, parentMenu: 'Admin', module: null },
  { menuName: 'System Settings', controlName: 'SystemSettings', order: 11, parentMenu: 'Admin', module: null },
];

// Default access per role, mirroring seed.ts (only applied to brand-new rows).
const roleDefaults: Record<string, { isEnable: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }> = {
  ADMIN: { isEnable: true, canCreate: true, canEdit: true, canDelete: true },
  MANAGER: { isEnable: true, canCreate: true, canEdit: true, canDelete: false },
  CASHIER: { isEnable: true, canCreate: true, canEdit: false, canDelete: false },
  VIEWER: { isEnable: true, canCreate: false, canEdit: false, canDelete: false },
};

async function main() {
  let inserted = 0;

  // 1) Upsert the menu rows (create only; never overwrite an existing menu).
  for (const menu of newMenus) {
    const before = await prisma.menu.findUnique({ where: { controlName: menu.controlName } });
    await prisma.menu.upsert({
      where: { controlName: menu.controlName },
      update: {},
      create: { ...menu, isActive: true },
    });
    if (!before) inserted++;
  }

  // 2) Grant each of the 4 default roles access on the new menus (additive).
  const roles = await prisma.role.findMany({ where: { name: { in: Object.keys(roleDefaults) } } });
  const seededMenus = await prisma.menu.findMany({
    where: { controlName: { in: newMenus.map((m) => m.controlName) } },
  });
  for (const menu of seededMenus) {
    for (const role of roles) {
      const d = roleDefaults[role.name];
      if (!d) continue;
      await prisma.permission.upsert({
        where: { roleId_menuId: { roleId: role.id, menuId: menu.id } },
        update: {}, // do not clobber a manually-adjusted permission
        create: { roleId: role.id, menuId: menu.id, ...d },
      });
    }
  }

  // 3) Grant the built-in `admin` user full access on the new menus via t_UserRole.
  for (const menu of newMenus) {
    await prisma.t_UserRole.upsert({
      where: { userId_controlName: { userId: 'admin', controlName: menu.controlName } },
      update: {},
      create: {
        userId: 'admin',
        controlName: menu.controlName,
        isEnable: 'Y',
        addAccess: 'Y',
        editAccess: 'Y',
        deleteAccess: 'Y',
      },
    });
  }

  console.log(`Done. ${newMenus.length} leaf menus ensured (${inserted} newly inserted), grants applied for ${roles.length} roles + admin user.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
