import { Effect, Result, Schema } from 'effect';
import { GitUnreadable } from '@runlith/git/repository';
import type { MergeSides } from '@runlith/git/merge';
import type { MergeDriver } from '@runlith/git/apart';
import { type BlockFile, decodeBlockFile, encodeBlockFile } from '../../graph/tree/blockFile.js';
import { lawEnforcementSchema } from '../../graph/contract/wire/enforcement.js';
import { closedParsing } from '../../graph/contract/wire/fields.js';
import { settledBlocks } from '../../graph/tree/settling.js';
import { askOnce } from '../../graph/tree/oneShot.js';
import type { CountedDebt } from '../contract/wire/document.js';
import { MERGE_DRIVER } from './mergeDriver.js';

type Taken<T> = { readonly taken: T } | null;

const decodeLaw = Schema.decodeUnknownResult(lawEnforcementSchema);

const debtOf = (value: unknown): readonly CountedDebt[] | undefined => {
  const read = decodeLaw(value, closedParsing);
  return Result.isSuccess(read) ? read.success.debt : undefined;
};

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const threeWay = <T>(base: T, ours: T, theirs: T): Taken<T> =>
  same(ours, base) ? { taken: theirs } : same(theirs, base) || same(ours, theirs) ? { taken: ours } : null;

const lowest = (base: number | undefined, ours: number | undefined, theirs: number | undefined): Taken<number | undefined> =>
  base !== undefined && ours !== undefined && theirs !== undefined && ours <= base && theirs <= base
    ? { taken: Math.min(ours, theirs) }
    : threeWay(base, ours, theirs);

const countKept = (base: CountedDebt, side: CountedDebt): boolean => side.owner === base.owner && (side.count ?? 1) <= (base.count ?? 1);

const measured = (base: number | undefined, ours: number | undefined, theirs: number | undefined): Taken<number | undefined> =>
  ours !== undefined && theirs !== undefined && ours !== theirs && ours !== base && theirs !== base
    ? { taken: Math.min(ours, theirs) }
    : threeWay(base, ours, theirs);

const entryMerged = (
  base: CountedDebt | undefined,
  ours: CountedDebt | undefined,
  theirs: CountedDebt | undefined,
): Taken<CountedDebt | undefined> => {
  if (base === undefined) return threeWay(base, ours, theirs);
  if (ours === undefined) return theirs === undefined || countKept(base, theirs) ? { taken: undefined } : null;
  if (theirs === undefined) return countKept(base, ours) ? { taken: undefined } : null;
  const owner = threeWay(base.owner, ours.owner, theirs.owner);
  const value = measured(base.value, ours.value, theirs.value);
  const count = lowest(base.count ?? 1, ours.count ?? 1, theirs.count ?? 1);
  const held = threeWay(base.held, ours.held, theirs.held);
  if (owner === null || value === null || count === null || held === null) return null;
  return {
    taken: {
      fingerprint: base.fingerprint,
      owner: owner.taken,
      value: value.taken,
      count: count.taken === 1 ? undefined : count.taken,
      held: held.taken,
    },
  };
};

export const debtMerged = (
  base: readonly CountedDebt[],
  ours: readonly CountedDebt[],
  theirs: readonly CountedDebt[],
): readonly CountedDebt[] | null => {
  const at = (debt: readonly CountedDebt[]) => new Map(debt.map((entry) => [entry.fingerprint, entry] as const));
  const [was, mine, other] = [at(base), at(ours), at(theirs)];
  const merged: CountedDebt[] = [];
  for (const fingerprint of new Set([...mine.keys(), ...other.keys(), ...was.keys()])) {
    const entry = entryMerged(was.get(fingerprint), mine.get(fingerprint), other.get(fingerprint));
    if (entry === null) return null;
    if (entry.taken !== undefined) merged.push(entry.taken);
  }
  return merged;
};

const withDebt = (file: BlockFile, name: string, debt: readonly CountedDebt[]): BlockFile => {
  const fields = file.frontmatter.fields ?? {};
  return { ...file, frontmatter: { ...file.frontmatter, fields: { ...fields, [name]: { ...(fields[name] as object), debt } } } };
};

export const debtReconciled = Effect.fn('enforcement.debtReconciled')(function* (sides: MergeSides) {
  const read = yield* Effect.result(Effect.all([decodeBlockFile(sides.base), decodeBlockFile(sides.ours), decodeBlockFile(sides.theirs)]));
  if (Result.isFailure(read)) return sides;
  let [base, ours, theirs] = read.success;
  let moved = false;
  for (const [name, value] of Object.entries(ours.frontmatter.fields ?? {})) {
    const debts = [base.frontmatter.fields?.[name], value, theirs.frontmatter.fields?.[name]].map(debtOf);
    const [was, mine, other] = debts;
    if (was === undefined || mine === undefined || other === undefined) continue;
    const merged = debtMerged(was, mine, other);
    if (merged === null || (same(merged, was) && same(merged, mine) && same(merged, other))) continue;
    [base, ours, theirs] = [withDebt(base, name, merged), withDebt(ours, name, merged), withDebt(theirs, name, merged)];
    moved = true;
  }
  return moved ? { base: encodeBlockFile(base), ours: encodeBlockFile(ours), theirs: encodeBlockFile(theirs) } : sides;
});

export const graphDriver: MergeDriver & { readonly revision: string } = {
  name: MERGE_DRIVER,
  revision: 'settlement-batch-1',
  sides: (sides) =>
    (sides.length === 0
      ? Effect.succeed([])
      : askOnce<readonly MergeSides[], GitUnreadable>(
          new URL('./graphMerge.worker.ts', import.meta.url),
          sides,
          (reason) => new GitUnreadable({ command: ['tagma', 'merge-driver'], reason: `the graph merge worker failed: ${reason}` }),
        )
    ).pipe(Effect.withSpan('enforcement.debtReconciled')),
  settle: settledBlocks,
};
