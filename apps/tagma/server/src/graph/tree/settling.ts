import { Cause, Effect, Queue } from 'effect';
import { eventReason } from '@runlith/utils/worker';
import type { MergeSides } from '@runlith/git/merge';
import type { Settled, SettledFile, Settling, SettlingFiles, SettlingMerge, SideFile } from '@runlith/git/apart';
import { GitUnreadable } from '@runlith/git/repository';
import { type BlockFileInvalid, decodeBlockFile } from './blockFile.js';

type Joining = { readonly file: SideFile; readonly sides: MergeSides; readonly id: string };
type PlannedFile = SettledFile & { readonly merge?: number };

export type BlockSettlement = {
  readonly files: readonly PlannedFile[];
  readonly yielding: readonly (string | number)[];
  readonly joining: readonly Joining[];
};

export type SettlementJob =
  | { readonly phase: 'plan'; readonly files: SettlingFiles }
  | { readonly phase: 'finish'; readonly merged: readonly SettlingMerge[] };

export type SettlementAnswer =
  | { readonly state: 'ready' }
  | { readonly state: 'merge'; readonly sides: readonly MergeSides[] }
  | { readonly state: 'settled'; readonly settled: Settled | null };

const INDEX = 'index.md';
const ID_LINE = /^id: *(\S+) *$/m;

const identityOf = (text: string): Effect.Effect<string | BlockFileInvalid> =>
  Effect.map(Effect.result(decodeBlockFile(text)), (read) => (read._tag === 'Success' ? read.success.frontmatter.id : read.failure));

const byIdentity = (files: readonly SideFile[]): ReadonlyMap<string, readonly SideFile[]> => {
  const index = new Map<string, SideFile[]>();
  for (const file of files) {
    const id = ID_LINE.exec(file.text)?.[1];
    if (id === undefined) continue;
    const held = index.get(id);
    if (held === undefined) index.set(id, [file]);
    else held.push(file);
  }
  return index;
};

const directoriesOf = (paths: Iterable<string>): ReadonlySet<string> => {
  const directories = new Set<string>();
  for (const path of paths) {
    for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
      const directory = path.slice(0, cut + 1);
      if (directories.has(directory)) break;
      directories.add(directory);
    }
  }
  return directories;
};

export const planBlocks = Effect.fnUntraced(function* (settling: SettlingFiles) {
  const files = new Map<string, PlannedFile>();
  const yielding: (string | number)[] = [];
  const joining: Joining[] = [];
  const settled = new Set(settling.conflicts.map((conflict) => conflict.path));
  const indexes = new Map<readonly SideFile[], ReadonlyMap<string, readonly SideFile[]>>();
  const carrying = Effect.fnUntraced(function* (among: readonly SideFile[], id: string) {
    const index = indexes.get(among) ?? byIdentity(among);
    indexes.set(among, index);
    for (const file of index.get(id) ?? []) if (!settled.has(file.path) && (yield* identityOf(file.text)) === id) return file;
    return null;
  });
  const write = (file: SideFile) => files.set(file.path, file);
  const remove = (path: string) => files.set(path, { path, mode: '0', text: null });
  const join = (file: SideFile, sides: MergeSides, id: string) => {
    const merge = joining.length;
    joining.push({ file, sides, id });
    files.set(file.path, { ...file, merge });
    yielding.push(merge);
  };
  for (const { path, base, ours, theirs } of settling.conflicts) {
    const sides = [base, ours, theirs].filter((side) => side !== null);
    const ids = new Set<string>();
    for (const side of sides) {
      const id = yield* identityOf(side.text);
      if (typeof id !== 'string') return null;
      ids.add(id);
    }
    const [id] = ids;
    if (id === undefined || ids.size > 1) return null;
    if (base !== null && ours !== null && theirs !== null) {
      join(ours, { base: base.text, ours: ours.text, theirs: theirs.text }, id);
    } else if (base !== null && ours !== null) {
      const moved = yield* carrying(settling.arrived.theirs, id);
      if (moved === null) {
        write(ours);
        yielding.push(path);
      } else {
        join(moved, { base: base.text, ours: ours.text, theirs: moved.text }, id);
        remove(path);
      }
    } else if (base !== null && theirs !== null) {
      const moved = yield* carrying(settling.arrived.ours, id);
      if (moved === null) {
        remove(path);
        yielding.push(path);
      } else {
        join(moved, { base: base.text, ours: moved.text, theirs: theirs.text }, id);
        remove(path);
      }
    } else if (ours !== null && theirs !== null) {
      const was = yield* carrying(settling.left, id);
      join(ours, { base: was?.text ?? '', ours: ours.text, theirs: theirs.text }, id);
    } else return null;
  }
  const standing = directoriesOf(
    [...settling.arrived.ours, ...settling.arrived.theirs].flatMap((file) => (files.get(file.path)?.text === null ? [] : [file.path])),
  );
  for (const file of files.values()) {
    if (file.text === null && file.path.endsWith(`/${INDEX}`) && standing.has(file.path.slice(0, -INDEX.length))) return null;
  }
  return { files: [...files.values()], yielding, joining } satisfies BlockSettlement;
});

