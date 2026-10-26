import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Clock, Context, Effect, Exit, Scope } from 'effect';
import type { StopRig, StopState } from '@runlith/agent/thread/conformance/transportStops';
import type { RestartCase, RestartRig } from '@runlith/agent/thread/conformance/transportRestarts';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { LEASE_RHYTHM } from '../../../threads/contract/wire/rhythm.js';
import { threadRun } from '../../../threads/testing/doubles.js';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { RigAgent, Sign } from './protocolAgents.js';
import { platform, until as readUntil, type ProtocolRig } from './protocolRig.js';

export const CLAUDE = { name: 'claude-code', hosts: 'tagma' } as const;

export type Raised = Effect.Success<ReturnType<ProtocolRig['Service']['floor']>>;

export const rigReads = (rig: ProtocolRig['Service'], agent: RigAgent) => {
  const db = Context.get(rig.world.context, MachineStore).db;
  const units = Context.get(rig.world.context, MachineUnits);
  const until = readUntil;
  const running = (threadId: string) =>
    units.read((unit) =>
      unit.run(
        db
          .select({ id: threadRun().id })
          .from(threadRun())
          .where(and(eq(threadRun().threadId, threadId), eq(threadRun().status, 'running')))
          .get(),
      ),
    );
  const rested = (raised: Raised, threadId: string, report: string) =>
    Effect.andThen(
      Effect.sync(() => writeFileSync(`${report}.release`, 'release')),
      until(
        Effect.gen(function* () {
          const pending = yield* raised.inbox.pending(threadId);
          const going = yield* running(threadId);
          const waiting = pending.filter((item) => item.state === 'queued');
          return waiting.length === 0 && going === undefined && (yield* agent.quiet(report)) ? true : null;
        }),
        'came to rest',
        report,
        rig.changes(threadId),
      ),
    );
  const prompted = (report: string, count: number) =>
    until(
      Effect.map(agent.turns(report), (turns) => (turns >= count ? true : null)),
      `prompted ${count} turn(s)`,
      report,
      rig.changes(),
    );
  const asked = (report: string, sign: Sign, count = 1) =>
    until(
      Effect.map(agent.seen(report, sign), (seen) => (seen >= count ? true : null)),
      `the agent saw ${count} ${sign}`,
      report,
      rig.changes(),
    );
  const runsOf = (threadId: string) =>
    units.read((unit) =>
      unit.run(
        db
          .select()
          .from(threadRun())
          .where(eq(threadRun().threadId, threadId))
          .orderBy(asc(threadRun().createdAt), asc(threadRun().id))
          .all(),
      ),
    );
  return { db, units, rested, prompted, asked, runsOf };
};

export const staging = (rig: ProtocolRig['Service'], name: string): string => {
  mkdirSync(join(rig.stage, name), { recursive: true });
  return join(rig.stage, name, 'agent.report');
};

export const staged = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  body.pipe(Effect.provide(HostRegistration.layer), Effect.provide(endpointConnection), Effect.provide(platform));

