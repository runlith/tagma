import type { Debt } from '@tagma/inspection/verdict';
import { ancestorAt } from '@runlith/git/history';
import { runEnded, troubleOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { CountedDebt } from '../contract/wire/document.js';

export const judgedDebt = (debt: readonly CountedDebt[]): Debt[] =>
  debt.map(({ fingerprint, count, held }) => ({ fingerprint, count, held: held === undefined ? undefined : true }));

const unread = (root: string, said: string, failure: Parameters<typeof troubleOf>[0]) =>
  new GateRefusal('inspection-failed', `git could not ${said} in ${root}: ${troubleOf(failure)}`, [
    'read what git said and clear it, then ask again',
  ]);

export const awaitingLanding = Effect.fn('enforcement.awaitingLanding')(function* (
  root: string,
  head: string,
  debt: readonly CountedDebt[],
  found: ReadonlySet<string>,
) {
  const byBase = new Map<string, { fingerprint: string; path: string }[]>();
  for (const { fingerprint, held } of debt) {
    if (held === undefined || found.has(fingerprint)) continue;
    byBase.set(held.base, [...(byBase.get(held.base) ?? []), { fingerprint, path: held.path }]);
  }
  const awaiting = new Set<string>();
  if (byBase.size === 0) return awaiting;
  const git = actingGit(yield* Git, 'enforcement-held');
  const files = yield* FileSystem.FileSystem;
  const present = new Map<string, boolean>();
  for (const [base, entries] of byBase) {
    if (base !== head) {
      const descends = yield* ancestorAt(git, root, base, head).pipe(
        Effect.mapError((failure) => unread(root, `say whether ${head} descends from ${base}`, failure)),
      );
      if (!descends) continue;
    }
    const paths = [...new Set(entries.map((one) => one.path))];
    const args = [
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      '--end-of-options',
      base,
      head,
      '--',
      ...paths.map((path) => `:(literal)${path}`),
    ];
    const moved =
      base === head
        ? new Set<string>()
        : new Set(
            (yield* runEnded(git, root, args, undefined, []).pipe(
              Effect.mapError((failure) => unread(root, `compare ${base} and ${head}`, failure)),
            )).stdout
              .split('\0')
              .filter((path) => path !== ''),
          );
    for (const one of entries) {
      if (moved.has(one.path)) continue;
      const exists =
        present.get(one.path) ??
        (yield* files
          .exists(join(root, one.path))
          .pipe(
            Effect.mapError(
              (failure) =>
                new GateRefusal('inspection-failed', `could not read ${one.path} in ${root}: ${failure.message}`, [
                  'clear the file access failure, then ask again',
                ]),
            ),
          ));
      present.set(one.path, exists);
      if (exists) awaiting.add(one.fingerprint);
    }
  }
  return awaiting;
});
