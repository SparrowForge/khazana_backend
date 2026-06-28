import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const LOW_STOCK_THRESHOLD = 10;

interface BranchSales {
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  todaySales: number;
  todayRevenue: number;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Dashboard stats scoped to the branches the user is assigned to
   * (user_to_branch_mapping). Single-branch users see only their branch;
   * multi-branch users get a per-branch sales breakdown plus the combined totals.
   */
  async getStats(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Branches this user may see.
    const mappings = await this.prisma.userBranchMapping.findMany({
      where: { userId },
      include: { branch: true },
      orderBy: { branch: { branchName: 'asc' } },
    });
    const branchIds = mappings.map((m) => m.branchId);

    const [
      cashByBranch,
      creditByBranch,
      totalItems,
      totalCustomers,
      lowStockItems,
      pendingOrders,
    ] = await Promise.all([
      // POS / cash sales today, grouped by branch
      this.prisma.t_SOMstr.groupBy({
        by: ['branchId'],
        where: { somstrDate: { gte: startOfDay }, somstrIsActive: true, branchId: { in: branchIds } },
        _count: { _all: true },
        _sum: { somstrNetAmt: true },
      }),
      // Credit sales today, grouped by branch
      this.prisma.cSMaster.groupBy({
        by: ['branchId'],
        where: { invDate: { gte: startOfDay }, isActive: 1, branchId: { in: branchIds } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.item_Information.count({ where: { isActive: 'Y' } }),
      this.prisma.customer.count(),
      this.prisma.inventory.count({ where: { quantity: { lt: LOW_STOCK_THRESHOLD } } }),
      this.prisma.orderReceive_Master.count(),
    ]);

    const cashMap = new Map(cashByBranch.map((r) => [r.branchId, r]));
    const creditMap = new Map(creditByBranch.map((r) => [r.branchId, r]));

    const branches: BranchSales[] = mappings.map((m) => {
      const cash = cashMap.get(m.branchId);
      const credit = creditMap.get(m.branchId);
      const todaySales = (cash?._count._all ?? 0) + (credit?._count._all ?? 0);
      const todayRevenue =
        Number(cash?._sum.somstrNetAmt ?? 0) + Number(credit?._sum.totalAmount ?? 0);
      return {
        branchId: m.branchId,
        branchCode: m.branch.branchCode,
        branchName: m.branch.branchName,
        todaySales,
        todayRevenue,
      };
    });

    return {
      // Combined totals across the user's accessible branches (top cards).
      todaySales: branches.reduce((s, b) => s + b.todaySales, 0),
      todayRevenue: branches.reduce((s, b) => s + b.todayRevenue, 0),
      totalItems,
      totalCustomers,
      lowStockItems,
      pendingOrders,
      // Per-branch sales breakdown (one entry per assigned branch).
      branches,
    };
  }
}
