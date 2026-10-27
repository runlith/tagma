import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Fiber, Stream } from 'effect';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { FrameRevision } from '@runlith/executions/protocol/presentation';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { Rpc } from 'effect/rpc';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import { ViewLeaseId } from '../contract/wire/viewLeases.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import { makeViewLeaseBook, type ViewLeaseBook } from './viewLeases.js';
import type { RecordChunk } from '../contract/wire/viewLeases.js';
import { terminalChannel } from './channel.js';

const installation = InstallationId.make('socket-under-test');

const record = {
  projectId: 1,
  execution: { installation, execution: ExecutionId.make('exec-1'), incarnation: 0 },
  transport: 'pipes',
  lifetime: 'held',
  targetKey: 'target-under-test',
  holder: 'operator',
  origin: 'operator',
  revision: 0,
  holdings: {},
  acceptedAt: 0,
} as unknown as TerminalRecord;

type ChannelUse = Parameters<typeof terminalChannel>[0];

const facesOver = (viewers: ViewLeaseBook, records?: Stream.Stream<RecordChunk, never>): ChannelUse =>
  ({
    terminals: { record: () => Effect.succeed(record) },
    records: { records: () => records ?? Stream.empty },
    viewers,
  }) as unknown as ChannelUse;

const call = { client: { id: 7 } } as unknown as { readonly client: Rpc.ServerClient };

const chunk = (text: string): RecordChunk => ({
  _tag: 'Bytes',
  range: {
    cursor: { ref: record.execution, stream: 'pty', offset: ByteOffset.make('0') },
    next: ByteOffset.make(String(text.length)),
    retainedFrom: ByteOffset.make('0'),
    durableThrough: ByteOffset.make(String(text.length)),
    gap: false,
  },
  bytes: new TextEncoder().encode(text),
});

it.live('a viewer refused at the seat ceiling keeps its own sentence and code', () =>
  Effect.gen(function* () {
    const channel = terminalChannel(facesOver(yield* makeViewLeaseBook({ capacity: 0 })));
    const stream = channel['terminal.screen.subscribe']({ projectId: 1, execution: 'exec-1', incarnation: 0 }, call);
    const failure: RefusalBody = yield* Effect.scoped(Stream.runCollect(stream).pipe(Effect.flip));
    expect(failure.code).toBe('terminal-capacity');
    expect(failure.reason).toContain('ceiling');
  }),
);

it.live('an acknowledgement for a lease that is gone names the lease, not the screen', () =>
  Effect.gen(function* () {
    const channel = terminalChannel(facesOver(yield* makeViewLeaseBook()));
    const failure: RefusalBody = yield* channel['terminal.screen.painted'](
      { viewer: ViewLeaseId.make('viewer:ghost'), revision: 0 as FrameRevision },
      call,
    ).pipe(Effect.flip);
    expect(failure.code).toBe('terminal-screen-lease-closed');
    expect(failure.reason).toContain('released with its stream');
    expect(failure.unblock).toEqual(['open the view again: a reader is released with its stream and nothing is held for it']);
  }),
);

it.live('a byte chunk carries the record range it came from, and the next one waits on the page', () =>
  Effect.gen(function* () {
    const channel = terminalChannel(
      facesOver(yield* makeViewLeaseBook(), Stream.fromIterable([chunk('hi'), { _tag: 'Ended', ending: 'completed' } as const])),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const pull = yield* Stream.toPull(
          channel['terminal.bytes.subscribe'](
            { projectId: 1, execution: 'exec-1', incarnation: 0, stream: 'pty', offset: ByteOffset.make('0') },
            call,
          ),
        );
        const first = (yield* pull)[0];
        expect(first.chunk._tag === 'Bytes' && first.chunk.bytes).toEqual(new TextEncoder().encode('hi'));
        expect(first.chunk._tag === 'Bytes' && first.chunk.range.next).toBe(ByteOffset.make('2'));

        const waiting = yield* Effect.forkChild(pull);
        yield* Effect.yieldNow;
        const acknowledged = yield* channel['terminal.bytes.parsed']({ viewer: first.viewer, offset: ByteOffset.make('2') }, call);
        expect(acknowledged).toEqual({ acknowledged: true });
        const second = (yield* Fiber.join(waiting))[0];
        expect(second.chunk._tag === 'Ended' && second.chunk.ending).toBe('completed');
      }),
    );
  }),
);

it.live('a parsed acknowledgement for a lease that is gone names the record lease', () =>
  Effect.gen(function* () {
    const channel = terminalChannel(facesOver(yield* makeViewLeaseBook()));
    const failure: RefusalBody = yield* channel['terminal.bytes.parsed'](
      { viewer: ViewLeaseId.make('viewer:ghost'), offset: ByteOffset.make('0') },
      call,
    ).pipe(Effect.flip);
    expect(failure.code).toBe('terminal-record-lease-closed');
    expect(failure.unblock.length).toBeGreaterThan(0);
  }),
);

it.live('a byte feed on an execution this project does not hold refuses before any reader opens', () =>
  Effect.gen(function* () {
    const viewers = yield* makeViewLeaseBook();
    const channel = terminalChannel(facesOver(viewers, Stream.fromIterable([chunk('hi')])));
    const failure: RefusalBody = yield* Effect.scoped(
      Stream.runCollect(
        channel['terminal.bytes.subscribe'](
          { projectId: 2, execution: 'exec-1', incarnation: 0, stream: 'pty', offset: ByteOffset.make('0') },
          call,
        ),
      ).pipe(Effect.flip),
    );
    expect(failure.code).toBe('terminal-unknown');
    expect(viewers.held).toBe(0);
  }),
);
