import { isAbsolute, join, relative } from 'node:path';
import { type Assembled, follows, modulesRenamed, relocated } from '@tagma/inspection/builtins';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import type { BlockRow } from '../graph/contract/service/acts.js';
import { ServedTree } from '../graph/contract/service/serving.js';
import { runGit } from '../platform/git/ownGit.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { Measurement, RuleViolation } from './contract/wire/enforcement.js';
import { type CountedDebt, isProgrammed, type Programmed } from './contract/wire/document.js';

export type Renamed = { readonly from: string; readonly to: string };

export const lineageFrom = Effect.fn('enforcement.lineageFrom')(function* (
  root: string,
  rule: BlockRow,
  measured: Measurement | undefined,
) {
  if (measured !== undefined) return measured.commit;
  const tree = yield* ServedTree;
  if (tree === null || rule.path === null) return null;
  const file = join(tree.treeRoot, rule.path);
  const within = relative(root, file);
  if (within === '' || within.startsWith('..') || isAbsolute(within)) return null;
  const answer = yield* runGit(yield* Git, 'enforcement-lineage', [
    '-C',
    root,
    'log',
    '-1',
    '--format=%H %P',
    'HEAD',
    '--',
    `:(literal)${within}`,
  ]).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('inspection-failed', `the history of ${within} could not be read: ${failure.message}`, [
          'read the git error and run enforce_rule again',
        ]),
    ),
  );
  const [commit, parent] = answer.trim().split(' ');
  return parent ?? (commit === undefined || commit === '' ? null : commit);
});

export const renamedBetween = Effect.fn('enforcement.renamedBetween')(function* (
  root: string,
  from: string | null,
  to: string,
  base: string,
) {
  if (from === null || from === to) return [] as readonly Renamed[];
  const args = [
    '-C',
    root,
    'diff',
    '--find-renames',
    '--diff-filter=R',
    '--name-status',
    '-z',
    '--end-of-options',
    from,
    to,
    '--',
    ...(base === '' ? [] : [`:(literal)${base}`]),
  ];
  const answer = yield* runGit(yield* Git, 'enforcement-lineage', args).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('inspection-failed', `rename history could not be read: ${failure.message}`, [
          'read the git error and run enforce_rule again',
        ]),
    ),
  );
  const fields = answer.split('\0');
  const renamed: Renamed[] = [];
  for (let at = 0; at + 2 < fields.length; at += 3) {
    const [status, old, now] = [fields[at] ?? '', fields[at + 1] ?? '', fields[at + 2] ?? ''];
    if (status.startsWith('R') && old !== '' && now !== '') renamed.push({ from: old, to: now });
  }
  return renamed as readonly Renamed[];
});

export const followedDebt = (
  inspection: Assembled,
  debt: readonly CountedDebt[],
  found: ReadonlyMap<string, RuleViolation>,
  renamed: readonly Renamed[],
  reserved: readonly CountedDebt[] = debt,
): readonly CountedDebt[] => {
  if (renamed.length === 0) return debt;
  const owed = new Set(reserved.map(({ fingerprint }) => fingerprint));
  return debt.map((entry) => {
    if (found.has(entry.fingerprint)) return entry;
    for (const { from, to } of renamed) {
      const next = relocated(inspection, entry.fingerprint, from, to);
      if (next === undefined || owed.has(next) || !follows(inspection, next)) continue;
      const measured = found.get(next);
      if (measured === undefined) continue;
      owed.add(next);
      return { ...entry, fingerprint: next, value: measured.value ?? entry.value };
    }
    return entry;
  });
};

export const renamedModuleDebt = (
  inspection: Assembled | Programmed,
  debt: readonly CountedDebt[],
  found: ReadonlyMap<string, RuleViolation>,
  renamed: ReadonlyMap<string, string>,
): readonly CountedDebt[] => {
  if (renamed.size === 0 || isProgrammed(inspection)) return debt;
  return debt.map((entry) => {
    const next = modulesRenamed(inspection, entry.fingerprint, renamed);
    return next === undefined ? entry : { ...entry, fingerprint: next, value: found.get(next)?.value ?? entry.value };
  });
};

export const needsLineage = (debt: readonly CountedDebt[], found: ReadonlyMap<string, RuleViolation>): boolean => {
  const owed = new Set(debt.map(({ fingerprint }) => fingerprint));
  return debt.some(({ fingerprint }) => !found.has(fingerprint)) && [...found.keys()].some((fingerprint) => !owed.has(fingerprint));
};
