import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, type Layer } from 'effect';
import { Holder } from '../Holder';
import { PIPES, PTY, drain, finished, launch, pipes, readUntil, ready, request, terminal, using, writeAll, Adapter } from './Adapter';

export const lifecycleContracts = (name: string, services: Layer.Layer<Adapter | Holder, unknown>) =>
  layer(services, { excludeTestServices: true })(`${name} lifecycle contracts`, (it) => {
    for (const transport of [PTY, PIPES]) {
      it.effect(
        `${transport._tag}: a stopped and continued child stays running, keeps its input and output, and reports its own exit`,
        () =>
          Effect.gen(function* () {
            const holder = yield* Holder;
            const child = yield* launch(transport, 'echo', 2);
            yield* using(
              child,
              Effect.gen(function* () {
                const source = transport._tag === 'pty' ? terminal(child) : pipes(child).stdout;
                const sink = transport._tag === 'pty' ? terminal(child) : pipes(child).stdin!;
                yield* ready(source);
                yield* writeAll(sink, Buffer.from('a'));
                expect((yield* readUntil(source, 'a')).toString()).toContain('a');
                const stopped = yield* Effect.result(child.signal('leader', 'SIGSTOP'));
                if (!holder.capabilities.has('named-signals')) {
                  expect(stopped._tag === 'Failure' ? stopped.failure : undefined).toMatchObject({ reason: 'unsupported' });
                  return;
                }
                expect(stopped._tag).toBe('Success');
                yield* Effect.sleep(100);
                expect(yield* child.observe).toBeUndefined();
                expect(yield* child.observed).toBeUndefined();
                yield* child.signal('leader', 'SIGCONT');
                yield* Effect.sleep(50);
                expect(yield* child.observe).toBeUndefined();
                yield* writeAll(sink, Buffer.from('b'));
                expect((yield* readUntil(source, 'b')).toString()).toContain('b');
                expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
              }),
            );
          }),
      );
    }

    it.effect('observes exit without reaping and removes the zombie only on reap', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PIPES, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* ready(channel.stdout);
            expect(yield* child.observed).toBeUndefined();
            expect(child.reaped).toBeUndefined();
            yield* writeAll(channel.stdin!, Buffer.from('x'));
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 37 });
            expect(yield* child.observed).toEqual({ _tag: 'Code', code: 37 });
            expect(child.reaped).toBeUndefined();
            expect(yield* adapter.standing(child.pid)).toBe('zombie');
            const reaped = yield* child.reap;
            expect(reaped.exit).toEqual({ _tag: 'Code', code: 37 });
            expect(child.reaped).toEqual(reaped);
            expect(yield* adapter.standing(child.pid)).toBe('gone');
          }),
        );
      }),
    );

    it.effect('answers a preparation and an activation by whether the holder replaces itself', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const holder = yield* Holder;
        const replaces = holder.capabilities.has('holder-replaces-itself');
        const prepared = yield* Effect.result(holder.prepare({ holder: 'holder', logic: [adapter.missing] }));
        const activated = yield* Effect.result(holder.activate);
        expect(prepared._tag === 'Failure' ? prepared.failure : undefined).toMatchObject({
          act: 'prepare',
          reason: replaces ? 'not-found' : 'unsupported',
        });
        expect(activated._tag === 'Failure' ? activated.failure : undefined).toMatchObject({
          act: 'activate',
          reason: replaces ? 'invalid' : 'unsupported',
        });
      }),
    );

    it.effect('answers an action on a work whose exited, unreaped leader is its last member as gone', () =>
      Effect.gen(function* () {
        const child = yield* launch(PIPES, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(pipes(child).stdout);
            yield* writeAll(pipes(child).stdin!, Buffer.from('x'));
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 37 });
            const acted = yield* Effect.result(child.act('work', 'kill'));
            expect(acted._tag === 'Failure' ? acted.failure : undefined).toMatchObject({
              _tag: 'HolderRefused',
              act: 'act',
              reason: 'gone',
            });
            expect(yield* child.workState).toBe('ended');
            expect((yield* child.reap).exit).toEqual({ _tag: 'Code', code: 37 });
          }),
        );
      }),
    );

    it.effect('refuses to reap a running child and leaves it running', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PIPES, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(pipes(child).stdout);
            const refused = yield* Effect.result(child.reap);
            expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({
              _tag: 'HolderRefused',
              act: 'reap',
              reason: 'running',
            });
            expect(yield* adapter.standing(child.pid)).toBe('running');
          }),
        );
      }),
    );

    it.effect('measures actual child CPU and peak memory when reaped', () =>
      Effect.gen(function* () {
        const measure = Effect.fnUntraced(function* (scenario: 'cost' | 'wait') {
          const child = yield* launch(PIPES, scenario);
          return yield* using(
            child,
            Effect.gen(function* () {
              const channel = pipes(child);
              yield* ready(channel.stdout);
              expect(child.reaped).toBeUndefined();
              yield* writeAll(channel.stdin!, Buffer.from('x'));
              yield* drain(channel.stdout);
              yield* child.exit;
              return (yield* child.reap).cost;
            }),
          );
        });
        const burned = yield* measure('cost');
        const idle = yield* measure('wait');
        expect(burned._tag).toBe('Measured');
        expect(idle._tag).toBe('Measured');
        if (burned._tag !== 'Measured' || idle._tag !== 'Measured')
          return yield* Effect.die(new Error('the reaped costs must be measured'));
        expect(burned.cpuMicros).toBeGreaterThan(idle.cpuMicros * 5);
        expect(idle.cpuMicros).toBeLessThan(200_000);
        expect(burned.peakRssBytes).toBeGreaterThan(256 * 1024);
      }),
    );

    it.effect('rejects actions after reap and closes all terminal operations on release', () =>
      Effect.gen(function* () {
        const holder = yield* Holder;
        const child = yield* launch(PTY, 'wait');
        const channel = terminal(child);
        yield* ready(channel);
        yield* writeAll(channel, Buffer.from('x'));
        yield* drain(channel);
        yield* child.exit;
        yield* child.reap;
        const acted = yield* Effect.result(child.act('leader', 'kill'));
        expect(acted._tag === 'Failure' ? acted.failure : undefined).toMatchObject({ _tag: 'HolderRefused', reason: 'reaped' });
        const named = yield* Effect.result(child.signal('leader', 'SIGTERM'));
        expect(named._tag === 'Failure' ? named.failure : undefined).toMatchObject({
          _tag: 'HolderRefused',
          reason: holder.capabilities.has('named-signals') ? 'reaped' : 'unsupported',
        });
        yield* child.release;
        const write = yield* Effect.result(channel.write(Buffer.from('late')));
        const resize = yield* Effect.result(channel.resize(30, 100));
        const interrupt = yield* Effect.result(channel.interrupt());
        for (const refused of [write, resize, interrupt]) {
          expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({ _tag: 'ChannelFailed', reason: 'closed' });
        }
        const released = yield* Effect.result(child.act('leader', 'kill'));
        expect(released._tag === 'Failure' ? released.failure : undefined).toMatchObject({ _tag: 'HolderRefused', reason: 'unknown' });
        const signalled = yield* Effect.result(child.signal('leader', 'SIGTERM'));
        expect(signalled._tag === 'Failure' ? signalled.failure : undefined).toMatchObject({
          _tag: 'HolderRefused',
          reason: holder.capabilities.has('named-signals') ? 'unknown' : 'unsupported',
        });
      }),
    );

    it.effect('refuses a duplicate live identity without replacing its child', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const holder = yield* Holder;
        const spec = request(adapter, adapter.fixture('wait', PIPES), PIPES);
        const child = yield* holder.launch(spec);
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(pipes(child).stdout);
            const refused = yield* Effect.result(holder.launch(spec));
            expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({
              _tag: 'HolderRefused',
              reason: 'duplicate',
            });
            expect(yield* adapter.standing(child.pid)).toBe('running');
          }),
        );
      }),
    );

    it.effect('delivers a named signal or returns its typed unsupported refusal', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const holder = yield* Holder;
        const child = yield* launch(PIPES, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(pipes(child).stdout);
            const named = yield* Effect.result(child.signal('leader', 'SIGTERM'));
            if (!holder.capabilities.has('named-signals')) {
              expect(named._tag === 'Failure' ? named.failure : undefined).toMatchObject({
                _tag: 'HolderRefused',
                reason: 'unsupported',
              });
              expect(yield* child.observed).toBeUndefined();
            } else {
              expect(named._tag).toBe('Success');
              expect(yield* child.exit).toEqual(adapter.exits.terminate);
              yield* child.reap;
            }
          }),
        );
      }),
    );
  });
