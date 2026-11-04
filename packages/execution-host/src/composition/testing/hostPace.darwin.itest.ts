import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { background } from '../../posix/testing/tempo';
import { policy, limits, World, fixture, key, take, request, start, lane, through, bytes, command } from './processCases';

const childOf = Effect.fnUntraced(function* (pid: number) {
  const found = (yield* command(['pgrep', '-P', String(pid)])).stdout.trim().split('\n')[0];
  return yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(found);
});
const backgrounds = (pids: readonly number[]) => Effect.forEach(pids, background);
type PaceInput = { readonly name: string; readonly line: string; readonly paced: boolean; readonly input?: boolean };
const paced = Effect.fnUntraced(function* ({ name, line, paced, input = false }: PaceInput) {
  const host = yield* World;
  const answer = yield* Effect.acquireRelease(
    start({
      host,
      name,
      request: {
        ...request(host, '/bin/sh', ['-c', line]),
        paced: paced ? true : undefined,
        transport: { _tag: 'pipes', stdin: input ? 'pipe' : 'ignore' },
      },
    }),
    (answer) => host.client.stop(key(host, `${name}-cleanup`), answer.execution, 'explicit-stop', 'destroy').pipe(Effect.orDie),
  );
  if (answer.native.pid === undefined) return yield* Effect.die(new Error('the paced execution has no pid'));
  yield* through(bytes(host, answer.execution), 'READY\n');
  return { ref: answer.execution, pid: answer.native.pid };
});
layer(fixture({ policy, executions: 12, limits }), { excludeTestServices: true })('agent-work pace over actual children', (it) => {
  it.effect(
    'backgrounds paced descendants, preserves unpaced work and raises live work to full',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-lowest-take');
      expect(yield* host.client.pace('lowest')).toEqual({ _tag: 'Applied', pace: 'lowest', reached: 0, kept: 0, failed: 0 });
      const held = yield* paced({ name: 'pace-lowest', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const unpaced = yield* Effect.acquireRelease(
        start({ host, name: 'pace-unpaced', request: request(host, '/bin/sleep', ['30']) }),
        (answer) => host.client.stop(key(host, 'pace-unpaced-cleanup'), answer.execution, 'explicit-stop', 'destroy').pipe(Effect.orDie),
      );
      if (unpaced.native.pid === undefined) return yield* Effect.die(new Error('the unpaced process has no pid'));
      const child = yield* childOf(held.pid);
      const pids = [held.pid, child, unpaced.native.pid];
      expect(yield* backgrounds(pids)).toEqual([true, true, false]);
      const before = (yield* host.client.commandsAt([held.ref])).revision;
      expect(yield* host.client.pace('full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 2, kept: 0, failed: 0 });
      expect(yield* backgrounds(pids)).toEqual([false, false, false]);
      const changed = yield* host.client.changes(before, 8);
      expect(changed._tag === 'Changed' ? changed.executions.map((summary) => summary.state.ref.execution) : changed).toContain(
        held.ref.execution,
      );
      yield* host.client.pace('lowest');
      expect(yield* backgrounds(pids)).toEqual([true, true, false]);
      yield* host.client.pace('full');
      yield* host.client.stop(key(host, 'pace-lowest-stop'), held.ref, 'explicit-stop', 'destroy');
      yield* host.client.stop(key(host, 'pace-unpaced-stop'), unpaced.execution, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'applies a full move while running utility work keeps its level, and applies supported lower moves',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-low-take');
      yield* host.client.pace('low');
      const held = yield* paced({ name: 'pace-low', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const child = yield* childOf(held.pid);
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      expect(yield* host.client.pace('full')).toEqual({ _tag: 'Applied', pace: 'full', reached: 0, kept: 2, failed: 0 });
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.pace('lowest');
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('low');
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.stop(key(host, 'pace-low-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'backgrounds a live command and the descendant it starts afterward',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-running-take');
      yield* host.client.pace('full');
      const held = yield* paced({
        name: 'pace-running',
        line: "echo READY; read wake; sh -c 'echo READY; exec sleep 30'; :",
        paced: true,
        input: true,
      });
      expect(yield* background(held.pid)).toBe(false);
      expect(yield* host.client.pace('lowest')).toEqual({ _tag: 'Applied', pace: 'lowest', reached: 1, kept: 0, failed: 0 });
      yield* host.client.input(held.ref, yield* lane, { sequence: 0, cause: 'raw', act: { _tag: 'Write', bytes: Buffer.from('GO\n') } });
      yield* through(bytes(host, held.ref, 'stdout', 6n), 'READY\n');
      const child = yield* childOf(held.pid);
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('full');
      yield* host.client.stop(key(host, 'pace-running-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
  it.effect(
    'keeps lowest-born work at lowest on a low move and still permits full',
    Effect.fnUntraced(function* () {
      const host = yield* take('pace-eased-take');
      yield* host.client.pace('lowest');
      const held = yield* paced({ name: 'pace-eased', line: "sh -c 'echo READY; exec sleep 30'; :", paced: true });
      const child = yield* childOf(held.pid);
      expect(yield* host.client.pace('low')).toEqual({ _tag: 'Applied', pace: 'low', reached: 0, kept: 2, failed: 0 });
      expect(yield* backgrounds([held.pid, child])).toEqual([true, true]);
      yield* host.client.pace('full');
      expect(yield* backgrounds([held.pid, child])).toEqual([false, false]);
      yield* host.client.stop(key(host, 'pace-eased-stop'), held.ref, 'explicit-stop', 'destroy');
    }),
  );
});