const make = (rig: ProtocolRig['Service'], agent: RigAgent, label: string) => {
  const { db, units, rested, prompted, asked, runsOf } = rigReads(rig, agent);
  const runOf = (runId: string) => units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().id, runId)).get()));
  const seen = (raised: Raised, threadId: string, runId: string, text: string) =>
    Effect.map(Effect.zip(runOf(runId), raised.entries(threadId)), ([run, entries]) =>
      JSON.stringify(run?.streamTail ?? []).includes(text) ||
      entries.some((entry) => entry.runId === runId && JSON.stringify(entry).includes(text))
        ? true
        : null,
    );

  const stopCase = (
    raised: Raised,
    threadId: string,
    runId: string,
    report: string,
    custom: { readonly stop?: Effect.Effect<unknown, unknown>; readonly settle?: Effect.Effect<void, unknown> } = {},
  ): RestartCase => ({
    runId,
    continues: true,
    restart: () => raised.harness.threads.handle(threadId, 'operator').restart(),
    processes: () => agent.seen(report, 'process'),
    stop: () =>
      Effect.andThen(
        custom.stop ?? Effect.void,
        Effect.suspend(() => raised.harness.threads.handle(threadId, 'operator').stop()),
      ),
    ended: () =>
      Effect.map(runOf(runId), (run) =>
        run === undefined || run.status === 'running'
          ? null
          : { status: run.status, stoppedBy: run.settledBy, finishedAt: run.finishedAt ?? run.updatedAt },
      ),
    journal: () =>
      Effect.map(Effect.zip(raised.entries(threadId), runOf(runId)), ([entries, run]) => ({
        entries: entries.filter((entry) => entry.runId === runId),
        tail: run?.streamTail ?? null,
      })),
    agentTurns: () => agent.turns(report),
    interrupts: () => agent.interrupts(report),
    runsAfter: () =>
      Effect.map(
        runsOf(threadId),
        (runs) => runs.slice(runs.findIndex((run) => run.id === runId) + 1).filter((run) => run.origin === 'core').length,
      ),
    settle: Effect.fnUntraced(function* () {
      if (custom.settle !== undefined) yield* custom.settle;
      yield* rested(raised, threadId, report);
    }),
  });

  const reach = Effect.fnUntraced(function* (state: StopState) {
    const report = staging(rig, `${label}-${state}`);
    yield* agent.install(report);
    const threadId = `thread-${label}-${state}`;
    const until = <A, E, R>(read: Effect.Effect<A | null, E, R>, what: string, report?: string) =>
      readUntil(read, what, report, rig.changes(threadId));
    yield* rig.openThread(threadId, CLAUDE);
    const scope = yield* Effect.scope;
    const raised = yield* rig.floor([]);
    if (state === 'unlinked' || state === 'restarted') {
      const first = yield* Scope.fork(scope);
      const before = yield* raised.driver(`owner-${state}-before`).pipe(Scope.provide(first));
      yield* before.send(threadId, 'HOLD the turn');
      const runId = yield* until(before.current(threadId), 'opened the turn', report);
      yield* prompted(report, 1);
      if (state === 'restarted') {
        const quiet = (yield* Clock.currentTimeMillis) - LEASE_RHYTHM.takeoverAfterMs - 1_000;
        yield* db.run(
          sql`update thread_run set owner_id = 'a-server-that-died', handed_over_at = null, heartbeat_at = ${quiet} where id = ${runId}`,
        );
        yield* db.run(sql`update external_session set lease_owner = 'a-server-that-died', lease_beat = 1 where id = ${threadId}`);
      }
      yield* Scope.close(first, Exit.void);
      yield* raised.driver(`owner-${state}-after`);
      return stopCase(raised, threadId, runId, report);
    }
    const driver = yield* raised.driver(`owner-${state}`);
    const handle = raised.harness.threads.handle(threadId, 'operator');
    const opened = Effect.fnUntraced(function* (text: string) {
      yield* driver.send(threadId, text);
      const runId = yield* until(driver.current(threadId), 'opened the turn', report);
      yield* prompted(report, 1);
      return runId;
    });
    switch (state) {
      case 'opening': {
        const sent = yield* handle.send('HOLD the turn');
        if (sent.status !== 'started') return yield* Effect.die(new Error(`the opening words answered ${sent.status}`));
        return stopCase(raised, threadId, sent.runId, report);
      }
      case 'thinking':
      case 'writing': {
        const runId = yield* opened(state === 'thinking' ? 'PONDER the turn' : 'STREAM the turn');
        yield* until(seen(raised, threadId, runId, state === 'thinking' ? 'Weighing it.' : 'Partial'), `streamed while ${state}`, report);
        return stopCase(raised, threadId, runId, report);
      }
      case 'tagma-call':
      case 'vendor-call': {
        const runId = yield* opened('HOLD the turn');
        writeFileSync(`${report}.${state === 'tagma-call' ? 'call' : 'vendor'}`, 'call');
        yield* until(seen(raised, threadId, runId, state === 'tagma-call' ? 'hosted-call' : 'vendor-call'), `began the ${state}`, report);
        return stopCase(raised, threadId, runId, report);
      }
      case 'question': {
        const runId = yield* opened('ASK to push');
        yield* until(
          Effect.map(raised.stageOf(threadId), (stage) => (stage === 'awaiting-question' ? true : null)),
          'raised its question',
          report,
        );
        return stopCase(raised, threadId, runId, report);
      }
      case 'compaction-step': {
        const runId = yield* opened('HOLD the turn');
        yield* handle.compact({ at: 'step', keep: 'HOLD' });
        yield* until(
          Effect.map(raised.entries(threadId), (entries) =>
            entries.some((entry) => entry.runId === runId && entry.type === 'compaction' && entry.status === 'running') ? true : null,
          ),
          'began compacting at the step',
          report,
        );
        return stopCase(raised, threadId, runId, report);
      }
      case 'compaction-end': {
        yield* driver.start(threadId);
        const compacting = yield* handle.compact({ at: 'end', keep: 'CANCEL' });
        if (compacting.status !== 'started') return yield* Effect.die(new Error(`the compaction answered ${compacting.status}`));
        yield* asked(report, 'compact');
        return stopCase(raised, threadId, compacting.runId, report);
      }
      case 'reopening': {
        yield* driver.send(threadId, 'plain words');
        yield* until(
          Effect.map(runsOf(threadId), (runs) => (runs.length === 1 && runs[0]!.status === 'completed' ? true : null)),
          'answered the first words',
          report,
        );
        yield* driver.stop(threadId);
        const hold = join(dirname(report), 'opening.hold');
        writeFileSync(hold, 'hold');
        yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(hold, { force: true })));
        const sent = yield* handle.send('HOLD the turn');
        if (sent.status !== 'started') return yield* Effect.die(new Error(`the words after the release answered ${sent.status}`));
        const runId = sent.runId;
        yield* asked(report, 'process', 2);
        return stopCase(raised, threadId, runId, report, { settle: Effect.sync(() => rmSync(hold, { force: true })) });
      }
      case 'steer-unechoed':
      case 'steer-echoed': {
        const runId = yield* opened('HOLD the turn');
        yield* handle.send('Use the other table.');
        yield* asked(report, 'steer');
        if (state === 'steer-echoed') {
          writeFileSync(`${report}.step`, 'step');
          yield* until(
            Effect.map(raised.entries(threadId), (entries) =>
              entries.some((entry) => entry.runId === runId && JSON.stringify(entry).includes('Use the other table.')) ? true : null,
            ),
            'read the steer in the run',
            report,
          );
        }
        return stopCase(raised, threadId, runId, report);
      }
      case 'natural-end': {
        const runId = yield* opened('HOLD the turn');
        return stopCase(raised, threadId, runId, report, { stop: Effect.sync(() => writeFileSync(`${report}.release`, 'release')) });
      }
      case 'repeated': {
        const runId = yield* opened('LINGER HOLD the turn');
        return stopCase(raised, threadId, runId, report);
      }
    }
  });
  return reach;
};

export const protocolStopRig = (rig: ProtocolRig['Service'], agent: RigAgent, label = 'stops'): StopRig & RestartRig => {
  const reach = make(rig, agent, label);
  return { reach: (state: StopState) => staged(reach(state)) };
};
