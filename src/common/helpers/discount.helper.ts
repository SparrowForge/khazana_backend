/**
 * Invoice-level discounts are entered once against the whole document, but a
 * report that lists what was sold reads the *lines*. A discount that lives only
 * on the master is invisible there — the item rows add up to more than the
 * invoice was actually worth. So every document that takes a whole-invoice
 * discount pushes it down onto its lines at save time, and stores the per-line
 * share alongside the line.
 */

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Split `amount` across lines pro-rata by `bases` — normally each line's
 * VAT-inclusive value, the same base the percentage was charged on.
 *
 * The shares are rounded to 2dp individually, which never adds up on its own, so
 * the **largest** line absorbs the remainder: the parts then sum to `amount`
 * exactly without any line being handed a share bigger than its own value
 * merely because it happened to come last.
 *
 * Returns one amount per line, in the order given; all zeros when there is
 * nothing to spread or nothing to spread it over.
 */
export function allocateDiscount(bases: number[], amount: number): number[] {
  const shares = new Array<number>(bases.length).fill(0);
  const total = r2(amount);
  if (!bases.length || total <= 0) return shares;

  const positive = bases.map((b) => (Number.isFinite(b) && b > 0 ? b : 0));
  const gross = positive.reduce((s, b) => s + b, 0);
  if (gross <= 0) return shares;

  let biggest = 0;
  for (let i = 1; i < positive.length; i++) {
    if (positive[i] > positive[biggest]) biggest = i;
  }

  let placed = 0;
  for (let i = 0; i < positive.length; i++) {
    if (i === biggest) continue;
    shares[i] = r2((positive[i] / gross) * total);
    placed = r2(placed + shares[i]);
  }
  shares[biggest] = r2(total - placed);
  return shares;
}
