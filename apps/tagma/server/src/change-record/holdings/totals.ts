import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import type { CheckoutTotals, Holding, ThreadTotals } from '../contract/wire/holdings.js';

type Counted = { paths: number; unproven: number; outside: number };

type CheckoutCounted = { paths: number; held: number; operator: number; nobody: number; unproven: number };

const OPERATOR_KEY = holderKey(OPERATOR);

const shown = (holding: Holding): boolean =>
  holding.git !== null || holding.verdict.verdict === 'unknown' || holding.verdict.hands.length > 0 || holding.verdict.nobody.length > 0;

export const holdersOf = (holding: Holding): readonly string[] =>
  holding.verdict.verdict === 'proven'
    ? holding.verdict.hands.map((hand) => holderKey(hand.holder))
    : holding.verdict.writers.map(holderKey);

export const owes = (holding: Holding, holder: string): boolean =>
  (holding.verdict.verdict === 'unknown' || holding.git !== 'ignored') && holdersOf(holding).includes(holder);

export class Totals {
  private readonly checkouts = new Map<string, CheckoutCounted>();

  private readonly holders = new Map<string, Map<string, Counted>>();

  apply(checkout: string, before: Holding | undefined, after: Holding | undefined): ReadonlySet<string> {
    const touched = new Set<string>();
    if (before !== undefined) this.count(checkout, before, -1, touched);
    if (after !== undefined) this.count(checkout, after, 1, touched);
    return touched;
  }

  checkout(checkout: string): CheckoutTotals {
    const counted = this.checkouts.get(checkout);
    return counted === undefined ? { paths: 0, held: 0, operator: 0, nobody: 0, unproven: 0 } : { ...counted };
  }

  holder(holder: string): ThreadTotals {
    const total = { paths: 0, unproven: 0, outside: 0 };
    for (const counted of this.holders.get(holder)?.values() ?? []) {
      total.paths += counted.paths;
      total.unproven += counted.unproven;
      total.outside += counted.outside;
    }
    return total;
  }

  checkoutsOf(holders: readonly string[]): readonly string[] {
    return [
      ...new Set(
        holders.flatMap((holder) =>
          [...(this.holders.get(holder) ?? [])].flatMap(([checkout, counted]) => (counted.paths + counted.unproven > 0 ? [checkout] : [])),
        ),
      ),
    ];
  }

  forget(checkout: string): ReadonlySet<string> {
    this.checkouts.delete(checkout);
    const touched = new Set<string>();
    for (const [holder, byCheckout] of this.holders) {
      if (!byCheckout.delete(checkout)) continue;
      touched.add(holder);
      if (byCheckout.size === 0) this.holders.delete(holder);
    }
    return touched;
  }

  private count(checkout: string, holding: Holding, sign: 1 | -1, touched: Set<string>): void {
    const totals = this.checkouts.get(checkout) ?? { paths: 0, held: 0, operator: 0, nobody: 0, unproven: 0 };
    this.checkouts.set(checkout, totals);
    const verdict = holding.verdict;
    const holders = holdersOf(holding);
    if (shown(holding)) totals.paths += sign;
    if (verdict.verdict === 'unknown') totals.unproven += sign;
    else if (verdict.hands.length > 0) totals.held += sign;
    else if (verdict.nobody.length > 0) totals.nobody += sign;
    if (verdict.verdict === 'proven' && holders.includes(OPERATOR_KEY)) totals.operator += sign;
    for (const holder of holders) {
      const byCheckout = this.holders.get(holder) ?? new Map<string, Counted>();
      this.holders.set(holder, byCheckout);
      const counted = byCheckout.get(checkout) ?? { paths: 0, unproven: 0, outside: 0 };
      byCheckout.set(checkout, counted);
      if (verdict.verdict === 'unknown') counted.unproven += sign;
      else if (holding.git === 'ignored') counted.outside += sign;
      else counted.paths += sign;
      if (counted.paths === 0 && counted.unproven === 0 && counted.outside === 0) byCheckout.delete(checkout);
      if (byCheckout.size === 0) this.holders.delete(holder);
      touched.add(holder);
    }
  }
}
