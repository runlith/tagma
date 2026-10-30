import { join } from 'node:path';
import { Effect, FileSystem, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { findProgram } from '@runlith/adapter-opencode/host';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import type { Invocation } from '../../../platform/cli/verb.js';
import type { ServerCli } from '../../cli/server.js';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import { ServerDoor } from '../../cli/serverDoor.js';
import { serveHosted } from '@runlith/hosted-runner/run';
import { OpenCodeSdk } from './channel.js';
import { makeOpenCodeCycle, type Launch } from './cycle.js';
import { makeOpenCodeSdk } from './sdk.js';

export const runOpenCode = Effect.fnUntraced(function* (server: ServerCli, at: Invocation, launch: Launch) {
  const directory = at.env.OPENCODE_DATA_DIR;
  if (!directory) return yield* new AgentFault({ code: FAULT.internal, message: 'The OpenCode runner has no thread scratch directory.' });
  const files = yield* FileSystem.FileSystem;
  const temporary = join(directory, 'tmp');
  const config = join(directory, 'config');
  yield* files.makeDirectory(temporary, { recursive: true }).pipe(Effect.orDie);
  yield* files.makeDirectory(config, { recursive: true }).pipe(Effect.orDie);
  const environment = { ...at.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary };
  const program = yield* findProgram(environment).pipe(
    Effect.mapError((cause) => new AgentFault({ code: FAULT.internal, message: cause.message })),
  );
  const door = new ServerDoor(server, at);
  const input = Stream.fromReadableStream({
    evaluate: at.stdin,
    onError: (cause) => new ExchangeFailed({ detail: `stdin failed: ${String(cause)}` }),
  });
  const out = Bun.stdout.writer();
  const write = (bytes: Uint8Array) =>
    Effect.try({
      try: () => {
        out.write(bytes);
        out.flush();
      },
      catch: (cause) => new ExchangeFailed({ detail: `stdout failed: ${String(cause)}` }),
    });
  yield* serveHosted(
    input,
    write,
    (process) =>
      Effect.gen(function* () {
        const sdk = yield* makeOpenCodeSdk(
          {
            directory,
            host: {
              program,
              cwd: at.cwd,
              environment,
              config: { directory: config, content: '{}', project: false, claude: false },
              onStderr: process.stderr,
            },
          },
          process,
        );
        const cycle = yield* makeOpenCodeCycle(door, process, launch).pipe(Effect.provideService(OpenCodeSdk, sdk));
        return hostedAgent(cycle, door);
      }),
    (text) => process.stderr.write(text),
  );
}, Effect.scoped);
