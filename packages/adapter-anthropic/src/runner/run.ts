import { Effect, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { hostedStdio, serveHosted, type HostedLaunch, type HostedRunner, type Invoked } from '@runlith/hosted-runner/run';
import { HARNESS_PROGRAM } from '@runlith/hosted-runner/wire/program';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import { claudeAgent, type Launch } from './agent.js';
import type { ClaudeSdk } from './channel.js';
import { runCut } from './cut.js';
import type { Machine } from './runner.js';
import { claudeSdk } from './sdk.js';
import { EFFORTS } from './settings.js';
import { versionOf } from './version.js';

export const serveClaude = (
  input: Stream.Stream<Uint8Array, ExchangeFailed>,
  write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>,
  sdk: ClaudeSdk,
  door: HostedDoor,
  machine: Machine,
  launch: Launch,
) => serveHosted(input, write, (process) => Effect.succeed(claudeAgent(sdk, door, { ...machine, ...process }, launch)), machine.stderr);

const runClaude = Effect.fnUntraced(function* (at: Invoked, door: HostedDoor, requested: HostedLaunch) {
  const effort = EFFORTS.find((one) => one === requested.effort) ?? null;
  if (requested.effort !== null && effort === null) return yield* Effect.die(`Claude Code does not offer effort ${requested.effort}`);
  const claude = at.env[HARNESS_PROGRAM] ?? Bun.which('claude', { PATH: at.env.PATH ?? '' });
  if (claude === null) return yield* new AgentFault({ code: FAULT.internal, message: "claude is not installed on this machine's PATH" });
  const sdk = claudeSdk({ module: yield* Effect.promise(() => import('@anthropic-ai/claude-agent-sdk')) });
  const { input, write } = hostedStdio(at);
  const machine: Machine = { claude, version: () => versionOf(claude), stderr: (text) => process.stderr.write(text) };
  yield* serveClaude(input, write, sdk, door, machine, { ...requested, effort });
});

export const claudeRunner: HostedRunner = { run: runClaude, cut: runCut };
