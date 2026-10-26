import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Queue, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { CommandBytesSubscription } from '../contract/wire/viewLeases.js';
import { type RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { RecordChunk, RecordDelivery } from '../contract/wire/viewLeases.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { makeViewLeaseBook } from '../terminals/viewLeases.js';
import type { ExecutionRecords } from '../contract/service/records.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { CommandReader } from '../contract/service/commands.js';
import { commandBytesChannel } from './bytesChannel.js';

const installation = InstallationId.make('command-bytes-under-test');
const execution: ExecutionRef = { installation, execution: ExecutionId.make('exec-1'), incarnation: 0 };

const params: CommandBytesSubscription = {
  projectId: 1,
  execution: 'exec-1',
  incarnation: 0,
  stream: 'stdout',
  offset: ByteOffset.make('0'),
};

const chunk = (from: number, bytes: string): RecordChunk => ({
  _tag: 'Bytes',
  range: {
    cursor: { ref: execution, stream: 'stdout', offset: ByteOffset.make(String(from)) },
    next: ByteOffset.make(String(from + bytes.length)),
    retainedFrom: ByteOffset.make('0'),
    durableThrough: ByteOffset.make(String(from + bytes.length)),
    gap: false,
  },
  bytes: new TextEncoder().encode(bytes),
});

const call = (id: number) => ({ client: { id } }) as unknown as { readonly client: Rpc.ServerClient };

const floorOver = Effect.fnUntraced(function* (
  options: {
    readonly placement?: 'held' | 'unknown';
    readonly observation?: 'prepared' | 'refused';
    readonly chunks?: readonly RecordChunk[];
  } = {},
) {
  const viewers = yield* makeViewLeaseBook({ window: 1 });
  const reader = {
    one: () =>
      options.placement === 'unknown'
        ? Effect.fail(new TerminalRefused({ reason: 'no-command', message: 'this installation holds no command under exec-1' }))
        : Effect.succeed({ command: { execution } }),
  } as unknown as CommandReader['Service'];
  const access = {
    prepare: () =>
      options.observation === 'refused'
        ? Effect.fail(new TerminalRefused({ reason: 'service-denied', message: 'this command answers its owner and the operator' }))
        : Effect.succeed({ request: { _tag: 'Observe', execution } }),
  } as unknown as CommandAccess['Service'];
  const records = {
    records: () => Stream.fromIterable(options.chunks ?? [chunk(0, 'hello')]),
  } as unknown as ExecutionRecords['Service'];
  return { reader, access, records, viewers };
});

const channel = (floor: Effect.Success<ReturnType<typeof floorOver>>) =>
  commandBytesChannel({ reader: floor.reader, access: floor.access, records: floor.records, viewers: floor.viewers });

it.live('a reference the command owner does not hold reaches no bytes, and takes no seat', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ placement: 'unknown' });
    const failure: RefusalBody = yield* Effect.scoped(
      Effect.scoped(Stream.runCollect(channel(floor)['command.bytes.subscribe'](params, call(7)))).pipe(Effect.flip),
    );

    expect(failure.code).toBe('terminal-no-command');
    expect(floor.viewers.held).toBe(0);
  }),
);

it.live('an observation the command owner refuses travels in its own words', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ observation: 'refused' });
    const failure: RefusalBody = yield* Effect.scoped(
      Effect.scoped(Stream.runCollect(channel(floor)['command.bytes.subscribe'](params, call(7)))).pipe(Effect.flip),
    );

    expect(failure.code).toBe('terminal-service-denied');
    expect(failure.unblock.length).toBeGreaterThan(0);
    expect(floor.viewers.held).toBe(0);
  }),
);

it.live('an admitted reading hands over its chunk with a lease, and its acknowledgement names one connection', () =>
  Effect.gen(function* () {
    const floor = yield* floorOver({ chunks: [chunk(0, 'hello')] });
    yield* Effect.scoped(
      Effect.scoped(
        Effect.gen(function* () {
          const frames = yield* Queue.unbounded<RecordDelivery>();
          yield* Effect.forkScoped(
            Stream.runForEach(channel(floor)['command.bytes.subscribe'](params, call(7)), (frame) => Queue.offer(frames, frame)),
          );
          const delivery = yield* Queue.take(frames);

          expect(delivery.chunk).toMatchObject({ _tag: 'Bytes', range: { next: ByteOffset.make('5') } });
          expect(delivery.viewer).toContain('viewer:');

          const crossed = yield* Effect.result(
            channel(floor)['command.bytes.parsed']({ viewer: delivery.viewer, offset: ByteOffset.make('5') }, call(8)),
          );
          expect(crossed._tag).toBe('Failure');
          if (crossed._tag === 'Failure') expect(crossed.failure.code).toBe('terminal-not-holder');

          const taken = yield* channel(floor)['command.bytes.parsed']({ viewer: delivery.viewer, offset: ByteOffset.make('5') }, call(7));
          expect(taken).toEqual({ acknowledged: true });
        }),
      ),
    );

    expect(floor.viewers.held).toBe(0);
  }),
);
