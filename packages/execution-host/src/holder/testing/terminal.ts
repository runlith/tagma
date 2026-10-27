import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Fiber, type Layer } from 'effect';
import { Holder } from '../Holder';
import { Adapter, PTY, pty, drain, finished, launch, readUntil, ready, terminal, using, writeAll } from './Adapter';

export const terminalContracts = (name: string, services: Layer.Layer<Adapter | Holder, unknown>) =>
  layer(services, { excludeTestServices: true })(`${name} terminal contracts`, (it) => {
    it.effect('starts with the requested geometry and foreground child', () =>
      Effect.gen(function* () {
        const holder = yield* Holder;
        const child = yield* launch(pty(37, 113), 'geometry');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            const output = yield* ready(channel);
            expect(output.toString()).toContain('37 113');
            expect(yield* channel.size).toEqual({ rows: 37, cols: 113 });
            const foreground = yield* Effect.result(channel.foreground);
            if (holder.capabilities.has('terminal-foreground')) {
              expect(foreground._tag).toBe('Success');
              if (foreground._tag !== 'Success') return yield* Effect.die(new Error('declared foreground capability refused'));
              expect(foreground.success.pid).toBe(child.pid);
              expect(foreground.success.birth).toBe(child.birth);
            } else
              expect(foreground._tag === 'Failure' ? foreground.failure : undefined).toMatchObject({
                _tag: 'ForegroundRefused',
                reason: 'unsupported',
              });
          }),
        );
      }),
    );

    it.effect('preserves UTF-8 and a paste beyond one write while the reader is slow', () =>
      Effect.gen(function* () {
        const sent = Buffer.from('λ🙂漢字\u0000\n'.repeat(8_192));
        const child = yield* launch(PTY, 'echo', sent.length);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            yield* ready(channel);
            const writer = yield* Effect.forkScoped(writeAll(channel, sent));
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (size < sent.length) {
              const chunk = yield* channel.read();
              if (chunk === undefined) break;
              chunks.push(chunk);
              size += chunk.length;
              yield* Effect.sleep(5);
            }
            yield* Fiber.join(writer);
            expect(Buffer.concat(chunks)).toEqual(sent);
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
          }),
        );
      }),
    );

    it.effect('drains a backpressured output byte-exact and in order', () =>
      Effect.gen(function* () {
        const size = 256 * 1024;
        const child = yield* launch(PTY, 'output', size);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            yield* ready(channel);
            yield* writeAll(channel, Buffer.from('x'));
            yield* Effect.sleep(50);
            const output = yield* drain(channel);
            expect(output).toEqual(Buffer.from('y\n'.repeat(size / 2)));
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
          }),
        );
      }),
    );

    it.effect('delivers interrupt to a shell foreground job and keeps its shell alive', () =>
      Effect.gen(function* () {
        const child = yield* launch(PTY, 'foreground');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            yield* writeAll(channel, Buffer.from('sh -c \'echo RE""ADY; exec /usr/bin/perl -e "sleep while 1"\'\n'));
            yield* ready(channel);
            yield* channel.interrupt();
            yield* writeAll(channel, Buffer.from('echo ST""ATUS=$? EN""D\n'));
            const status = yield* readUntil(channel, 'END\r\n');
            expect(status.toString()).toContain('STATUS=130');
            expect(yield* child.observed).toBeUndefined();
            yield* writeAll(channel, Buffer.from('exit 0\n'));
            yield* drain(channel);
            expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
          }),
        );
      }),
    );

    it.effect('delivers resize to the child and the channel geometry', () =>
      Effect.gen(function* () {
        const child = yield* launch(PTY, 'resize');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            yield* ready(channel);
            yield* channel.resize(43, 132);
            const output = yield* readUntil(channel, 'WINCH\n');
            expect(output.toString()).toContain('43 132');
            expect(yield* channel.size).toEqual({ rows: 43, cols: 132 });
          }),
        );
      }),
    );

    it.effect('closes terminal input by hanging up the child', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PTY, 'wait');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(terminal(child));
            yield* child.closeInput;
            expect(yield* child.exit).toEqual(adapter.exits.hangup);
            const closed = yield* Effect.result(terminal(child).write(Buffer.from('late')));
            expect(closed._tag === 'Failure' ? closed.failure : undefined).toMatchObject({ _tag: 'ChannelFailed', reason: 'closed' });
            yield* child.reap;
          }),
        );
      }),
    );

    it.effect('drains every terminal tail byte while observing and reaping the child exit', () =>
      Effect.gen(function* () {
        const child = yield* launch(PTY, 'output', 1_024);
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            yield* ready(channel);
            yield* writeAll(channel, Buffer.from('x'));
            const [output, ending] = yield* Effect.all([drain(channel), finished(child)], { concurrency: 2 });
            expect(ending.exit).toEqual({ _tag: 'Code', code: 0 });
            expect(output).toEqual(Buffer.from('y\n'.repeat(512)));
          }),
        );
      }),
    );

    it.effect('refuses terminal input as closed after its session leader exits with a live descendant', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PTY, 'orphan-terminal');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            const descendant = Number((yield* readUntil(channel, '\n')).toString().trim());
            yield* writeAll(channel, Buffer.from('x'));
            expect(yield* child.exit).toEqual({ _tag: 'Code', code: 7 });
            expect(yield* adapter.standing(descendant)).toBe('running');
            const refused = yield* Effect.result(channel.write(Buffer.from('late')));
            expect(refused._tag === 'Failure' ? { tag: refused.failure._tag, reason: refused.failure.reason } : { accepted: true }).toEqual(
              { tag: 'ChannelFailed', reason: 'closed' },
            );
          }),
        );
      }),
    );

    it.effect('preserves alternate-screen entry and return in terminal output', () =>
      Effect.gen(function* () {
        const child = yield* launch(PTY, 'alternate');
        yield* using(
          child,
          Effect.gen(function* () {
            const channel = terminal(child);
            const entered = yield* readUntil(channel, 'ALT\n');
            expect(entered.toString()).toBe('\x1b[2J\x1b[HMAIN\x1b[?1049h\x1b[HALT\n');
            yield* writeAll(channel, Buffer.from('x'));
            expect((yield* drain(channel)).toString()).toBe('\x1b[?1049l');
            yield* finished(child);
          }),
        );
      }),
    );

    it.effect('stops terminal work while its output has no consumer', () =>
      Effect.gen(function* () {
        const adapter = yield* Adapter;
        const child = yield* launch(PTY, 'flood');
        yield* using(
          child,
          Effect.gen(function* () {
            yield* ready(terminal(child));
            yield* child.act('work', 'hang-up');
            expect(yield* child.exit).toEqual(adapter.exits.hangup);
            yield* child.reap;
            expect(yield* adapter.standing(child.pid)).toBe('gone');
          }),
        );
      }),
    );
  });
