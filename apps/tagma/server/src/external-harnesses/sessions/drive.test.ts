import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { APPROVAL, started } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { providerCatalogOf, staticRegistry } from '../../providers/testing/registry.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { TestClock } from 'effect/testing';
import { activityRecording } from '@runlith/activity/testing';
import { TerminalUnavailable } from '../../executions/contract/wire/refusals.js';
import { keyboardSession } from '../testing/driver.js';
import { keyboardFrame, keyboardRecord, keyboardRig } from '../testing/keyboard.js';
import { standingAlignment } from '../testing/alignment.js';
import { silentGuidance } from '@runlith/agent/thread/conformance/fakeTransport';

it.effect('an account refusal before launch settles both the session and its run with the recovery action', () =>
  Effect.gen(function* () {
    const ports = yield* Layer.build(
      Layer.mock(HarnessAccounts, {
        launch: () => Effect.fail(new GateRefusal('account-required', 'The account is signed out.', ['sign_in_account'])),
      }),
    );
    const world = yield* keyboardSession({
      name: 'claude-code',
      keyboard: keyboardRig({ frames: [keyboardFrame(['────────', '❯ ', '────────'])] }),
      accounts: Context.get(ports, HarnessAccounts),
      providers: staticRegistry(providerCatalogOf([])),
      place: () => Effect.succeed({ projectId: 7, root: '/project' }),
    });
    yield* world.store.change(world.id, (facet) =>
      Effect.succeed({ facet: { ...facet, execution: null, session: { ...facet.session!, state: 'ended' } }, value: undefined }),
    );
    const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
    world.open.add(run.id, world.id);
    yield* world.journal.open(run, (yield* world.store.read(world.id))!, []);
    yield* world.words.intend(world.id, run.id, [], 'work', undefined);
    yield* world.driver.launch(world.id, run.id, 'work');
    yield* world.store.wait(world.id, (facet) => facet.session?.state === 'ended');
    const saved = yield* world.world.ledger.runById(run.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureReason).toContain('account-required');
    expect(saved?.failureReason).toContain('sign_in_account');
    expect((yield* world.store.read(world.id))?.session?.state).toBe('ended');
    expect(world.keyboard.accepted).toEqual([]);
  }),
);

type World = Effect.Success<ReturnType<typeof keyboardSession>>;

const prompt = () => keyboardRig({ frames: [keyboardFrame(['────────', '❯ ', '────────'])] });

const unlaunched = (world: World) =>
  world.store.change(world.id, (facet) =>
    Effect.succeed({ facet: { ...facet, execution: null, session: { ...facet.session!, state: 'ended' } }, value: undefined }),
  );

const spoken = Effect.fnUntraced(function* (world: World, id: string, text: string) {
  const word = (yield* world.storage.inbox.put({
    id,
    threadId: world.id,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text },
    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  })).item;
  const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
  world.world.control.drive(run);
  yield* world.storage.inbox.deliver([word.id], run.id);
  yield* world.runs.transport.launch({
    thread: (yield* world.storage.aggregate.find(world.id))!,
    run,
    seed: [word],
    oriented: true,
    outputOptional: false,
    guidance: silentGuidance,
  });
  return run;
});

const standingAgain = Effect.fnUntraced(function* (world: World, before: string) {
  const run = yield* spoken(world, 'again', 'again');
  const next = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'running' && facet.session.id !== before);
  expect(next?.execution).not.toBeNull();
  expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(run.id);
});

it.effect(
  'a drive that dies before the CLI start is dispatched ends the session and its run failed with the defect, and the next word starts the CLI',
  () =>
    Effect.gen(function* () {
      let broken = true;
      const recording = activityRecording();
      const world = yield* keyboardSession({
        name: 'claude-code',
        keyboard: prompt(),
        log: recording.log,
        alignment: (store) => {
          const standing = standingAlignment(store);
          return {
            ...standing,
            align: (...asked) => {
              if (!broken) return standing.align(...asked);
              broken = false;
              return Effect.sync(() => {
                throw new ReferenceError('preparing is not defined');
              });
            },
          };
        },
      });
      yield* unlaunched(world);
      const run = yield* spoken(world, 'work', 'work');
      const ended = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'ended');
      expect(ended?.session?.failure).toContain('ReferenceError: preparing is not defined');
      const saved = yield* world.world.ledger.runById(run.id);
      expect(saved?.status).toBe('failed');
      expect(saved?.failureReason).toContain('ReferenceError: preparing is not defined');
      const faults = recording.activities().filter((one) => one.notes.some((note) => note.type === 'defect'));
      expect(faults.map((one) => [one.opened.thread, one.notes])).toMatchObject([
        [world.id, [{ type: 'defect', place: 'terminal drive', message: 'preparing is not defined' }]],
      ]);
      yield* standingAgain(world, ended!.session!.id);
    }),
);

