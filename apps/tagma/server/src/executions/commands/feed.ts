import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { sameProcess, type ProcessIdentity, type ProcessReport, type UsageReading } from '@runlith/executions/protocol/evidence';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import { Cause, Clock, Context, Effect, Fiber, Queue, Stream, Tracer } from 'effect';
import type { CommandWait } from '../contract/wire/commands.js';
import { commandFeedDelta, commandKey, same } from './feedDelta.js';
import { type CommandFeedDelta, type CommandFeedFrame, type CommandFeedSnapshot } from '../contract/wire/commandFeed.js';
import type {
  CommandCurrent,
  CommandCursor,
  CommandHostAnswer,
  CommandLive,
  CommandReading,
  CommandView,
} from '../contract/wire/commands.js';
import type { TerminalRow } from '../contract/wire/terminals.js';
import type { TerminalAdopters } from '../contract/service/adopters.js';
import { withAdopters } from '../terminals/adopted.js';
import { viewOf } from './reader.js';
import type { CommandReader } from '../contract/service/commands.js';
import type { Custody } from '../contract/service/custody.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { TerminalFailure, Terminals } from '../contract/service/terminals.js';
import type { CommandMarks } from '../store/commandRows.js';
import type { CommandState } from '../store/rows.js';
import { INVENTORY_PAGE } from '../store/terminalRows.js';

const STANDING_PAGE = INVENTORY_PAGE;

type FeedReading = Pick<CommandReader['Service'], 'rows' | 'operationKeys' | 'lives' | 'marks'>;

type Roster = { readonly terminals: readonly TerminalRow[]; readonly stale: boolean };

type Row = {
  readonly key: string;
  readonly execution: ExecutionRef;
  readonly wait: CommandWait | undefined;
  readonly view: () => CommandView;
};

const storedRow = (standing: CommandState): Row => ({
  key: commandKey(standing.record.execution),
  execution: standing.record.execution,
  wait: standing.wait ?? undefined,
  view: () => viewOf(standing.record),
});

const heldRow = (reading: CommandReading): Row => ({
  key: commandKey(reading.command.execution),
  execution: reading.command.execution,
  wait: reading.wait,
  view: () => reading.command,
});

const rowsOf = Effect.fnUntraced(function* (reader: FeedReading, projectId: number, bounds: { readonly ended: number }) {
  const standing: CommandState[] = [];
  let after: CommandCursor | undefined = undefined;
  for (;;) {
    const page: { readonly rows: readonly CommandState[]; readonly after?: CommandCursor } = yield* reader.rows(projectId, {
      standing: true,
      order: 'newest',
      limit: STANDING_PAGE,
      after: after,
    });
    standing.push(...page.rows);
    if (page.after === undefined) break;
    after = page.after;
  }
  const ended = bounds.ended === 0 ? undefined : yield* reader.rows(projectId, { standing: false, order: 'newest', limit: bounds.ended });
  const stopped = new Set((ended?.rows ?? []).map((row) => commandKey(row.record.execution)));
  return {
    owed: standing.filter((row) => !stopped.has(commandKey(row.record.execution))).map(storedRow),
    ended: (ended?.rows ?? []).map(storedRow),
    endedAfter: ended?.after,
  };
});

const commandOf = (report: ProcessReport | undefined, identity: ProcessIdentity): string | undefined => {
  const row = report?.processes.find(
    (one) => sameProcess(one.identity, identity) && one.association !== undefined && one.association.relation !== 'leader',
  );
  const command = row?.command?.trim();
  return command === undefined || command === '' ? undefined : command;
};

const currentOf = Effect.fnUntraced(function* (
  evidence: ExecutionProcessEvidence['Service'],
  reading: CommandReading,
  held: CommandCurrent | undefined,
): Effect.fn.Return<CommandReading> {
  const newest = reading.live._tag === 'Held' ? reading.live.entry.usage?.current : undefined;
  if (reading.current !== undefined && newest !== undefined && sameProcess(reading.current.identity, newest)) return reading;
  const { current: _drawn, ...bare } = reading;
  if (newest === undefined) return reading.current === undefined ? reading : bare;
  if (held !== undefined && sameProcess(held.identity, newest)) return { ...bare, current: held };
  const report = yield* Effect.result(evidence.processes(reading.command.execution));
  if (report._tag === 'Failure') {
    yield* Effect.logDebug('the current process of a command is unread; the next reading asks again', {
      execution: reading.command.execution.execution,
      reason: report.failure._tag,
    });
    return bare;
  }
  return { ...bare, current: { identity: newest, command: commandOf(report.success, newest) } };
});

