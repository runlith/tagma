import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { APPROVAL, started } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { silentGuidance } from '@runlith/agent/thread/conformance/fakeTransport';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import { keyboardSession } from '../testing/driver.js';
import { keyboardFrame, keyboardRecord, keyboardRig, type KeyboardRig } from '../testing/keyboard.js';

type Session = Effect.Success<ReturnType<typeof keyboardSession>>;
const frame = (text = '') => keyboardFrame(['────────', `❯ ${text}`, '────────']);
const input = Effect.fnUntraced(function* (world: Session, text: string) {
  return (yield* world.storage.inbox.put({
    id: crypto.randomUUID(),
    threadId: world.id,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text },
    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  })).item;
});
const launch = Effect.fnUntraced(function* (world: Session, text = 'work') {
  const item = yield* input(world, text);
  const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
  world.world.control.drive(run);
  yield* world.storage.inbox.deliver([item.id], run.id);
  return {
    thread: (yield* world.storage.aggregate.find(world.id))!,
    run,
    seed: [item],
    oriented: true,
    outputOptional: false,
    guidance: silentGuidance,
  };
});
const abandoned = Effect.fnUntraced(function* (world: Session, run: ThreadRunRow) {
  world.world.control.ended(run.id);
  world.open.drop(run.id);
  return {
    id: run.id,
    threadId: run.threadId,
    kind: run.kind,
    gapMs: 1,
    selector: { kind: 'dropped' as const, failure: 'The transport driver ended.' },
    resumeLimit: 1,
    stopRequest: null,
  };
});
const plain = (world: Session) =>
  world.store.change(world.id, (facet) => Effect.succeed({ facet: { ...facet, plain: true }, value: undefined }));
const text = (world: Session) =>
  world.keyboard.accepted.filter((value) => value.cause === 'paste').map((value) => new TextDecoder().decode(value.bytes));

it.effect('a run whose CLI is gone is adopted only to end with the session’s own ending, typing nothing', () =>
  Effect.gen(function* () {
    const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()], record: null }) });
    const first = yield* launch(world);
    yield* world.words.intend(world.id, first.run.id, [first.seed[0]!.id], 'work', undefined);
    yield* world.words.sending(world.id, first.run.id, [first.seed[0]!.id], undefined);
    expect(yield* world.runs.transport.adopt(yield* abandoned(world, first.run))).toBe('adopted');
    yield* world.store.wait(world.id, (facet) => facet.session?.state === 'ended');
    expect(text(world)).toEqual([]);
    const saved = yield* world.world.ledger.runById(first.run.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureReason).toStartWith('lost:');
  }),
);

it.effect(
  'a new server over a session a stopped one left uncertain before its CLI started ends the open run with that session’s reason, whichever comes first',
  () =>
    Effect.gen(function* () {
      const why = 'launch-failed: the CLI was not started — ReferenceError: preparing is not defined';
      for (const leaseFirst of [true, false]) {
        const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()] }) });
        const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
        yield* world.words.intend(world.id, run.id, [], 'work', undefined);
        yield* world.store.change(world.id, (facet) =>
          Effect.succeed({
            facet: {
              ...facet,
              execution: null,
              session: { ...facet.session!, state: 'uncertain', cwd: null, argv: null, ownerId: null, failure: why },
            },
            value: undefined,
          }),
        );
        const candidate = yield* abandoned(world, run);
        if (leaseFirst) yield* world.driver.lease.recover();
        expect(yield* world.runs.transport.adopt(candidate)).toBe('adopted');
        if (!leaseFirst) yield* world.driver.lease.recover();
        const saved = yield* world.world.ledger.runById(run.id);
        expect([leaseFirst, saved?.status]).toEqual([leaseFirst, 'failed']);
        expect(saved?.failureReason).toStartWith('unlaunched:');
        expect(saved?.failureReason).toContain(why);
        expect((yield* world.store.read(world.id))?.session?.state).toBe('ended');
      }
    }),
);

