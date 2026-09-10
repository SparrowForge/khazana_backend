import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';

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
 * What a single BRANCH holds, rolled forward from the movement ledgers.
 *
 * `Inventory` is keyed by item alone — one company-wide balance, no branch
 * column — so it cannot answer "does the Factory have 11 of this?". It answers
 * "does the company have 11", which an outlet's shelf stock happily satisfies on
 * the Factory's behalf. Worse, an internal transfer is net-zero in that pool:
 * the issue decrements it and the receiving branch's confirm increments it
 * straight back, so shipping goods out of a branch never depletes the number the
 * guard reads. That is how the Factory issued 11 Apple Sandesh against a
 * production run of 10 and the Production & Delivery report closed at -4.
 *
 * This is the report's own formula, and deliberately so: the same ledgers, the
 * same branch columns, the same signs as `getProductionDeliveryReport`, so a
 * document that passes here cannot drive that report's closing balance below
 * zero. Read the two together — if one gains a ledger, so must the other.
 *
 *   in   = Production + Item_Receive + ItemReject.Excess
 *   out  = Item_Issue + counter sales (t_SODet) + VAT cash sales (t_SODeV)
 *        + credit sales (CSDetail) + VAT credit sales (CSVDetail)
 *        + non-charge issues (t_NCDet)
 *        + ItemReject.Assort + .Reject + .Short
 *
 * Sales join through their master for the branch and the active flag, matching
 * how the report scopes them (`saleWhere`) rather than trusting the detail row's
 * own BranchId copy — the two can disagree, and the report's reading wins.
 *
 * One statement rather than a groupBy per ledger: this runs inside the
 * transaction that performs the deduction, where queries serialise on a single
 * connection, and nine round trips there is how a POS sale meets the transaction
 * clock (P2028) — the same reason `deductStock` is one statement.
 *
 * Balances are all-time, not as-of the document's date: the guard protects the
 * LATEST closing balance. A back-dated document can still dip an intermediate
 * day negative while ending up square, which no single-balance check can see.
 */
