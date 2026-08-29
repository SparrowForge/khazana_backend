/**
 * A bill is settled in notes and coins, not in paisa, so the amount a customer
 * is asked for is rounded to the whole taka: ৳4949.99 is charged, printed and
 * recorded as ৳4950.
 *
 * The rounding is applied to the PAYABLE only. Item lines, VAT and the
 * authorised discount all keep their exact values, because they are what the
 * sale actually consisted of and what item-level reporting is built from.
 *
 * That leaves a documented gap: a bill can be worth up to ৳0.50 more or less
 * than the sum of its own lines. It is unavoidable when rounding to nearest —
 * rounding up is a surcharge, and there is no column anywhere in the schema
 * that records one. Reports that read line detail (Stock Analysis, Production &
 * Delivery, Daily Final) therefore keep reading exact values; only the figure
 * presented to a customer as "payable" is rounded.
 */
export function roundPayable(amount: number): number {
  return Math.round(amount);
}
