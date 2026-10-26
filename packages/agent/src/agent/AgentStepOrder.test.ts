import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Message } from '@runlith/llm/schema/messages';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { type AgentCalls, makeAgentCalls } from './AgentCalls';
import { callerInThread } from './testing/caller';
import { builtinMode } from './testing/modes';
import type { AgentToolDoor } from './door/AgentToolDoor';
import { openToolDoor, ToolJudge } from './door/openToolDoor';
import { type Claim, everyClaim, Tool } from './tool';
import { runStepTools } from './turn/tools';
import { RunStop } from './RunStop';
import type { AgentStepIntent } from './AgentStep';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

type Ctx = Record<string, never>;

const P = '/work/notes/page.html';
const Q = '/work/notes/other.md';

const reads = (path: string): Claim => ({ on: { kind: 'file', path }, access: 'read' });
const writes = (path: string): Claim => ({ on: { kind: 'file', path }, access: 'write' });

const opened = (calls: AgentCalls, mode: 'trust' | 'review' = 'trust') =>
  openToolDoor<Ctx>(
    'run-1',
    callerInThread('thread-1', 'run-1'),
    {},
    new ToolJudge(builtinMode(mode)),
    undefined,
    undefined,
    undefined,
    undefined,
    calls,
  );

const fake = (input: {
  readonly claims?: readonly Claim[];
  readonly mutates?: true;
  readonly approval?: typeof ASKS_NEVER;
  readonly prepare?: () => Effect.Effect<unknown>;
  readonly execute: Effect.Effect<unknown>;
}) =>
  Tool.make({
    display: () => ({ form: 'none' }),
    approval: input.approval ?? ASKS_NEVER,
    description: 'A step participant.',
    parameters: Schema.Struct({}),
    mutates: input.mutates,
    claims: input.claims === undefined ? undefined : () => Effect.succeed(input.claims ?? []),
    prepare: input.prepare === undefined ? undefined : () => Effect.map(input.prepare!(), (prepared) => ({ subjects: [], prepared })),
    execute: () => input.execute,
  });

const step = (
  door: AgentToolDoor<Ctx>,
  sources: ReadonlyMap<string, Tool.Tool>,
  ids: readonly string[],
  stepNumber = 1,
  commitEffects?: (intent: AgentStepIntent) => Effect.Effect<void>,
) =>
  runStepTools({
    commitEffects,
    message: Message.assistant(ids.map((id) => ({ type: 'tool-call' as const, id, name: id, input: {} }))),
    sources,
    door,
    stop: new RunStop(),
    feed: { push: () => Effect.void },
    phase: () => Effect.void,
    callMessages: [],
    arguments: {},
    stepNumber,
  });

const queuedBehind = (calls: AgentCalls, toolCallId: string) =>
  calls.events().pipe(
    Stream.filter((event) =>
      (event.type === 'snapshot' ? event.calls : [event.call]).some(
        (call) => call.toolCallId === toolCallId && call.phase === 'waiting' && call.detail?.startsWith('after ') === true,
      ),
    ),
    Stream.take(1),
    Stream.runDrain,
  );

const marking = (order: string[], name: string, held?: Deferred.Deferred<void>) =>
  Effect.sync(() => order.push(`${name}:start`)).pipe(
    Effect.andThen(held === undefined ? Effect.void : Deferred.await(held)),
    Effect.andThen(Effect.sync(() => order.push(`${name}:end`))),
    Effect.as({ done: name }),
  );