it.effect('a run adopted while the drive that left its session uncertain is still handing it over ends once that drive has gone', () =>
  Effect.gen(function* () {
    const record = keyboardRecord();
    const handing = yield* Deferred.make<void>();
    const handed = yield* Deferred.make<void>();
    const world = yield* keyboardSession({
      name: 'claude-code',
      keyboard: keyboardRig({ frames: [frame()] }),
      start: (request) => {
        const operation = { installation: record.execution.installation, operation: request.operationId };
        return Effect.succeed({ _tag: 'Uncertain' as const, operation, effect: { _tag: 'InFlight' as const, operation } });
      },
      request: (_project, operation) =>
        Effect.succeed({ _tag: 'Unknown' as const, operation: { installation: record.execution.installation, operation } }),
      published: (_threadId, facet) =>
        facet.session?.state === 'uncertain' && facet.session.ownerId === null
          ? Effect.andThen(Deferred.succeed(handing, undefined), Deferred.await(handed))
          : Effect.void,
    });
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: { ...facet, execution: null, session: { ...facet.session!, state: 'ended' } }, value: undefined }),
    );
    const first = yield* launch(world);
    yield* world.runs.transport.launch(first);
    yield* Deferred.await(handing);
    const adopting = yield* Effect.forkChild(world.runs.transport.adopt(yield* abandoned(world, first.run)), { startImmediately: true });
    yield* Deferred.succeed(handed, undefined);
    expect(yield* Fiber.join(adopting)).toBe('adopted');
    const saved = yield* world.world.ledger.runById(first.run.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureReason).toStartWith('unlaunched:');
    expect(saved?.failureReason).toContain('The start receipt is unknown');
  }),
);

it.effect('bytes admitted before their receipt was committed are not reprinted on adoption', () =>
  Effect.gen(function* () {
    const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()] }) });
    const first = yield* launch(world);
    yield* world.words.intend(world.id, first.run.id, [first.seed[0]!.id], 'work', undefined);
    yield* world.words.sending(world.id, first.run.id, [first.seed[0]!.id], undefined);
    yield* world.driver.typing(world.id, world.execution, (keyboard) => keyboard.words('work'));
    const before = text(world);
    expect(before).toHaveLength(1);
    expect((yield* world.store.read(world.id))?.unread?.[0]?.send).toBe('sending');
    expect(yield* world.runs.transport.adopt(yield* abandoned(world, first.run))).toBe('adopted');
    expect(text(world)).toEqual(before);
    expect(yield* world.storage.inbox.unconfirmed(world.id, first.run.id)).toEqual([first.seed[0]!.id]);
  }),
);

it.effect('adoption prints a core-opened run and an intended delivery once, but a definite pre-byte refusal returns the words', () =>
  Effect.gen(function* () {
    for (const declared of [false, true]) {
      const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()] }) });
      const first = yield* launch(world);
      if (declared) yield* world.words.intend(world.id, first.run.id, [first.seed[0]!.id], 'work', undefined);
      expect(yield* world.runs.transport.adopt(yield* abandoned(world, first.run))).toBe('adopted');
      expect(text(world)).toHaveLength(1);
      expect((yield* world.world.ledger.runById(first.run.id))?.status).toBe('running');
      expect((yield* world.store.read(world.id))?.unread?.[0]?.send).toBeUndefined();
    }
    const refused = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()], unsupported: 1 }) });
    const first = yield* launch(refused);
    yield* refused.words.intend(refused.id, first.run.id, [first.seed[0]!.id], 'work', undefined);
    expect(yield* refused.runs.transport.adopt(yield* abandoned(refused, first.run))).toBe('adopted');
    expect(text(refused)).toEqual([]);
    expect((yield* refused.world.ledger.runById(first.run.id))?.status).toBe('failed');
    expect((yield* refused.storage.inbox.pending(refused.id)).map((item) => item.id)).toEqual([first.seed[0]!.id]);
    expect((yield* refused.store.read(refused.id))?.session?.state).toBe('running');
  }),
);

it.effect('a lost input reply preserves uncertain delivery through adoption without printing its bytes again', () =>
  Effect.gen(function* () {
    const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames: [frame()], lostReplyAt: 1 }) });
    const first = yield* launch(world);
    yield* world.runs.transport.launch(first);
    const before = text(world);
    expect(before).toHaveLength(1);
    expect(yield* world.storage.inbox.receipt(first.seed[0]!.id)).toMatchObject({ state: 'delivered', deliveredToRunId: first.run.id });
    expect(yield* world.runs.transport.adopt(yield* abandoned(world, first.run))).toBe('adopted');
    expect(text(world)).toEqual(before);
    expect(yield* world.storage.inbox.unconfirmed(world.id, first.run.id)).toEqual([first.seed[0]!.id]);
    expect((yield* world.world.ledger.runById(first.run.id))?.status).toBe('running');
  }),
);

