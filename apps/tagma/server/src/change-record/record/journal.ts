import { and, eq, gte, inArray, isNull, lt, lte, min, ne, notExists } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { CommandBase, CommandMove } from '@runlith/agent-tools/WorkspaceChanges';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import type { CommandSession, CommandUnattributed } from '../contract/service/commands.js';
import {
  closingWrites,
  commandUnattributed,
  commandUnowned,
  commandWindow,
  commandContent,
  unattributedWrites,
  unownedWrites,
  type WindowBase,
  type WindowMove,
  windowWrites,
} from '../store/commandTables.js';
import { type Span, WRITE_GAP_MS } from './lives.js';
import type { Role } from './roles.js';
import { PLACES_PER_STATEMENT } from './places.js';
import type { Walks } from '../lines/walks.js';
import { keepVersions } from './inserts.js';
import { batches, collectReleased, releaseVersions } from './versions.js';
import { workspaceChangeContent } from '../store/tables.js';
import { versionContentLimit } from '@runlith/files/content';
import { chunk } from '@runlith/utils/collection';

export type JournalWindow = typeof commandWindow.$inferSelect;

export type WindowOpening = {
  readonly id: string;
  readonly projectId: number;
  readonly threadId: string;
  readonly runHint: string | null;
  readonly checkout: string;
  readonly spelling: string;
  readonly openedAt: number;
  readonly role: Role;
  readonly signatures: readonly (string | null)[];
  readonly team: string | null;
};

export type LifeSpan = { readonly start: number | null; readonly end: number | null };

export type UnownedMark = {
  readonly id: string;
  readonly checkout: string;
  readonly path: string;
  readonly after: string;
  readonly at: number;
};

const UNATTRIBUTED_PER_STATEMENT = rowsPerStatement(9);

const OPERATOR_KEY = holderKey(OPERATOR);

const baseOf = (base: CommandBase): WindowBase =>
  Object.fromEntries([...base.dirty].map(([name, one]) => [name, { digest: one.digest, present: one.present }]));

const movesOf = (moves: readonly CommandMove[]): readonly WindowMove[] =>
  moves.map((move) => ({
    name: move.name,
    before: move.before,
    after: move.after,
    present: move.present,
    existed: move.existed,
    written: move.written,
    link: move.link,
    mode: move.mode,
  }));

export type UnattributedPlace = { readonly projectId: number; readonly threadId: string; readonly checkout: string };

export type CommandJournal = Effect.Success<ReturnType<typeof makeCommandJournal>>;

