import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname } from 'node:path';
import { Clock, Effect, Result, Schema } from 'effect';
import { pidAlive } from '@runlith/utils/process';
import type { PhaseStamp } from '../../platform/contract/wire/phases.js';
import type { PhaseCapture } from '../../platform/contract/service/phases.js';
import type { Source } from '../contract/wire/source.js';
import type { OpeningStep } from '../../platform/contract/service/opening.js';
import type { MigrationLoad } from '../../platform/contract/wire/migrationLoad.js';
import { RestartRecords } from '../contract/service/restarts.js';
import {
  type Handover,
  type RestartDoor,
  type RestartIssue,
  type RestartRecord,
  type RestartStage,
  type RestartWindow,
  type RestartState,
  type Startup,
  type StartupState,
  RestartRecordUnreadable,
  RestartRecordUnwritable,
  RestartWindowRefused,
  restartRecordSchema,
  WINDOW_CEILING_MS,
} from '../contract/wire/restart.js';

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(restartRecordSchema));
const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const UNDER_WAY: ReadonlySet<RestartStage> = new Set(['accepted', 'prepared', 'transferred']);

const thisBoot = (record: RestartRecord, now: number): boolean => {
  const began = record.points[0]?.at ?? record.startup?.startedAt;
  return began === undefined || began >= now - uptime() * 1000;
};

export const handoverOf = ({ record, stage }: RestartState, now: number): Handover | null =>
  record === null || stage === null
    ? null
    : {
        id: record.id,
        stage,
        underway:
          UNDER_WAY.has(stage) &&
          thisBoot(record, now) &&
          [record.predecessor?.pid, record.successor?.pid].some((pid) => pid !== undefined && pidAlive(pid)),
        failure: stage === 'failed' ? (record.failure?.detail ?? null) : null,
        stays: stage === 'failed' && record.failure?.pid === record.predecessor?.pid,
      };

export const readStartup = Effect.fn('installation.readStartup')(function* (path: string): Effect.fn.Return<StartupState> {
  const reader = yield* makeProcessRestart({ path, pid: process.pid });
  reader.load();
  const state = yield* reader.state;
  return { startup: state.startup, issue: state.issue, restart: handoverOf(state, yield* Clock.currentTimeMillis) };
});

export const readHandover = (path: string): Effect.Effect<Handover | null> =>
  Effect.map(readStartup(path), ({ restart }) => restart ?? null);

export type ProcessRestart = Effect.Success<ReturnType<typeof makeProcessRestart>>;