const sameLive = (held: CommandLive, read: CommandLive): boolean =>
  held._tag === 'Held' && read._tag === 'Held' ? same(held.entry, read.entry) : same(held, read);

type Composing = {
  readonly held?: CommandFeedSnapshot;
  readonly fresh: ReadonlySet<string> | 'all';
  readonly rows: boolean;
  readonly roster?: Roster;
  readonly usage?: ReadonlyMap<string, UsageReading>;
};

const readRoster = Effect.fnUntraced(function* (terminals: Terminals['Service'], adopters: TerminalAdopters['Service'], projectId: number) {
  const roster = yield* terminals.inventory(projectId, { standing: true });
  return { terminals: yield* withAdopters(adopters, projectId, roster.terminals), stale: roster.stale };
});

const composeFeed = Effect.fnUntraced(function* (
  terminals: Terminals['Service'],
  adopters: TerminalAdopters['Service'],
  evidence: ExecutionProcessEvidence['Service'],
  reader: FeedReading,
  projectId: number,
  bounds: { readonly ended: number },
  composing: Composing,
): Effect.fn.Return<CommandFeedSnapshot, TerminalFailure> {
  const composedAt = yield* Clock.currentTimeMillis;
  const held = composing.held;
  const before = new Map<string, CommandReading>();
  if (held !== undefined) for (const reading of [...held.active, ...held.ended]) before.set(commandKey(reading.command.execution), reading);
  const fresh = composing.fresh;
  const reread = (key: string): boolean => held === undefined || fresh === 'all' || fresh.has(key) || !before.has(key);
  const rows =
    held === undefined || composing.rows
      ? { ...(yield* rowsOf(reader, projectId, bounds)), operationKeys: yield* reader.operationKeys() }
      : {
          owed: held.active.map(heldRow),
          ended: held.ended.map(heldRow),
          endedAfter: held.endedAfter,
          operationKeys: held.operationKeys,
        };
  const roster = composing.roster ?? (yield* readRoster(terminals, adopters, projectId));
  const asked = [...rows.owed, ...rows.ended].filter((row) => reread(row.key));
  const lives = held !== undefined && asked.length === 0 ? undefined : yield* reader.lives(asked.map((row) => row.execution));
  const drawn = (row: Row, active: boolean): CommandReading => {
    const was = before.get(row.key);
    const read = lives !== undefined && reread(row.key) ? lives.live(row.execution) : undefined;
    if (read !== undefined && (was === undefined || !sameLive(was.live, read))) {
      return { command: was?.command ?? row.view(), wait: row.wait, live: read };
    }
    const reading = was as CommandReading;
    const sampled = active && read === undefined ? composing.usage?.get(row.key) : undefined;
    const live =
      sampled === undefined || reading.live._tag !== 'Held'
        ? reading.live
        : { ...reading.live, entry: { ...reading.live.entry, usage: sampled } };
    if (live === reading.live && same(reading.wait, row.wait) && (active || reading.current === undefined)) return reading;
    const { current, wait: _wait, ...bare } = reading;
    return {
      ...bare,
      wait: row.wait,
      live,
      current: active && current !== undefined ? current : undefined,
    };
  };
  const active = yield* Effect.forEach(rows.owed, (row) => currentOf(evidence, drawn(row, true), before.get(row.key)?.current));
  const host =
    lives === undefined
      ? (held as CommandFeedSnapshot).host
      : held === undefined || fresh === 'all'
        ? lives.host
        : accountOf([held.host, lives.host]);
  return {
    projectId,
    composedAt,
    active,
    ended: rows.ended.map((row) => drawn(row, false)),
    endedAfter: rows.endedAfter,
    terminals: held !== undefined && rosterOf(held.terminals) === rosterOf(roster.terminals) ? held.terminals : roster.terminals,
    host,
    stale: roster.stale,
    operationKeys: rows.operationKeys,
  };
});

