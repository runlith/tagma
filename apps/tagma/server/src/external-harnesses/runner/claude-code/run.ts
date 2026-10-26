import { Effect, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { serveHosted } from '../hosted/run.js';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import type { Invocation } from '../../../platform/cli/verb.js';
import type { ServerCli } from '../../cli/server.js';
import { claudeAgent, type Launch } from './agent.js';
import { ServerDoor, type HostedDoor } from '../hosted/door.js';
import type { ClaudeSdk } from './channel.js';
import type { Machine } from './runner.js';
import { claudeSdk } from './sdk.js';
import { versionOf } from './version.js';
import { HARNESS_PROGRAM } from '../../contract/wire/program.js';

export const serveClaude = (
  input: Stream.Stream<Uint8Array, ExchangeFailed>,
  write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>,
  sdk: ClaudeSdk,
  door: HostedDoor,
  machine: Machine,
  launch: Launch,
) => serveHosted(input, write, (process) => Effect.succeed(claudeAgent(sdk, door, { ...machine, ...process }, launch)), machine.stderr);

export const runClaude = Effect.fnUntraced(function* (server: ServerCli, at: Invocation, launch: Launch) {
  const claude = at.env[HARNESS_PROGRAM] ?? Bun.which('claude', { PATH: at.env.PATH ?? '' });
  if (claude === null) return yield* new AgentFault({ code: FAULT.internal, message: "claude is not installed on this machine's PATH" });
  const sdk = claudeSdk({ module: yield* Effect.promise(() => import('@anthropic-ai/claude-agent-sdk')) });
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
  const machine: Machine = { claude, version: () => versionOf(claude), stderr: (text) => process.stderr.write(text) };
  yield* serveClaude(input, write, sdk, new ServerDoor(server, at), machine, launch);
});
