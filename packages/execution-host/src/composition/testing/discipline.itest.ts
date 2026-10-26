import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { PTY, drain, finished, launch, ready, terminal, using, writeAll } from '../../holder/testing/Adapter';
import { terminalFacts } from '../../posix/testing/terminal';
import { heldPosix } from './posix';

layer(heldPosix(), { excludeTestServices: true })('POSIX line discipline', (it) => {
  it.effect('starts the POSIX terminal child as the leader of its own session', () =>
    Effect.gen(function* () {
      const child = yield* launch(PTY, 'geometry');
      yield* using(
        child,
        Effect.gen(function* () {
          yield* ready(terminal(child));
          expect((yield* terminalFacts(child)).sid).toBe(child.pid);
        }),
      );
    }),
  );

  it.effect('refuses a POSIX interrupt with ISIG disabled and leaves ordinary input usable', () =>
    Effect.gen(function* () {
      const child = yield* launch(PTY, 'no-isig', 4);
      yield* using(
        child,
        Effect.gen(function* () {
          const channel = terminal(child);
          yield* ready(channel);
          const refused = yield* Effect.result(channel.interrupt());
          expect(refused._tag === 'Failure' ? refused.failure : undefined).toMatchObject({
            _tag: 'TerminalInterruptRefused',
            reason: 'isig-disabled',
          });
          yield* writeAll(channel, Buffer.from('kept'));
          expect((yield* drain(channel)).toString()).toBe('kept');
          yield* finished(child);
        }),
      );
    }),
  );
});