export const makeProcessRestart = Effect.fnUntraced(function* (input: {
  readonly path: string;
  readonly pid: number;
  readonly incoming?: string;
}) {
  const { path, pid: ownPid, incoming } = input;
  const clock = yield* Clock.Clock;
  let recorded: RestartRecord | null = null;
  let issue: RestartIssue | null = null;
  let role: 'reading' | 'waiting' | 'predecessor' | 'successor' = incoming === undefined ? 'reading' : 'waiting';
  let capturing = false;
  let source: Source = { cut: null, installation: null };
  const pending: PhaseStamp[] = [];
  const doors = new Set<RestartDoor>();
  let unrecorded: number | undefined;

  const persist = (record: RestartRecord): Result.Result<void, RestartRecordUnwritable> => {
    const stored = Result.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${ownPid}.writing`;
        writeFileSync(temporary, JSON.stringify(record));
        renameSync(temporary, path);
      },
      catch: (cause) => new RestartRecordUnwritable({ path, detail: detailOf(cause) }),
    });
    issue = Result.isFailure(stored) ? { kind: 'unwritable', path, detail: stored.failure.detail } : null;
    return stored;
  };

  const note = (stamp: PhaseStamp): void => {
    if (recorded === null) return;
    const phases = recorded.phases;
    const index = phases.findIndex((phase) => phase.id === stamp.id);
    recorded = { ...recorded, phases: index < 0 ? [...phases, stamp] : phases.map((phase, at) => (at === index ? stamp : phase)) };
  };

  const startup = (): Startup | null => {
    const record = recorded;
    if (record === null) return null;
    if (record.startup === null) {
      if (record.heavy === undefined || record.predecessor === null) return null;
      return {
        pid: record.predecessor.pid,
        startedAt: record.points[0]!.at,
        readyAt: null,
        expectedMs: null,
        step: null,
        status: 'starting',
        phase: 'preparing heavy update',
        failure: null,
        heavy: record.heavy,
      };
    }
    const attempt = record.startup;
    const failure = record.failure?.pid === attempt.pid ? record.failure : null;
    const phases = record.phases.filter((stamp) => stamp.pid === attempt.pid);
    const phase =
      (failure === null ? phases.at(-1) : phases.findLast((stamp) => stamp.outcome === 'failed'))?.name ??
      phases.at(-1)?.name ??
      'data taken';
    return {
      ...attempt,
      heavy: record.heavy,
      status: failure !== null ? 'failed' : attempt.readyAt !== null ? 'ready' : 'starting',
      phase,
      failure: failure === null ? null : { phase, at: failure.at, detail: failure.detail },
    };
  };

  const stage = (): RestartState['stage'] => {
    const record = recorded;
    if (record === null || record.predecessor === null) return null;
    if (record.failure !== null) return 'failed';
    if (record.frames.some((frame) => frame.door === 'local') && record.points.some((point) => point.name === 'runs-restored'))
      return 'restored';
    if (record.points.some((point) => point.name === 'door-ready' && point.door === 'local')) return 'serving';
    if (record.points.some((point) => point.name === 'data-taken')) return 'transferred';
    if (record.points.some((point) => point.name === 'standing-by')) return 'prepared';
    return 'accepted';
  };

  const observations = RestartRecords.of({
    state: Effect.sync(() => ({ record: recorded, issue, stage: stage(), startup: startup() })),
    report: Effect.fn('RestartRecords.report')(function* (window) {
      const record = recorded;
      if (record === null || record.id !== window.restartId || record.successor?.pid !== ownPid) {
        return yield* new RestartWindowRefused({ detail: `restart ${window.restartId} is not the restart this process received` });
      }
      const prior = record.windows.find((row) => row.clientId === window.clientId);
      if (prior !== undefined) {
        if (
          prior.door === window.door &&
          prior.projectId === window.projectId &&
          prior.threadId === window.threadId &&
          prior.durationMs === window.durationMs
        )
          return record;
        return yield* new RestartWindowRefused({ detail: 'this client already reported a different window' });
      }
      const next: RestartRecord = {
        ...record,
        windows: [
          ...record.windows,
          { ...window, receivedAt: clock.currentTimeMillisUnsafe(), exceeded: window.durationMs > WINDOW_CEILING_MS },
        ],
      };
      yield* Effect.fromResult(persist(next));
      recorded = next;
      capturing = false;
      return next;
    }),
  });

  return {
    ...observations,
    path,
    receive: (predecessor: number): void => {
      if (incoming !== undefined) return;
      unrecorded = predecessor;
      role = 'waiting';
    },
    start: (startedAt: number, expectedMs: number | null = null): void => {
      if (role !== 'successor' || recorded === null) {
        recorded = {
          id: crypto.randomUUID(),
          predecessor: null,
          successor: { pid: ownPid, source },
          startup: null,
          phases: [],
          points: [],
          frames: [],
          windows: [],
          failure: null,
        };
        role = 'successor';
      }
      capturing = true;
      recorded = { ...recorded, startup: { pid: ownPid, startedAt, expectedMs, readyAt: null, step: null } };
      persist(recorded);
    },
    opening: (step: OpeningStep): void => {
      const record = recorded;
      if (record?.startup === null || record?.startup === undefined || record.startup.readyAt !== null) return;
      const progress = step.phase === 'migration' ? { name: step.name, index: step.index, total: step.total } : null;
      recorded = { ...record, startup: { ...record.startup, step: progress } };
      persist(recorded);
    },
    load: (): Result.Result<RestartRecord | null, RestartRecordUnreadable> => {
      const receiving = unrecorded !== undefined;
      const read = Result.try({
        try: () => {
          const saved: RestartRecord | null =
            unrecorded === undefined
              ? existsSync(path)
                ? decode(readFileSync(path, 'utf8'))
                : null
              : {
                  id: crypto.randomUUID(),
                  startup: null,
                  predecessor: { pid: unrecorded, source: { cut: null, installation: null } },
                  successor: null,
                  phases: [],
                  points: [],
                  frames: [],
                  windows: [],
                  failure: null,
                };
          if (incoming !== undefined && (saved === null || saved.id !== incoming))
            throw new Error(`restart ${incoming} has no predecessor record at ${path}`);
          return saved;
        },
        catch: (cause) => new RestartRecordUnreadable({ path, detail: detailOf(cause) }),
      });
      if (Result.isFailure(read)) {
        recorded = null;
        role = 'reading';
        pending.length = 0;
        issue = { kind: 'unreadable', path, detail: read.failure.detail };
        return read;
      }
      issue = null;
      recorded = read.success;
      if ((incoming === undefined && !receiving) || recorded === null) return read;
      unrecorded = undefined;
      recorded = { ...recorded, successor: { pid: ownPid, source } };
      role = 'successor';
      capturing = true;
      for (const stamp of pending.splice(0)) note(stamp);
      persist(recorded);
      return Result.succeed(recorded);
    },
    identify: (next: Source): void => {
      source = next;
      if (role !== 'successor' || recorded === null) return;
      recorded = { ...recorded, successor: { pid: ownPid, source } };
      persist(recorded);
    },
    spawned: (pid: number, next: Source): void => {
      if (role !== 'predecessor' || recorded === null) return;
      recorded = { ...recorded, successor: { pid, source: next } };
      persist(recorded);
    },
    begin: Effect.fn('RestartRecords.begin')(function* (heavy?: MigrationLoad): Effect.fn.Return<string, RestartRecordUnwritable> {
      const id = crypto.randomUUID();
      const next: RestartRecord = {
        id,
        heavy,
        startup: null,
        predecessor: { pid: ownPid, source },
        successor: null,
        phases: [],
        frames: [],
        windows: [],
        failure: null,
        points: [{ name: 'accepted', pid: ownPid, at: clock.currentTimeMillisUnsafe(), door: null, migrations: null }],
      };
      yield* Effect.fromResult(persist(next));
      recorded = next;
      role = 'predecessor';
      capturing = false;
      return id;
    }),
    phase: (stamp: PhaseStamp): Effect.Effect<PhaseCapture> =>
      Effect.sync(() => {
        if (role === 'waiting') {
          pending.push(stamp);
          return { status: 'observed' } as const;
        }
        if (role === 'reading' || recorded === null) return { status: 'unobserved' } as const;
        note(stamp);
        const stored = persist(recorded);
        return Result.isSuccess(stored)
          ? ({ status: 'observed' } as const)
          : ({ status: 'unavailable', detail: stored.failure.detail } as const);
      }),
    point: (name: string, options: { door?: RestartDoor; migrations?: number; at?: number } = {}): void => {
      if (options.door !== undefined && name === 'door-ready') doors.add(options.door);
      if (options.door !== undefined && name === 'door-closed' && !doors.delete(options.door)) return;
      if (recorded === null || role === 'reading' || role === 'waiting') return;
      if (name === 'door-ready' && role === 'successor' && !capturing) return;
      if (recorded.points.some((point) => point.name === name && point.door === (options.door ?? null))) return;
      const at = options.at ?? clock.currentTimeMillisUnsafe();
      recorded = {
        ...recorded,
        startup:
          name === 'door-ready' && options.door === 'local' && recorded.startup !== null
            ? { ...recorded.startup, readyAt: at, step: null }
            : recorded.startup,
        points: [...recorded.points, { name, pid: ownPid, at, door: options.door ?? null, migrations: options.migrations ?? null }],
      };
      persist(recorded);
    },
    frame: (door: RestartDoor, projectId: number, threadId: string, at: number): void => {
      if (!capturing || role !== 'successor' || recorded === null) return;
      if (recorded.frames.some((frame) => frame.door === door)) return;
      const closed = recorded.points.find((point) => point.name === 'door-closed' && point.door === door);
      recorded = {
        ...recorded,
        frames: [...recorded.frames, { door, projectId, threadId, at, intervalMs: closed === undefined ? null : at - closed.at }],
      };
      persist(recorded);
    },
    hostEnded: (executions: number | undefined, detail: string): void => {
      if (recorded === null || role === 'reading' || role === 'waiting') return;
      recorded = { ...recorded, hostEnded: { at: clock.currentTimeMillisUnsafe(), executions: executions ?? null, detail } };
      persist(recorded);
    },
    unreleased: (detail: string): void => {
      if (recorded === null || role === 'reading' || role === 'waiting') return;
      recorded = { ...recorded, unreleased: { at: clock.currentTimeMillisUnsafe(), detail } };
      persist(recorded);
    },
    fail: (detail: string): void => {
      if (recorded === null || role === 'reading' || role === 'waiting') return;
      recorded = { ...recorded, failure: { at: clock.currentTimeMillisUnsafe(), pid: ownPid, detail } };
      persist(recorded);
      role = 'reading';
      capturing = false;
    },
    close: (): void => {
      if (role !== 'predecessor') role = 'reading';
      capturing = false;
    },
  };
});
