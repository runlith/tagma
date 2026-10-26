import { Clock, Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { mergeFileAt } from '@runlith/git/merge';
import { workingBlobTextsAt } from '@runlith/git/working';
import { contentDigest } from '@runlith/files/content';
import { actingGit, configuredGit, runGit } from '../../platform/git/ownGit.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { Holdings } from '../contract/service/holdings.js';
import { LineWrites } from '../contract/service/lineWrites.js';
import { RetireUnwritten } from '../contract/service/retirement.js';
import type { DebtSource } from '../contract/wire/reshape.js';
import { tokensOf } from '../lines/marks.js';
import type { CommandWrites } from '../record/commands.js';
import { READING_CAPTURE } from '../threadFiles/failures.js';
import { working } from '../threadFiles/sides.js';
import type { OwedPath, RetireStore } from './store.js';

type Sides = { readonly before: string; readonly after: string };

const unformed = (sides: Sides, text: string, head: string): boolean => {
  const owed = new Map<string, number>();
  for (const line of tokensOf(sides.before)) owed.set(line, (owed.get(line) ?? 0) + 1);
  for (const line of tokensOf(sides.after)) if (owed.has(line)) owed.set(line, (owed.get(line) as number) - 1);
  const counted = (lines: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of tokensOf(lines)) if ((owed.get(line) ?? 0) > 0) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const standing = counted(text);
  const landed = counted(head);
  for (const [line, count] of standing) if (count > (landed.get(line) ?? 0)) return true;
  return false;
};

export const makeDebts = Effect.fnUntraced(function* ({
  store,
  commands,
}: {
  readonly store: RetireStore;
  readonly commands: CommandWrites;
}) {
  const holdings = yield* Holdings;
  const git = yield* Git;
  const writes = yield* LineWrites;
  const files = yield* FileSystem.FileSystem;
  const clock = yield* Clock.Clock;

  const replayed = Effect.fn('Retirer.replay')(function* (
    dir: string,
    path: string,
    owed: { readonly commit: string; readonly source: DebtSource; readonly head: string | null },
    sides: Sides,
    ours: string,
  ) {
    const merge = (base: string, theirs: string, favor: 'none' | 'ours', into: string) =>
      mergeFileAt(actingGit(git, 'debt-merge'), dir, { base, ours: into, theirs }, { capture: READING_CAPTURE, favor });
    const direct = yield* merge(sides.before, sides.after, 'none', ours);
    if (direct.conflicts === 0 || owed.source !== 'steps' || owed.head === null || owed.head === owed.commit) return direct;
    const [landed, now] = (yield* runGit(git, 'debt-since', [
      '-C',
      dir,
      'rev-parse',
      `${owed.commit}:${path}`,
      `${owed.head}:${path}`,
    ])).split('\n');
    if (landed === undefined || now === undefined || landed === now) return direct;
    const [first, second] = yield* workingBlobTextsAt(
      configuredGit(git, 'debt-blobs'),
      dir,
      [
        { blob: landed, path },
        { blob: now, path },
      ],
      { capture: READING_CAPTURE },
    );
    if (first === undefined || second === undefined) return direct;
    const base = yield* Effect.fromResult(first);
    const head = yield* Effect.fromResult(second);
    if (base === null || head === null) return direct;
    const moved = (side: string) => (side === base ? Effect.succeed(head) : Effect.map(merge(base, side, 'ours', head), (one) => one.text));
    const rebased = yield* merge(yield* moved(sides.before), yield* moved(sides.after), 'none', ours);
    return rebased.conflicts > 0 || unformed(sides, rebased.text, head) ? direct : rebased;
  });

  const paid = Effect.fnUntraced(function* (checkout: RootId, dir: string, debts: readonly OwedPath[]) {
    const settled = new Set<OwedPath>();
    if (debts.length === 0) return settled;
    const owedBy = new Map<string, OwedPath[]>();
    for (const debt of debts) owedBy.set(debt.path, [...(owedBy.get(debt.path) ?? []), debt]);
    const judged = yield* holdings.judged(checkout, [...owedBy.keys()]);
    for (const [path, owing] of owedBy) {
      const one = judged.get(path);
      if (one === undefined || one.verdict.verdict !== 'proven' || one.verdict.lines === 'unweighed') continue;
      if (one.holding.verdict.verdict === 'proven' && one.holding.verdict.hands.some((hand) => hand.writing)) continue;
      const disk = yield* Effect.result(working(files, dir, path));
      if (disk._tag === 'Failure') {
        yield* Effect.logWarning('a commit-step debt waits for the next pass: its file could not be read', {
          checkout,
          path,
          reason: disk.failure.message,
        });
        continue;
      }
      const text = disk.success;
      const asked = owing.flatMap((debt) => [debt.before, debt.after].flatMap((blob) => (blob === null ? [] : [{ blob, path }])));
      const texts = yield* workingBlobTextsAt(configuredGit(git, 'debt-blobs'), dir, asked, { capture: READING_CAPTURE });
      const paid: OwedPath[] = [];
      let at = 0;
      let next = text;
      for (const debt of owing) {
        const sides: (string | null)[] = [];
        for (const blob of [debt.before, debt.after]) {
          if (blob === null) {
            sides.push(null);
            continue;
          }
          const read = texts[at++];
          if (read !== undefined && read._tag === 'Success' && read.success !== null) sides.push(read.success);
        }
        if (sides.length < 2) {
          yield* Effect.logWarning('a commit-step debt waits for the next pass: its blobs could not be read', {
            checkout,
            path,
            commit: debt.commit,
          });
          continue;
        }
        const [before, after] = sides as [string | null, string | null];
        if (next === after) {
          paid.push(debt);
          continue;
        }
        if (next === before) next = after;
        else if (next === text && one.verdict.lines.length === 0 && debt.source === 'steps') {
          paid.push(debt);
          continue;
        } else {
          if (before === null || after === null || next === null) continue;
          const merged = yield* Effect.result(
            replayed(dir, path, { commit: debt.commit, source: debt.source, head: one.head }, { before, after }, next),
          );
          if (merged._tag === 'Failure') {
            yield* Effect.logWarning('a commit-step debt waits for the next pass: its three texts could not be merged', {
              checkout,
              path,
              reason: merged.failure.message,
            });
            continue;
          }
          if (merged.success.conflicts > 0) continue;
          next = merged.success.text;
        }
        paid.push(debt);
      }
      if (next !== text) {
        const written = yield* Effect.provideService(
          writes.replace(
            {
              root: dir,
              path,
              before: text,
              after: next,
              publishing: () => commands.unowned(checkout, path, contentDigest(next ?? ''), clock.currentTimeMillisUnsafe()),
            },
            Effect.succeed(true),
          ),
          FileSystem.FileSystem,
          files,
        ).pipe(Effect.mapError((failure) => new RetireUnwritten({ path, reason: failure.message })));
        if (!written) continue;
      }
      for (const debt of paid) {
        yield* store.paid(debt);
        settled.add(debt);
      }
    }
    return settled;
  });

  const owed = Effect.fnUntraced(function* (checkout: RootId, dir: string) {
    const debts = yield* store.owed(checkout);
    if (debts.length === 0 || (yield* store.running(checkout))) return 0;
    const steps = debts.filter((debt) => debt.source === 'steps');
    const formed = yield* paid(checkout, dir, steps);
    const unformedPaths = new Set(steps.flatMap((debt) => (formed.has(debt) ? [] : [debt.path])));
    const posted = yield* paid(
      checkout,
      dir,
      debts.filter((debt) => debt.source === 'post-commit' && !unformedPaths.has(debt.path)),
    );
    return formed.size + posted.size;
  });

  return { owed };
});
