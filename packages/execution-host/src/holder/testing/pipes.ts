import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Fiber, type Layer } from 'effect';
import { Holder } from '../Holder';
import { Adapter, PIPES, drain, finished, launch, pipes, readUntil, ready, using, writeAll } from './Adapter';

export const pipeContracts = (name: string, services: Layer.Layer<Adapter | Holder, unknown>) =>
  layer(services, { excludeTestServices: true })(`${name} pipe contracts`, (it) => {
    it.effect('preserves repeated binary writes and delivers EOF only on closeInput', () =>
      Effect.gen(function* () {
        const sent = Buffer.from([0, 0x80, 0xfe, 0xff, 0x63, 0x0a]);
        const child = yield* launch(PIPES, 'cat');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* ready(channel.stdout);
            yield* writeAll(channel.stdin!, sent.subarray(0, 4));
            yield* writeAll(channel.stdin!, sent.subarray(4));
            yield* child.closeInput;
            expect(yield* drain(channel.stdout)).toEqual(Buffer.concat([sent, Buffer.from('DONE\n')]));
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
          }),
        );
      }),
    );

    it.effect('preserves a write beyond both pipe buffers against a slow reader', () =>
      Effect.gen(function* () {
        const sent = Buffer.alloc(192 * 1024);
        for (let i = 0; i < sent.length; i++) sent[i] = i % 251;
        const child = yield* launch(PIPES, 'echo', sent.length);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* ready(channel.stdout);
            const writer = yield* Effect.forkScoped(writeAll(channel.stdin!, sent));
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (size < sent.length) {
              const chunk = yield* channel.stdout.read();
              if (chunk === undefined) break;
              chunks.push(chunk);
              size += chunk.length;
              yield* Effect.sleep(5);
            }
            yield* Fiber.join(writer);
            expect(Buffer.concat(chunks)).toEqual(sent);
            yield* finished(child);
          }),
        );
      }),
    );

    it.effect('gives ignored stdin EOF without exposing an input pipe', () =>
      Effect.gen(function* () {
        const transport = { _tag: 'pipes', stdin: 'ignore' } as const;
        const child = yield* launch(transport, 'cat');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            expect(channel.input).toBe('absent');
            expect(channel.stdin).toBeUndefined();
            expect((yield* drain(channel.stdout)).toString()).toBe('READY\nDONE\n');
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
          }),
        );
      }),
    );

    it.effect('reports a typed write failure for closed stdin and keeps the child observable', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PIPES, 'closed-input');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* ready(channel.stdout);
            const refused = yield* Effect.result(writeAll(channel.stdin!, Buffer.alloc(64 * 1024, 0x78)));
            expect(refused._tag === 'Failure' ? { tag: refused.failure._tag, reason: refused.failure.reason } : { accepted: true }).toEqual(
              { tag: 'ChannelFailed', reason: 'closed' },
            );
            expect(yield* adapter.standing(child.pid)).toBe('running');
            expect(yield* child.observed).toBeUndefined();
            yield* child.act('work', 'kill');
            expect((yield* finished(child)).exit).toEqual(adapter.exits.kill);
          }),
        );
      }),
    );

    it.effect('drains stdout and stderr separately after exit', () =>
      Effect.gen(function* () {
        const child = yield* launch(PIPES, 'split-output', 4_096);
        yield* using(
          child,
          Effect.gen(function* () {
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 3 });
            const channel = pipes(child);
            const [out, err] = yield* Effect.all([drain(channel.stdout), drain(channel.stderr)], { concurrency: 2 });
            expect(out).toEqual(Buffer.alloc(4_096, 0x4f));
            expect(err).toEqual(Buffer.alloc(4_096, 0x45));
            yield* child.reap;
          }),
        );
      }),
    );

    it.effect('preserves separately backpressured stdout and stderr', () =>
      Effect.gen(function* () {
        const size = 192 * 1024;
        const child = yield* launch(PIPES, 'split-output', size);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* Effect.sleep(50);
            const [out, err] = yield* Effect.all([drain(channel.stdout), drain(channel.stderr)], { concurrency: 2 });
            expect(out).toEqual(Buffer.alloc(size, 0x4f));
            expect(err).toEqual(Buffer.alloc(size, 0x45));
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 3 });
          }),
        );
      }),
    );

    it.effect('observes a quiet exit without acquiring an output reader', () =>
      Effect.gen(function* () {
        const child = yield* launch(PIPES, 'split-output', 1);
        yield* using(
          child,
          Effect.gen(function* () {
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 3 });
            yield* child.reap;
          }),
        );
      }),
    );

    it.effect('stops work while output remains unread', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const holder = yield* Holder;
        const child = yield* launch(PIPES, 'flood');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(pipes(child).stdout);
            const graceful = holder.capabilities.has('pipe-graceful-stop');
            const acted = yield* Effect.result(child.act('work', 'interrupt'));
            if (!graceful) {
              expect(acted._tag === 'Failure' ? acted.failure : undefined).toMatchObject({
                _tag: 'HolderRefused',
                reason: 'unsupported',
              });
              yield* child.act('work', 'kill');
            } else {
              expect(acted._tag).toBe('Success');
            }
            expect(yield* child.exit).toEqual(graceful ? adapter.exits.interrupt : adapter.exits.kill);
            yield* child.reap;
            expect(yield* adapter.standing(child.pid)).toBe('gone');
          }),
        );
      }),
    );

    it.effect('interrupts a program beneath a parent that did not exec it', () =>
      Effect.gen(function* () {
        const holder = yield* Holder;
        const child = yield* launch(PIPES, 'interrupt');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            yield* ready(channel.stdout);
            const acted = yield* Effect.result(child.act('work', 'interrupt'));
            if (!holder.capabilities.has('pipe-graceful-stop')) {
              expect(acted._tag === 'Failure' ? acted.failure : undefined).toMatchObject({
                _tag: 'HolderRefused',
                reason: 'unsupported',
              });
              return;
            }
            expect(acted._tag).toBe('Success');
            expect((yield* drain(channel.stdout)).toString()).toBe('CLEANED\n');
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 0 });
            yield* child.reap;
          }),
        );
      }),
    );

    it.effect('accepts pipe input after the leader exits until the descendant closes it', () =>
      Effect.gen(function* () {
        const child = yield* launch(PIPES, 'orphan-input', 4);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 7 });
            yield* writeAll(channel.stdin!, Buffer.from('kept'));
            expect((yield* drain(channel.stdout)).toString()).toBe('kept');
            const refused = yield* Effect.result(channel.stdin!.write(Buffer.from('late')));
            expect(refused._tag === 'Failure' ? { tag: refused.failure._tag, reason: refused.failure.reason } : { accepted: true }).toEqual(
              { tag: 'ChannelFailed', reason: 'closed' },
            );
            yield* child.reap;
          }),
        );
      }),
    );

    it.effect('keeps a descendant running after leader-only action and ends it by work action before reap', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const holder = yield* Holder;
        const child = yield* launch(PIPES, 'fork');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = pipes(child);
            const pid = Number((yield* readUntil(channel.stdout, '\n')).toString().trim());
            expect(pid).toBeGreaterThan(0);
            const graceful = holder.capabilities.has('pipe-graceful-stop');
            const leader = yield* Effect.result(child.act('leader', 'terminate'));
            if (!graceful) {
              expect(leader._tag === 'Failure' ? leader.failure : undefined).toMatchObject({
                _tag: 'HolderRefused',
                reason: 'unsupported',
              });
              yield* child.act('leader', 'kill');
            } else expect(leader._tag).toBe('Success');
            expect(yield* child.exit).toEqual(graceful ? { _tag: 'Code', code: 7 } : adapter.exits.kill);
            expect(yield* child.workState).toBe('standing');
            expect(yield* adapter.standing(pid)).toBe('running');
            const acted = yield* Effect.result(child.act('work', 'terminate'));
            if (!holder.capabilities.has('pipe-graceful-stop')) {
              expect(acted._tag === 'Failure' ? acted.failure : undefined).toMatchObject({
                _tag: 'HolderRefused',
                reason: 'unsupported',
              });
              yield* child.act('work', 'kill');
            } else expect(acted._tag).toBe('Success');
            yield* drain(channel.stdout);
            expect(yield* child.workState).toBe('ended');
            expect(yield* adapter.standing(pid)).not.toBe('running');
            yield* child.reap;
            const after = yield* Effect.result(child.act('work', 'kill'));
            expect(after._tag === 'Failure' ? after.failure : undefined).toMatchObject({ _tag: 'HolderRefused', reason: 'reaped' });
          }),
        );
      }),
    );
  });