it.effect('a start whose receipt never came back leaves the session uncertain with that reason, and its run open', () =>
  Effect.gen(function* () {
    const record = keyboardRecord();
    const world = yield* keyboardSession({
      name: 'claude-code',
      keyboard: prompt(),
      start: (request) => {
        const operation = { installation: record.execution.installation, operation: request.operationId };
        return Effect.succeed({ _tag: 'Uncertain' as const, operation, effect: { _tag: 'InFlight' as const, operation } });
      },
    });
    yield* unlaunched(world);
    const run = yield* spoken(world, 'work', 'work');
    const uncertain = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'uncertain');
    expect(uncertain?.execution).toBeNull();
    expect(uncertain?.session?.failure).toContain(`harness-run:${uncertain?.session?.id}`);
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(run.id);
  }),
);

it.effect('a start the terminal host refuses before dispatching it, its receipt naming no start, ends the session and its run failed', () =>
  Effect.gen(function* () {
    const record = keyboardRecord();
    const world = yield* keyboardSession({
      name: 'claude-code',
      keyboard: prompt(),
      start: () =>
        Effect.fail(
          new TerminalUnavailable({
            owner: 'store',
            message: 'The launch storage binding could not be recorded; this launch was not dispatched.',
          }),
        ),
      request: (_project, operation) =>
        Effect.succeed({ _tag: 'Unknown' as const, operation: { installation: record.execution.installation, operation } }),
    });
    yield* unlaunched(world);
    const run = yield* spoken(world, 'work', 'work');
    const ended = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'ended');
    expect(ended?.session?.failure).toContain('this launch was not dispatched');
    const saved = yield* world.world.ledger.runById(run.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureReason).toContain('this launch was not dispatched');
  }),
);

it.effect(
  'a session a stopped server left uncertain before its CLI ever started ends failed as unlaunched when the next server takes it up',
  () =>
    Effect.gen(function* () {
      const world = yield* keyboardSession({ name: 'claude-code', keyboard: prompt() });
      const run = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
      yield* world.words.intend(world.id, run.id, [], 'work', undefined);
      yield* world.store.change(world.id, (facet) =>
        Effect.succeed({
          facet: { ...facet, execution: null, session: { ...facet.session!, state: 'uncertain', cwd: null, argv: null, ownerId: null } },
          value: undefined,
        }),
      );
      yield* world.driver.lease.recover();
      const ended = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'ended');
      expect(ended?.session?.failure).toStartWith('unlaunched:');
    }),
);

it.effect('releasing an active CLI closes its run and unread words, preserves the thread and permits a new session', () =>
  Effect.gen(function* () {
    const world = yield* keyboardSession({
      name: 'claude-code',
      keyboard: keyboardRig({ frames: [keyboardFrame(['────────', '❯ ', '────────'])] }),
    });
    yield* TestClock.adjust(1);
    yield* world.reports.reported(world.id, {
      session: world.session,
      receipt: 'prompt',
      event: { hook_event_name: 'UserPromptSubmit', session_id: 'root', prompt_id: 'p1' },
      prompt: 'work',
    });
    const run = (yield* world.world.ledger.activeRun(world.id))!;
    world.open.add(run.id, world.id);
    const item = (yield* world.storage.inbox.put({
      id: 'unread',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'signal',
      body: { type: 'steer', addressee: 'transport', text: 'more' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })).item;
    yield* world.storage.inbox.deliver([item.id], run.id);
    yield* world.words.steered(world.id, run.id, [item.id], undefined);
    expect(yield* world.driver.stop(world.id)).toBe('stopped');
    expect(yield* world.world.ledger.activeRun(world.id)).toBeNull();
    expect((yield* world.world.ledger.runById(run.id))?.status).toBe('aborted');
    const after = yield* world.store.read(world.id);
    expect(after?.session?.state).toBe('ended');
    expect(after?.turn).toBeUndefined();
    expect(after?.unread ?? []).toEqual([]);
    expect(yield* world.storage.aggregate.find(world.id)).toBeDefined();
    const nextWord = (yield* world.storage.inbox.put({
      id: 'again',
      threadId: world.id,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'again' },
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    })).item;
    const nextRun = started(yield* world.world.lifecycle.create(world.world.startFrom, APPROVAL, { kind: 'turn' })).run;
    world.world.control.drive(nextRun);
    yield* world.storage.inbox.deliver([nextWord.id], nextRun.id);
    yield* world.runs.transport.launch({
      thread: (yield* world.storage.aggregate.find(world.id))!,
      run: nextRun,
      seed: [nextWord],
      oriented: true,
      outputOptional: false,
      guidance: silentGuidance,
    });
    const next = yield* world.store.wait(world.id, (facet) => facet.session?.state === 'running' && facet.session.id !== world.session);
    expect(next?.session?.id).not.toBe(world.session);
    expect(next?.execution).not.toBeNull();
    expect((yield* world.world.ledger.activeRun(world.id))?.id).toBe(nextRun.id);
  }),
);
