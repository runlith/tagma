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

export type Forgetting = (directory: string, execution: string, what: 'start' | 'departure') => Effect.Effect<void, unknown>;

export const restartContracts = (adapter: HostAdapter, forgetStart: Forgetting) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host logic replacement contracts`, (it) => {
    it.effect('recovers records and terminal input, and names children whose start or departure was lost', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const kept = Effect.map(host.client.status(), (status) => status.kept?.records ?? 0);
        const beforeKept = yield* kept;
        const ended = yield* host.client.start(yield* operation(host), {
          command: {
            program: '/bin/sh',
            args: ['-c', "printf 'kept\\n'"],
            environment: [{ name: 'PATH', value: platform.searchPath }],
          },
          transport: { _tag: 'pipes', stdin: 'ignore' },
          lifetime: 'command',
          purpose: 'command',
          target: { environment: 'contract', namespace: 'contract', cwd: platform.directory, dependencies: [] },
          holder: principal,
          origin: principal,
          admission: {
            origin: { scope: 'contract', owner: 'contract', cohort: 'contract' },
            limits: { executionMs: 60_000, executionCeilingMs: 60_000 },
            policyIdentity: 'contract',
          },
        });
        if (ended._tag !== 'Accepted' || ended.execution === undefined)
          return yield* Effect.die(new Error(`the command was not accepted: ${ended._tag}`));
        yield* kept.pipe(Effect.repeat({ schedule: Schedule.spaced(20), until: (records) => records > beforeKept }));

        const child = yield* start(PTY, 'echo', 1_024);
        const unknown = yield* start(PIPES, 'echo', 1_024);
        if (child.native.pid === undefined || unknown.native.pid === undefined)
          return yield* Effect.die(new Error('the host omitted a live leader'));
        yield* Effect.addFinalizer(() => Effect.orDie(Effect.asVoid(stop(host, child.execution, 'destroy'))));
        yield* Effect.addFinalizer(() =>
          Effect.orDie(
            Effect.gen(function* () {
              if ((yield* platform.standing(unknown.native.pid!)) === 'running') process.kill(unknown.native.pid!, 'SIGKILL');
            }),
          ),
        );
        const first = yield* through(host, { ref: child.execution, stream: 'pty', offset: byteOffset(0n) }, 'READY\n');
        const lane = yield* binding(host, child.execution);
        expect(
          (yield* host.client.input(child.execution, lane, {
            sequence: 0,
            cause: 'raw',
            act: { _tag: 'Write', bytes: Buffer.from('before\n') },
          }))._tag,
        ).toBe('InputAdmitted');
        const before = yield* through(host, first.cursor, 'before\n');
        expect(before.bytes.toString()).toBe('before\n');
        const incarnation = yield* host.client.generation();
        yield* forgetStart(platform.directory, unknown.execution.execution, 'start');
        yield* host.control.restartLogic;

        expect(yield* host.client.generation()).toBe(incarnation);
        expect((yield* host.client.state(child.execution))?.native.pid).toBe(child.native.pid);
        expect(yield* platform.standing(child.native.pid)).toBe('running');
        expect((yield* host.client.status()).unadopted).toMatchObject([{ execution: unknown.execution.execution, reason: 'no-start' }]);
        expect(yield* platform.standing(unknown.native.pid)).toBe('running');
        const renewed = yield* binding(host, child.execution);
        expect(
          (yield* host.client.input(child.execution, renewed, {
            sequence: 0,
            cause: 'raw',
            act: { _tag: 'Write', bytes: Buffer.from('after\n') },
          }))._tag,
        ).toBe('InputAdmitted');
        expect((yield* through(host, before.cursor, 'after\n')).bytes.toString()).toBe('after\n');
        const read = yield* host.client.read({ ref: ended.execution, stream: 'stdout', offset: byteOffset(0n) }, 4_096);
        expect(Buffer.from(read.bytes).toString()).toBe('kept\n');
        expect((yield* through(host, { ref: ended.execution, stream: 'stdout', offset: byteOffset(0n) }, 'kept\n')).bytes.toString()).toBe(
          'kept\n',
        );

        const unrecorded = yield* start(PIPES, 'wait');
        if (unrecorded.native.pid === undefined) return yield* Effect.die(new Error('the host omitted the unrecorded leader'));
        yield* Effect.addFinalizer(() =>
          Effect.orDie(
            Effect.gen(function* () {
              if ((yield* platform.standing(unrecorded.native.pid!)) === 'running') process.kill(unrecorded.native.pid!, 'SIGKILL');
            }),
          ),
        );
        yield* forgetStart(platform.directory, unrecorded.execution.execution, 'departure');
        yield* host.control.yieldLogic;
        expect((yield* host.client.status()).unadopted).toContainEqual(
          expect.objectContaining({
            execution: unrecorded.execution.execution,
            reason: 'departure-lost',
          }),
        );
        expect(yield* platform.standing(unrecorded.native.pid)).toBe('running');
        expect((yield* host.client.state(child.execution))?.native.pid).toBe(child.native.pid);
      }),
    );
  });
