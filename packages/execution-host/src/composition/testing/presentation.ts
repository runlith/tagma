import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { PIPES, PTY } from '../../holder/testing/Adapter';
import { binding, bytes, Host, start, textUntil, withExecution, type HostAdapter } from './session';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';

const buffer = (host: Host['Service'], execution: ExecutionRef, wanted: 'normal' | 'alternate') =>
  host.client.subscribe({ _tag: 'Screen', execution }, host.credits).pipe(
    Stream.filter((item) => item._tag === 'Screen' && 'buffer' in item.update && item.update.buffer === wanted),
    Stream.runHead,
  );

export const presentationContracts = (adapter: HostAdapter) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host presentation contracts`, (it) => {
    it.effect('enters alternate screen and restores the original screen on return', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const child = yield* start(PTY, 'alternate');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            expect((yield* buffer(host, child.execution, 'alternate'))._tag).toBe('Some');
            const alternate = yield* host.client.screen(child.execution);
            expect(alternate._tag).toBe('ScreenTextFrame');
            if (alternate._tag !== 'ScreenTextFrame') return yield* Effect.die(new Error('the terminal screen is unavailable'));
            expect(alternate.buffer).toBe('alternate');
            expect(alternate.rows.map((row) => row.text).join('\n')).toContain('ALT');
            const lane = yield* binding(host, child.execution);
            expect(
              (yield* host.client.input(child.execution, lane, {
                sequence: 0,
                cause: 'raw',
                act: { _tag: 'Write', bytes: Buffer.from('x') },
              }))._tag,
            ).toBe('InputAdmitted');
            expect((yield* buffer(host, child.execution, 'normal'))._tag).toBe('Some');
            const restored = yield* host.client.screen(child.execution);
            expect(restored._tag).toBe('ScreenTextFrame');
            if (restored._tag !== 'ScreenTextFrame') return yield* Effect.die(new Error('the restored screen is unavailable'));
            expect(restored.buffer).toBe('normal');
            expect(restored.rows.map((row) => row.text).join('\n')).toContain('MAIN');
          }),
        );
      }).pipe(Effect.timeout(9_000)),
    );

    for (const transport of [PTY, PIPES]) {
      const stream = transport._tag === 'pty' ? 'pty' : 'stdout';
      it.effect(`${transport._tag}: carries fragmented UTF-8 input beyond one admission and drains every output byte`, () =>
        Effect.gen(function* () {
          const host = yield* Host;
          const profile = yield* host.client.capabilities();
          const sample = 'λ🙂漢字\n';
          const sent = Buffer.from(sample.repeat(Math.floor(profile.execution.input.chunkBytes / Buffer.byteLength(sample)) + 1));
          const child = yield* start(transport, 'echo', sent.length);
          yield* withExecution(
            host,
            child.execution,
            Effect.gen(function* () {
              yield* textUntil(host, child.execution, stream, 'READY\n');
              const lane = yield* binding(host, child.execution);
              let sequence = 0;
              for (let at = 0; at < sent.length; at += profile.execution.input.chunkBytes) {
                const answer = yield* host.client.input(child.execution, lane, {
                  sequence: sequence++,
                  cause: 'raw',
                  act: { _tag: 'Write', bytes: sent.subarray(at, at + profile.execution.input.chunkBytes) },
                });
                expect(answer._tag).toBe('InputAdmitted');
                const echoed = yield* host.client
                  .subscribe(
                    {
                      _tag: 'Bytes',
                      cursor: {
                        ref: child.execution,
                        stream,
                        offset: byteOffset(BigInt(Buffer.byteLength('READY\n') + at)),
                      },
                    },
                    host.credits,
                  )
                  .pipe(
                    Stream.filter((item) => item._tag === 'Bytes'),
                    Stream.scan(
                      () => 0,
                      (count, item) => count + (item._tag === 'Bytes' ? item.bytes.length : 0),
                    ),
                    Stream.takeUntil((count) => count >= Math.min(profile.execution.input.chunkBytes, sent.length - at)),
                    Stream.runLast,
                  );
                expect(echoed._tag).toBe('Some');
              }
              expect(yield* bytes(host, child.execution, stream)).toEqual(Buffer.concat([Buffer.from('READY\n'), sent]));
            }),
          );
        }).pipe(Effect.timeout(9_000)),
      );

      it.effect(`${transport._tag}: applies the input lifetime contract after the leader exits`, () =>
        Effect.gen(function* () {
          const host = yield* Host;
          const child = yield* start(transport, transport._tag === 'pty' ? 'orphan-terminal' : 'orphan-input', 4);
          yield* withExecution(
            host,
            child.execution,
            Effect.gen(function* () {
              const lane = yield* binding(host, child.execution);
              let sequence = 0;
              if (transport._tag === 'pty') {
                yield* textUntil(host, child.execution, stream, '\n');
                expect(
                  (yield* host.client.input(child.execution, lane, {
                    sequence: sequence++,
                    cause: 'raw',
                    act: { _tag: 'Write', bytes: Buffer.from('x') },
                  }))._tag,
                ).toBe('InputAdmitted');
              }
              const ended = yield* host.client.subscribe({ _tag: 'State', execution: child.execution }, host.credits).pipe(
                Stream.filter((item) => item._tag === 'State' && item.summary.state.nativeExit !== undefined),
                Stream.runHead,
              );
              expect(ended._tag).toBe('Some');
              const answer = yield* host.client.input(child.execution, lane, {
                sequence,
                cause: 'raw',
                act: { _tag: 'Write', bytes: Buffer.from('kept') },
              });
              if (transport._tag === 'pty') {
                expect(answer._tag).toBe('InputEnded');
              } else {
                expect(answer._tag).toBe('InputAdmitted');
                expect((yield* bytes(host, child.execution, stream)).toString()).toBe('kept');
              }
            }),
          );
        }).pipe(Effect.timeout(9_000)),
      );
    }

    it.effect('refuses writes and EOF control when the live child has no input pipe', () =>
      Effect.gen(function* () {
        const host = yield* Host;
        const child = yield* start({ _tag: 'pipes', stdin: 'ignore' }, 'terminate');
        yield* withExecution(
          host,
          child.execution,
          Effect.gen(function* () {
            yield* textUntil(host, child.execution, 'stdout', 'READY\n');
            const lane = yield* binding(host, child.execution);
            const ended = yield* host.client.input(child.execution, lane, { sequence: 0, cause: 'end', act: { _tag: 'End' } });
            expect(ended).toMatchObject({ _tag: 'InputUnsupported', act: 'end', reason: 'transport' });
            const written = yield* host.client.input(child.execution, lane, {
              sequence: 0,
              cause: 'raw',
              act: { _tag: 'Write', bytes: Buffer.from('late') },
            });
            expect(written._tag).toBe('InputEnded');
            expect((yield* host.client.state(child.execution))?.state.phase).toBe('running');
          }),
        );
      }).pipe(Effect.timeout(9_000)),
    );
  });
