import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { findProgram } from '../host.js';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { hostedStdio, serveHosted, type HostedLaunch, type HostedRunner, type Invoked } from '@runlith/hosted-runner/run';
import { OpenCodeSdk } from './channel.js';
import { makeOpenCodeCycle } from './cycle.js';
import { makeOpenCodeSdk } from './sdk.js';

const runOpenCode = Effect.fnUntraced(
  function* (at: Invoked, door: HostedDoor, launch: HostedLaunch) {
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
    const { input, write } = hostedStdio(at);
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
          const cycle = yield* makeOpenCodeCycle(door, process, { ...launch, parameters: {} }).pipe(
            Effect.provideService(OpenCodeSdk, sdk),
          );
          return hostedAgent(cycle, door);
        }),
      (text) => process.stderr.write(text),
    );
  },
  Effect.scoped,
  Effect.provide(BunFileSystem.layer),
);

export const opencodeRunner: HostedRunner = { run: runOpenCode, cut: null };