export async function branchStockOnHand(
  db: Prisma.TransactionClient,
  itemIds: string[],
  branchId: string,
): Promise<Map<string, number>> {
  const onHand = new Map<string, number>();
  if (!itemIds.length || !branchId) return onHand;

  const ids = Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`));
  const branch = Prisma.sql`${branchId}::uuid`;

  // CSVDetail."ItemOId" is plain text, not uuid — it predates the item-code to
  // uuid migration. Compared as text so a row still holding a loose item CODE
  // simply doesn't match, exactly as it doesn't in the report, instead of
  // failing the whole statement on a cast error.
  const rows = await db.$queryRaw<{ item_id: string; qty: number }[]>`
    SELECT m.item_id::text AS item_id, SUM(m.qty)::float8 AS qty
    FROM (
      SELECT p."ItemId" AS item_id, COALESCE(p."Qty", 0) AS qty
        FROM "Production" p
       WHERE p."IsActive" = 1 AND p."BranchId" = ${branch} AND p."ItemId" IN (${ids})
      UNION ALL
      SELECT r."ItemId", COALESCE(r."Qty", 0)
        FROM "Item_Receive" r
       WHERE r."IsActive" = 1 AND r."ReceiveBranchID" = ${branch} AND r."ItemId" IN (${ids})
      UNION ALL
      SELECT j."itmOId", COALESCE(j."Excess", 0)
             - COALESCE(j."Assort", 0) - COALESCE(j."Reject", 0) - COALESCE(j."Short", 0)
        FROM "ItemReject" j
       WHERE j."IsActive" = 1 AND j."BranchId" = ${branch} AND j."itmOId" IN (${ids})
      UNION ALL
      SELECT i."ItemId", -COALESCE(i."Qty", 0)
        FROM "Item_Issue" i
       WHERE i."IsActive" = 1 AND i."IssueBranchId" = ${branch} AND i."ItemId" IN (${ids})
      UNION ALL
      SELECT d."SODet_ItemOID", -COALESCE(d."SODet_QTY", 0)
        FROM "t_SODet" d
        JOIN "t_SOMstr" s ON s."SOMstr_OID" = d."SODet_MStrOID"
       WHERE s."SOMstr_IsActive" = true AND s."BranchId" = ${branch}
         AND d."SODet_ItemOID" IN (${ids})
      UNION ALL
      SELECT v."SODet_ItemOID", -COALESCE(v."SODet_QTY", 0)
        FROM "t_SODeV" v
        JOIN "t_SOMstV" sv ON sv."SOMstr_OID" = v."SODet_MStrOID"
       WHERE sv."SOMstr_IsActive" = true AND sv."BranchId" = ${branch}
         AND v."SODet_ItemOID" IN (${ids})
      UNION ALL
      SELECT n."NCDet_ItemOID", -COALESCE(n."NCDet_QTY", 0)
        FROM "t_NCDet" n
        JOIN "t_NCMstr" nm ON nm."NCMstr_OID" = n."NCDet_MStrOID"
       WHERE nm."NCMstr_IsActive" = true AND nm."BranchId" = ${branch}
         AND n."NCDet_ItemOID" IN (${ids})
      UNION ALL
      SELECT c."ItemOId", -COALESCE(c."Qty", 0)
        FROM "CSDetail" c
        JOIN "CSMaster" cm ON cm."InvNo" = c."InvNo"
       WHERE cm."IsActive" = 1 AND cm."BranchId" = ${branch}
         AND c."ItemOId" IN (${ids})
      UNION ALL
      SELECT cv."ItemOId"::uuid AS item_id, -COALESCE(cv."Qty", 0)
        FROM "CSVDetail" cv
        JOIN "CSVMaster" cvm ON cvm."InvNo" = cv."InvNo"
       WHERE cvm."BranchId" = ${branch}
         AND cv."ItemOId" = ANY (ARRAY[${ids}]::text[])
    ) AS m
    WHERE m.item_id IS NOT NULL
    GROUP BY m.item_id
  `;

  for (const row of rows) onHand.set(row.item_id, Number(row.qty) || 0);
  return onHand;
}

/**
 * Refuse a document that would drive stock below zero.
 *
 * - `takes` — what the document removes from stock.
 * - `returns` — what the document already holds and is about to give back. Edits
 *   are purge-and-replace, so an amendment is judged against
 *   (on hand + what its previous version took out); without this, re-saving an
 *   unchanged document would fail the check against its own deduction.
 * - `branchId` — the branch the stock actually leaves. Pass it. Without it only
 *   the company-wide `Inventory` balance is checked, which cannot catch a branch
 *   overdrawing itself — see `branchStockOnHand`.
 *
 * Both balances are enforced, and the branch one is the binding constraint in
 * practice. It is a hard block on every path, edits of historical documents
 * included: a document already sitting on a negative balance has to have that
 * balance corrected rather than simply re-saved.
 *
 * `Item_Information` is still read even though `Inventory` is keyed by the same
 * id: it validates the ids and supplies the name/code the shortage message
 * names the item by. Takes a client rather than reaching for `this.prisma` so
 * callers can run the check inside the very transaction that performs the
 * deduction — checking outside it leaves a window for two concurrent sales to
 * both pass.
 */
export async function assertStockAvailable(
  db: Prisma.TransactionClient,
  takes: StockLine[],
  returns: StockLine[] = [],
  branchId?: string | null,
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
    where: { itemId: { in: itemIds } },
    select: { itemId: true, quantity: true },
  });
  const onHand = new Map(rows.map((r) => [r.itemId, Number(r.quantity)]));

  const branchOnHand = branchId ? await branchStockOnHand(db, itemIds, branchId) : null;

  const shortages: string[] = [];
  const branchShortages: string[] = [];
  for (const [itemId, qty] of required) {
    const item = itemById.get(itemId)!;
    const label = item.itmName || item.itmCode;
    const giveBack = restored.get(itemId) ?? 0;
    // No Inventory row means the item has never been received — nothing to draw
    // on, and nothing for the deduction to decrement (it would otherwise fail
    // with an opaque Prisma "record not found"). `restored` can't rescue it:
    // giving a quantity back to a row that doesn't exist is a no-op, so the
    // balance really is zero either way.
    const available = onHand.has(itemId) ? r4(onHand.get(itemId)! + giveBack) : 0;
    if (r4(qty) > available) {
      shortages.push(`${label} — available ${available}, required ${r4(qty)}`);
    }
    if (branchOnHand) {
      // A branch with no movements at all rolls forward to zero, which is the
      // truth — unlike Inventory there is no "row missing" case to special-case.
      const atBranch = r4((branchOnHand.get(itemId) ?? 0) + giveBack);
      if (r4(qty) > atBranch) {
        branchShortages.push(`${label} — available ${atBranch}, required ${r4(qty)}`);
      }
    }
  }

  // Branch first: it is the tighter and the more actionable of the two, and
  // naming the branch is what tells the operator the goods exist but are
  // sitting somewhere else. The name is looked up only once something is
  // actually short — this runs inside the deducting transaction, where a round
  // trip spent on the happy path is a round trip against the clock (P2028).
  if (branchShortages.length) {
    const branch = await db.branch.findUnique({
      where: { id: branchId! },
      select: { branchName: true },
    });
    throw new BadRequestException(
      `Insufficient stock at ${branch?.branchName || 'this branch'}: ${branchShortages.join('; ')}`,
    );
  }
  if (shortages.length) {
    throw new BadRequestException(`Insufficient stock: ${shortages.join('; ')}`);
  }
}
