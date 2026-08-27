import { PrismaClient } from '../src/generated/prisma';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Default branch
  const branch = await prisma.branch.upsert({
    where: { branchCode: 'Factory' },
    update: {},
    create: {
      branchCode: 'Factory',
      branchName: 'Factory',
      address: 'Dhaka, Bangladesh',
    },
  });

  // Admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.upsert({
    where: { userName: 'admin' },
    update: {},
    create: {
      userName: 'admin',
      name: 'System Administrator',
      password: hashedPassword,
      isActive: 'Y',
      creator: 'system',
      creationDate: new Date(),
    },
  });

  // Branch association is via UserBranchMapping (User has no branchId scalar)
  await prisma.userBranchMapping.upsert({
    where: { userId_branchId: { userId: adminUser.id, branchId: branch.id } },
    update: {},
    create: { userId: adminUser.id, branchId: branch.id },
  });

  // Default menus. `module` groups menus into the 3 business modules shown on the
  // User Menu Permission screen: Sale | Purchase | Inventory. Cross-cutting menus
  // (Dashboard, Finance, Reports, Admin) are left null and appear under "All".
  const menus = [
    { menuName: 'Dashboard', controlName: 'Dashboard', order: 1, parentMenu: null, module: null },
    { menuName: 'Sales', controlName: 'Sales', order: 3, parentMenu: null, module: 'Sale' },
    { menuName: 'POS Terminal', controlName: 'POSTerminal', order: 1, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'POS Sales', controlName: 'POSSales', order: 2, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'Cash Sales', controlName: 'CashSales', order: 3, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'Credit Sales', controlName: 'CreditSales', order: 4, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'VAT Cash Sales', controlName: 'VatCashSales', order: 5, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'VAT Credit Sales', controlName: 'VatCreditSales', order: 6, parentMenu: 'Sales', module: 'Sale' },
    { menuName: 'NC Adjustment', controlName: 'NCAdjustment', order: 3, parentMenu: null, module: 'Sale' },
    { menuName: 'Assortment', controlName: 'Assortment', order: 4, parentMenu: null, module: 'Sale' },
    { menuName: 'Packets', controlName: 'Packets', order: 7, parentMenu: null, module: 'Sale' },
    { menuName: 'Customers', controlName: 'Customers', order: 7, parentMenu: null, module: 'Sale' },
    { menuName: 'Orders', controlName: 'Orders', order: 8, parentMenu: null, module: 'Sale' },
    { menuName: 'Pricing', controlName: 'Pricing', order: 9, parentMenu: null, module: 'Sale' },
    { menuName: 'Inventory', controlName: 'Inventory', order: 5, parentMenu: null, module: 'Inventory' },
    { menuName: 'Items', controlName: 'Items', order: 1, parentMenu: 'Inventory', module: 'Inventory' },
    { menuName: 'Stock View', controlName: 'StockView', order: 2, parentMenu: 'Inventory', module: 'Inventory' },
    { menuName: 'Stock Receive', controlName: 'StockReceive', order: 3, parentMenu: 'Inventory', module: 'Purchase' },
    { menuName: 'Stock Issue', controlName: 'StockIssue', order: 4, parentMenu: 'Inventory', module: 'Inventory' },
    { menuName: 'Stock Transfer', controlName: 'StockTransfer', order: 5, parentMenu: 'Inventory', module: 'Inventory' },
    { menuName: 'Stock Adjustment', controlName: 'StockAdjustment', order: 6, parentMenu: 'Inventory', module: 'Inventory' },
    // Factory-only: the sidebar hides it unless the session branch is the
    // factory, and ProductionService rejects any other branch outright.
    { menuName: 'Production Entry', controlName: 'ProductionEntry', order: 8, parentMenu: 'Inventory', module: 'Inventory' },
    { menuName: 'Vehicle Challan', controlName: 'VehicleChallan', order: 9, parentMenu: 'Inventory', module: 'Inventory' },
    // Factory Report — a top-level group whose every leaf is factory-only, so
    // the sidebar drops the whole group for any other branch.
    { menuName: 'Factory Report', controlName: 'FactoryReport', order: 13, parentMenu: null, module: 'Inventory' },
    { menuName: 'Production & Delivery Report', controlName: 'ProductionDeliveryReport', order: 1, parentMenu: 'FactoryReport', module: 'Inventory' },
    { menuName: 'Branchwise Delivery Report', controlName: 'BranchwiseDeliveryReport', order: 2, parentMenu: 'FactoryReport', module: 'Inventory' },
    { menuName: 'Discount Log Report', controlName: 'DiscountLogReport', order: 3, parentMenu: 'FactoryReport', module: 'Inventory' },
    { menuName: 'Demand Report', controlName: 'DemandReport', order: 4, parentMenu: 'FactoryReport', module: 'Inventory' },
    { menuName: 'Sales History Report', controlName: 'SalesHistoryReport', order: 5, parentMenu: 'FactoryReport', module: null },
    { menuName: 'Finance', controlName: 'Finance', order: 10, parentMenu: null, module: null },
    { menuName: 'Reports', controlName: 'Reports', order: 11, parentMenu: null, module: null },
    { menuName: 'Administration', controlName: 'Admin', order: 12, parentMenu: null, module: null },
    { menuName: 'Users', controlName: 'Users', order: 1, parentMenu: 'Admin', module: null },
    { menuName: 'Roles & Permissions', controlName: 'RolesPermissions', order: 2, parentMenu: 'Admin', module: null },
    { menuName: 'User Role Permission', controlName: 'UserRolePermission', order: 3, parentMenu: 'Admin', module: null },
    { menuName: 'Bank', controlName: 'Bank', order: 4, parentMenu: 'Admin', module: null },

    // ---- Per-page leaf menus: every navigable page is its own menu row so it
    // can be permission-controlled individually (mirrors frontend navRegistry).
    // Sales
    { menuName: 'Sales List', controlName: 'SalesList', order: 7, parentMenu: 'Sales', module: 'Sale' },
    // NC Adjustment
    { menuName: 'New NC', controlName: 'NCNew', order: 1, parentMenu: 'NCAdjustment', module: 'Sale' },
    { menuName: 'NC List', controlName: 'NCList', order: 2, parentMenu: 'NCAdjustment', module: 'Sale' },
    // Assortment
    { menuName: 'New Assortment', controlName: 'AssortmentNew', order: 1, parentMenu: 'Assortment', module: 'Sale' },
    { menuName: 'Assortment List', controlName: 'AssortmentList', order: 2, parentMenu: 'Assortment', module: 'Sale' },
    // Inventory
    { menuName: 'Categories', controlName: 'Categories', order: 7, parentMenu: 'Inventory', module: 'Inventory' },
    // Packets
    { menuName: 'Packet Info', controlName: 'PacketInfo', order: 1, parentMenu: 'Packets', module: 'Sale' },
    { menuName: 'Packet Receive', controlName: 'PacketReceive', order: 2, parentMenu: 'Packets', module: 'Sale' },
    { menuName: 'Packet Issue', controlName: 'PacketIssue', order: 3, parentMenu: 'Packets', module: 'Sale' },
    { menuName: 'Packet Stock', controlName: 'PacketStock', order: 4, parentMenu: 'Packets', module: 'Sale' },
    // Customers
    { menuName: 'Customer List', controlName: 'CustomerList', order: 1, parentMenu: 'Customers', module: 'Sale' },
    { menuName: 'Customer Money Receipt', controlName: 'CustomerPayments', order: 2, parentMenu: 'Customers', module: 'Sale' },
    // Orders
    { menuName: 'Orders List', controlName: 'OrdersList', order: 1, parentMenu: 'Orders', module: 'Sale' },
    { menuName: 'VAT Orders', controlName: 'VatOrders', order: 2, parentMenu: 'Orders', module: 'Sale' },
    { menuName: 'Demand Order', controlName: 'DemandOrders', order: 3, parentMenu: 'Orders', module: 'Sale' },
    // Pricing
    { menuName: 'Price Setup', controlName: 'PriceSetup', order: 1, parentMenu: 'Pricing', module: 'Sale' },
    { menuName: 'Cost Price Setup', controlName: 'CostPriceSetup', order: 2, parentMenu: 'Pricing', module: 'Sale' },
    // Finance
    { menuName: 'Cash Purchase', controlName: 'CashPurchase', order: 1, parentMenu: 'Finance', module: null },
    // Reports
    { menuName: 'Sales Report', controlName: 'SalesReport', order: 1, parentMenu: 'Reports', module: null },
    { menuName: 'Stock Report', controlName: 'StockReport', order: 2, parentMenu: 'Reports', module: null },
    { menuName: 'Stock Analysis', controlName: 'StockAnalysis', order: 3, parentMenu: 'Reports', module: null },
    { menuName: 'Customer Statement', controlName: 'CustomerStatement', order: 4, parentMenu: 'Reports', module: null },
    { menuName: 'Daily Summary', controlName: 'DailySummary', order: 5, parentMenu: 'Reports', module: null },
    { menuName: 'Daily Final Report', controlName: 'DailyFinalReport', order: 6, parentMenu: 'Reports', module: null },
    { menuName: 'Item-wise Sales', controlName: 'ItemSales', order: 7, parentMenu: 'Reports', module: null },
    { menuName: 'Packet Analysis', controlName: 'PacketAnalysis', order: 8, parentMenu: 'Reports', module: null },
    // Administration (leaf pages; group-level Admin/RolesPermissions/UserRolePermission
    // rows are kept above because backend @RequiredPermission guards still use them)
    { menuName: 'Roles', controlName: 'Roles', order: 5, parentMenu: 'Admin', module: null },
    { menuName: 'Permissions', controlName: 'Permissions', order: 6, parentMenu: 'Admin', module: null },
    { menuName: 'User Menu Permission', controlName: 'UserMenuPermission', order: 7, parentMenu: 'Admin', module: null },
    { menuName: 'User Role Assignment', controlName: 'UserRoleAssignment', order: 8, parentMenu: 'Admin', module: null },
    { menuName: 'Branches', controlName: 'Branches', order: 9, parentMenu: 'Admin', module: null },
    { menuName: 'Audit Log', controlName: 'AuditLog', order: 10, parentMenu: 'Admin', module: null },
    { menuName: 'System Settings', controlName: 'SystemSettings', order: 11, parentMenu: 'Admin', module: null },
  ];

  for (const menu of menus) {
    await prisma.menu.upsert({
      where: { controlName: menu.controlName },
      update: {},
      create: { ...menu, isActive: true },
    });
  }

  // Roles
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Full system access' },
  });

  const managerRole = await prisma.role.upsert({ where: { name: 'MANAGER' }, update: {}, create: { name: 'MANAGER', description: 'Manager access' } });
  const cashierRole = await prisma.role.upsert({ where: { name: 'CASHIER' }, update: {}, create: { name: 'CASHIER', description: 'Cashier access' } });
  const viewerRole = await prisma.role.upsert({ where: { name: 'VIEWER' }, update: {}, create: { name: 'VIEWER', description: 'Read-only access' } });

  // Permissions (Role <-> Menu)
  const seededMenus = await prisma.menu.findMany();
  for (const menu of seededMenus) {
    // ADMIN: full access on every menu
    await prisma.permission.upsert({
      where: { roleId_menuId: { roleId: adminRole.id, menuId: menu.id } },
      update: { isEnable: true, canCreate: true, canEdit: true, canDelete: true },
      create: { roleId: adminRole.id, menuId: menu.id, isEnable: true, canCreate: true, canEdit: true, canDelete: true },
    });

    // MANAGER: create + edit, no delete
    await prisma.permission.upsert({
      where: { roleId_menuId: { roleId: managerRole.id, menuId: menu.id } },
      update: { isEnable: true, canCreate: true, canEdit: true, canDelete: false },
      create: { roleId: managerRole.id, menuId: menu.id, isEnable: true, canCreate: true, canEdit: true, canDelete: false },
    });

    // CASHIER: create only
    await prisma.permission.upsert({
      where: { roleId_menuId: { roleId: cashierRole.id, menuId: menu.id } },
      update: { isEnable: true, canCreate: true, canEdit: false, canDelete: false },
      create: { roleId: cashierRole.id, menuId: menu.id, isEnable: true, canCreate: true, canEdit: false, canDelete: false },
    });

    // VIEWER: read-only
    await prisma.permission.upsert({
      where: { roleId_menuId: { roleId: viewerRole.id, menuId: menu.id } },
      update: { isEnable: true, canCreate: false, canEdit: false, canDelete: false },
      create: { roleId: viewerRole.id, menuId: menu.id, isEnable: true, canCreate: false, canEdit: false, canDelete: false },
    });
  }

  // Grant admin full access to all menus via t_UserRole
  const allMenus = await prisma.menu.findMany();
  for (const menu of allMenus) {
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

  // System settings
  const existing = await prisma.setup_System.findFirst();
  if (!existing) {
    await prisma.setup_System.create({
      data: {
        companyName: 'Khazana Mithai',
        companyAddress: 'Dhaka, Bangladesh',
        reportFooter: 'Thank you for your business!',
      },
    });
  }

  console.log('Seed completed successfully.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
