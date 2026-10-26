import { Deferred, Effect, type Exit } from 'effect';
import type { CommandSelection } from '../contract/service/commands.js';

export const UNIT_BOUND = 64;

type Sessioned = { readonly projectId: number; readonly threadId: string; readonly key: string; readonly paths: ReadonlySet<string> };

type Queued<Entry> = { readonly entry: Entry; readonly seq: number };

type Barrier<E> = { readonly target: number; readonly done: Deferred.Deferred<void, E> };

const chosen = (selection: CommandSelection, entry: Sessioned): boolean =>
  ('projectId' in selection ? entry.projectId === selection.projectId : entry.key === selection.checkout) &&
  (selection.threadId === undefined || entry.threadId === selection.threadId) &&
  (selection.paths === undefined || selection.paths.some((path) => entry.paths.has(path)));

class Lane<Entry extends Sessioned, E> {
  waiting: Queued<Entry>[] = [];
  writing: readonly Queued<Entry>[] = [];
  appended = 0;
  draining = false;
  readonly barriers = new Set<Barrier<E>>();
  readonly projects = new Map<number, number>();
  readonly checkouts = new Map<string, number>();

  constructor(readonly key: string) {}

  target(selection: CommandSelection): number {
    const last =
      this.waiting.findLast((held) => chosen(selection, held.entry)) ?? this.writing.findLast((held) => chosen(selection, held.entry));
    return last?.seq ?? 0;
  }

  endings(exit: Exit.Exit<void, E>, written: number): readonly (() => void)[] {
    const endings: (() => void)[] = [];
    for (const barrier of [...this.barriers]) {
      if (exit._tag === 'Success' && barrier.target > written) continue;
      this.barriers.delete(barrier);
      endings.push(() => Deferred.doneUnsafe(barrier.done, exit));
    }
    return endings;
  }
}

export type CommandQueue<Entry extends Sessioned, E = never> = ReturnType<typeof makeCommandQueue<Entry, E>>;

export const makeCommandQueue = <Entry extends Sessioned, E = never>({
  write,
}: {
  readonly write: (entries: readonly Entry[]) => Effect.Effect<void, E>;
}) => {
  const lanes = new Map<string, Lane<Entry, E>>();
  const byProject = new Map<number, Set<Lane<Entry, E>>>();
  const byCheckout = new Map<string, Set<Lane<Entry, E>>>();

  const release = (lane: Lane<Entry, E>, entry: Entry): void => {
    const { projectId, key } = entry;
    const remaining = (lane.checkouts.get(key) ?? 0) - 1;
    if (remaining > 0) lane.checkouts.set(key, remaining);
    else {
      lane.checkouts.delete(key);
      const checkouts = byCheckout.get(key);
      checkouts?.delete(lane);
      if (checkouts?.size === 0) byCheckout.delete(key);
    }
    const left = (lane.projects.get(projectId) ?? 0) - 1;
    if (left > 0) {
      lane.projects.set(projectId, left);
      return;
    }
    lane.projects.delete(projectId);
    const projects = byProject.get(projectId);
    projects?.delete(lane);
    if (projects?.size === 0) byProject.delete(projectId);
  };

  const take = (lane: Lane<Entry, E>): readonly Queued<Entry>[] => {
    if (lane.waiting.length === 0) {
      lane.draining = false;
      lanes.delete(lane.key);
      return [];
    }
    lane.writing = lane.waiting.splice(0, UNIT_BOUND);
    return lane.writing;
  };

  const settle = (lane: Lane<Entry, E>, batch: readonly Queued<Entry>[], exit: Exit.Exit<void, E>): boolean => {
    lane.writing = [];
    if (exit._tag === 'Failure') {
      lane.waiting = [...batch, ...lane.waiting];
      lane.draining = false;
    } else {
      for (const held of batch) release(lane, held.entry);
    }
    const endings = lane.endings(exit, batch[batch.length - 1]?.seq ?? 0);
    for (const end of endings) end();
    return exit._tag === 'Success';
  };

  const abandon = (lane: Lane<Entry, E>): void => {
    for (const held of [...lane.writing, ...lane.waiting]) release(lane, held.entry);
    lane.writing = [];
    lane.waiting = [];
    lane.draining = false;
    lanes.delete(lane.key);
    const barriers = [...lane.barriers];
    lane.barriers.clear();
    for (const barrier of barriers) Deferred.doneUnsafe(barrier.done, Effect.interrupt);
  };

  const drain = Effect.fnUntraced(
    function* (lane: Lane<Entry, E>) {
      while (true) {
        const batch = yield* Effect.sync(() => take(lane));
        if (batch.length === 0) return;
        const exit = yield* Effect.exit(write(batch.map((held) => held.entry)));
        if (!(yield* Effect.sync(() => settle(lane, batch, exit)))) return;
      }
    },
    (effect, lane) => Effect.onInterrupt(effect, () => Effect.sync(() => abandon(lane))),
  );

  const started = (lane: Lane<Entry, E>): Effect.Effect<void> => {
    lane.draining = true;
    return Effect.asVoid(Effect.forkDetach(drain(lane)));
  };

  return {
    append: (key: string, entries: readonly Entry[]) =>
      Effect.uninterruptible(
        Effect.suspend(() => {
          if (entries.length === 0) return Effect.void;
          const lane = lanes.get(key) ?? new Lane<Entry, E>(key);
          lanes.set(key, lane);
          for (const entry of entries) {
            lane.appended += 1;
            lane.waiting.push({ entry, seq: lane.appended });
            lane.projects.set(entry.projectId, (lane.projects.get(entry.projectId) ?? 0) + 1);
            const projects = byProject.get(entry.projectId) ?? new Set<Lane<Entry, E>>();
            projects.add(lane);
            byProject.set(entry.projectId, projects);
            lane.checkouts.set(entry.key, (lane.checkouts.get(entry.key) ?? 0) + 1);
            const checkouts = byCheckout.get(entry.key) ?? new Set<Lane<Entry, E>>();
            checkouts.add(lane);
            byCheckout.set(entry.key, checkouts);
          }
          return lane.draining ? Effect.void : started(lane);
        }),
      ),
    settled: (selection: CommandSelection) =>
      Effect.uninterruptible(
        Effect.suspend(() => {
          const waits: Deferred.Deferred<void, E>[] = [];
          const stalled: Lane<Entry, E>[] = [];
          const selected = 'projectId' in selection ? byProject.get(selection.projectId) : byCheckout.get(selection.checkout);
          for (const lane of selected ?? []) {
            const target = lane.target(selection);
            if (target === 0) continue;
            const done = Deferred.makeUnsafe<void, E>();
            lane.barriers.add({ target, done });
            waits.push(done);
            if (!lane.draining) stalled.push(lane);
          }
          return Effect.as(Effect.forEach(stalled, started, { discard: true }), waits);
        }),
      ).pipe(Effect.flatMap((waits) => Effect.forEach(waits, (done) => Deferred.await(done), { discard: true }))),
  };
};
