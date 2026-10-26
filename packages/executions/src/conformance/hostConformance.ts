import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import type { Executions } from '../Executions';
import type { ExecutionFeed } from '../ExecutionFeed';
import type { ExecutionRecord } from '../ExecutionRecord';
import type { HostAuthority } from '../HostAuthority';
import type { HostLifecycle } from '../HostLifecycle';
import { type CapabilityProfile, reserveOf } from '../protocol/capacity';
import { InstallationId, HostRequestKey, type ExecutionRef, type HostRequestRef } from '../protocol/execution';
import { Principal } from '../protocol/custody';
import { byteOffset } from '../protocol/record';
import type { LaunchRequest } from '../protocol/launch';

export type HostConformanceRig = {
  readonly port: Executions['Service'] &
    HostLifecycle['Service'] &
    ExecutionFeed['Service'] &
    ExecutionRecord['Service'] &
    HostAuthority['Service'];
  readonly profile: CapabilityProfile;
  readonly installation: InstallationId;
  readonly directory: string;
  readonly credits: number;
};

export class Conformance extends Context.Service<Conformance, HostConformanceRig>()('executions/testing/Conformance') {}

const decodePrincipal = Schema.decodeUnknownSync(Principal);
const decodeOperation = Schema.decodeUnknownSync(HostRequestKey);
const tester = decodePrincipal('tester');

const key =
  (installation: InstallationId) =>
  (name: string): HostRequestRef => ({ installation, operation: decodeOperation(name) });

const takeHost = Effect.fnUntraced(function* (port: HostConformanceRig['port'], keyed: (name: string) => HostRequestRef, name: string) {
  const first = yield* port.take(keyed(name), 0);
  if (first._tag !== 'Stale') return first;
  return yield* port.take(keyed(`${name}-standing`), first.standing.revision);
});

