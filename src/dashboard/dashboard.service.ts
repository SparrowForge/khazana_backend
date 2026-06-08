import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const LOW_STOCK_THRESHOLD = 10;

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      todaySales,
      todayRevenue,
      totalItems,
      totalCustomers,
      lowStockItems,
      pendingOrders,
    ] = await this.prisma.$transaction([
      this.prisma.cSMaster.count({ where: { invDate: { gte: startOfDay }, isActive: 1 } }),
      this.prisma.cSMaster.aggregate({
        where: { invDate: { gte: startOfDay }, isActive: 1 },
        _sum: { totalAmount: true },
      }),
      this.prisma.item_Information.count({ where: { isActive: 'Y' } }),
      this.prisma.customer.count(),
      this.prisma.inventory.count({ where: { quantity: { lt: LOW_STOCK_THRESHOLD } } }),
      this.prisma.orderReceive_Master.count(),
    ]);

    return {
      todaySales,
      todayRevenue: Number(todayRevenue._sum.totalAmount ?? 0),
      totalItems,
      totalCustomers,
      lowStockItems,
      pendingOrders,
    };
  }
}
