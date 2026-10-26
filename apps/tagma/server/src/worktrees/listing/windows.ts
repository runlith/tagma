import { Effect, Exit, Queue, Scope, Stream } from 'effect';
import type { WorktreeElsewhere, WorktreeFeedEvent, WorktreePlace, WorktreeRow, WorktreeWindow } from '../contract/wire/rows.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { FeedReads, Frames, WorktreeFeedFailure } from './membership.js';
import { makeWorktreeFeed, type FeedOptions } from './feed.js';
import type { ProjectMoved } from '../contract/service/listing.js';
import type { ThreadsMoved } from '../contract/service/finishingGate.js';

export const placeOf = (row: WorktreeRow): WorktreePlace => ({
  index: row.index,
  rootId: row.rootId,
  kind: row.kind,
  name: row.name,
  folder: row.folder,
  branch: row.branch,
  base: row.base,
  hue: row.hue,
  head: row.head,
  headTime: row.headTime,
  missing: row.missing,
  agents: row.agents,
  threads: row.threads,
  setup: row.setup,
  taskId: row.taskId,
  pending: row.pending,
  movedAt: row.movedAt,
});

type Reader = { readonly window: WorktreeWindow; readonly frames: Frames; opened: boolean };
type Session = {
  readonly scope: Scope.Closeable;
  readonly readers: Set<Reader>;
  readonly listeners: Set<() => void>;
  rows: Map<RootId, WorktreeRow>;
  order: readonly RootId[];
  elsewhere: readonly WorktreeElsewhere[];
  places: Map<RootId, WorktreePlace>;
  acts: Extract<WorktreeFeedEvent, { readonly kind: 'acts' }>;
  known: boolean;
};

export const makeWindows = Effect.fnUntraced(function* (input: {
  readonly reads: FeedReads;
  readonly recorded: ProjectMoved;
  readonly threadsMoved: ThreadsMoved;
  readonly options: Omit<FeedOptions, 'visible' | 'interestsMoved'>;
}) {
  const scope = yield* Effect.scope;
  const sessions = new Map<number, Session>();
  const rowsIn = (session: Session, window: WorktreeWindow): readonly WorktreeRow[] =>
    session.order.slice(window.start, window.start + window.limit).flatMap((rootId) => {
      const row = session.rows.get(rootId);
      return row === undefined ? [] : [row];
    });
  const visible = (session: Session): ReadonlySet<string> =>
    new Set([...session.readers].flatMap(({ window }) => session.order.slice(window.start, window.start + window.limit)));
  const interested = (session: Session): void => {
    for (const listener of session.listeners) listener();
  };

  const publish = Effect.fnUntraced(function* (session: Session, event: WorktreeFeedEvent) {
    if (event.kind === 'acts') {
      session.acts = event;
      for (const reader of session.readers) yield* Queue.offer(reader.frames, event);
      return;
    }
    if (event.kind === 'places') return;
    const beforeVisible = event.kind === 'list' ? visible(session) : null;
    let removed: RootId[] = [];
    let upsert: WorktreePlace[] = [];
    if (event.kind === 'list') {
      session.rows = new Map(event.rows.map((row) => [row.rootId, row]));
      session.order = event.rows.map((row) => row.rootId);
      session.elsewhere = event.elsewhere;
      session.known = true;
      const places = new Map(event.rows.map((row) => [row.rootId, placeOf(row)]));
      removed = [...session.places.keys()].filter((rootId) => !places.has(rootId));
      upsert = [...places.values()].filter((place) => JSON.stringify(place) !== JSON.stringify(session.places.get(place.rootId)));
      session.places = places;
    } else {
      session.rows.set(event.row.rootId, event.row);
      const place = placeOf(event.row);
      if (JSON.stringify(place) !== JSON.stringify(session.places.get(place.rootId))) {
        session.places.set(place.rootId, place);
        upsert = [place];
      }
    }
    for (const reader of session.readers) {
      const rows = rowsIn(session, reader.window);
      if (!reader.opened || event.kind === 'list') {
        yield* Queue.offer(reader.frames, {
          kind: 'list',
          rows,
          elsewhere: session.elsewhere,
          start: reader.window.start,
          total: session.order.length,
          places: !reader.opened && reader.window.places === true ? [...session.places.values()] : undefined,
        });
      } else if (event.kind === 'row' && rows.some((row) => row.rootId === event.row.rootId)) {
        yield* Queue.offer(reader.frames, event);
      }
      if (reader.opened && reader.window.places === true && (upsert.length > 0 || removed.length > 0))
        yield* Queue.offer(reader.frames, { kind: 'places', upsert, removed });
      reader.opened = true;
    }
    if (beforeVisible !== null) {
      const afterVisible = visible(session);
      if (afterVisible.size !== beforeVisible.size || [...afterVisible].some((rootId) => !beforeVisible.has(rootId))) interested(session);
    }
  });

  const acquire = Effect.fnUntraced(function* (projectId: number) {
    const standing = sessions.get(projectId);
    if (standing !== undefined) return standing;
    const own = yield* Scope.fork(scope);
    const session: Session = {
      scope: own,
      readers: new Set(),
      listeners: new Set(),
      rows: new Map(),
      order: [],
      elsewhere: [],
      places: new Map(),
      acts: { kind: 'acts', acts: [] },
      known: false,
    };
    sessions.set(projectId, session);
    const feed = makeWorktreeFeed({
      projectId,
      reads: input.reads,
      recorded: input.recorded,
      threadsMoved: input.threadsMoved,
      options: {
        ...input.options,
        visible: () => visible(session),
        interestsMoved: (listener) => {
          session.listeners.add(listener);
          return () => {
            session.listeners.delete(listener);
          };
        },
      },
    });
    yield* Effect.forkIn(
      Stream.runForEach(
        Stream.callback<WorktreeFeedEvent, WorktreeFeedFailure>((frames) => feed.run(frames)),
        (event) => publish(session, event),
      ).pipe(
        Effect.tapError((failure) => Effect.forEach(session.readers, (reader) => Queue.fail(reader.frames, failure), { discard: true })),
      ),
      own,
    );
    return session;
  });

  return (projectId: number, window: WorktreeWindow): Stream.Stream<WorktreeFeedEvent, WorktreeFeedFailure> =>
    Stream.callback((frames: Frames) =>
      Effect.gen(function* () {
        const session = yield* acquire(projectId);
        const reader: Reader = { window, frames, opened: false };
        session.readers.add(reader);
        if (session.known) {
          const rows = rowsIn(session, window);
          yield* Queue.offer(frames, {
            kind: 'list',
            rows,
            elsewhere: session.elsewhere,
            start: window.start,
            total: session.order.length,
            places: window.places === true ? [...session.places.values()] : undefined,
          });
          reader.opened = true;
          yield* Queue.offer(frames, session.acts);
          interested(session);
        }
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            session.readers.delete(reader);
            if (session.readers.size === 0) {
              sessions.delete(projectId);
              yield* Scope.close(session.scope, Exit.void);
            } else interested(session);
          }),
        );
      }),
    );
});
