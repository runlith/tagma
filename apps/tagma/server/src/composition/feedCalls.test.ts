import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { InputRequest } from '@runlith/executions/protocol/input';
import { terminalChannel, terminalLanes } from '../executions/testing/doubles.js';
import type { TerminalGrants } from '../executions/contract/service/grants.js';
import { TERMINAL_INPUT_WRITE } from '../executions/contract/wire/feeds.js';
import type { TerminalInputWrite } from '../executions/contract/wire/viewLeases.js';
import type { TerminalRecord } from '../executions/contract/wire/terminals.js';
import { bindFeed, SocketOperations } from '../invocation/contract/service/socketOperations.js';
import type { FeedHandler } from '../platform/contract/wire/live.js';
import type { RefusalBody } from '../platform/contract/wire/refusal.js';

const record = {
  projectId: 1,
  execution: { installation: InstallationId.make('feed-order'), execution: ExecutionId.make('exec-1'), incarnation: 0 },
  transport: 'pty',
  lifetime: 'held',
  targetKey: 'feed-order',
  holder: Principal.make('operator'),
  origin: 'operator',
  revision: 0,
  acceptedAt: 0,
} as TerminalRecord;

const call = { client: { id: 1 } as Rpc.ServerClient };

const fixture = Effect.fnUntraced(function* (subscribed: () => Effect.Effect<void>) {
  let text = '';
  const faces = {
    terminals: { record: () => Effect.succeed(record) },
    writing: {
      input: (_execution: unknown, _scope: unknown, request: InputRequest) =>
        Effect.sync(() => {
          const bytes = request.act._tag === 'Write' ? request.act.bytes : new Uint8Array();
          text += new TextDecoder().decode(bytes);
          return {
            _tag: 'InputAdmitted' as const,
            receipt: {
              execution: record.execution,
              sequence: request.sequence,
              cause: request.cause,
              bytes: bytes.length,
              acceptedThrough: ByteOffset.make(String(text.length)),
            },
          };
        }),
    },
    access: {
      prepare: ({ subject }: { readonly subject: { readonly binding: BindingId } }) =>
        Effect.succeed({
          grant: {
            projectId: 1,
            execution: record.execution,
            actor: Principal.make('operator'),
            targetKey: record.targetKey,
            binding: subject.binding,
            permissionRevision: 0,
          },
        }),
    },
  } as unknown as Parameters<typeof terminalChannel>[0];
  const lanes = yield* terminalLanes({
    writing: faces.writing,
    grants: { watch: () => () => {} } as unknown as TerminalGrants['Service'],
  });
  const use = {
    ...faces,
    lanes: {
      open: lanes.open,
      close: lanes.close,
      listen: (...input: Parameters<typeof lanes.listen>) => Effect.andThen(lanes.listen(...input), subscribed()),
      publish: lanes.publish,
      turn: lanes.turn,
    },
  };
  const channel = terminalChannel(use);
  const other = terminalChannel(use);
  const bound = bindFeed(TERMINAL_INPUT_WRITE, channel['terminal.input.write'] as FeedHandler);
  const otherBound = bindFeed(TERMINAL_INPUT_WRITE, other['terminal.input.write'] as FeedHandler);
  return {
    text: () => text,
    receipts: (binding: string) => channel['terminal.input.receipts']({ projectId: 1, execution: 'exec-1', incarnation: 0, binding }),
    write: (sequence: number, text: string, binding = 'lane-1', otherDoor = false) =>
      (otherDoor ? otherBound : bound)(
        {
          projectId: 1,
          execution: 'exec-1',
          incarnation: 0,
          binding,
          sequence,
          cause: 'typed',
          act: { _tag: 'Write', bytes: new TextEncoder().encode(text) },
        } as TerminalInputWrite,
        call,
      ) as Effect.Effect<unknown, RefusalBody, SocketOperations>,
  };
});

it.effect.each([false, true])(
  'a lane preserves input order through delayed RPC admission across doors=%s without blocking another lane',
  (otherDoor) =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ready = yield* Deferred.make<void>();
          const firstStarted = yield* Deferred.make<void>();
          const firstFree = yield* Deferred.make<void>();
          const terminal = yield* fixture(() => Deferred.succeed(ready, undefined).pipe(Effect.asVoid));
          let first = true;
          const operations = SocketOperations.of({
            perform: () => Effect.die('this test invokes a feed, not an operation'),
            admitFeed: () =>
              Effect.suspend(() => {
                if (!first) return Effect.void;
                first = false;
                return Effect.andThen(Deferred.succeed(firstStarted, undefined), Deferred.await(firstFree));
              }),
          });
          const receipts = yield* Effect.forkChild(Stream.runCollect(Stream.take(terminal.receipts('lane-1'), 2)));
          yield* Deferred.await(ready);
          const before = yield* Effect.forkChild(terminal.write(0, 'a').pipe(Effect.provideService(SocketOperations, operations)));
          yield* Deferred.await(firstStarted);
          const after = yield* Effect.forkChild(
            terminal.write(1, 'b', 'lane-1', otherDoor).pipe(Effect.provideService(SocketOperations, operations)),
          );
          yield* terminal.write(0, 'z', 'lane-2').pipe(Effect.provideService(SocketOperations, operations));
          yield* Deferred.succeed(firstFree, undefined);
          yield* Fiber.join(before);
          yield* Fiber.join(after);
          expect(terminal.text()).toBe('zab');
          const answered = yield* Fiber.join(receipts);
          expect(answered.map(({ sequence, kind }) => [sequence, kind])).toEqual([
            [0, 'applied'],
            [1, 'applied'],
          ]);
        }),
      );
    }),
);