export const finishBlocks = Effect.fnUntraced(function* (plan: BlockSettlement, merged: readonly SettlingMerge[]) {
  const texts: string[] = [];
  const yielded = new Set<number>();
  for (const [at, joining] of plan.joining.entries()) {
    const read = merged[at]!;
    const valid = (yield* identityOf(read.text)) === joining.id;
    texts.push(valid ? read.text : joining.sides.ours);
    if (read.conflicted || !valid) yielded.add(at);
  }
  return {
    files: plan.files.map(({ path, mode, text, merge }) => ({ path, mode, text: merge === undefined ? text : texts[merge]! })),
    yielded: [
      ...new Set(
        plan.yielding.flatMap((one) => (typeof one === 'string' ? [one] : yielded.has(one) ? [plan.joining[one]!.file.path] : [])),
      ),
    ],
  } satisfies Settled;
});

export const settledBlocks = Effect.fn('graph.settledBlocks')(function* (settling: Settling) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const gone = (reason: string) =>
        new GitUnreadable({ command: ['tagma', 'merge-driver'], reason: `the graph settlement worker failed: ${reason}` });
      const answers = yield* Effect.acquireRelease(Queue.unbounded<SettlementAnswer, GitUnreadable>(), Queue.shutdown);
      const failed = (reason: string) => Queue.failCauseUnsafe(answers, Cause.fail(gone(reason)));
      const worker = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const worker = new Worker(new URL('./settling.worker.ts', import.meta.url), { type: 'module' });
            worker.addEventListener('message', (event: MessageEvent<SettlementAnswer>) => {
              if (event.data.state !== 'ready') Queue.offerUnsafe(answers, event.data);
              else {
                try {
                  worker.postMessage({
                    phase: 'plan',
                    files: { conflicts: settling.conflicts, arrived: settling.arrived, left: settling.left },
                  } satisfies SettlementJob);
                } catch (cause) {
                  failed(String(cause));
                }
              }
            });
            worker.addEventListener('error', (event: ErrorEvent) => failed(eventReason(event, 'the worker failed')));
            worker.addEventListener('messageerror', () => failed('the worker answer could not be read'));
            worker.addEventListener('close', () => failed('the worker closed before answering'));
            return worker;
          },
          catch: (cause) => gone(String(cause)),
        }),
        (worker) => Effect.sync(() => worker.terminate()),
      );
      const planned = yield* Queue.take(answers);
      if (planned.state === 'settled') return planned.settled;
      if (planned.state !== 'merge') return yield* gone('the worker answered no settlement plan');
      const merged = yield* settling.merge(planned.sides);
      yield* Effect.try({
        try: () => worker.postMessage({ phase: 'finish', merged } satisfies SettlementJob),
        catch: (cause) => gone(String(cause)),
      });
      const finished = yield* Queue.take(answers);
      if (finished.state !== 'settled') return yield* gone('the worker answered no settled files');
      return finished.settled;
    }),
  );
});
