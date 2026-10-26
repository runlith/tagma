import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { PTY, PIPES } from '../../holder/testing/Adapter';
import { binding, Host, start, textUntil, withExecution } from './session';
import { hosted } from './host';
import { posix } from './posix';
import { loadLibrary } from '../../posix/Library';
import { processReader } from '../../posix/macos/processes';
import { HOLDER_LIBRARY } from '../../posix/testing/holder';
import { sameProcess } from '@runlith/executions/protocol/evidence';

layer(hosted('POSIX', posix()).layer.pipe(Layer.merge(BunFileSystem.layer)), { excludeTestServices: true })('POSIX foreground', (it) => {
  it.effect('answers the foreground process birth through host wire and follows a shell foreground job', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const library = yield* loadLibrary(HOLDER_LIBRARY);
      const reader = yield* processReader(library);
      const shell = yield* start(PTY, 'foreground');
      yield* withExecution(
        host,
        shell.execution,
        Effect.gen(function* () {
          const scope = yield* binding(host, shell.execution);
          yield* host.client.input(shell.execution, scope, {
            sequence: 0,
            cause: 'typed',
            act: { _tag: 'Write', bytes: Buffer.from('echo SH""ELL_READY\n') },
          });
          yield* textUntil(host, shell.execution, 'pty', 'SHELL_READY\r\n');
          const first = yield* host.client.foreground(shell.execution);
          expect(first._tag).toBe('Foreground');
          if (first._tag !== 'Foreground') return yield* Effect.die(new Error(first.detail));
          expect(first.process.pid).toBe(shell.native.pid!);
          const leader = reader.identity(first.process.pid);
          expect(leader._tag === 'Read' && sameProcess(first.process, leader)).toBe(true);

          yield* host.client.input(shell.execution, scope, {
            sequence: 1,
            cause: 'typed',
            act: { _tag: 'Write', bytes: Buffer.from('sh -c \'echo JO""B=$$ JOB_RE""ADY; read pending\'\n') },
          });
          const output = yield* textUntil(host, shell.execution, 'pty', 'JOB_READY\r\n');
          const pid = Number(/JOB=(\d+) JOB_READY\r\n/u.exec(output)?.[1]);
          expect(pid).toBeGreaterThan(0);
          expect(pid).not.toBe(shell.native.pid!);
          const job = yield* host.client.foreground(shell.execution);
          expect(job._tag).toBe('Foreground');
          if (job._tag !== 'Foreground') return yield* Effect.die(new Error(job.detail));
          expect(job.process.pid).toBe(pid);
          const current = reader.identity(pid);
          expect(current._tag === 'Read' && sameProcess(job.process, current)).toBe(true);
        }),
      );
    }),
  );

  it.effect('answers no-terminal for a pipes execution', () =>
    Effect.gen(function* () {
      const host = yield* Host;
      const child = yield* start(PIPES, 'wait');
      yield* withExecution(
        host,
        child.execution,
        Effect.gen(function* () {
          const answer = yield* host.client.foreground(child.execution);
          expect(answer).toMatchObject({ _tag: 'ForegroundRefused', reason: 'no-terminal' });
        }),
      );
    }),
  );
});
