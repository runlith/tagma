import { Console as NodeConsole } from 'node:console';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Console, Effect, Sink, Stdio, Stream } from 'effect';
import { CurrentInvocation, type Environment, Invocation } from '../../platform/cli/verb.js';
import { invoke } from '../../cli/invoke.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import { verbsOf } from '../cli/verbs.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { DEVELOPER } from '../developer/build.js';
import { cliNativeLayer } from '../children.js';

const verbs = verbsOf(DEVELOPER, () => import('../developer/server.js'));
const native = cliNativeLayer(DEVELOPER.cut.roots.packages);

export type Answer = { readonly code: number; readonly out: string; readonly err: string };

const collecting = () => {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
};

const sinkInto = (stream: Writable) => Sink.forEach((chunk: string | Uint8Array) => Effect.sync(() => void stream.write(chunk)));

export type Stdin = string | ReadableStream<Uint8Array>;

export const capturedEffect = Effect.fnUntraced(function* (
  argv: readonly string[],
  env: Environment,
  cwd: string,
  stdin?: Stdin,
  clock?: Clock.Clock,
) {
  const out = collecting();
  const err = collecting();
  const input = () => (typeof stdin === 'string' || stdin === undefined ? new Blob([stdin ?? '']).stream() : stdin);
  const at = new Invocation(env, cwd, input, join(import.meta.dir, '../developer/cli.ts'));
  const invocation = Effect.provideService(invoke(argv, verbs, PROGRAM_RELEASE), InstalledChannel, DEVELOPER.channel);
  const run = clock === undefined ? invocation : Effect.provideService(invocation, Clock.Clock, clock);
  const code = yield* run.pipe(
    Effect.provideService(
      Stdio.Stdio,
      Stdio.make({
        args: Effect.succeed(argv),
        stdout: () => sinkInto(out.stream),
        stderr: () => sinkInto(err.stream),
        stdin: Stream.empty,
      }),
    ),
    Effect.provideService(Console.Console, new NodeConsole({ stdout: out.stream, stderr: err.stream, colorMode: false })),
    Effect.provideService(CurrentInvocation, at),
    Effect.provide(native),
    Effect.provide(BunServices.layer),
  );
  return { code, out: out.text(), err: err.text() };
});
