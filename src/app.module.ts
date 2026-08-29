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
import { ProductionModule } from './production/production.module';
import { VehicleChallanModule } from './vehicle-challan/vehicle-challan.module';
import { CustomersModule } from './customers/customers.module';
import { OrdersModule } from './orders/orders.module';
import { DemandOrdersModule } from './demand-orders/demand-orders.module';
import { PricingModule } from './pricing/pricing.module';
import { FinanceModule } from './finance/finance.module';
import { PacketsModule } from './packets/packets.module';
import { NcAdjustmentModule } from './nc-adjustment/nc-adjustment.module';
import { AssortmentModule } from './assortment/assortment.module';
import { ReportsModule } from './reports/reports.module';
import { AdminModule } from './admin/admin.module';
import { CategoriesModule } from './categories/categories.module';
import { UomsModule } from './uoms/uoms.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PosModule } from './pos/pos.module';
import { UploadModule } from './upload/upload.module';

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
    ProductionModule,
    VehicleChallanModule,
    CustomersModule,
    OrdersModule,
    DemandOrdersModule,
    PricingModule,
    FinanceModule,
    PacketsModule,
    NcAdjustmentModule,
    AssortmentModule,
    ReportsModule,
    AdminModule,
    CategoriesModule,
    UomsModule,
    DashboardModule,
    PosModule,
    UploadModule,
  ],
})
export class AppModule {}
