import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import type { ThreadEntry, ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { describeTransportStops } from '@runlith/agent/thread/conformance/transportStops';
import { describeTransportRestarts } from '@runlith/agent/thread/conformance/transportRestarts';
import { describeTransportEndings, describeTransportWords } from '@runlith/agent/thread/conformance/transportWords';
import { runEnd } from './protocolEnds.js';
import { ASIDE, COMPACT, FORK, REWIND } from '@runlith/hosted-runner/wire/extensions';
import { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';
import { shippedAdapters } from '../external-harnesses/shipped.js';
import { heard, ProtocolRig, protocolFixture, scenario, until as readUntil, words, type Said } from './protocolRig.js';
import { scriptedAgent } from './protocolAgents.js';
import { protocolStopRig } from './protocolStopRig.js';
import { protocolWordRig } from './protocolWordRig.js';

const waiting =
  (threadId: string) =>
  <A, E, R>(read: Effect.Effect<A | null, E, R>, what: string, report?: string) =>
    Effect.flatMap(ProtocolRig, (rig) => readUntil(read, what, report, rig.changes(threadId)));

const CLAUDE = { name: 'claude-code', hosts: 'tagma' } as const;
const own = (said: readonly Said[], threadId: string) => said.filter((one) => one.threadId === threadId);
const SPENT = { inputTokens: 2, outputTokens: 1, totalTokens: 3 };
const asked = (report: string, method: string) => Effect.map(heard(report), (lines) => lines.filter((line) => line.method === method));
const methods = (report: string) =>
  Effect.map(heard(report), (lines) => lines.flatMap((line) => (line.method === undefined ? [] : [line.method])));
const compactions = (journal: readonly ThreadEntry[]) => [
  ...new Map(journal.flatMap((entry) => (entry.type === 'compaction' ? [[entry.id, entry] as const] : []))).values(),
];
const configured = (report: string) =>
  Effect.flatMap(asked(report, 'session/set_config_option'), (lines) =>
    Effect.forEach(lines, (line) =>
      Schema.decodeUnknownEffect(Schema.Struct({ configId: Schema.String, value: Schema.String }))(line.params),
    ),
  );
const payloadMessages = (payload: unknown) =>
  Effect.map(
    Schema.decodeUnknownEffect(Schema.Struct({ messages: Schema.optional(Schema.Array(Message)) }))(payload),
    (value) => value.messages ?? [],
  );
const standing = (entries: readonly ThreadEntry[]) => {
  const latest = new Map<string, ThreadQuestionEntry>();
  for (const entry of entries) if (entry.type === 'question') latest.set(entry.id, entry);
  return [...latest.values()].filter((entry) => entry.status === 'open');
};
const agent = Effect.fnUntraced(function* (name: string) {
  const { stage, agentBinary } = yield* ProtocolRig;
  const report = join(stage, `${name}.report`);
  yield* agentBinary(report, 'tagma', 'claude-code');
  return report;
});

describe('ACP adapter boundaries over one execution host', () => {
  layer(protocolFixture('protocol-road'), { excludeTestServices: true })('protocol rig', (it) => {
    describeTransportStops(
      'acp (scripted agent)',
      () => Effect.map(ProtocolRig, (rig) => protocolStopRig(rig, scriptedAgent(rig))),
      it.effect,
      ['thinking'],
    );
    describeTransportRestarts(
      'acp (scripted agent)',
      () => Effect.map(ProtocolRig, (rig) => protocolStopRig(rig, scriptedAgent(rig), 'restarts')),
      it.effect,
      undefined,
    );
    describeTransportWords(
      'acp (scripted agent)',
      () => Effect.map(ProtocolRig, (rig) => protocolWordRig(rig, scriptedAgent(rig))),
      it.effect,
      ['running'],
    );
    describeTransportEndings(
      'acp (scripted agent)',
      () => Effect.map(ProtocolRig, (rig) => protocolWordRig(rig, scriptedAgent(rig), 'endings')),
      it.effect,
    );

    it.effect('stopping an opening ACP turn drains the session it started', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-stopped-opening';
        const report = yield* agent('stopped-opening');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const said: Said[] = [];
            const floor = yield* rig.floor(said, { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opening-owner');
            const sent = yield* driver.send(threadId, 'HOLD the turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(pause.stopping);
            yield* Deferred.succeed(pause.released, undefined);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Deferred.await(pause.finished);
            const facet = yield* floor.sessionStore.read(threadId);
            expect(facet?.session?.state ?? 'ended').toBe('ended');
            expect((yield* asked(report, 'session/prompt')).length).toBe(0);
            yield* driver.send(threadId, 'Answer the next turn');
            yield* waiting(threadId)(
              Effect.sync(() => own(said, threadId).find((one) => one.run !== sent.runId) ?? null),
              'answered the next turn',
              report,
            );
            expect(yield* runEnd(rig.world.context, threadId)).toMatchObject({ status: 'completed' });
            expect(yield* asked(report, 'session/prompt')).toHaveLength(1);
          }),
        );
      }),
    );

    it.effect('concurrent stops both drain the same opening before the session ends', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-opening-two-stops';
        const report = yield* agent('opening-two-stops');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              secondStopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opening-two-stops-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const handle = floor.harness.threads.handle(threadId, 'operator');
            let firstReturned = false;
            let secondReturned = false;
            const first = yield* Effect.forkChild(Effect.tap(handle.stop(), () => Effect.sync(() => { firstReturned = true; })));
            yield* Deferred.await(pause.stopping);
            const second = yield* Effect.forkChild(Effect.tap(handle.stop(), () => Effect.sync(() => { secondReturned = true; })));
            yield* Deferred.await(pause.secondStopping);
            expect(firstReturned).toBe(false);
            expect(secondReturned).toBe(false);
            yield* Deferred.succeed(pause.released, undefined);
            expect((yield* Fiber.join(first)).status).toBe('stopped');
            expect((yield* Fiber.join(second)).status).toBe('stopped');
            yield* Deferred.await(pause.finished);
            const facet = yield* floor.sessionStore.read(threadId);
            expect(facet?.session?.state ?? 'ended').toBe('ended');
            expect(facet?.execution).toBeNull();
            expect(yield* asked(report, 'initialize')).toHaveLength(0);
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
          }),
        );
      }),
    );

    it.effect('stopping during activity preparation opens no session', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-stopped-preparing';
        const report = yield* agent('stopped-preparing');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, preparing: pause });
            const driver = yield* floor.driver('preparing-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(pause.stopping);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Deferred.await(pause.finished);
            yield* Deferred.succeed(pause.released, undefined);
            const facet = yield* floor.sessionStore.read(threadId);
            expect(facet?.session).toBeUndefined();
            expect(facet?.execution).toBeNull();
            expect(yield* runEnd(rig.world.context, threadId)).toMatchObject({ status: 'aborted' });
            expect(yield* asked(report, 'initialize')).toHaveLength(0);
          }),
        );
      }),
    );

    it.effect('a session start concurrent with a stopped opening keeps the session available', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-opening-shared';
        const report = yield* agent('opening-shared');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opening-shared-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(pause.stopping);
            const starting = yield* Effect.forkChild(driver.sessions.start(threadId), { startImmediately: true });
            yield* Deferred.succeed(pause.released, undefined);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Fiber.join(starting);
            yield* Deferred.await(pause.finished);
            expect((yield* floor.sessionStore.read(threadId))?.session?.state).toBe('running');
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
          }),
        );
      }),
    );

    it.effect('a session start adopts the new session when its earlier read rolls over', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-session-rollover';
        const report = yield* agent('session-rollover');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const opening = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
              armed: yield* Deferred.make<void>(),
            };
            const startRead = { entered: yield* Deferred.make<void>(), released: yield* Deferred.make<void>() };
            const stalls = { entered: yield* Deferred.make<void>(), released: yield* Deferred.make<void>(), first: true };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, opening, startRead, stalls });
            const driver = yield* floor.driver('rollover-owner');
            yield* driver.start(threadId);
            const old = (yield* floor.sessionStore.read(threadId))?.session?.id;
            if (old === undefined) return yield* Effect.die('the original session did not open');
            const adopter = yield* Effect.forkChild(driver.sessions.start(threadId), { startImmediately: true });
            yield* Deferred.await(startRead.entered);
            expect(yield* driver.stop(threadId)).toBe('stopped');
            yield* Deferred.succeed(opening.armed, undefined);
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(opening.entered);
            const current = (yield* floor.sessionStore.read(threadId))?.session?.id;
            if (current === undefined || current === old) return yield* Effect.die('the new session did not replace the old one');
            yield* Deferred.succeed(startRead.released, undefined);
            yield* Fiber.join(adopter);
            yield* Deferred.await(stalls.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(opening.stopping);
            yield* Deferred.succeed(opening.released, undefined);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Deferred.await(opening.finished);
            const after = yield* floor.sessionStore.read(threadId);
            expect(after?.session?.id).toBe(current);
            expect(after?.session?.state).toBe('running');
            expect(after?.execution).not.toBeNull();
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
            yield* Deferred.succeed(stalls.released, undefined);
          }),
        );
      }),
    );

    it.effect('words queued while a stopped opening drains reach a later turn', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-opening-queued';
        const report = yield* agent('opening-queued');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const said: Said[] = [];
            const floor = yield* rig.floor(said, { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opening-queued-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(pause.stopping);
            yield* driver.send(threadId, 'Answer the queued turn');
            yield* Deferred.succeed(pause.released, undefined);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Deferred.await(pause.finished);
            yield* waiting(threadId)(
              Effect.sync(() => own(said, threadId).find((one) => one.run !== sent.runId) ?? null),
              'answered the queued turn',
              report,
            );
            expect(yield* runEnd(rig.world.context, threadId)).toMatchObject({ status: 'completed' });
            expect(yield* asked(report, 'session/prompt')).toHaveLength(1);
          }),
        );
      }),
    );

    it.effect('an opening failure settles a concurrent stop without leaving a session running', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-opening-failed';
        const report = yield* agent('opening-failed');
        const recorded = activityRecording();
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
              failure: 'session publication failed',
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opening-failed-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(Effect.exit(floor.harness.threads.handle(threadId, 'operator').stop()));
            yield* Deferred.await(pause.stopping);
            yield* Deferred.succeed(pause.released, undefined);
            const stopped = yield* Fiber.join(stopping);
            yield* Deferred.await(pause.finished);
            if (Exit.isSuccess(stopped)) expect(stopped.value.status).toBe('stopped');
            else expect(Cause.pretty(stopped.cause)).toContain('session publication failed');
            expect((yield* floor.sessionStore.read(threadId))?.session?.state ?? 'ended').toBe('ended');
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
            const activity = recorded.activities().find((row) => row.opened.kind === 'run' && row.opened.run === sent.runId);
            expect(activity?.ended).toMatchObject({ outcome: 'failed', message: expect.stringContaining('session publication failed') });
          }).pipe(Effect.provideService(ActivityLog, recorded.log)),
        );
      }),
    );

    it.effect('stopping an unsent turn after launch returns retires its session', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-opened-unsent';
        const report = yield* agent('opened-unsent');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const hold = join(report, '..', 'opening.hold');
            yield* Effect.acquireRelease(rig.files.writeFileString(hold, ''), () => rig.files.remove(hold, { force: true }).pipe(Effect.orDie));
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, opening: pause });
            const driver = yield* floor.driver('opened-unsent-owner');
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            yield* Deferred.succeed(pause.released, undefined);
            yield* Deferred.await(pause.finished);
            yield* waiting(threadId)(
              Effect.map(asked(report, 'initialize'), (lines) => (lines.length > 0 ? true : null)),
              'started the agent before its handshake',
              report,
            );
            expect((yield* floor.harness.threads.handle(threadId, 'operator').stop()).status).toBe('stopped');
            expect((yield* floor.sessionStore.read(threadId))?.session?.state).toBe('ended');
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
          }),
        );
      }),
    );

    it.effect('stopping during preparation leaves the existing ACP session running', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const threadId = 'thread-existing-session';
        const report = yield* agent('existing-session');
        yield* rig.openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const pause = {
              entered: yield* Deferred.make<void>(),
              released: yield* Deferred.make<void>(),
              stopping: yield* Deferred.make<void>(),
              finished: yield* Deferred.make<void>(),
            };
            const floor = yield* rig.floor([], { fails: 0, refuses: false, preparing: pause });
            const driver = yield* floor.driver('existing-session-owner');
            yield* driver.start(threadId);
            const before = yield* floor.sessionStore.read(threadId);
            const sent = yield* driver.send(threadId, 'HOLD the stopped turn');
            if (sent.status !== 'started') return yield* Effect.die(`the opening turn answered ${sent.status}`);
            yield* Deferred.await(pause.entered);
            const stopping = yield* Effect.forkChild(floor.harness.threads.handle(threadId, 'operator').stop());
            yield* Deferred.await(pause.stopping);
            expect((yield* Fiber.join(stopping)).status).toBe('stopped');
            yield* Deferred.await(pause.finished);
            yield* Deferred.succeed(pause.released, undefined);
            const after = yield* floor.sessionStore.read(threadId);
            expect(after?.session?.id).toBe(before?.session?.id);
            expect(after?.session?.state).toBe('running');
            expect(after?.execution).toEqual(before?.execution);
            expect(yield* asked(report, 'session/prompt')).toHaveLength(0);
          }),
        );
      }),
    );

    it.effect('a vendor-run profile claiming an unnegotiated capability refuses launch before opening a session', () =>
      Effect.gen(function* () {
        const rig = yield* ProtocolRig;
        const { openThread, floor, stage, agentBinary } = rig;
        const report = join(stage, 'unnegotiated.report');
        yield* agentBinary(report);
        const threadId = 'thread-protocol-unnegotiated';
        yield* openThread(threadId);
        yield* scenario(
          Effect.gen(function* () {
            const shipped = yield* shippedAdapters;
            const original = yield* shipped.row('devin');
            if (original.acp === undefined) return yield* Effect.die('the vendor-run fixture needs an ACP profile');
            const profile = {
              ...original,
              acp: {
                ...original.acp,
                proves: { ...original.acp.proves, fork: true, rewind: true, compaction: true, aside: 'session' as const },
                extensions: [FORK, REWIND, COMPACT, ASIDE],
              },
            };
            const adapters = HarnessAdapters.of({
              ...shipped,
              find: (id) => (id === 'devin' ? profile : shipped.find(id)),
              last: (id) => (id === 'devin' ? profile : shipped.last(id)),
              all: () => shipped.all().map((row) => (row.harness === 'devin' ? profile : row)),
              row: (id, install) => (id === 'devin' ? Effect.succeed(profile) : shipped.row(id, install)),
            });
            const raised = yield* floor([], { fails: 0, refuses: false, adapters });
            const driver = yield* raised.driver('owner-unnegotiated');
            yield* driver.send(threadId, 'do not open the unsupported session');
            const ended = yield* waiting(threadId)(runEnd(rig.world.context, threadId), 'settled the unsupported launch', report);
            expect(ended.status).toBe('failed');
            expect(ended.failure).toContain('harness-contract');
            for (const capability of ['fork', 'rewind', 'compaction', 'aside']) expect(ended.failure).toContain(capability);
            expect(yield* asked(report, 'session/new')).toEqual([]);
          }),
        );
      }),
    );

    it.effect('a live session copy answers through the ACP extension and is released when its process exits', () =>
      Effect.gen(function* () {
        const { openThread, floor } = yield* ProtocolRig;
        const report = yield* agent('session-aside');
        const threadId = 'thread-protocol-session-aside';
        yield* openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const raised = yield* floor([]);
            const driver = yield* raised.driver('owner-session-aside');
            yield* driver.send(threadId, 'WARM HOLD the turn');
            const copy = yield* readUntil(
              Effect.sync(() => raised.held.of(threadId) ?? null),
              'held the measured session copy',
              report,
            );
            expect(copy.source).toBe('session');
            expect((yield* raised.held.ask(threadId, copy, { instruction: 'the held prefix' })).text).toBe('aside: the held prefix');
            expect(yield* driver.current(threadId)).toBe(copy.runId);
            yield* driver.stop(threadId);
            yield* readUntil(
              Effect.sync(() => (raised.held.of(threadId) === undefined ? true : null)),
              'released the exited session copy',
              report,
            );
            expect(raised.held.of(threadId)).toBeUndefined();
          }),
        );
      }),
    );

    it.effect(
      'a permission its rule asks about waits as a Tagma question, survives a server restart, and the answer reaches the agent as its option',
      () =>
        Effect.gen(function* () {
          const { stage, agentBinary, openThread, floor } = yield* ProtocolRig;
          const report = join(stage, 'ask.report');
          yield* agentBinary(report);
          const threadId = 'thread-protocol-ask';
          const until = waiting(threadId);
          yield* openThread(threadId);
          const said: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const raised = yield* floor(said);
              const first = yield* Scope.fork(yield* Effect.scope);
              const before = yield* raised.driver('owner-before').pipe(Scope.provide(first));
              const item = yield* words(threadId, 'ASK to push');
              yield* raised.inbox.put(item);
              yield* before.receive(threadId, item);
              const question = yield* until(
                Effect.map(raised.entries(threadId), (entries) => standing(entries)[0] ?? null),
                'parked the permission',
                report,
              );
              expect(question).toMatchObject({
                questionId: 'harness-protocol:p1',
                route: 'acp',
                questions: [{ options: [{ value: 'allow-once' }, { value: 'deny' }] }],
              });
              expect(yield* raised.stageOf(threadId)).toBe('awaiting-question');
              yield* Scope.close(first, Exit.void);
              const after = yield* raised.driver('owner-after');
              yield* after.resource.watch();
              expect(yield* after.asks.answer(threadId, question, [{ questionId: question.questionId, values: ['allow-once'] }])).toBe(
                'delivered',
              );
              yield* until(
                Effect.sync(() => (own(said, threadId).length > 0 ? true : null)),
                'reported the turn',
                report,
              );
              expect(own(said, threadId)[0]?.text).toBe('chose allow');
              expect((yield* heard(report)).filter((line) => line.id === 'p1' && line.method === undefined)).toHaveLength(1);
              expect(yield* asked(report, 'initialize')).toHaveLength(1);
              expect(yield* after.stop(threadId)).toBe('stopped');
            }),
          );
        }),
    );

    it.effect(
      'a hosted session relaunched after its thread moved opens where the thread now stands, though the folder it launched in is gone',
      () =>
        Effect.gen(function* () {
          const { openThread, floor, files, stage } = yield* ProtocolRig;
          const report = yield* agent('moved-relaunch');
          const threadId = 'thread-protocol-moved-relaunch';
          const until = waiting(threadId);
          const left = join(stage, 'moved-relaunch-left');
          const entered = join(stage, 'moved-relaunch-entered');
          yield* files.makeDirectory(left, { recursive: true });
          yield* files.makeDirectory(entered, { recursive: true });
          const place = { current: left };
          yield* openThread(threadId, CLAUDE);
          const reported: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const refusing = yield* Deferred.make<void>();
              const raised = yield* floor(reported, { fails: 0, refuses: false, place, refusing });
              const driver = yield* raised.driver('owner-moved-relaunch');
              yield* driver.send(threadId, 'plain words');
              yield* until(
                Effect.map(asked(report, 'session/new'), (lines) => (lines.length > 0 ? true : null)),
                'opened the session where it launched',
                report,
              );
              place.current = entered;
              yield* files.remove(left, { recursive: true });
              yield* Deferred.succeed(refusing, undefined);
              yield* until(
                Effect.sync(() => (own(reported, threadId).some((one) => one.text === 'echo: heard') ? true : null)),
                'answered the words on the relaunched process',
                report,
              );
              const cwdOf = Schema.decodeUnknownEffect(Schema.Struct({ cwd: Schema.String }));
              expect((yield* cwdOf((yield* asked(report, 'session/resume'))[0]?.params)).cwd).toBe(yield* files.realPath(entered));
            }),
          );
        }),
    );

    it.effect(
      'a hosted turn running across a restart onto another build ends on its runner, and the words after it go to a runner of that build',
      () =>
        Effect.gen(function* () {
          const rig = yield* ProtocolRig;
          const { openThread, floor, files } = rig;
          const report = yield* agent('build-turn');
          const threadId = 'thread-resource-build-turn';
          const until = waiting(threadId);
          yield* openThread(threadId, CLAUDE);
          const reported: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const raised = yield* floor(reported);
              const scope = yield* Scope.fork(yield* Effect.scope);
              const before = yield* raised.driver('owner-build-held', { build: 'build-one' }).pipe(Scope.provide(scope));
              yield* before.send(threadId, 'HOLD the turn');
              yield* until(
                Effect.map(asked(report, 'session/prompt'), (lines) => (lines.length > 0 ? true : null)),
                'prompted the held turn',
                report,
              );
              const first = (yield* raised.sessionStore.read(threadId))!.execution!;
              yield* Scope.close(scope, Exit.void);
              const after = yield* raised.driver('owner-build-next', { build: 'build-two' });
              yield* after.resource.watch();
              yield* raised.recover();
              yield* files.writeFileString(`${report}.release`, 'release');
              yield* until(
                Effect.sync(() => (own(reported, threadId).length > 0 ? true : null)),
                'ended the held turn',
                report,
              );
              expect((yield* runEnd(rig.world.context, threadId))?.status).toBe('completed');
              yield* after.send(threadId, 'once more');
              yield* until(
                Effect.sync(() => (own(reported, threadId).length > 1 ? true : null)),
                'reported the turn after the held one',
                report,
              );
              expect(yield* runEnd(rig.world.context, threadId)).toEqual({ status: 'completed', failure: null });
              expect(
                (yield* heard(report)).flatMap((line) =>
                  line.method === 'session/new' || line.method === 'session/resume' ? [line.method] : [],
                ),
              ).toEqual(['session/new', 'session/resume']);
              expect((yield* raised.sessionStore.read(threadId))!.execution!.execution).not.toBe(first.execution);
            }),
          );
        }),
    );

    it.effect(
      'a hosted session whose execution was lost with its host generation ends as lost and gives its terminal back, never uncertain',
      () =>
        Effect.gen(function* () {
          const rig = yield* ProtocolRig;
          const { openThread, floor, replaceHost } = rig;
          const report = yield* agent('lost-generation');
          const threadId = 'thread-protocol-lost-generation';
          const until = waiting(threadId);
          yield* openThread(threadId, CLAUDE);
          yield* scenario(
            Effect.gen(function* () {
              const scope = yield* Scope.fork(yield* Effect.scope);
              const first = yield* floor([]);
              const before = yield* first.driver('owner-lost-before').pipe(Scope.provide(scope));
              yield* before.send(threadId, 'HOLD the turn');
              yield* until(
                Effect.map(asked(report, 'session/prompt'), (lines) => (lines.length > 0 ? true : null)),
                'prompted the held turn',
                report,
              );
              yield* Scope.close(scope, Exit.void);
              yield* replaceHost();
              const raised = yield* floor([]);
              const lost = (yield* raised.sessionStore.read(threadId))!.execution!;
              const after = yield* raised.driver('owner-lost-after');
              yield* after.resource.watch();
              yield* raised.recover();
              const ended = yield* until(
                Effect.map(raised.sessionStore.read(threadId), (facet) => (facet?.session?.state === 'ended' ? facet : null)),
                'ended the session of the lost execution',
                report,
              );
              expect(ended.execution).toBeNull();
              expect(yield* runEnd(rig.world.context, threadId)).toMatchObject({ status: 'failed' });
              const record = yield* raised.terminals.record(lost.execution, lost.incarnation);
              expect(record?.heldBy).toBeUndefined();
            }),
          );
        }),
    );

    it.effect('a compaction barrier ends its run with the spend the agent reports, whether it compacts, fails or is cancelled', () =>
      Effect.gen(function* () {
        const { openThread, floor } = yield* ProtocolRig;
        const report = yield* agent('compact');
        const threadId = 'thread-methods-compact';
        const until = waiting(threadId);
        yield* openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const raised = yield* floor([]);
            const driver = yield* raised.driver('owner-compact');
            yield* driver.start(threadId);
            const compacted = Effect.fn('testing.compactProtocolTurn')(function* (keep: string, count: number) {
              yield* raised.harness.threads.handle(threadId, 'operator').compact({ at: 'end', keep });
              yield* until(
                Effect.map(asked(report, '_tagma/compact'), (lines) => (lines.length === count ? true : null)),
                `asked to compact (${keep})`,
                report,
              );
              if (keep === 'CANCEL') yield* driver.cancel(threadId);
              return yield* until(
                Effect.map(raised.entries(threadId), (entries) => {
                  const ended = compactions(entries).filter((entry) => entry.status !== 'running');
                  return ended.length === count ? ended.at(-1)! : null;
                }),
                `ended the compaction run (${keep})`,
                report,
              );
            });
            const completed = yield* compacted('the active task', 1);
            const failed = yield* compacted('FAIL', 2);
            const cancelled = yield* compacted('CANCEL', 3);
            expect([completed.status, failed.status, cancelled.status]).toEqual(['completed', 'failed', 'aborted']);
            expect(completed.summary).toBe('the compacted summary');
            for (const entry of [completed, failed])
              expect(raised.usages.find((spent) => spent.turn === entry.runId)?.usage).toMatchObject(SPENT);
            yield* until(
              Effect.map(raised.spentOf(threadId), (spent) => (spent?.totalTokens === SPENT.totalTokens ? true : null)),
              'charged the spend the agent reported after the cancel',
              report,
            );
            expect(yield* driver.current(threadId)).toBeNull();
            yield* driver.stop(threadId);
          }),
        );
      }),
    );

    it.effect(
      'a move mid-turn answers at once, the turn ends on its model, the next prompt reconfigures the same session, and a restart keeps what it applied',
      () =>
        Effect.gen(function* () {
          const rig = yield* ProtocolRig;
          const { openThread, floor, files } = rig;
          const report = yield* agent('configure-live');
          const threadId = 'thread-configure-live';
          const until = waiting(threadId);
          yield* openThread(threadId, CLAUDE);
          const said: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const raised = yield* floor(said);
              const first = yield* Scope.fork(yield* Effect.scope);
              const before = yield* raised.driver('owner-configure-before').pipe(Scope.provide(first));
              const answered = Effect.fn('testing.answeredConfiguredWords')(function* (
                send: (text: string) => Effect.Effect<unknown, unknown>,
                text: string,
              ) {
                const count = own(said, threadId).length + 1;
                yield* send(text);
                yield* until(
                  Effect.sync(() => (own(said, threadId).length === count ? true : null)),
                  `answered ${text}`,
                  report,
                );
              });
              yield* before.send(threadId, 'HOLD the turn');
              const held = yield* until(before.current(threadId), 'opened the held turn', report);
              yield* raised.sessionStore.choose(threadId, { model: 'claude-sonnet-5-5', reasoning: 'high' });
              expect(yield* before.current(threadId)).toBe(held);
              yield* files.writeFileString(`${report}.release`, 'release');
              yield* until(
                Effect.sync(() => (own(said, threadId).length === 1 ? true : null)),
                'ended the held turn',
                report,
              );
              yield* files.remove(`${report}.release`, { force: true });
              expect(yield* runEnd(rig.world.context, threadId)).toMatchObject({ status: 'completed' });
              expect((yield* raised.entries(threadId)).filter((entry) => entry.type === 'interruption')).toEqual([]);
              const opened = (yield* methods(report)).length;
              yield* answered((text) => before.send(threadId, text), 'on the new model');
              const after = (yield* methods(report)).slice(opened);
              expect(after.filter((one) => one === 'session/set_config_option')).toHaveLength(2);
              expect(after.indexOf('session/set_config_option')).toBeLessThan(after.indexOf('session/prompt'));
              expect(after.filter((one) => one === 'session/new' || one === 'session/load' || one === 'session/resume')).toEqual([]);
              expect(yield* configured(report)).toEqual([
                expect.objectContaining({ configId: 'thinking', value: 'summarized' }),
                expect.objectContaining({ configId: 'model', value: 'claude-sonnet-5-5' }),
                expect.objectContaining({ configId: 'effort', value: 'high' }),
              ]);
              expect(yield* raised.reading(threadId)).toMatchObject({ model: 'claude-sonnet-5-5', reasoning: 'high' });
              yield* raised.sessionStore.choose(threadId, { model: 'claude-sonnet-5-5', reasoning: 'low' });
              expect((yield* raised.sessionStore.read(threadId))?.session?.state).toBe('running');
              yield* Scope.close(first, Exit.void);
              const later = yield* raised.driver('owner-configure-after');
              yield* later.resource.watch();
              yield* raised.recover();
              const restarted = (yield* methods(report)).length;
              yield* answered((text) => later.send(threadId, text), 'after the restart');
              expect((yield* methods(report)).slice(restarted).filter((method) => method === 'initialize')).toEqual([]);
              expect((yield* configured(report)).slice(3)).toEqual([expect.objectContaining({ configId: 'effort', value: 'low' })]);
              yield* raised.sessionStore.choose(threadId, { model: 'claude-sonnet-5-5', reasoning: 'low' });
              yield* answered((text) => later.send(threadId, text), 'on the same effort');
              expect(yield* configured(report)).toHaveLength(4);
              yield* raised.sessionStore.choose(threadId, { model: 'claude-sonnet-5-5', reasoning: 'xhigh' });
              yield* answered((text) => later.send(threadId, text), 'on an effort the agent reports otherwise');
              yield* answered((text) => later.send(threadId, text), 'again on that effort');
              expect((yield* configured(report)).slice(4)).toEqual([expect.objectContaining({ configId: 'effort', value: 'xhigh' })]);
              yield* later.stop(threadId);
            }),
          );
        }),
    );

    it.effect('the answer to a hosted call is not written before the assistant message that carries the call', () =>
      Effect.gen(function* () {
        const { openThread, floor, files } = yield* ProtocolRig;
        const report = yield* agent('call');
        const threadId = 'thread-order-call';
        const until = waiting(threadId);
        yield* openThread(threadId, CLAUDE);
        yield* scenario(
          Effect.gen(function* () {
            const raised = yield* floor([]);
            const driver = yield* raised.driver('owner-order');
            const carried = Effect.flatMap(raised.events(threadId), (events) =>
              Effect.map(
                Effect.forEach(events, (event) => payloadMessages(event.payload)),
                (groups) =>
                  groups.flat().flatMap((message) => message.content.flatMap((part) => (part.type === 'tool-call' ? [part.id] : []))),
              ),
            );
            yield* driver.send(threadId, 'HOLD the turn');
            yield* until(driver.current(threadId), 'opened the held turn', report);
            const run = (yield* raised.harness.reads.snapshot(threadId)).latestRun;
            if (run === null) return yield* Effect.die('the held turn has no run');
            let answered = false;
            const waiting = yield* Effect.forkChild(
              Effect.tap(driver.runs.reached(run, { callId: 'hosted-call' }), () =>
                Effect.sync(() => {
                  answered = true;
                }),
              ),
            );
            yield* files.writeFileString(`${report}.call`, 'call');
            yield* until(
              Effect.map(raised.entries(threadId), (entries) =>
                entries.some((entry) => entry.type === 'tool' && entry.toolCallId === 'hosted-call') ? true : null,
              ),
              'the driver projected the hosted call before its message boundary',
              report,
            );
            expect(answered).toBe(false);
            expect(yield* carried).toEqual([]);
            yield* files.writeFileString(`${report}.said`, 'said');
            yield* Fiber.join(waiting);
            expect(answered).toBe(true);
            expect(yield* carried).toEqual(['hosted-call']);
            yield* driver.stop(threadId);
          }),
        );
      }),
    );

    it.effect('an ACP run records its actor and inbox cause once, including when stopped before its prompt reaches the agent', () =>
      Effect.gen(function* () {
        const { openThread, floor, files } = yield* ProtocolRig;
        const report = yield* agent('activity');
        const threadId = 'thread-protocol-activity';
        const until = waiting(threadId);
        yield* openThread(threadId, CLAUDE);
        const recorded = activityRecording();
        const roots = () => recorded.activities().filter((row) => row.opened.kind === 'run' && row.opened.thread === threadId);
        yield* scenario(
          Effect.gen(function* () {
            const raised = yield* floor([]);
            const driver = yield* raised.driver('owner-activity');
            const handle = raised.harness.threads.handle(threadId, 'operator');
            yield* driver.send(threadId, 'HOLD the activity turn');
            const first = yield* until(driver.current(threadId), 'opened the activity turn', report);
            yield* until(
              Effect.map(asked(report, 'session/prompt'), (lines) => (lines.length === 1 ? true : null)),
              'prompted the activity turn',
              report,
            );
            const firstRefs = yield* raised.inbox.delivered(threadId, first);
            expect(firstRefs).toHaveLength(1);
            yield* handle.stop();
            yield* until(
              Effect.sync(() => roots().find((row) => row.opened.run === first)?.ended ?? null),
              'closed the activity turn',
              report,
            );
            yield* driver.stop(threadId);
            const hold = join(report, '..', 'opening.hold');
            yield* Effect.acquireRelease(files.writeFileString(hold, ''), () => files.remove(hold, { force: true }).pipe(Effect.orDie));
            yield* Effect.forkScoped(driver.send(threadId, 'Never prompt these words'));
            const second = yield* until(
              Effect.map(raised.harness.reads.snapshot(threadId), (snapshot) => snapshot.activeRun?.id ?? null),
              'opened the pre-prompt turn',
              report,
            );
            yield* until(
              Effect.map(asked(report, 'initialize'), (lines) => (lines.length === 2 ? true : null)),
              'started the blocked agent',
              report,
            );
            const secondRefs = yield* raised.inbox.delivered(threadId, second);
            expect(secondRefs).toHaveLength(1);
            yield* handle.stop();
            yield* until(
              Effect.sync(() => roots().find((row) => row.opened.run === second)?.ended ?? null),
              'closed the pre-prompt activity',
              report,
            );
            expect(roots()).toHaveLength(2);
            for (const [run, refs] of [
              [first, firstRefs],
              [second, secondRefs],
            ] as const) {
              expect(roots().find((row) => row.opened.run === run)).toMatchObject({
                opened: {
                  run,
                  actor: { kind: 'thread', id: threadId },
                  trigger: { kind: 'inbox', refs },
                  attrs: { provider: 'claude-code', modelSteps: 'unobserved' },
                },
                ended: { outcome: 'cancelled', result: { finish: 'aborted' } },
              });
            }
            expect(yield* asked(report, 'session/prompt')).toHaveLength(1);
            yield* driver.stop(threadId);
          }).pipe(Effect.provideService(ActivityLog, recorded.log)),
        );
      }),
    );

    it.effect(
      'a rewind of a stopped thread starts no agent, survives a restart before the next words, cuts the session once before them, and a later restart cuts nothing',
      () =>
        Effect.gen(function* () {
          const { openThread, floor } = yield* ProtocolRig;
          const report = yield* agent('cut-stopped');
          const threadId = 'thread-cut-stopped';
          const until = waiting(threadId);
          yield* openThread(threadId, CLAUDE);
          const said: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const raised = yield* floor(said);
              const answered = Effect.fn('testing.answeredCutWords')(function* (
                send: (text: string) => Effect.Effect<unknown, unknown>,
                text: string,
              ) {
                const count = own(said, threadId).length + 1;
                yield* send(text);
                yield* until(
                  Effect.sync(() => {
                    const mine = own(said, threadId);
                    return mine.length >= count && mine.at(-1)?.text === 'echo: heard' ? true : null;
                  }),
                  `answered ${text}`,
                  report,
                );
                return own(said, threadId).at(-1)!.run;
              });
              const first = yield* Scope.fork(yield* Effect.scope);
              const before = yield* raised.driver('owner-cut-before').pipe(Scope.provide(first));
              yield* answered((text) => before.send(threadId, text), 'remember this');
              const second = yield* answered((text) => before.send(threadId, text), 'and this');
              yield* before.stop(threadId);
              const started = (yield* asked(report, 'initialize')).length;
              const rewound = yield* raised.harness.threads.handle(threadId, 'operator').rewind({ at: second, scope: 'from' });
              expect(rewound.runIds).toEqual([second]);
              expect(yield* asked(report, 'initialize')).toHaveLength(started);
              expect((yield* raised.sessionStore.read(threadId))?.session?.state).toBe('ended');
              yield* Scope.close(first, Exit.void);
              const middle = yield* Scope.fork(yield* Effect.scope);
              const restarted = yield* raised.driver('owner-cut-middle').pipe(Scope.provide(middle));
              yield* restarted.resource.watch();
              yield* raised.recover();
              const opened = (yield* methods(report)).length;
              yield* answered((text) => restarted.send(threadId, text), 'after the rewind');
              expect((yield* methods(report)).slice(opened).filter((one) => one === '_tagma/rewind' || one === 'session/prompt')).toEqual([
                '_tagma/rewind',
                'session/prompt',
              ]);
              expect((yield* asked(report, '_tagma/rewind')).map((line) => line.params)).toMatchObject([
                { sessionId: 'sess-1', turn: second },
              ]);
              expect(yield* raised.turns.turn(threadId, second)).toBeUndefined();
              yield* Scope.close(middle, Exit.void);
              const last = yield* raised.driver('owner-cut-after');
              yield* last.resource.watch();
              yield* raised.recover();
              yield* answered((text) => last.send(threadId, text), 'after another restart');
              expect(yield* asked(report, '_tagma/rewind')).toHaveLength(1);
              expect((yield* raised.sessionStore.read(threadId))?.sessionKey).toBe('sess-rewound');
              yield* last.stop(threadId);
            }),
          );
        }),
    );

    it.effect(
      'a restore after the vendor session was cut returns the thread to the session it was cut from, which the next words resume without a new one',
      () =>
        Effect.gen(function* () {
          const { openThread, floor } = yield* ProtocolRig;
          const report = yield* agent('cut-restored');
          const threadId = 'thread-cut-restored';
          const until = waiting(threadId);
          yield* openThread(threadId, CLAUDE);
          const said: Said[] = [];
          yield* scenario(
            Effect.gen(function* () {
              const raised = yield* floor(said);
              const driver = yield* raised.driver('owner-cut-restored');
              const answered = Effect.fn('testing.answeredRestoredWords')(function* (text: string) {
                const count = own(said, threadId).length + 1;
                yield* driver.send(threadId, text);
                yield* until(
                  Effect.sync(() => {
                    const mine = own(said, threadId);
                    return mine.length >= count && mine.at(-1)?.text === 'echo: heard' ? true : null;
                  }),
                  `answered ${text}`,
                  report,
                );
                return own(said, threadId).at(-1)!.run;
              });
              yield* answered('remember this');
              const second = yield* answered('and this');
              yield* driver.stop(threadId);
              const handle = raised.harness.threads.handle(threadId, 'operator');
              const rewound = yield* handle.rewind({ at: second, scope: 'from' });
              yield* raised.sessionStore.change(
                threadId,
                (facet, unit) =>
                  Effect.as(raised.turns.cut(unit, threadId, facet.sessionKey, second), {
                    facet: { ...facet, sessionKey: 'sess-rewound' },
                    value: undefined,
                  }),
                raised.turns.writes,
              );
              expect(yield* raised.turns.turn(threadId, second)).toBeUndefined();
              expect(yield* handle.restore({ rewindId: rewound.rewindId })).toMatchObject({ runIds: [second] });
              expect((yield* raised.sessionStore.read(threadId))?.sessionKey).toBe('sess-1');
              expect(yield* raised.turns.turn(threadId, second)).toMatchObject({ address: second });
              const opened = (yield* methods(report)).length;
              yield* answered('after the restore');
              const after = (yield* methods(report)).slice(opened);
              expect(after.filter((one) => one === 'session/new' || one === '_tagma/rewind')).toEqual([]);
              expect((yield* asked(report, 'session/resume')).at(-1)?.params).toMatchObject({ sessionId: 'sess-1' });
              yield* driver.stop(threadId);
            }),
          );
        }),
    );
  });
});