it.effect('an operator draft holds a word with its public waiting reason, then concurrent steering shares one input lane', () =>
  Effect.gen(function* () {
    const frames = [frame('my own unsent words')];
    const face = keyboardRig({ frames });
    const entered = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    let block = false;
    const keyboard: KeyboardRig = {
      ...face,
      writing: {
        ...face.writing,
        input: Effect.fnUntraced(function* (execution, scope, request, revision) {
          const answer = yield* face.writing.input(execution, scope, request, revision);
          if (block && request.cause === 'paste') {
            block = false;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(released);
          }
          return answer;
        }),
      },
    };
    const world = yield* keyboardSession({ name: 'claude-code', keyboard });
    const first = yield* launch(world);
    const pending = yield* Effect.forkScoped(world.runs.transport.launch(first));
    yield* TestClock.adjust(0);
    expect(world.runs.transport.wordsWait?.(world.id)).toBe('composer-draft');
    expect(text(world)).toEqual([]);
    frames[0] = frame();
    yield* TestClock.adjust(250);
    yield* Fiber.join(pending);
    expect(world.runs.transport.wordsWait?.(world.id)).toBeNull();
    const one = yield* input(world, 'steer one');
    const two = yield* input(world, 'steer two');
    yield* world.storage.inbox.deliver([one.id, two.id], first.run.id);
    block = true;
    yield* Effect.all([world.runs.transport.deliver(first.run, [one]), world.runs.transport.deliver(first.run, [two])], {
      concurrency: 'unbounded',
    });
    yield* Deferred.await(entered);
    yield* TestClock.adjust(0);
    expect(keyboard.accepted.map((value) => value.cause)).toEqual(['paste', 'typed', 'paste']);
    yield* Deferred.succeed(released, undefined);
    yield* TestClock.adjust(0);
    expect(keyboard.accepted.map((value) => [value.binding, value.sequence])).toEqual(
      Array.from({ length: 6 }, (_, sequence) => [keyboard.accepted[0]!.binding, sequence]),
    );
    expect(keyboard.accepted.map((value) => value.cause)).toEqual(['paste', 'typed', 'paste', 'typed', 'paste', 'typed']);
    expect(keyboard.accepted.filter((value) => value.cause === 'typed').map((value) => [...value.bytes])).toEqual([[13], [13], [13]]);
    const printed = text(world);
    expect(printed).toHaveLength(3);
    expect(printed[1]).toContain('steer one');
    expect(printed[2]).toContain('steer two');
    expect((yield* world.store.read(world.id))?.unread?.map((word) => word.items)).toEqual([[first.seed[0]!.id], [one.id], [two.id]]);
    expect((yield* world.world.ledger.runById(first.run.id))?.status).toBe('running');
  }),
);

it.effect('a returned prompt is cleared before the next word, without clearing text that also contains an operator draft', () =>
  Effect.gen(function* () {
    const frames = [frame()];
    const world = yield* keyboardSession({ name: 'claude-code', keyboard: keyboardRig({ frames }) });
    yield* plain(world);
    const first = yield* launch(world);
    yield* world.runs.transport.launch(first);
    expect(text(world)).toEqual(['\u001b[200~work\u001b[201~']);
    frames[0] = frame('work');
    yield* world.runs.transport.interrupt(first.run.id, 'reader');
    yield* TestClock.adjust(0);
    expect(
      world.keyboard.accepted.filter((value) => value.cause === 'typed' && value.bytes[0] !== 13).map((value) => [...value.bytes]),
    ).toEqual([[27], [3]]);
    frames[0] = frame();
    yield* TestClock.adjust(100);
    yield* world.interrupts.settled(world.id);
    const second = yield* launch(world, 'next');
    yield* world.runs.transport.launch(second);
    frames[0] = frame('next plus my draft');
    yield* world.runs.transport.interrupt(second.run.id, 'reader');
    yield* world.interrupts.settled(world.id);
    expect(
      world.keyboard.accepted.filter((value) => value.cause === 'typed' && value.bytes[0] !== 13).map((value) => [...value.bytes]),
    ).toEqual([[27], [3], [27]]);
    const third = yield* launch(world, 'third');
    const held = yield* Effect.forkScoped(world.runs.transport.launch(third));
    yield* TestClock.adjust(0);
    expect(world.runs.transport.wordsWait?.(world.id)).toBe('composer-draft');
    expect(text(world)).toHaveLength(2);
    yield* Fiber.interrupt(held);
  }),
);
