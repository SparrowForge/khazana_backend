import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';

/** One item's worth of stock movement, keyed by the Item_Information UUID. */
export interface StockLine {
  itemId: string | null | undefined;
  qty: number;
}

/** Inventory.quantity is Decimal(18,4) — round both sides of the comparison to
 *  the same precision so binary float drift (0.1 + 0.2) can't invent a shortage
 *  of 0.0000000001. */
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Sum the lines per item so two lines of the same item are judged against one
 *  balance instead of each being measured against the full on-hand qty. */
function sumByItem(lines: StockLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!line.itemId) continue;
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + qty);
  }
  return totals;
}

/**
 * Refuse a document that would drive `Inventory.quantity` below zero.
 *
 * - `takes` — what the document removes from stock.
 * - `returns` — what the document already holds and is about to give back. Edits
 *   are purge-and-replace, so an amendment is judged against
 *   (on hand + what its previous version took out); without this, re-saving an
 *   unchanged document would fail the check against its own deduction.
 *
 * Balances live on `Inventory`, which is still itemCode-keyed, so items are
 * bridged id → itmCode first (same pattern as InventoryService#itemCodesByIds).
 * Takes a client rather than reaching for `this.prisma` so callers can run the
 * check inside the very transaction that performs the deduction — checking
 * outside it leaves a window for two concurrent sales to both pass.
 */
export async function assertStockAvailable(
  db: Prisma.TransactionClient,
  takes: StockLine[],
  returns: StockLine[] = [],
): Promise<void> {
  const required = sumByItem(takes);
  if (!required.size) return;
  const restored = sumByItem(returns);

  const itemIds = [...required.keys()];
  const items = await db.item_Information.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, itmCode: true, itmName: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const missing = itemIds.filter((id) => !itemById.has(id));
  if (missing.length) {
    throw new BadRequestException(`Unknown item id(s): ${missing.join(', ')}`);
  }

  const rows = await db.inventory.findMany({
    where: { itemCode: { in: items.map((i) => i.itmCode) } },
    select: { itemCode: true, quantity: true },
  });
  // An item with no Inventory row has never been received — treat it as zero
  // on hand rather than letting the decrement fail with an opaque Prisma error.
  const onHand = new Map(rows.map((r) => [r.itemCode, Number(r.quantity)]));

  const shortages: string[] = [];
  for (const [itemId, qty] of required) {
    const item = itemById.get(itemId)!;
    const available = r4((onHand.get(item.itmCode) ?? 0) + (restored.get(itemId) ?? 0));
    if (r4(qty) > available) {
      shortages.push(
        `${item.itmName || item.itmCode} — available ${available}, required ${r4(qty)}`,
      );
    }
  }

  if (shortages.length) {
    throw new BadRequestException(`Insufficient stock: ${shortages.join('; ')}`);
  }
}
