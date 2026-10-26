import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { CONTROL_VARIABLE, openHolder } from '../PosixHolder';
import { report } from './report';

const [library, state] = process.argv.slice(2) as [string, string];

const arrive = Effect.gen(function* () {
  const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]));
  if (holder.held.length > 0) {
    yield* report(state, { relaunched: process.pid });
    return;
  }
  const held = yield* holder.launch({
    id: 'held',
    path: '/bin/sh',
    argv: ['sh', '-c', "/usr/bin/perl -e 'sleep while 1' & echo $!; wait"],
    env: [{ name: 'PATH', value: '/usr/bin:/bin' }],
    cwd: state,
    transport: { _tag: 'pipes', stdin: 'ignore' },
    pace: 'full',
  });
  if (held.channels._tag !== 'pipes') return yield* Effect.die(new Error('the held execution is not on pipes'));
  let said = '';
  while (!said.includes('\n')) {
    const chunk = yield* held.channels.stdout.read();
    if (chunk === undefined) break;
    said += new TextDecoder().decode(chunk);
  }
  yield* holder.ready;
  yield* report(state, { leader: held.pid, member: Number(said.trim()) });
  yield* holder.vacate;
});

await Effect.runPromise(arrive.pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))).catch((error: unknown) =>
  Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer))),
);
