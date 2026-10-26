import { sep } from 'node:path';

const nameOrder = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const lastNames: readonly string[] = ['.gitattributes', '.git'];

const rank = (name: string): number => lastNames.indexOf(name) + 1;

export const siblingOrder = (left: string, right: string): number => rank(left) - rank(right) || nameOrder(left, right);

export function removalOrder(left: string, right: string): number {
  const one = left.split(sep);
  const other = right.split(sep);
  for (let at = 0; at < one.length && at < other.length; at++) {
    if (one[at] !== other[at]) return siblingOrder(one[at]!, other[at]!);
  }
  return other.length - one.length;
}
