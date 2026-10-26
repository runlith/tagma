import type { CheckoutEntryStatus, CheckoutLines } from '@tagma/server/workspace/contract/wire/checkout';
import { CHECKOUT_DIRECTORY } from '@tagma/server/graph/contract/wire/storage';
import { pathGroups } from './pathGroups.js';

export type ChangeItem = {
  readonly path: string;
  readonly status: CheckoutEntryStatus | null;
  readonly lines: CheckoutLines;
};

const ROW_INSET = 18;

const DEPTH_STEP = 20;

export const insetOf = (depth: number): number => ROW_INSET + depth * DEPTH_STEP;

export const weightMark = (lines: CheckoutLines): string => (typeof lines === 'string' ? lines : `${lines.added}/${lines.removed}`);

const PICTURE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;

export const isPicture = (path: string): boolean => PICTURE.test(path);

const inGraph = (path: string): boolean => path === CHECKOUT_DIRECTORY || path.startsWith(`${CHECKOUT_DIRECTORY}/`);

export const opens = (item: { readonly path: string; readonly lines: CheckoutLines }): boolean =>
  !inGraph(item.path) && (item.lines !== 'binary' || isPicture(item.path));

export function shownOrder<T extends { readonly path: string }>(items: readonly T[], grouped: boolean): readonly T[] {
  return grouped ? pathGroups(items).flatMap((group) => group.entries) : items;
}

export function stepOf<T extends { readonly path: string; readonly lines?: CheckoutLines }>(
  items: readonly T[],
  at: string | null,
  step: 1 | -1,
  keyOf: (item: T) => string = (item) => item.path,
): T | null {
  const walked = items.filter((item) => item.lines === undefined || opens({ path: item.path, lines: item.lines }) || keyOf(item) === at);
  if (walked.length === 0) return null;
  const index = at === null ? -1 : walked.findIndex((item) => keyOf(item) === at);
  if (index === -1) return step === 1 ? (walked[0] ?? null) : (walked[walked.length - 1] ?? null);
  return walked[index + step] ?? null;
}
