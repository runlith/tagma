import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { Effect, type Fiber, Queue, Scope, Semaphore, Stream } from 'effect';
import { workingAt, type Working } from '@runlith/files/working';
import { CheckoutWatch, type CheckoutShift, type Following } from '../../workspace/contract/service/watch.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../workspace/contract/wire/roots.js';
import { Renames } from '../contract/service/renames.js';
import type { DocumentFrame } from '../contract/wire/document.js';
import type { LooseFile, Target, Targets } from '../tree/target.js';
import type { FilesWorker } from '../worker/client.js';
import { type Current, type TextCurrent, frameOf, queued, readCurrent, sameCurrent } from './current.js';
import { inlineEdits } from './edits.js';
import type { FolderWatches } from './folders.js';

const BACKLOG = 32;

const LOW_WATER = 0.75;

const MIB = 1024 * 1024;

export const retainedBudget = (memory: number = totalmem()): number => Math.max(16 * MIB, Math.floor(memory / 64));

type Sub = { frames: DocumentFrame[]; wake: (() => void) | null; primed: boolean };

type Folder<E> = {
  readonly key: string;
  readonly real: string;
  readonly checkout: RootId | null;
  readonly follow: Effect.Effect<Following, E>;
};

type Cell = {
  readonly checkout: RootId | null;
  readonly root: string;
  readonly path: string;
  readonly abs: string;
  readonly subs: Set<Sub>;
  readonly lock: Semaphore.Semaphore;
  current: Current | null;
  detached: boolean;
  touched: number;
};

type Rooted = {
  readonly key: string;
  readonly real: string;
  readonly checkout: RootId | null;
  readonly cells: Map<string, Cell>;
  following: Following;
  consumer: Fiber.Fiber<void> | null;
};

type Joined = { readonly rooted: Rooted; readonly cell: Cell; readonly sub: Sub };

export type Wrote = { readonly before: Current; readonly after: TextCurrent };

export type Writing<A> = { readonly answer: A; readonly wrote: Wrote | null };

const sizeOf = (current: Current | null): number => (current?.kind === 'text' && current.text !== null ? current.text.length * 2 : 0);

const written = (frame: DocumentFrame, write: string | undefined): DocumentFrame =>
  write !== undefined && (frame.kind === 'change' || frame.kind === 'whole') ? { ...frame, write } : frame;

