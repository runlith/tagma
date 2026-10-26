import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem, Schedule } from 'effect';
import { Environments } from '../../../workspace/contract/service/environments.js';
import { HarnessReports } from '../../../external-harnesses/contract/service/reports.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import type { HarnessReportInput } from '../../../threads/contract/wire/harness/observation.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { threadStore } from '../../../native-harness/testing/doubles.js';
import { threadParts } from '../threadParts.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { birthsOf, inboxOf, threadEvent as eventTable, threadRun as runTable } from '../../../threads/testing/doubles.js';
import type { DoorFixture } from '../doorFixture.js';

export const OLD_MS = 10 * 60_000;
export const stamp = (offsetMs = 0) => Effect.map(Clock.currentTimeMillis, (now) => new Date(now + offsetMs).toISOString());

export const claudeUser = (root: string, text: string, at?: string) =>
  Effect.map(
    at === undefined ? stamp() : Effect.succeed(at),
    (timestamp) => `${JSON.stringify({ type: 'user', sessionId: root, timestamp, message: { role: 'user', content: text } })}\n`,
  );
export const claudeAnswer = (text: string, at?: string) =>
  Effect.map(
    at === undefined ? stamp() : Effect.succeed(at),
    (timestamp) =>
      `${JSON.stringify({ type: 'assistant', timestamp, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] } })}\n`,
  );
export const claudeInterrupted = (root: string, at?: string) => claudeUser(root, '[Request interrupted by user]', at);

export type CliOptions = {
  readonly name: string;
  readonly type?: 'harness:claude-code' | 'harness:cursor' | 'harness:grok' | 'harness:codex';
  readonly transcript?: string;
  readonly beat?: string;
  readonly parent?: { readonly threadId: string; readonly task: string };
  readonly seeded?: boolean;
  readonly approvalMode?: 'review';
};

export type TerminalRig = Effect.Success<ReturnType<typeof terminalRig>>;
export type Cli = Effect.Success<ReturnType<TerminalRig['raised']>>;

