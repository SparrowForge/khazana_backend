import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { MenusModule } from './menus/menus.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SalesModule } from './sales/sales.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { OrdersModule } from './orders/orders.module';
import { PricingModule } from './pricing/pricing.module';
import { FinanceModule } from './finance/finance.module';
import { PacketsModule } from './packets/packets.module';
import { NcAdjustmentModule } from './nc-adjustment/nc-adjustment.module';
import { AssortmentModule } from './assortment/assortment.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { CategoriesModule } from './categories/categories.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    AuthModule,
    UsersModule,
    RolesModule,
    MenusModule,
    PermissionsModule,
    SalesModule,
    InventoryModule,
    CustomersModule,
    OrdersModule,
    PricingModule,
    FinanceModule,
    PacketsModule,
    NcAdjustmentModule,
    AssortmentModule,
    ReportsModule,
    AdminModule,
    CategoriesModule,
    DashboardModule,
  ],
})
export class AppModule {}
