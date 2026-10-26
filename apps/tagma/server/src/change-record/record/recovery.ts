import { join } from 'node:path';
import { and, gte, inArray } from 'drizzle-orm';
import { Effect, type FileSystem, Option } from 'effect';
import { bytesDigest, contentDigest, streamedDigest } from '@runlith/files/content';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { workspaceChange } from '../store/tables.js';
import type { WindowBase } from '../store/commandTables.js';
import type { CommandWrites } from './commands.js';
import type { CommandJournal, JournalWindow } from './journal.js';
import type { CommandUnattributed } from '../contract/service/commands.js';
import type { Commanding } from './commandRows.js';
import type { CommandMoves } from '@runlith/agent-tools/WorkspaceChanges';
import { type Lives, WRITE_GAP_MS } from './lives.js';
import type { StoreShape } from './places.js';

export const RESTART_REASON = 'restart';

type Standing = { readonly digest: string; readonly present: boolean } | null;

type Written = {
  readonly checkout: string;
  readonly threadId: string;
  readonly path: string;
  readonly afterHash: string | null;
  readonly at: Date;
};

const ABSENT = contentDigest('');

const standingAt = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, path: string): Effect.fn.Return<Standing> {
  const link = yield* Effect.option(fs.readLink(path));
  if (Option.isSome(link)) return { digest: bytesDigest(new TextEncoder().encode(link.value)), present: true };
  const info = yield* Effect.result(fs.stat(path));
  if (info._tag === 'Failure' && info.failure.reason._tag === 'NotFound') return { digest: ABSENT, present: false };
  const digest = info._tag === 'Failure' ? info : yield* Effect.result(streamedDigest(fs, path));
  if (digest._tag === 'Success') return { digest: digest.success, present: true };
  yield* Effect.logWarning('a path a restarted command window based stays unjudged: it could not be read', {
    path,
    reason: digest.failure.message,
  });
  return null;
});

const movedFrom = (base: WindowBase, name: string, now: Standing): boolean => {
  const was = base[name];
  if (was === undefined || was.present === null || now === null) return false;
  return was.digest !== now.digest || was.present !== now.present;
};

export type CommandsRecovered = { readonly replayed: number; readonly restarted: number; readonly unattributed: number };

const writtenSince = (
  store: StoreShape,
  units: MachineUnits['Service'],
  checkouts: readonly string[],
  from: number,
): Effect.Effect<readonly Written[], StoreFailure> =>
  units.read((unit) =>
    unit.run(
      store.db
        .select({
          checkout: workspaceChange.checkout,
          threadId: workspaceChange.holder,
          path: workspaceChange.path,
          afterHash: workspaceChange.afterHash,
          at: workspaceChange.at,
        })
        .from(workspaceChange)
        .where(and(inArray(workspaceChange.checkout, [...checkouts]), gte(workspaceChange.at, new Date(from)))),
    ),
  );

const settledOf = (window: JournalWindow): (Commanding & { readonly moved: CommandMoves }) | null =>
  window.windowFrom === null || window.windowTo === null
    ? null
    : {
        projectId: window.projectId,
        threadId: window.threadId,
        runHint: window.runHint,
        spelling: window.spelling,
        key: window.checkout,
        windowId: window.id,
        moved: {
          base: window.head,
          window: { from: window.windowFrom, to: window.windowTo },
          moves: (window.moves ?? []).map((move) => ({ ...move, bytes: null })),
        },
      };

export const recoverCommands = Effect.fn('ChangeRecord.recoverCommands')(function* (
  store: StoreShape,
  units: MachineUnits['Service'],
  fs: FileSystem.FileSystem,
  journal: CommandJournal,
  lives: Lives,
  commands: CommandWrites,
  restartAt: number,
): Effect.fn.Return<CommandsRecovered, StoreFailure> {
  yield* journal.retireEnded();
  const windows = yield* journal.windows();
  if (windows.length === 0) {
    commands.remembered(yield* journal.unattributed());
    return { replayed: 0, restarted: 0, unattributed: 0 };
  }
  const from = Math.min(...windows.map((one) => one.openedAt)) - WRITE_GAP_MS;
  const checkouts = [...new Set(windows.map((one) => one.checkout))];
  const holds = checkouts.map((checkout) => lives.hold(checkout, from));
  const recovering = Effect.gen(function* () {
    const restored = new Map(
      windows.map(
        (one) =>
          [
            one.id,
            lives.restore(
              one.checkout,
              one.threadId,
              { id: one.id, role: one.role, signatures: one.signatures, team: one.team },
              one.startedAt ?? one.openedAt,
              one.endedAt ?? restartAt,
            ),
          ] as const,
      ),
    );
    for (const row of yield* writtenSince(store, units, checkouts, from)) {
      lives.instant(row.checkout, row.threadId, row.path, row.afterHash ?? ABSENT, row.at.getTime(), row.at.getTime());
    }
    for (const mark of yield* journal.unownedSince(from)) lives.unowned(mark.checkout, mark.path, mark.after, mark.at);
    let replayed = 0;
    for (const window of windows) {
      const settled = settledOf(window);
      const life = restored.get(window.id);
      if (settled === null || life === undefined) continue;
      const { moved, ...at } = settled;
      yield* commands.replay(at, life, moved);
      replayed += 1;
    }
    for (const projectId of new Set(windows.map((one) => one.projectId))) yield* commands.settled({ projectId });
    const open = windows.filter((one) => settledOf(one) === null);
    const written = new Map<string, Written[]>();
    if (open.length > 0) {
      const openCheckouts = [...new Set(open.map((one) => one.checkout))];
      for (const row of yield* writtenSince(store, units, openCheckouts, Math.min(...open.map((one) => one.openedAt)))) {
        const key = `${row.checkout}\0${row.path}`;
        const known = written.get(key);
        if (known === undefined) written.set(key, [row]);
        else known.push(row);
      }
    }
    const lost: CommandUnattributed[] = [];
    for (const window of open) {
      const base = window.base ?? {};
      for (const name of Object.keys(base)) {
        const now = yield* standingAt(fs, join(window.spelling, name));
        if (now === null || !movedFrom(base, name, now)) continue;
        const explained = (written.get(`${window.checkout}\0${name}`) ?? []).some(
          (row) => (row.afterHash ?? ABSENT) === now.digest && row.at.getTime() >= window.openedAt,
        );
        if (!explained) {
          lost.push({
            projectId: window.projectId,
            threadId: window.threadId,
            checkout: window.checkout,
            path: name,
            reason: RESTART_REASON,
            team: null,
            at: restartAt,
          });
        }
      }
    }
    yield* journal.unattribute(lost);
    yield* journal.closed(open.map((one) => one.id));
    commands.remembered(yield* journal.unattributed());
    return { replayed, restarted: open.length, unattributed: lost.length };
  });
  return yield* Effect.ensuring(
    recovering,
    Effect.sync(() => {
      for (const release of holds) release();
    }),
  );
});
