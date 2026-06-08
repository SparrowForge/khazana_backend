import { PrismaClient } from '../src/generated/prisma';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Default branch
  const branch = await prisma.branch.upsert({
    where: { branchCode: 'HQ' },
    update: {},
    create: {
      branchCode: 'HQ',
      branchName: 'Head Quarter',
      address: 'Dhaka, Bangladesh',
    },
  });

  // Admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { userName: 'admin' },
    update: {},
    create: {
      userName: 'admin',
      name: 'System Administrator',
      password: hashedPassword,
      branchId: branch.id,
      isActive: 'Y',
      creator: 'system',
      creationDate: new Date(),
    },
  });

  // Default menus
  const menus = [
    { menuName: 'Dashboard', controlName: 'Dashboard', order: 1, parentMenu: null },
    { menuName: 'Sales', controlName: 'Sales', order: 2, parentMenu: null },
    { menuName: 'Cash Sales', controlName: 'CashSales', order: 1, parentMenu: 'Sales' },
    { menuName: 'Credit Sales', controlName: 'CreditSales', order: 2, parentMenu: 'Sales' },
    { menuName: 'VAT Cash Sales', controlName: 'VatCashSales', order: 3, parentMenu: 'Sales' },
    { menuName: 'VAT Credit Sales', controlName: 'VatCreditSales', order: 4, parentMenu: 'Sales' },
    { menuName: 'NC Adjustment', controlName: 'NCAdjustment', order: 3, parentMenu: null },
    { menuName: 'Assortment', controlName: 'Assortment', order: 4, parentMenu: null },
    { menuName: 'Inventory', controlName: 'Inventory', order: 5, parentMenu: null },
    { menuName: 'Items', controlName: 'Items', order: 1, parentMenu: 'Inventory' },
    { menuName: 'Stock View', controlName: 'StockView', order: 2, parentMenu: 'Inventory' },
    { menuName: 'Stock Receive', controlName: 'StockReceive', order: 3, parentMenu: 'Inventory' },
    { menuName: 'Stock Issue', controlName: 'StockIssue', order: 4, parentMenu: 'Inventory' },
    { menuName: 'Stock Transfer', controlName: 'StockTransfer', order: 5, parentMenu: 'Inventory' },
    { menuName: 'Packets', controlName: 'Packets', order: 6, parentMenu: null },
    { menuName: 'Customers', controlName: 'Customers', order: 7, parentMenu: null },
    { menuName: 'Orders', controlName: 'Orders', order: 8, parentMenu: null },
    { menuName: 'Pricing', controlName: 'Pricing', order: 9, parentMenu: null },
    { menuName: 'Finance', controlName: 'Finance', order: 10, parentMenu: null },
    { menuName: 'Reports', controlName: 'Reports', order: 11, parentMenu: null },
    { menuName: 'Administration', controlName: 'Admin', order: 12, parentMenu: null },
    { menuName: 'Users', controlName: 'Users', order: 1, parentMenu: 'Admin' },
    { menuName: 'Roles & Permissions', controlName: 'RolesPermissions', order: 2, parentMenu: 'Admin' },
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
