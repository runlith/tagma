import { Deferred, Effect, FiberSet } from 'effect';
import type {
  PresenceChange,
  PresenceEntry,
  PresenceMissingReason,
  PresenceRow,
  PresenceTail,
  PresenceTailStep,
} from '../contract/wire/presence.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { EvidenceFeed, ThreadEvidence, type PresenceSource } from '../contract/service/evidence.js';
import { ThreadList } from '../contract/service/list.js';
import { changeOf, presenceOf } from './projection.js';
import { ReasoningTail } from './tail.js';

export type PresenceNotice =
  | { readonly kind: 'changed'; readonly threadId: string; readonly revision: number; readonly fields: PresenceChange }
  | { readonly kind: 'missing'; readonly threadId: string; readonly revision: number }
  | { readonly kind: 'tail'; readonly threadId: string; readonly revision: number; readonly tail: PresenceTailStep | null }
  | { readonly kind: 'failed'; readonly failure: HarnessFailure };

export type Listener = (notice: PresenceNotice) => void;

type Watch = {
  readonly key: string;
  readonly threadId: string;
  readonly projectId: number;
  readonly listeners: Set<Listener>;
  readonly detaches: (() => void)[];
  readonly ready: Deferred.Deferred<void, HarnessFailure>;
  readonly tail: ReasoningTail;
  claimed: boolean;
  closed: boolean;
  reading: boolean;
  wanted: number;
  covered: number;
  absent: Exclude<PresenceMissingReason, 'deleted'> | null;
  gone: boolean;
  row: PresenceRow | null;
  revision: number;
};

export type Opening = {
  subscribe(listener: Listener): () => void;
  tailOf(threadId: string): PresenceTail | null;
  snapshot(): Effect.Effect<
    { readonly entries: readonly PresenceEntry[]; readonly covered: (notice: PresenceNotice) => boolean },
    HarnessFailure
  >;
};

export type Opens = { open(projectId: number, threadIds: readonly string[]): Opening };