const launchEcho = (directory: string): LaunchRequest => ({
  command: { program: '/bin/echo', args: ['managed'], environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
  holder: tester,
  origin: tester,
});

const launchWaiting = (directory: string): LaunchRequest => ({
  command: { program: '/bin/cat', args: [], environment: [] },
  transport: { _tag: 'pipes', stdin: 'pipe' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
  holder: tester,
  origin: tester,
});

const decoded = (chunks: Iterable<Uint8Array>): string => [...chunks].map((chunk) => new TextDecoder().decode(chunk)).join('');

const PATIENCE = 10_000;

export function describeHostConformance<E>(name: string, fixture: Layer.Layer<Conformance, E>): void {
  layer(fixture, { excludeTestServices: true })(`${name}: execution host conformance`, (it) => {
    it.effect(
      'the recorded host starts empty, runs and records children, preserves request identity and resizes its share',
      () =>
        Effect.gen(function* () {
          {
            const held = yield* Conformance;
            const status = yield* held.port.status();
            expect(String(status.installation)).toBe(String(held.installation));
            expect(status.executions).toBe(0);
          }
          {
            const held = yield* Conformance;
            const keyed = key(held.installation);
            const took = yield* takeHost(held.port, keyed, 'conformance-take-echo');
            expect(took._tag).toBe('Held');
            if (took._tag !== 'Held') return;
            const launched = yield* held.port.start(keyed('conformance-run-echo'), launchEcho(held.directory));
            expect(launched._tag).toBe('Started');
            if (launched._tag !== 'Started') return;
            const execution: ExecutionRef = launched.execution;
            const delivered = yield* Stream.runCollect(
              held.port.subscribe({ _tag: 'Bytes', cursor: { ref: execution, stream: 'stdout', offset: byteOffset(0n) } }, held.credits),
            );
            const bytes = decoded(delivered.filter((delivery) => delivery._tag === 'Bytes').map((delivery) => delivery.bytes));
            const ending = delivered.find((delivery) => delivery._tag === 'Ended');
            const settled = yield* Stream.runHead(
              Stream.filter(
                held.port.subscribe({ _tag: 'State', execution }, held.credits),
                (delivery) =>
                  delivery._tag === 'State' &&
                  delivery.summary.state.nativeExit !== undefined &&
                  delivery.summary.state.streams.stdout !== 'open' &&
                  delivery.summary.state.streams.stderr !== 'open',
              ),
            );
            const summary = settled._tag === 'Some' && settled.value._tag === 'State' ? settled.value.summary : undefined;
            const ends = summary?.streams.map(({ stream, ending, durableThrough }) => ({ stream, ending, durableThrough })) ?? [];
            expect(bytes).toBe('managed\n');
            expect(ending).toEqual({ _tag: 'Ended', ending: 'completed' });
            expect(summary?.state.nativeExit).toEqual({ _tag: 'Code', code: 0 });
            expect(ends).toContainEqual({ stream: 'stdout', ending: 'eof', durableThrough: byteOffset(8n) });
          }
          {
            const held = yield* Conformance;
            const keyed = key(held.installation);
            const took = yield* takeHost(held.port, keyed, 'conformance-take-dup');
            expect(took._tag).toBe('Held');
            if (took._tag !== 'Held') return;
            const launch = launchWaiting(held.directory);
            const before = yield* held.port.list({ limit: 32 });
            const first = yield* held.port.start(keyed('conformance-run-dup'), launch);
            expect(first._tag).toBe('Started');
            if (first._tag !== 'Started') return;
            const second = yield* held.port.start(keyed('conformance-run-dup'), launch);
            const after = yield* held.port.list({ limit: 32 });
            expect(second._tag).toBe('Started');
            if (second._tag === 'Started') expect(second.execution).toEqual(first.execution);
            expect(after.executions.length - before.executions.length).toBe(1);
          }
          {
            const held = yield* Conformance;
            const keyed = key(held.installation);
            const took = yield* takeHost(held.port, keyed, 'conformance-take-read');
            expect(took._tag).toBe('Held');
            if (took._tag !== 'Held') return;
            const launched = yield* held.port.start(keyed('conformance-run-read'), launchEcho(held.directory));
            expect(launched._tag).toBe('Started');
            if (launched._tag !== 'Started') return;
            const execution: ExecutionRef = launched.execution;
            yield* Stream.runHead(
              Stream.filter(
                held.port.subscribe({ _tag: 'State', execution }, held.credits),
                (delivery) => delivery._tag === 'State' && delivery.summary.state.nativeExit !== undefined,
              ),
            );
            const limit = held.profile.execution.output.landingBytes;
            const cursor = { ref: execution, stream: 'stdout' as const, offset: byteOffset(0n) };
            const head = yield* held.port.read(cursor, limit);
            const again = yield* held.port.read(cursor, limit);
            const tail = yield* held.port.read({ ...cursor, offset: byteOffset(3n) }, limit);
            const text = (chunk: { readonly bytes: Uint8Array }): string => new TextDecoder().decode(chunk.bytes);
            expect(text(head)).toBe('managed\n');
            expect(text(again)).toBe(text(head));
            expect(text(tail)).toBe('aged\n');
            expect(head.range.gap).toBe(false);
          }
          {
            const held = yield* Conformance;
            const keyed = key(held.installation);
            const took = yield* takeHost(held.port, keyed, 'conformance-take-grant');
            expect(took._tag).toBe('Held');
            if (took._tag !== 'Held') return;
            const launched = yield* held.port.start(keyed('conformance-run-grant'), launchWaiting(held.directory));
            expect(launched._tag).toBe('Started');
            if (launched._tag !== 'Started') return;
            const boot = yield* held.port.capabilities();
            const standing = yield* held.port.list();
            const raised = yield* held.port.grant(keyed('conformance-grant-up'), Math.min(1, boot.granted.share * 2));
            const starved = reserveOf(held.profile.execution, 'pipes') / 2 / boot.granted.machineBytes;
            const lowered = yield* held.port.grant(keyed('conformance-grant-down'), starved);
            const after = yield* held.port.list();
            const restored = yield* held.port.grant(keyed('conformance-grant-back'), boot.granted.share);
            expect(raised._tag).toBe('Granted');
            if (raised._tag === 'Granted') {
              expect(raised.granted.share).toBe(Math.min(1, boot.granted.share * 2));
              expect(raised.granted.machineBytes).toBe(boot.granted.machineBytes);
              expect(raised.granted.grantBytes).toBe(Math.floor(raised.granted.share * boot.granted.machineBytes));
              expect(raised.reserved).toBeGreaterThan(0);
              expect(raised.over).toBe(0);
            }
            if (lowered._tag === 'Granted') {
              expect(lowered.over).toBe(lowered.reserved + lowered.retained - lowered.granted.grantBytes);
              expect(lowered.over).toBeGreaterThan(0);
            }
            expect(restored._tag).toBe('Granted');
            expect(after.executions.map((row) => String(row.state.ref.execution))).toEqual(
              standing.executions.map((row) => String(row.state.ref.execution)),
            );
            expect(standing.executions.length).toBeGreaterThan(0);
          }
          {
            const held = yield* Conformance;
            const keyed = key(held.installation);
            const took = yield* takeHost(held.port, keyed, 'conformance-take-unpaged');
            expect(took._tag).toBe('Held');
            if (took._tag !== 'Held') return;
            const launch = launchWaiting(held.directory);
            const first = yield* held.port.start(keyed('conformance-run-unpaged-1'), launch);
            expect(first._tag).toBe('Started');
            if (first._tag !== 'Started') return;
            const second = yield* held.port.start(keyed('conformance-run-unpaged-2'), launch);
            expect(second._tag).toBe('Started');
            if (second._tag !== 'Started') return;
            const page = yield* held.port.list();
            const ids = page.executions.map((row) => String(row.state.ref.execution));
            expect(ids).toContain(String(first.execution.execution));
            expect(ids).toContain(String(second.execution.execution));
          }
        }),
      PATIENCE,
    );
  });
}