export const readCommandFeed = (
  terminals: Terminals['Service'],
  adopters: TerminalAdopters['Service'],
  evidence: ExecutionProcessEvidence['Service'],
  reader: FeedReading,
  projectId: number,
  bounds: { readonly ended: number },
) => composeFeed(terminals, adopters, evidence, reader, projectId, bounds, { fresh: 'all', rows: true });

const CONFIRMED_MS = 5_000;

type Composed = {
  readonly revision: number;
  readonly epoch: number;
  readonly marks: string;
  readonly roster: string;
  readonly snapshot: CommandFeedSnapshot;
  readonly sentAt: number;
};

const marksOf = (marks: CommandMarks): string =>
  [marks.newest ?? '', ...marks.waits.map((mark) => `${mark.execution}:${mark.incarnation}:${mark.mode}:${mark.revision}`).sort()].join(
    '|',
  );

const drawnOf = ({ listeners, ...listing }: TerminalRow) => ({
  ...listing,
  sockets:
    listeners === undefined
      ? null
      : {
          completeness: listeners.completeness,
          unmeasured: listeners.unmeasured,
          listeners: listeners.listeners.map(({ observedAt: _observed, ...socket }) => socket),
        },
});

const rosterOf = (terminals: readonly TerminalRow[]): string => JSON.stringify(terminals.map(drawnOf));

const holdsWork = (snapshot: CommandFeedSnapshot): boolean => snapshot.active.length > 0 || snapshot.terminals.length > 0;

const answered = (snapshot: CommandFeedSnapshot): boolean => snapshot.host._tag === 'Answered';

const unsettled = (reading: CommandReading): boolean => reading.live._tag === 'Held' && reading.live.entry.state.phase !== 'ended';

const whole = (snapshot: CommandFeedSnapshot): boolean => snapshot.host._tag === 'Answered' && snapshot.host.unmeasured.length === 0;

type Pulse = { readonly _tag: 'Update'; readonly update: InventoryFeedItem } | { readonly _tag: 'Moved' } | { readonly _tag: 'Joined' };

type Step =
  | { readonly _tag: 'Compose'; readonly composing: Composing; readonly marks: string; readonly revision: number; readonly epoch: number }
  | { readonly _tag: 'Confirm' }
  | { readonly _tag: 'Quiet'; readonly marks: string; readonly revision: number };

type Reader = Queue.Queue<CommandFeedFrame, TerminalFailure | Cause.Done>;

type Shared = {
  readonly key: string;
  readonly readers: Map<Reader, { base: number | undefined }>;
  owed: boolean;
  wake: (() => void) | undefined;
  fiber: Fiber.Fiber<void, TerminalFailure> | undefined;
};