export const terminalRig = Effect.fn('testing.terminalRig')(function* (world: DoorFixture['Service'], projectId: number, folder: string) {
  const files = yield* FileSystem.FileSystem;
  const owner = 'a-server-that-is-alive';
  yield* files.makeDirectory(folder, { recursive: true });
  const machine = Context.get(world.runtime.graph, MachineStore);
  const units = Context.get(world.runtime.graph, MachineUnits);
  const context = yield* world.runtime.runtime.contextEffect;
  const records = yield* Effect.provide(makeThreadRecords, context);
  const threads = yield* Effect.provide(
    Effect.flatMap(threadStore(records, ENTRY_KINDS), (kernel) => threadParts({ db: machine.db, units, threads: kernel, records })),
    context,
  );
  const store = yield* sessionStoreOver(
    machine.db,
    units,
    threads.spells,
    records,
    Context.get(world.runtime.owners, ModelChanges),
    () => Effect.void,
  );
  const reports = Context.get(world.runtime.owners, HarnessReports);
  const resource = () =>
    Context.get(world.runtime.owners, ThreadHarness)
      .runs.transports()
      .all()
      .find((transport) => transport.adapter === 'terminal')!.resource!;
  const raised = Effect.fn('testing.raiseTerminal')(function* (options: CliOptions) {
    const environment = yield* Context.get(world.runtime.workspace, Environments).inspect('host');
    const binding = environment.binding;
    if (binding === null) return yield* Effect.die(new Error('the host environment names no binding'));
    const born = yield* birthsOf(world.runtime.owners).create({
      projectId,
      createdBySessionId: null,
      type: options.type ?? 'harness:claude-code',
      approvalMode: options.approvalMode,
      parent: options.parent?.threadId,
      task: options.parent?.task,
    });
    const threadId = born.thread.id;
    const path = join(folder, `${options.name}.jsonl`);
    const root = `root-${options.name}`;
    yield* files.writeFileString(path, options.transcript ?? '');
    const seed = Effect.fn('testing.seedTerminal')(function* () {
      const now = yield* stamp();
      yield* store.change(threadId, (facet) =>
        Effect.succeed({
          facet: {
            ...facet,
            execution: { execution: `exec-${options.name}`, incarnation: 1 },
            session: {
              id: `session-${options.name}`,
              origin: 'launched',
              state: 'running',
              prompt: '',
              cwd: folder,
              argv: null,
              ownerId: owner,
              startedAt: now,
              heartbeatAt: options.beat ?? now,
              storage: { binding, entries: [] },
              transcriptPath: path,
            },
            observation: {
              ...facet.observation,
              binding: { ...facet.observation.binding, sessionId: `session-${options.name}`, rootKey: root },
            },
          },
          value: undefined,
        }),
      );
    });
    const unheld = () =>
      store.change(threadId, (standing) =>
        Effect.succeed({
          facet: standing.session === undefined ? standing : { ...standing, session: { ...standing.session, ownerId: null } },
          value: undefined,
        }),
      );
    if (options.seeded !== false) {
      yield* seed();
      yield* Effect.addFinalizer(() =>
        unheld().pipe(
          Effect.andThen(() => resource().release(threadId)),
          Effect.asVoid,
          Effect.orDie,
        ),
      );
    }
    const facet = () => store.read(threadId);
    return {
      threadId,
      path,
      root,
      store,
      hook: Effect.fn('testing.terminalHook')(function* (
        event: string,
        over: Record<string, unknown> = {},
        input: HarnessReportInput = {},
      ) {
        return yield* reports.reported(threadId, {
          capturedAt: yield* stamp(),
          ...input,
          event: { hook_event_name: event, session_id: root, ...over },
        });
      }),
      facet,
      running: () => Effect.map(records.facts(threadId), (facts) => facts?.runningRunId ?? null),
      statusOf: (runId: string) =>
        Effect.map(
          units.read((unit) =>
            unit.run(machine.db.select({ status: runTable().status }).from(runTable()).where(eq(runTable().id, runId)).get()),
          ),
          (row) => row?.status,
        ),
      settled: Effect.fn('testing.terminalSettled')(function* (accepts: (facet: ExternalSession) => boolean) {
        return yield* Effect.repeat(facet(), {
          until: (standing) => standing !== null && accepts(standing),
          schedule: Schedule.spaced(25),
        });
      }),
      seed,
      quiesce: Effect.fn('testing.quiesceTerminal')(function* () {
        const old = yield* stamp(-OLD_MS);
        yield* store.change(threadId, (standing) =>
          Effect.succeed({
            facet: standing.turn === undefined ? standing : { ...standing, turn: { ...standing.turn, openedAt: old, movedAt: old } },
            value: undefined,
          }),
        );
      }),
      age: (unreadAt: string) =>
        store.change(threadId, (standing) =>
          Effect.succeed({
            facet: { ...standing, unread: (standing.unread ?? []).map((entry) => ({ ...entry, at: unreadAt })) },
            value: undefined,
          }),
        ),
      unheld,
      append: (text: string) => files.writeFileString(path, text, { flag: 'a' }),
      watch: () => resource().watch(),
      release: () => resource().release(threadId),
    };
  });
  const journal = (threadId: string) =>
    Effect.map(
      units.read((unit) => unit.run(machine.db.select().from(eventTable()).where(eq(eventTable().threadId, threadId)).all())),
      (rows) => JSON.stringify(rows),
    );
  return {
    raised,
    store,
    journal,
    size: (path: string) => Effect.map(files.stat(path), (info) => Number(info.size)),
    inbox: () => inboxOf(world.runtime.owners),
  };
});

export const until = Effect.fn('testing.terminalUntil')(function* <E, R>(accepts: Effect.Effect<boolean, E, R>) {
  yield* Effect.repeat(accepts, { until: Boolean, schedule: Schedule.spaced(25) });
});
