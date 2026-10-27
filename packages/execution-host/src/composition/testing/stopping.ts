import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { Adapter, PTY, PIPES } from '../../holder/testing/Adapter';
import { binding, bytes, Host, start, stop, textUntil, withExecution, type HostAdapter } from './session';

export const stopContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host stop contracts`, (it) => {
    it.effect('starts terminal stopping with hang-up and preserves its native exit', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PTY, 'wait');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            yield* textUntil(host, child.execution, 'pty', 'READY');
            const receipt = yield* stop(host, child.execution);
            expect(receipt.steps.map(String)).toEqual([adapter.steps.hangup]);
            expect(receipt.confirmed[0]?.exit).toEqual(platform.exits.hangup);
            expect(receipt.residual).toEqual([]);
            expect(receipt.cleanup).toBe('complete');
          }),
        );
      }),
    );

    it.effect('interrupts unexeced pipe work and retains the cleanup it prints', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PIPES, 'interrupt');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            yield* textUntil(host, child.execution, 'stdout', 'READY\n');
            const graceful = (yield* host.client.served()).has('pipe-graceful-stop');
            const receipt = yield* stop(host, child.execution);
            expect(receipt.steps.map(String)).toEqual(graceful ? [adapter.steps.interrupt] : [adapter.steps.kill]);
            if (graceful) expect((yield* bytes(host, child.execution, 'stdout')).toString()).toContain('CLEANED\n');
            else expect(receipt.confirmed[0]?.exit).toEqual(platform.exits.kill);
            expect(receipt.residual).toEqual([]);
            expect(receipt.cleanup).toBe('complete');
          }),
        );
      }),
    );

    it.effect('delivers terminate as the second pipe stopping step', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PIPES, 'terminate');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            yield* textUntil(host, child.execution, 'stdout', 'READY\n');
            const graceful = (yield* host.client.served()).has('pipe-graceful-stop');
            const receipt = yield* stop(host, child.execution);
            expect(receipt.steps.map(String)).toEqual(graceful ? [adapter.steps.interrupt, adapter.steps.terminate] : [adapter.steps.kill]);
            if (graceful) {
              expect((yield* bytes(host, child.execution, 'stdout')).toString()).toContain('TERMINATED\n');
            } else expect(receipt.confirmed[0]?.exit).toEqual(platform.exits.kill);
            expect(receipt.residual).toEqual([]);
            expect(receipt.cleanup).toBe('complete');
          }),
        );
      }),
    );

    it.effect('kills pipe work that ignores interrupt and terminate at the last ladder step', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PIPES, 'stubborn');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            yield* textUntil(host, child.execution, 'stdout', 'READY\n');
            const graceful = (yield* host.client.served()).has('pipe-graceful-stop');
            const receipt = yield* stop(host, child.execution);
            expect(receipt.steps.map(String)).toEqual(
              graceful ? [adapter.steps.interrupt, adapter.steps.terminate, adapter.steps.kill] : [adapter.steps.kill],
            );
            expect(receipt.confirmed[0]?.exit).toEqual(platform.exits.kill);
            expect(receipt.residual).toEqual([]);
            expect(receipt.cleanup).toBe('complete');
          }),
        );
      }),
    );

    it.effect('destroys the work its leader forked and leaves no running proven member', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PIPES, 'fork');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            const printed = yield* textUntil(host, child.execution, 'stdout', '\n');
            const descendant = Number(printed.trim());
            expect(descendant).toBeGreaterThan(0);
            const receipt = yield* stop(host, child.execution, 'destroy');
            expect(receipt.residual).toEqual([]);
            expect(receipt.cleanup).toBe('complete');
            expect(yield* platform.standing(descendant)).not.toBe('running');
          }),
        );
      }),
    );

    it.effect('begins stopping after leader exit at terminate and preserves that original exit', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const platform = yield* Adapter;
        const child = yield* start(PIPES, 'fork');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            const descendant = Number((yield* textUntil(host, child.execution, 'stdout', '\n')).trim());
            const lane = yield* binding(host, child.execution);
            const typed = yield* host.client.input(child.execution, lane, {
              sequence: 0,
              cause: 'raw',
              act: { _tag: 'Write', bytes: Buffer.from('x') },
            });
            expect(typed._tag).toBe('InputAdmitted');
            const ended = yield* host.client.subscribe({ _tag: 'State', execution: child.execution }, host.credits).pipe(
              Stream.filter((item) => item._tag === 'State' && item.summary.state.nativeExit !== undefined),
              Stream.runHead,
            );
            expect(ended._tag).toBe('Some');
            const receipt = yield* stop(host, child.execution, 'destroy');
            const graceful = (yield* host.client.served()).has('pipe-graceful-stop');
            expect(String(receipt.steps[0])).toBe(graceful ? adapter.steps.terminate : adapter.steps.kill);
            expect(receipt.confirmed[0]?.exit).toEqual({ _tag: 'Code', code: 7 });
            expect(receipt.residual).toEqual([]);
            expect(yield* platform.standing(descendant)).not.toBe('running');
          }),
        );
      }),
    );
  });