export const makeCommandFeed = Effect.fnUntraced(function* ({
  terminals,
  evidence,
  commands,
  custody,
  reader,
}: {
  readonly terminals: Terminals['Service'];
  readonly evidence: ExecutionProcessEvidence['Service'];
  readonly commands: ManagedCommands['Service'];
  readonly custody: Custody['Service'];
  readonly reader: FeedReading;
}) {
  const scope = yield* Effect.scope;
  const feeds = new Map<string, Shared>();

  const composed = (
    projectId: number,
    bounds: { readonly ended: number },
    adopters: TerminalAdopters['Service'],
    shared: Shared,
  ): Effect.Effect<void, TerminalFailure> => {
    let last: Composed | undefined;
    let sequence = 0;
    const joins = Stream.callback<Pulse>(
      (queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            shared.wake = () => void Queue.offerUnsafe(queue, { _tag: 'Joined' });
          }),
          () =>
            Effect.sync(() => {
              shared.wake = undefined;
            }),
        ),
      { bufferSize: 1, strategy: 'sliding' },
    );
    const pulses: Stream.Stream<Pulse> = Stream.merge(
      commands.changes().pipe(Stream.map((update): Pulse => ({ _tag: 'Update', update }))),
      Stream.merge(Stream.merge(custody.moves(projectId), adopters.moves).pipe(Stream.map((): Pulse => ({ _tag: 'Moved' }))), joins),
      { haltStrategy: 'left' },
    );
    const deliver = (snapshot: CommandFeedSnapshot, delta: CommandFeedDelta | undefined): boolean => {
      if (delta !== undefined) sequence += 1;
      let sent = false;
      for (const [queue, one] of shared.readers) {
        if (one.base === undefined || (delta !== undefined && Queue.sizeUnsafe(queue) > 0)) {
          Queue.offerUnsafe(queue, { _tag: 'Snapshot', sequence, snapshot });
        } else if (delta !== undefined) {
          Queue.offerUnsafe(queue, { _tag: 'Delta', sequence, base: one.base, delta });
        } else {
          continue;
        }
        one.base = sequence;
        sent = true;
      }
      return sent;
    };

    const everything = Effect.fnUntraced(function* (revision: number): Effect.fn.Return<Step, TerminalFailure> {
      const moves = yield* commands.moves();
      return {
        _tag: 'Compose',
        composing: { held: last === undefined ? undefined : last.snapshot, fresh: 'all', rows: true },
        marks: marksOf(yield* reader.marks(projectId)),
        revision: moves.revision ?? revision,
        epoch: moves.epoch,
      };
    });

    const stepOf = Effect.fnUntraced(function* (pulse: Pulse, standing: Composed, now: number): Effect.fn.Return<Step, TerminalFailure> {
      const snapshot = standing.snapshot;
      if ((pulse._tag === 'Update' && pulse.update._tag === 'Gap') || !answered(snapshot)) {
        return yield* everything(pulse._tag === 'Update' ? pulse.update.revision : standing.revision);
      }
      const update = pulse._tag === 'Update' && pulse.update._tag === 'Moved' ? pulse.update : undefined;
      const fresh = new Set<string>();
      let revision = standing.revision;
      const epoch = standing.epoch;
      const moves = update === undefined ? undefined : yield* commands.moves();
      if (update !== undefined && moves !== undefined && (moves.epoch !== epoch || standing.revision < moves.horizon)) {
        return yield* everything(update.revision);
      }
      if (update !== undefined && moves !== undefined && update.revision !== standing.revision) {
        if (!whole(snapshot) || moves.revision === undefined) return yield* everything(update.revision);
        for (const reading of snapshot.active) {
          const ref = reading.command.execution;
          if (moves.movedAfter(ref.execution, standing.revision) || (!moves.holds(ref) && unsettled(reading))) {
            fresh.add(commandKey(ref));
          }
        }
        for (const reading of snapshot.ended) {
          const ref = reading.command.execution;
          if (moves.movedAfter(ref.execution, standing.revision)) fresh.add(commandKey(ref));
        }
        revision = moves.revision;
      }
      const usage = new Map<string, UsageReading>();
      if (update !== undefined) {
        const carried = new Map<string, CommandReading>();
        for (const reading of snapshot.active) carried.set(commandKey(reading.command.execution), reading);
        for (const sampled of update.usage) {
          const key = commandKey(sampled.execution);
          const reading = carried.get(key);
          if (reading === undefined || fresh.has(key)) continue;
          if (reading.live._tag !== 'Held') fresh.add(key);
          else if (reading.live.entry.usage?.takenAtMicros !== sampled.takenAtMicros) usage.set(key, sampled);
        }
      }
      const marks = marksOf(yield* reader.marks(projectId));
      if (marks !== standing.marks) {
        return { _tag: 'Compose', composing: { held: snapshot, fresh, rows: true, usage }, marks, revision, epoch };
      }
      const roster = yield* readRoster(terminals, adopters, projectId);
      const moved = rosterOf(roster.terminals) !== standing.roster || roster.stale !== snapshot.stale;
      if (fresh.size > 0 || usage.size > 0 || moved || pulse._tag === 'Moved') {
        return { _tag: 'Compose', composing: { held: snapshot, fresh, rows: false, roster, usage }, marks, revision, epoch };
      }
      if (holdsWork(snapshot) && now - standing.sentAt >= CONFIRMED_MS) return { _tag: 'Confirm' };
      return { _tag: 'Quiet', marks, revision };
    });

    return pulses.pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.runForEach((pulse) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const owed = shared.owed;
          shared.owed = false;
          const standing = last;
          const revision = pulse._tag === 'Update' ? pulse.update.revision : (standing?.revision ?? -1);
          const step: Step =
            owed || standing === undefined || pulse._tag === 'Joined' ? yield* everything(revision) : yield* stepOf(pulse, standing, now);
          if (step._tag === 'Quiet') {
            if (standing !== undefined) last = { ...standing, marks: step.marks, revision: step.revision };
            return;
          }
          if (step._tag === 'Confirm') {
            if (standing === undefined) return;
            deliver(standing.snapshot, { composedAt: standing.snapshot.composedAt });
            last = { ...standing, sentAt: now };
            return;
          }
          const snapshot = yield* composeFeed(terminals, adopters, evidence, reader, projectId, bounds, step.composing);
          const delta = standing === undefined ? undefined : commandFeedDelta(standing.snapshot, snapshot);
          const kept = standing !== undefined && delta === undefined ? standing.snapshot : snapshot;
          const sent = deliver(kept, delta);
          last = {
            revision: step.revision,
            epoch: step.epoch,
            marks: step.marks,
            roster: rosterOf(kept.terminals),
            snapshot: kept,
            sentAt: sent ? now : (standing?.sentAt ?? now),
          };
        }),
      ),
      Effect.tapCause((cause: Cause.Cause<TerminalFailure>) =>
        Effect.sync(() => {
          if (Cause.hasInterruptsOnly(cause)) return;
          if (feeds.get(shared.key) === shared) feeds.delete(shared.key);
          for (const one of shared.readers.keys()) Queue.failCauseUnsafe(one, cause);
        }),
      ),
    );
  };

  const join = (
    projectId: number,
    bounds: { readonly ended: number },
    adopters: TerminalAdopters['Service'],
    reader: Reader,
  ): Effect.Effect<Shared> =>
    Effect.suspend(() => {
      const key = `${projectId}:${bounds.ended}`;
      const standing = feeds.get(key);
      if (standing !== undefined) {
        standing.readers.set(reader, { base: undefined });
        standing.owed = true;
        standing.wake?.();
        return Effect.succeed(standing);
      }
      const shared: Shared = { key, readers: new Map([[reader, { base: undefined }]]), owed: false, wake: undefined, fiber: undefined };
      feeds.set(key, shared);
      const composing = Effect.updateContext(composed(projectId, bounds, adopters, shared), (context: Context.Context<never>) =>
        Context.omit(Tracer.ParentSpan)(context),
      );
      return Effect.map(Effect.forkIn(composing, scope), (fiber) => {
        shared.fiber = fiber;
        return shared;
      });
    });

  const leave = (shared: Shared, reader: Reader): Effect.Effect<void> =>
    Effect.suspend(() => {
      shared.readers.delete(reader);
      if (shared.readers.size > 0) return Effect.void;
      if (feeds.get(shared.key) === shared) feeds.delete(shared.key);
      return shared.fiber === undefined ? Effect.void : Fiber.interrupt(shared.fiber);
    });

  return {
    follow: (
      projectId: number,
      bounds: { readonly ended: number },
      adopters: TerminalAdopters['Service'],
    ): Stream.Stream<CommandFeedFrame, TerminalFailure> =>
      Stream.callback<CommandFeedFrame, TerminalFailure>(
        (queue) => Effect.acquireRelease(join(projectId, bounds, adopters, queue), (shared) => leave(shared, queue)),
        { bufferSize: 1, strategy: 'sliding' },
      ),
  };
});

const accountOf = (pages: readonly CommandHostAnswer[]): CommandHostAnswer => {
  const unavailable = pages.find((page) => page._tag === 'Unavailable');
  if (unavailable !== undefined) return unavailable;
  const answered = pages.filter((page): page is Extract<CommandHostAnswer, { _tag: 'Answered' }> => page._tag === 'Answered');
  const revision = answered.find((page) => page.revision !== undefined)?.revision;
  const last = answered[answered.length - 1] as Extract<CommandHostAnswer, { _tag: 'Answered' }>;
  const regions = new Map<string, string>();
  for (const page of answered) {
    for (const region of page.unmeasured) if (!regions.has(region.region)) regions.set(region.region, region.detail);
  }
  return {
    _tag: 'Answered',
    revision: revision,
    memory: last.memory,
    unmeasured: [...regions].map(([region, detail]) => ({ region, detail })),
  };
};