export const makeOpenDocuments = Effect.fnUntraced(function* (input: {
  readonly targets: Targets;
  readonly worker: FilesWorker;
  readonly folders: FolderWatches;
  readonly budget?: number;
  readonly stat?: (path: string) => Effect.Effect<Working>;
}) {
  const watch = yield* CheckoutWatch;
  const renames = yield* Renames;
  const scope = yield* Scope.Scope;
  const { targets, worker, folders } = input;
  const budget = input.budget ?? retainedBudget();
  const stat = input.stat ?? ((path: string) => Effect.suspend(() => workingAt(path, Date.now())));
  const roots = new Map<string, Rooted>();
  const reading = availableParallelism();
  let held = 0;
  let tick = 0;

  const checkoutFolder = (place: ProjectRoot, real: string): Folder<RootResolutionFailure> => ({
    key: `checkout:${place.rootId}`,
    real,
    checkout: place.rootId,
    follow: watch.follow(place.rootId),
  });

  const looseFolder = (file: LooseFile): Folder<never> => ({
    key: `loose:${file.dir}`,
    real: file.dir,
    checkout: null,
    follow: folders.follow(file.dir),
  });

  const stream = <E>(joining: Effect.Effect<Joined, E>): Stream.Stream<DocumentFrame, E> =>
    Stream.unwrap(
      Effect.map(
        Effect.acquireRelease(joining, (joined) => Effect.sync(() => leave(joined))),
        ({ sub }) =>
          Stream.callback<void>(
            (queue) =>
              Effect.acquireRelease(
                Effect.sync(() => {
                  sub.wake = () => void Queue.offerUnsafe(queue, undefined);
                  if (sub.frames.length > 0) sub.wake();
                }),
                () => Effect.sync(() => void (sub.wake = null)),
              ),
            { bufferSize: 1, strategy: 'sliding' },
          ).pipe(
            Stream.flatMap(() =>
              Stream.suspend(() => {
                const out = sub.frames;
                sub.frames = [];
                return Stream.fromIterable(out);
              }),
            ),
          ),
      ),
    );

  const joinCell = Effect.fnUntraced(function* <E>(folder: Folder<E>, key: string) {
    for (;;) {
      const rooted = yield* rootedOf(folder);
      if (roots.get(folder.key) !== rooted) continue;
      const cell = rooted.cells.get(key) ?? opened(rooted, key);
      const sub: Sub = { frames: [], wake: null, primed: false };
      cell.subs.add(sub);
      cell.touched = ++tick;
      yield* cell.lock.withPermit(prime(cell, sub));
      return { rooted, cell, sub } satisfies Joined;
    }
  });

  const prime = Effect.fnUntraced(function* (cell: Cell, sub: Sub) {
    if (cell.current === null || frameOf(cell.current) === null) yield* once(cell);
    const standing = cell.current === null ? null : frameOf(cell.current);
    if (standing !== null) sub.frames.push(standing);
    sub.primed = true;
  });

  const opened = (rooted: Rooted, path: string): Cell => {
    const cell: Cell = {
      checkout: rooted.checkout,
      root: rooted.real,
      path,
      abs: join(rooted.real, path),
      subs: new Set(),
      lock: Semaphore.makeUnsafe(1),
      current: null,
      detached: false,
      touched: 0,
    };
    rooted.cells.set(path, cell);
    return cell;
  };

  const rootedOf = Effect.fnUntraced(function* <E>(folder: Folder<E>) {
    const standing = roots.get(folder.key);
    if (standing !== undefined && standing.real === folder.real) return standing;
    const following = yield* folder.follow;
    const raced = roots.get(folder.key);
    if (raced !== undefined && raced.real === folder.real) {
      following.release();
      return raced;
    }
    const rooted: Rooted = { key: folder.key, real: folder.real, checkout: folder.checkout, cells: new Map(), following, consumer: null };
    if (raced !== undefined) retire(raced);
    roots.set(folder.key, rooted);
    rooted.consumer = yield* Effect.forkIn(
      Stream.runForEach(following.shifts, (shift) => dispatch(rooted, shift)),
      scope,
    );
    return rooted;
  });

  const retire = (rooted: Rooted): void => {
    rooted.consumer?.interruptUnsafe();
    rooted.following.release();
    if (roots.get(rooted.key) === rooted) roots.delete(rooted.key);
    for (const cell of rooted.cells.values()) detach(cell);
    rooted.cells.clear();
  };

  const detach = (cell: Cell): void => {
    if (cell.detached) return;
    held -= sizeOf(cell.current);
    cell.detached = true;
  };

  const leave = ({ rooted, cell, sub }: Joined): void => {
    cell.subs.delete(sub);
    if (cell.subs.size > 0) return;
    if (rooted.cells.get(cell.path) === cell) rooted.cells.delete(cell.path);
    detach(cell);
    if (rooted.cells.size === 0) retire(rooted);
  };

  const dispatch = (rooted: Rooted, shift: CheckoutShift): Effect.Effect<void> => {
    const hit = new Set<Cell>();
    if (shift.rescan !== null) for (const cell of rooted.cells.values()) hit.add(cell);
    else {
      for (const [path, move] of shift.paths) {
        const cell = rooted.cells.get(path);
        if (cell !== undefined) hit.add(cell);
        if (move !== 'rename') continue;
        for (const other of rooted.cells.values()) if (other.path.startsWith(`${path}/`)) hit.add(other);
      }
    }
    return Effect.forEach([...hit], (cell) => cell.lock.withPermit(once(cell)), { concurrency: reading, discard: true });
  };

  const once = Effect.fn('Document.refresh')(function* (cell: Cell) {
    yield* Effect.annotateCurrentSpan({ path: cell.path });
    const standing = cell.current;
    const next = yield* readCurrent(cell.abs, stat(cell.abs), standing);
    if (next === standing) return;
    if (next.kind === 'gone') {
      if (standing?.kind === 'gone' || standing?.kind === 'moved') return;
      const vanished = yield* gone(cell);
      advance(cell, vanished, frameOf(vanished));
      return;
    }
    const frame = yield* transition(standing, next);
    const kept = frame === null && standing?.kind === 'text' && next.kind === 'text' && standing.write !== undefined;
    advance(cell, kept ? { ...next, write: standing.write } : next, frame);
  });

  const settle = Effect.fn('Document.wrote')(function* (cell: Cell, wrote: Wrote) {
    yield* Effect.annotateCurrentSpan({ path: cell.path });
    const { before, after } = wrote;
    if (cell.current !== null && !sameCurrent(cell.current, before)) advance(cell, before, yield* transition(cell.current, before));
    const frame = yield* transition(cell.current, after);
    advance(cell, after, frame === null ? null : written(frame, after.write));
  });

  const locked = <A, E, R>(folder: string, real: string, key: string, work: Effect.Effect<Writing<A>, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const rooted = roots.get(folder);
      const cell = rooted !== undefined && rooted.real === real ? rooted.cells.get(key) : undefined;
      if (cell === undefined) return Effect.map(work, (done) => done.answer);
      return cell.lock.withPermit(
        Effect.flatMap(work, (done) =>
          done.wrote === null ? Effect.succeed(done.answer) : Effect.as(settle(cell, done.wrote), done.answer),
        ),
      );
    });

  const advance = (cell: Cell, next: Current, frame: DocumentFrame | null): void => {
    setCurrent(cell, next);
    cell.touched = ++tick;
    evict(cell);
    if (frame !== null) broadcast(cell, frame, next);
  };

  const gone = Effect.fnUntraced(function* (cell: Cell) {
    const checkout = cell.checkout;
    if (checkout === null) return { kind: 'gone' } as const;
    const found = yield* Effect.result(renames.movedTo({ checkout, path: cell.path }));
    if (found._tag === 'Failure') {
      return {
        kind: 'unreadable',
        reason: `${cell.path} is gone and whether it moved could not be read: ${found.failure.message}`,
      } as const;
    }
    if (found.success === null || (yield* stat(join(cell.root, found.success))).kind === 'absent') return { kind: 'gone' } as const;
    return { kind: 'moved', path: found.success } as const;
  });

  const setCurrent = (cell: Cell, next: Current): void => {
    if (cell.detached) return;
    held += sizeOf(next) - sizeOf(cell.current);
    cell.current = next;
  };

  const transition = Effect.fnUntraced(function* (standing: Current | null, next: Current) {
    if (standing !== null && sameCurrent(standing, next)) return null;
    if (
      standing?.kind === 'text' &&
      standing.text !== null &&
      next.kind === 'text' &&
      next.text !== null &&
      standing.readOnly === next.readOnly
    ) {
      const edits = yield* diff(standing.text, next.text);
      if (edits !== null) return { kind: 'change', digest: next.digest, edits } satisfies DocumentFrame;
    }
    return frameOf(next);
  });

  const diff = Effect.fnUntraced(function* (before: string, after: string) {
    const inline = inlineEdits(before, after);
    if (inline !== 'heavy') return inline.edits;
    const answer = yield* Effect.result(worker.ask({ kind: 'diff', before, after }));
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning('the document diff worker did not answer; the whole text follows', { reason: answer.failure.message });
      return null;
    }
    return answer.success.kind === 'edited' ? answer.success.edits : null;
  });

  const broadcast = (cell: Cell, frame: DocumentFrame, current: Current): void => {
    const whole = frameOf(current);
    for (const sub of cell.subs) {
      if (!sub.primed) continue;
      sub.frames = queued(sub.frames, frame, whole, BACKLOG);
      sub.wake?.();
    }
  };

  const evict = (keep: Cell): void => {
    if (held <= budget) return;
    const low = Math.floor(budget * LOW_WATER);
    const cells = [...roots.values()]
      .flatMap((rooted) => [...rooted.cells.values()])
      .filter((cell) => cell !== keep && sizeOf(cell.current) > 0);
    cells.sort((left, right) => left.touched - right.touched);
    for (const cell of cells) {
      if (held <= low) return;
      if (cell.current?.kind === 'text') setCurrent(cell, { ...cell.current, text: null });
    }
  };

  return {
    subscribe: (place: ProjectRoot, path: string) =>
      stream(Effect.flatMap(targets.of(place, path, 'follow'), (target) => joinCell(checkoutFolder(place, target.real), target.key))),

    subscribeLoose: (file: LooseFile): Stream.Stream<DocumentFrame> => stream(joinCell(looseFolder(file), file.name)),

    holding: <A, E, R>(place: ProjectRoot, target: Target, work: Effect.Effect<Writing<A>, E, R>): Effect.Effect<A, E, R> =>
      locked(`checkout:${place.rootId}`, target.real, target.key, work),

    holdingLoose: <A, E, R>(file: LooseFile, work: Effect.Effect<Writing<A>, E, R>): Effect.Effect<A, E, R> =>
      locked(`loose:${file.dir}`, file.dir, file.name, work),
  };
});

export type OpenDocuments = Effect.Success<ReturnType<typeof makeOpenDocuments>>;