export const makeCommandJournal = Effect.fnUntraced(function* ({ walks }: { readonly walks: Walks }) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const closures = new Set<(checkout: string) => Effect.Effect<void>>();

  const forgetting = (place: UnattributedPlace, paths: readonly string[], through: number): Effect.Effect<void, StoreFailure> =>
    Effect.forEach(
      chunk([...new Set(paths)], PLACES_PER_STATEMENT),
      (batch) =>
        store.db
          .delete(commandUnattributed)
          .where(
            and(
              eq(commandUnattributed.checkout, place.checkout),
              inArray(commandUnattributed.path, batch),
              eq(commandUnattributed.projectId, place.projectId),
              eq(commandUnattributed.threadId, place.threadId),
              Number.isFinite(through) ? lte(commandUnattributed.at, through) : undefined,
            ),
          ),
      { discard: true },
    );

  return {
    onClose: (listener: (checkout: string) => Effect.Effect<void>): (() => void) => {
      closures.add(listener);
      return () => closures.delete(listener);
    },

    opened: (window: WindowOpening): Effect.Effect<void, StoreFailure> =>
      units.write(windowWrites, (unit) => unit.run(store.db.insert(commandWindow).values({ ...window }))),

    based: Effect.fnUntraced(function* (id: string, base: CommandBase) {
      const known = yield* units.write(windowWrites, (unit) =>
        Effect.gen(function* () {
          yield* unit.run(
            store.db
              .update(commandWindow)
              .set({ head: base.head, base: baseOf(base) })
              .where(eq(commandWindow.id, id)),
          );
          const found = new Set<string>();
          for (const group of chunk([...base.contents.keys()], PLACES_PER_STATEMENT)) {
            const rows = yield* unit.run(
              store.db
                .select({ digest: workspaceChangeContent.digest })
                .from(workspaceChangeContent)
                .where(inArray(workspaceChangeContent.digest, group)),
            );
            if (rows.length === 0) continue;
            yield* unit.run(
              store.db
                .insert(commandContent)
                .values(rows.map(({ digest }) => ({ window: id, digest })))
                .onConflictDoNothing(),
            );
            for (const row of rows) found.add(row.digest);
          }
          return found;
        }),
      );
      const missing = [...base.contents].filter(([digest]) => !known.has(digest));
      for (const group of batches(
        missing.map(([key, content]) => ({ key, bytes: 'bytes' in content ? content.bytes.byteLength : versionContentLimit })),
      )) {
        const read = yield* walks.hunks(
          group.map((digest) => ({ before: null, after: { ...base.contents.get(digest)!, digest }, normalized: false })),
        );
        const versions = group.flatMap((digest, at) => {
          const one = read[at];
          return one?.after !== null && one?.after !== undefined && one.afterDigest === digest ? [{ digest, text: one.after }] : [];
        });
        if (versions.length === 0) continue;
        yield* units.write(windowWrites, (unit) =>
          Effect.gen(function* () {
            for (const batch of chunk(versions, PLACES_PER_STATEMENT)) {
              yield* unit.run(keepVersions(store.db, batch));
              yield* unit.run(
                store.db
                  .insert(commandContent)
                  .values(batch.map(({ digest }) => ({ window: id, digest })))
                  .onConflictDoNothing(),
              );
            }
          }),
        );
      }
    }),

    settled: (id: string, life: LifeSpan, window: Span, moves: readonly CommandMove[]): Effect.Effect<void, StoreFailure> =>
      units.write(windowWrites, (unit) =>
        unit.run(
          store.db
            .update(commandWindow)
            .set({ startedAt: life.start, endedAt: life.end, windowFrom: window.from, windowTo: window.to, moves: movesOf(moves) })
            .where(eq(commandWindow.id, id)),
        ),
      ),

    closed: (ids: readonly string[]): Effect.Effect<void, StoreFailure> =>
      ids.length === 0
        ? Effect.void
        : units
            .write(closingWrites, (unit) =>
              Effect.gen(function* () {
                const contents = yield* unit.run(
                  store.db
                    .select({ digest: commandContent.digest })
                    .from(commandContent)
                    .where(inArray(commandContent.window, [...ids])),
                );
                yield* unit.run(
                  releaseVersions(
                    store.db,
                    contents.map(({ digest }) => digest),
                  ),
                );
                const closed = yield* unit.run(
                  store.db
                    .delete(commandWindow)
                    .where(inArray(commandWindow.id, [...ids]))
                    .returning({ checkout: commandWindow.checkout }),
                );
                const oldest = yield* unit.run(store.db.select({ at: min(commandWindow.openedAt) }).from(commandWindow));
                const horizon = (oldest[0]?.at ?? (yield* Clock.currentTimeMillis)) - WRITE_GAP_MS;
                yield* unit.run(store.db.delete(commandUnowned).where(lt(commandUnowned.at, horizon)));
                return new Set(closed.map((window) => window.checkout));
              }),
            )
            .pipe(
              Effect.flatMap((checkouts) =>
                Effect.forEach(checkouts, (checkout) => Effect.forEach(closures, (listener) => listener(checkout), { discard: true }), {
                  discard: true,
                }),
              ),
              Effect.andThen(Effect.asVoid(collectReleased(units, store))),
            ),

    unowned: (mark: UnownedMark): Effect.Effect<void, StoreFailure> =>
      units.write(unownedWrites, (unit) => unit.run(store.db.insert(commandUnowned).values(mark))),

    owned: (id: string): Effect.Effect<void, StoreFailure> =>
      units.write(unownedWrites, (unit) => unit.run(store.db.delete(commandUnowned).where(eq(commandUnowned.id, id)))),

    unownedSince: (from: number): Effect.Effect<readonly UnownedMark[], StoreFailure> =>
      units.read((unit) => unit.run(store.db.select().from(commandUnowned).where(gte(commandUnowned.at, from)))),

    windows: (): Effect.Effect<readonly JournalWindow[], StoreFailure> =>
      units.read((unit) => unit.run(store.db.select().from(commandWindow).orderBy(commandWindow.openedAt))),

    unattribute: (rows: readonly CommandUnattributed[]): Effect.Effect<void, StoreFailure> => {
      if (rows.length === 0) return Effect.void;
      const places = new Map<string, { readonly place: UnattributedPlace; readonly paths: string[] }>();
      for (const row of rows) {
        const key = `${row.projectId}\0${row.threadId}\0${row.checkout}`;
        const known = places.get(key);
        if (known === undefined) places.set(key, { place: row, paths: [row.path] });
        else known.paths.push(row.path);
      }
      return units.write(unattributedWrites, (unit) =>
        Effect.gen(function* () {
          for (const { place, paths } of places.values()) yield* unit.run(forgetting(place, paths, Infinity));
          for (const batch of chunk(rows, UNATTRIBUTED_PER_STATEMENT))
            yield* unit.run(store.db.insert(commandUnattributed).values([...batch]));
        }),
      );
    },

    forgotten: (place: UnattributedPlace, paths: readonly string[], through: number): Effect.Effect<void, StoreFailure> =>
      paths.length === 0 ? Effect.void : units.write(unattributedWrites, (unit) => unit.run(forgetting(place, paths, through))),

    swept: (checkout: string, paths: readonly string[], before: number): Effect.Effect<void, StoreFailure> =>
      paths.length === 0
        ? Effect.void
        : units.write(unattributedWrites, (unit) =>
            Effect.forEach(
              chunk([...new Set(paths)], PLACES_PER_STATEMENT),
              (batch) =>
                unit.run(
                  store.db
                    .delete(commandUnattributed)
                    .where(
                      and(
                        eq(commandUnattributed.checkout, checkout),
                        inArray(commandUnattributed.path, batch),
                        lt(commandUnattributed.at, before),
                      ),
                    ),
                ),
              { discard: true },
            ),
          ),

    retired: (sessions: readonly CommandSession[]): Effect.Effect<void, StoreFailure> =>
      sessions.length === 0
        ? Effect.void
        : units.write(unattributedWrites, (unit) =>
            Effect.forEach(
              sessions,
              (session) =>
                unit.run(
                  store.db
                    .delete(commandUnattributed)
                    .where(and(eq(commandUnattributed.projectId, session.projectId), eq(commandUnattributed.threadId, session.threadId))),
                ),
              { discard: true },
            ),
          ),

    retireEnded: (): Effect.Effect<void, StoreFailure> =>
      units.write(unattributedWrites, (unit) =>
        unit.run(
          store.db.delete(commandUnattributed).where(
            and(
              ne(commandUnattributed.threadId, OPERATOR_KEY),
              notExists(
                store.db
                  .select({ id: threadRecord.id })
                  .from(threadRecord)
                  .where(
                    and(
                      eq(threadRecord.id, commandUnattributed.threadId),
                      eq(threadRecord.projectId, commandUnattributed.projectId),
                      isNull(threadRecord.archivedAt),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),

    unattributed: (): Effect.Effect<readonly CommandUnattributed[], StoreFailure> =>
      units.read((unit) =>
        unit.run(
          store.db
            .select({
              projectId: commandUnattributed.projectId,
              threadId: commandUnattributed.threadId,
              checkout: commandUnattributed.checkout,
              path: commandUnattributed.path,
              reason: commandUnattributed.reason,
              team: commandUnattributed.team,
              digest: commandUnattributed.digest,
              at: commandUnattributed.at,
            })
            .from(commandUnattributed)
            .orderBy(commandUnattributed.at, commandUnattributed.id),
        ),
      ),
  };
});