it.effect('a refused admission preserves its refusal and releases the lane for the next write', () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const firstStarted = yield* Deferred.make<void>();
        const firstFree = yield* Deferred.make<void>();
        const terminal = yield* fixture(() => Deferred.succeed(ready, undefined).pipe(Effect.asVoid));
        let first = true;
        const refusal: RefusalBody = { code: 'operator-only', reason: 'this caller is a thread', unblock: ['call as the operator'] };
        const operations = SocketOperations.of({
          perform: () => Effect.die('this test invokes a feed, not an operation'),
          admitFeed: () =>
            Effect.suspend(() => {
              if (!first) return Effect.void;
              first = false;
              return Effect.andThen(
                Deferred.succeed(firstStarted, undefined),
                Effect.andThen(Deferred.await(firstFree), Effect.fail(refusal)),
              );
            }),
        });
        const receipts = yield* Effect.forkChild(Stream.runCollect(Stream.take(terminal.receipts('lane-1'), 1)));
        yield* Deferred.await(ready);
        const refused = yield* Effect.forkChild(
          Effect.result(terminal.write(0, 'a').pipe(Effect.provideService(SocketOperations, operations))),
        );
        yield* Deferred.await(firstStarted);
        const admitted = yield* Effect.forkChild(terminal.write(0, 'b').pipe(Effect.provideService(SocketOperations, operations)));
        yield* Deferred.succeed(firstFree, undefined);
        const outcome = yield* Fiber.join(refused);
        expect(outcome._tag).toBe('Failure');
        if (outcome._tag === 'Failure') expect(outcome.failure).toEqual(refusal);
        yield* Fiber.join(admitted);
        expect(terminal.text()).toBe('b');
        expect((yield* Fiber.join(receipts)).map(({ sequence, kind }) => [sequence, kind])).toEqual([[0, 'applied']]);
      }),
    );
  }),
);

it.effect.each(['waiting', 'admission'] as const)('interrupting a write during %s leaves the lane usable and types none of it', (phase) =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const firstStarted = yield* Deferred.make<void>();
        const firstFree = yield* Deferred.make<void>();
        const terminal = yield* fixture(() => Deferred.succeed(ready, undefined).pipe(Effect.asVoid));
        let first = true;
        const operations = SocketOperations.of({
          perform: () => Effect.die('this test invokes a feed, not an operation'),
          admitFeed: () =>
            Effect.suspend(() => {
              if (!first) return Effect.void;
              first = false;
              return Effect.andThen(Deferred.succeed(firstStarted, undefined), Deferred.await(firstFree));
            }),
        });
        const receipts = yield* Effect.forkChild(Stream.runCollect(Stream.take(terminal.receipts('lane-1'), phase === 'waiting' ? 2 : 1)));
        yield* Deferred.await(ready);
        const before = yield* Effect.forkChild(terminal.write(0, 'a').pipe(Effect.provideService(SocketOperations, operations)));
        yield* Deferred.await(firstStarted);
        if (phase === 'waiting') {
          const cancelled = yield* Effect.forkChild(terminal.write(1, 'b').pipe(Effect.provideService(SocketOperations, operations)));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(cancelled);
        } else {
          yield* Fiber.interrupt(before);
        }
        const after = yield* Effect.forkChild(
          terminal.write(phase === 'waiting' ? 1 : 0, 'c').pipe(Effect.provideService(SocketOperations, operations)),
        );
        yield* Deferred.succeed(firstFree, undefined);
        if (phase === 'waiting') yield* Fiber.join(before);
        yield* Fiber.join(after);
        expect(terminal.text()).toBe(phase === 'waiting' ? 'ac' : 'c');
        expect((yield* Fiber.join(receipts)).map(({ sequence, kind }) => [sequence, kind])).toEqual(
          phase === 'waiting'
            ? [
                [0, 'applied'],
                [1, 'applied'],
              ]
            : [[0, 'applied']],
        );
      }),
    );
  }),
);
