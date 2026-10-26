import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schedule, Stream } from 'effect';
import { byteOffset, type ByteCursor } from '@runlith/executions/protocol/record';
import { Adapter, PIPES, PTY } from '../../holder/testing/Adapter';
import { binding, Host, operation, principal, start, stop, type HostAdapter } from './session';

const through = Effect.fnUntraced(function* (host: Host['Service'], from: ByteCursor, marker: string) {
  const chunks: Uint8Array[] = [];
  const needle = Buffer.from(marker);
  let tail = Buffer.alloc(0);
  let cursor = from;
  let found = false;
  yield* host.client.subscribe({ _tag: 'Bytes', cursor: from }, host.credits).pipe(
    Stream.filter((item) => item._tag === 'Bytes'),
    Stream.takeUntil((item) => {
      if (item._tag !== 'Bytes') return false;
      expect(item.range.gap).toBe(false);
      expect(item.range.cursor.offset).toBe(cursor.offset);
      chunks.push(item.bytes);
      cursor = { ...cursor, offset: item.range.next };
      const scan = Buffer.concat([tail, item.bytes]);
      found = scan.includes(needle);
      tail = scan.subarray(Math.max(0, scan.length - needle.length + 1));
      return found;
    }),
    Stream.runDrain,
  );
  expect(found).toBe(true);
  return { cursor, bytes: Buffer.concat(chunks) };
});

export const holderLossContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host holder-loss contracts`, (it) => {
    it.effect('serves live terminal and pipe output after holder loss, refuses new starts and can stop the surviving work', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const served = yield* host.client.served();
        const children = [];
        const ended = new Set<string>();
        for (const transport of [PTY, PIPES]) {
          const child = yield* start(transport, 'echo', 1_024);
          if (child.native.pid === undefined) return yield* Effect.die(new Error('the host omitted the live execution leader'));
          yield* Effect.addFinalizer(() =>
            ended.has(child.execution.execution) ? Effect.void : Effect.orDie(Effect.asVoid(stop(host, child.execution, 'destroy'))),
          );
          const stream = transport._tag === 'pty' ? 'pty' : 'stdout';
          const first = yield* through(host, { ref: child.execution, stream, offset: byteOffset(0n) }, 'READY\n');
          const survives = served.has(transport._tag === 'pty' ? 'terminal-survives-holder' : 'pipe-survives-holder');
          children.push({ child, cursor: first.cursor, lane: yield* binding(host, child.execution), survives });
        }
        yield* host.control.loseHolder;
        const status = yield* host.client
          .status()
          .pipe(Effect.repeat({ while: (status) => status.holder._tag === 'Standing', schedule: Schedule.spaced(10) }));
        expect(status.holder).toMatchObject({ _tag: 'Lost', loss: { reason: 'gone' } });
        const refused = yield* host.client.start(yield* operation(host), {
          command: { program: platform.cwd.path, args: platform.cwd.args, environment: [], cwd: platform.directory },
          transport: PIPES,
          lifetime: 'held',
          purpose: 'command',
          target: { environment: 'contract', namespace: 'contract', cwd: platform.directory, dependencies: [] },
          holder: principal,
          origin: principal,
        });
        expect(refused).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'HolderLost' } });
        const survivors = children.filter(({ survives }) => survives);
        for (const { child, cursor, lane } of survivors) {
          expect(yield* platform.standing(child.native.pid!)).toBe('running');
          expect(
            (yield* host.client.input(child.execution, lane, {
              sequence: 0,
              cause: 'raw',
              act: { _tag: 'Write', bytes: Buffer.from('survived\n') },
            }))._tag,
          ).toBe('InputAdmitted');
          expect((yield* through(host, cursor, 'survived\n')).bytes.toString()).toBe('survived\n');
        }
        for (const { child } of survivors) {
          const stopped = yield* stop(host, child.execution, 'destroy');
          ended.add(child.execution.execution);
          expect(stopped.steps.length).toBeGreaterThan(0);
          expect(yield* platform.standing(child.native.pid!)).toBe('gone');
        }
      }),
    );
  });