describe('calls of one step run in the order their claims require', () => {
  it.effect(
    'a call reading what an earlier call writes starts after the writer ends; a mutating call that declares nothing runs at once',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls);
      const held = yield* Deferred.make<void>();
      const undeclaredDone = yield* Deferred.make<void>();
      const order: string[] = [];
      const sources = new Map([
        ['write', fake({ claims: [writes(P)], mutates: true, execute: marking(order, 'write', held) })],
        ['publish', fake({ claims: [reads(P)], execute: marking(order, 'publish') })],
        [
          'undeclared',
          fake({
            mutates: true,
            execute: marking(order, 'undeclared').pipe(Effect.tap(() => Deferred.succeed(undeclaredDone, undefined))),
          }),
        ],
      ]);
      const running = yield* Effect.forkScoped(step(door, sources, ['write', 'publish', 'undeclared']));
      yield* queuedBehind(calls, 'publish');
      yield* Deferred.await(undeclaredDone);
      yield* Deferred.succeed(held, undefined);
      const settled = yield* Fiber.join(running);
      expect(settled.outcomes.every((outcome) => outcome.executed)).toBe(true);
      expect(order.indexOf('undeclared:end')).toBeLessThan(order.indexOf('write:end'));
      expect(order.indexOf('publish:start')).toBeGreaterThan(order.indexOf('write:end'));
    }),
  );

  it.effect(
    'a call claiming to write everything waits for every call before it, and every call after it waits for it',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls);
      const first = yield* Deferred.make<void>();
      const barrier = yield* Deferred.make<void>();
      const order: string[] = [];
      const sources = new Map([
        ['readA', fake({ claims: [reads(P)], execute: marking(order, 'readA', first) })],
        ['barrier', fake({ claims: everyClaim('write'), mutates: true, execute: marking(order, 'barrier', barrier) })],
        ['readB', fake({ claims: [reads(Q)], execute: marking(order, 'readB') })],
      ]);
      const running = yield* Effect.forkScoped(step(door, sources, ['readA', 'barrier', 'readB']));
      yield* queuedBehind(calls, 'barrier');
      yield* queuedBehind(calls, 'readB');
      yield* Deferred.succeed(first, undefined);
      yield* Deferred.succeed(barrier, undefined);
      yield* Fiber.join(running);
      expect(order).toEqual(['readA:start', 'readA:end', 'barrier:start', 'barrier:end', 'readB:start', 'readB:end']);
    }),
  );

  it.effect(
    'disjoint calls run together, and a write waits for an earlier read of the same file',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls);
      const writing = yield* Deferred.make<void>();
      const readStarted = yield* Deferred.make<void>();
      const reading = yield* Deferred.make<void>();
      const order: string[] = [];
      const sources = new Map([
        ['writeQ', fake({ claims: [writes(Q)], mutates: true, execute: marking(order, 'writeQ', writing) })],
        [
          'readP',
          fake({
            claims: [reads(P)],
            execute: Deferred.succeed(readStarted, undefined).pipe(Effect.andThen(marking(order, 'readP', reading))),
          }),
        ],
        ['writeP', fake({ claims: [writes(P)], mutates: true, execute: marking(order, 'writeP') })],
      ]);
      const running = yield* Effect.forkScoped(step(door, sources, ['writeQ', 'readP', 'writeP']));
      yield* Deferred.await(readStarted);
      expect(order).not.toContain('writeQ:end');
      yield* queuedBehind(calls, 'writeP');
      yield* Deferred.succeed(reading, undefined);
      yield* Deferred.succeed(writing, undefined);
      yield* Fiber.join(running);
      expect(order.indexOf('writeP:start')).toBeGreaterThan(order.indexOf('readP:end'));
    }),
  );

  it.effect(
    'a call behind one that waits for the reader is refused with that call and the file named; an independent call runs',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls, 'review');
      const order: string[] = [];
      const sources = new Map([
        ['write', fake({ claims: [writes(P)], mutates: true, approval: ASKS_IN_REVIEW, execute: marking(order, 'write') })],
        ['publish', fake({ claims: [reads(P)], execute: marking(order, 'publish') })],
        ['other', fake({ claims: [reads(Q)], execute: marking(order, 'other') })],
      ]);
      const settled = yield* step(door, sources, ['write', 'publish', 'other']);
      const byId = new Map(settled.outcomes.map((outcome) => [outcome.toolCallId, outcome]));
      expect(settled.everyCallSettled).toBe(false);
      expect(byId.has('write')).toBe(false);
      expect(byId.get('publish')).toMatchObject({ executed: false });
      expect(String(byId.get('publish')?.modelOutput.value)).toContain(`write (write) must settle first — it touches ${P}`);
      expect(byId.get('other')).toMatchObject({ executed: true });
      expect(order).toEqual(['other:start', 'other:end']);
    }),
  );

  it.effect(
    'a dependent call is prepared and journaled after the call before it ends, so it reads the state that call left',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls);
      let source = 'old bytes';
      const prepared: string[] = [];
      const journaled: (readonly [readonly string[], number, string])[] = [];
      const sources = new Map([
        ['write', fake({ claims: [writes(P)], mutates: true, execute: Effect.sync(() => (source = 'new bytes')) })],
        [
          'copy',
          fake({
            claims: [reads(P), writes(Q)],
            mutates: true,
            prepare: () => Effect.sync(() => prepared.push(source)),
            execute: Effect.void,
          }),
        ],
      ]);
      const settled = yield* step(door, sources, ['write', 'copy'], 1, (intent) =>
        Effect.sync(() => journaled.push([intent.calls.map((call) => call.toolCallId), intent.messages.length, source])),
      );
      expect(settled.outcomes.every((outcome) => outcome.executed)).toBe(true);
      expect(prepared).toEqual(['new bytes']);
      expect(journaled).toEqual([
        [['write'], 1, 'old bytes'],
        [['copy'], 0, 'new bytes'],
      ]);
    }),
  );

  it.effect(
    'a write moved to the background holds its file over the next step; a call claiming everything moved there holds nothing',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 8 });
      const door = opened(calls);
      const writing = yield* Deferred.make<void>();
      const writeHeld = yield* Deferred.make<void>();
      const barrierRunning = yield* Deferred.make<void>();
      const barrierHeld = yield* Deferred.make<void>();
      const otherDone = yield* Deferred.make<void>();
      const order: string[] = [];
      const sources = new Map([
        [
          'write',
          fake({
            claims: [writes(P)],
            mutates: true,
            execute: Deferred.succeed(writing, undefined).pipe(Effect.andThen(marking(order, 'write', writeHeld))),
          }),
        ],
        [
          'barrier',
          fake({
            claims: everyClaim('write'),
            mutates: true,
            execute: Deferred.succeed(barrierRunning, undefined).pipe(Effect.andThen(marking(order, 'barrier', barrierHeld))),
          }),
        ],
        ['read', fake({ claims: [reads(P)], execute: marking(order, 'read') })],
        [
          'other',
          fake({ claims: [reads(Q)], execute: marking(order, 'other').pipe(Effect.tap(() => Deferred.succeed(otherDone, undefined))) }),
        ],
      ]);
      const first = yield* Effect.forkScoped(step(door, sources, ['barrier'], 1));
      yield* Deferred.await(barrierRunning);
      yield* calls.control({ runId: 'run-1', toolCallId: 'barrier' }, { action: 'background' });
      expect((yield* Fiber.join(first)).outcomes[0]).toMatchObject({ executed: true, output: { status: 'running' } });
      const second = yield* Effect.forkScoped(step(door, sources, ['write'], 2));
      yield* Deferred.await(writing);
      yield* calls.control({ runId: 'run-1', toolCallId: 'write' }, { action: 'background' });
      yield* Fiber.join(second);
      const third = yield* Effect.forkScoped(step(door, sources, ['read', 'other'], 3));
      yield* queuedBehind(calls, 'read');
      yield* Deferred.await(otherDone);
      yield* Deferred.succeed(writeHeld, undefined);
      yield* Fiber.join(third);
      expect(order.indexOf('read:start')).toBeGreaterThan(order.indexOf('write:end'));
      expect(order).not.toContain('barrier:end');
      yield* Deferred.succeed(barrierHeld, undefined);
    }),
  );
});