export const makePresenceWatches = Effect.gen(function* () {
  const evidence = yield* ThreadEvidence;
  const list = yield* ThreadList;
  const feed = yield* EvidenceFeed;
  const run = yield* FiberSet.makeRuntime<never, void, never>();
  const watched = new Map<string, Watch>();

  const announce = (watch: Watch, notice: PresenceNotice): void => {
    for (const listener of watch.listeners) {
      try {
        listener(notice);
      } catch (error) {
        console.error('[tagma] a presence listener threw', { threadId: watch.threadId, kind: notice.kind }, error);
      }
    }
  };

  const drop = (watch: Watch): void => {
    if (watch.closed) return;
    watch.closed = true;
    for (const detach of watch.detaches) detach();
    if (watched.get(watch.key) === watch) watched.delete(watch.key);
  };

  const release = (watch: Watch, listener: Listener): void => {
    watch.listeners.delete(listener);
    if (watch.listeners.size === 0) drop(watch);
  };

  const settle = (watch: Watch, source: PresenceSource): void => {
    if (watch.gone || watch.row === null) return;
    if (source.outcome !== 'found') {
      watch.gone = true;
      watch.row = null;
      watch.revision += 1;
      announce(watch, { kind: 'missing', threadId: watch.threadId, revision: watch.revision });
      return;
    }
    const row = presenceOf(source.summary, source.status);
    const fields = changeOf(watch.row, row);
    if (fields === null) return;
    watch.row = row;
    watch.revision += 1;
    announce(watch, { kind: 'changed', threadId: watch.threadId, revision: watch.revision, fields });
  };

  const refresh = Effect.fnUntraced(
    function* (watch: Watch) {
      yield* Effect.yieldNow;
      for (;;) {
        watch.covered = watch.wanted;
        const source = yield* evidence.presenceOne(watch.threadId, watch.projectId);
        if (!watch.closed) settle(watch, source);
        if (watch.closed || watch.wanted === watch.covered) break;
      }
      watch.reading = false;
    },
    (work, watch) =>
      work.pipe(
        Effect.match({
          onFailure: (failure) => {
            watch.reading = false;
            announce(watch, { kind: 'failed', failure });
          },
          onSuccess: () => undefined,
        }),
      ),
  );

  const kick = (watch: Watch): void => {
    if (watch.reading) return;
    watch.reading = true;
    run(refresh(watch));
  };

  const schedule = (watch: Watch): void => {
    if (watch.closed || watch.gone) return;
    watch.wanted += 1;
    kick(watch);
  };

  const load = Effect.fnUntraced(function* (watches: readonly Watch[]) {
    const mine = watches.filter((watch) => !watch.claimed);
    for (const watch of mine) {
      watch.claimed = true;
      watch.reading = true;
      watch.covered = watch.wanted;
    }
    const first = mine[0];
    if (first !== undefined) {
      const read = yield* Effect.exit(
        evidence.presence(
          mine.map((watch) => watch.threadId),
          first.projectId,
        ),
      );
      if (read._tag === 'Failure') {
        for (const watch of mine) {
          drop(watch);
          Deferred.doneUnsafe(watch.ready, Effect.failCause(read.cause));
        }
      } else {
        const sources = new Map(read.value.map((source) => [source.threadId, source] as const));
        for (const watch of mine) {
          const source = sources.get(watch.threadId);
          watch.reading = false;
          if (source === undefined || source.outcome !== 'found') {
            watch.absent = source?.outcome ?? 'not-found';
            drop(watch);
          } else {
            watch.row = presenceOf(source.summary, source.status);
            watch.revision += 1;
            if (watch.wanted !== watch.covered) kick(watch);
          }
          Deferred.doneUnsafe(watch.ready, Effect.void);
        }
      }
    }
    for (const watch of watches) yield* Deferred.await(watch.ready);
  });

  const watch = (projectId: number, threadId: string): Watch => {
    const key = `${projectId}:${threadId}`;
    const held = watched.get(key);
    if (held !== undefined) return held;
    const made: Watch = {
      key,
      threadId,
      projectId,
      listeners: new Set(),
      detaches: [],
      ready: Deferred.makeUnsafe<void, HarnessFailure>(),
      tail: new ReasoningTail(() => feed.view(threadId)),
      claimed: false,
      closed: false,
      reading: false,
      wanted: 0,
      covered: 0,
      absent: null,
      gone: false,
      row: null,
      revision: 0,
    };
    watched.set(key, made);
    made.tail.seed();
    made.detaches.push(
      feed.subscribe(threadId, (event) => {
        if (event.type === 'state') schedule(made);
        const move = made.tail.apply(event);
        if (move !== undefined && !made.gone) {
          made.revision += 1;
          announce(made, { kind: 'tail', threadId, revision: made.revision, tail: move });
        }
      }),
      list.observe(threadId, () => schedule(made)),
    );
    return made;
  };

  const open: Opens['open'] = (projectId, threadIds) => {
    const ids = [...new Set(threadIds)];
    const held = new Map<string, Watch>();
    const sent = new Map<string, number>();
    return {
      tailOf: (threadId) => held.get(threadId)?.tail.current ?? null,
      subscribe: (listener) => {
        for (const id of ids) {
          const followed = watch(projectId, id);
          followed.listeners.add(listener);
          held.set(id, followed);
        }
        return () => {
          for (const followed of held.values()) release(followed, listener);
        };
      },
      snapshot: Effect.fnUntraced(function* () {
        yield* load([...held.values()]);
        const entries: PresenceEntry[] = [];
        sent.clear();
        for (const [id, followed] of held) sent.set(id, followed.revision);
        for (const id of ids) {
          const followed = held.get(id);
          const reason = followed?.absent ?? (followed?.gone ? 'deleted' : null);
          if (followed === undefined || reason !== null || followed.row === null) {
            entries.push({ type: 'missing', threadId: id, reason: reason ?? 'not-found' });
            continue;
          }
          const tail = followed.tail.current;
          entries.push({ type: 'row', revision: followed.revision, row: tail === null ? followed.row : { ...followed.row, tail } });
        }
        return {
          entries,
          covered: (notice: PresenceNotice) => notice.kind !== 'failed' && notice.revision <= (sent.get(notice.threadId) ?? 0),
        };
      }),
    };
  };

  return { open };
});
