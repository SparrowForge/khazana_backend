import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PosSalesService } from './pos-sales.service';
import { SyncOfflineDto } from './dto/sync-offline.dto';

export type SyncOrderStatus = 'synced' | 'skipped' | 'failed';

export interface SyncOrderResult {
  invoiceNo: string;
  status: SyncOrderStatus;
  saleId?: string; // present when synced
  reason?: string; // present when skipped/failed
}

export interface SyncOfflineResult {
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  results: SyncOrderResult[];
}

@Injectable()
export class PosSyncService {
  private readonly logger = new Logger(PosSyncService.name);

  constructor(
    private prisma: PrismaService,
    private posSales: PosSalesService,
  ) {}

  /**
   * Replay a batch of offline sales onto the central DB.
   *
   * Design notes:
   * - **Ownership:** the payload's `userId`/`userName` must match the
   *   authenticated session — a cashier can only sync their own offline cache.
   * - **Idempotency:** `somstrCode` is not DB-unique, so each order is matched by
   *   invoice number first; an already-present number is `skipped`, making
   *   re-syncs (retries after a flaky 200) safe.
   * - **Per-order isolation:** orders are processed independently so one bad
   *   order (e.g. price removed since it sold) doesn't abort the whole batch;
   *   its failure is reported and the client keeps it queued.
   * - **Historical timestamp:** the sale date is the original offline save time
   *   (`clientSavedAt`); `somstrCreationDate` records the actual sync time.
   * - **Stock:** deduction is plain decrement (commutative — replay order is
   *   irrelevant for a non-temporal `Inventory.quantity`).
   */
  async syncOffline(
    dto: SyncOfflineDto,
    authUserId: string,
    authUserName: string,
  ): Promise<SyncOfflineResult> {
    if (dto.userId !== authUserId || dto.userName !== authUserName) {
      throw new ForbiddenException(
        'Offline batch owner does not match the authenticated user',
      );
    }

    const results: SyncOrderResult[] = [];

    for (const order of dto.orders) {
      try {
        const existing = await this.prisma.t_SOMstr.findFirst({
          where: { somstrCode: order.invoiceNo },
          select: { id: true },
        });
        if (existing) {
          results.push({
            invoiceNo: order.invoiceNo,
            status: 'skipped',
            saleId: existing.id,
            reason: 'Already synced',
          });
          continue;
        }

        const sale = await this.posSales.persistSale({
          invoiceNo: order.invoiceNo,
          saleDate: new Date(order.clientSavedAt),
          items: order.items,
          paidAmount: order.paidAmount,
          servedBy: order.servedBy,
          salesType: order.salesType,
          bankId: order.bankId ?? null,
          branchId: order.branchId ?? null,
          discountType: order.discountType,
          discountValue: order.discountValue,
          discountRemarks: order.discountRemarks,
          discountContact: order.discountContact,
          createdBy: dto.userName,
        });

        results.push({ invoiceNo: order.invoiceNo, status: 'synced', saleId: sale.id });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        this.logger.warn(`Offline order ${order.invoiceNo} failed to sync: ${reason}`);
        results.push({ invoiceNo: order.invoiceNo, status: 'failed', reason });
      }
    }

    return {
      syncedCount: results.filter((r) => r.status === 'synced').length,
      skippedCount: results.filter((r) => r.status === 'skipped').length,
      failedCount: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }
}
