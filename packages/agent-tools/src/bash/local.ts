import { Duration, Effect } from 'effect';
import { ChildProcess } from 'effect/process';
import type { Tool } from '@runlith/agent/tool';
import { refused } from '../refusals';
import { managedCall } from '@runlith/executions/ManagedCall';
import { SpawnAnnotation } from '@runlith/executions/executionSpawner';
import type { ProcessCost } from '@runlith/executions/protocol/execution';
import { processCost } from '@runlith/executions/bunSpawner';
import { endLocally } from '../localLadder';
import { PLATFORM_COST, ShellRun, localRunning, settleManaged, type Settled } from '../ShellRun';
import type { CheckoutBaselines } from '../CheckoutBaselines';
import type { ResolvedToolOptions } from '../workspace';
import { commandLabel, finishedAnswer, localEnded, type CommandIdentity, type ShellServices } from './answers';
import { commandTime, preflight } from './preflight';
import type { Params } from './tool';

type ShellOutcome = { kind: 'exit'; code: number } | { kind: 'signal'; message: string } | { kind: 'timeout' };

export const local = Effect.fn('BashTool.local')(function* (
  resolved: ResolvedToolOptions,
  services: ShellServices,
  params: Params,
  ctx: Tool.ToolCallOptions,
  baselines: CheckoutBaselines,
) {
  const stop = ctx.progress;
  if (params.waitMs === 0) {
    return yield* refused(
      'call-shape',
      'This world runs a command for the length of the call, so nothing can be left running: it binds no execution owner that would keep the process, observe it or answer for it afterwards. Give it a `waitMs` above 0, or shorten the work.',
    );
  }
  const ready = yield* preflight(resolved, params, baselines);
  const time = yield* commandTime(resolved, params, ctx.caller, ready.workdir);
  const shell = new ShellRun(resolved, baselines, services, ready.workdir, params.command, ctx.progress);
  yield* shell.open(ready).pipe(Effect.uninterruptible);
  const timeout = Math.min(time.wait.ms, time.life.ms);
  let settled: Settled = localRunning;
  let named: CommandIdentity | null = null;

  shell.opened();
  yield* Effect.scoped(
    Effect.gen(function* () {
      const windows = resolved.world.environment.platform === 'win32';
      const shellProgram = resolved.world.environment.shell;
      const handle = yield* Effect.flatMap(SpawnAnnotation, (inherited) => {
        const { observed: support, ...carried } = inherited ?? {};
        void support;
        return ChildProcess.make(windows ? params.command : shellProgram, windows ? [] : ['-c', params.command], {
          shell: windows ? shellProgram : undefined,
          cwd: ready.workdir,
          env: { ...resolved.env, ...resolved.callEnv(ctx) },
          extendEnv: true,
          stdin: 'ignore',
          detached: !windows,
        }).pipe(
          Effect.provideService(SpawnAnnotation, {
            ...carried,
            purpose: 'command',
            correlation: ctx.toolCallId,
            budget: { timeoutMs: timeout },
            stop: stop ?? carried.stop,
          }),
        );
      });
      const collector = yield* Effect.forkScoped(shell.collector(handle.stdout, handle.stderr));
      const call = managedCall(handle);
      if (call !== undefined) {
        named = { execution: call.execution, operation: call.operation };
        const unlink = ctx.progress?.link({
          execution: call.execution,
          operation: call.operation,
          kind: 'command',
          label: commandLabel(params),
        });
        const answer = yield* Effect.result(call.result);
        unlink?.();
        if (answer._tag === 'Failure') {
          settled = {
            ...localRunning,
            source: 'owner',
            unconfirmed: `The decision for this command could not be read back: ${answer.failure.message}. Whether it finished, and with what, is not known — and it was not run again to find out.`,
          };
          return;
        }
        settled = settleManaged(answer.success, 'local');
        if (settled.code !== null || settled.signalDeath !== null) {
          settled = yield* shell.joinCollector(collector, settled);
        }
        return;
      }
      const finished = handle.exitCode.pipe(
        Effect.map((exit): ShellOutcome => ({ kind: 'exit', code: exit })),
        Effect.catchTag('PlatformError', (broke) => Effect.succeed<ShellOutcome>({ kind: 'signal', message: broke.message })),
      );
      const outcome = yield* Effect.raceAll([
        finished,
        Effect.sleep(Duration.millis(timeout)).pipe(Effect.map((): ShellOutcome => ({ kind: 'timeout' }))),
      ]).pipe(Effect.onInterrupt(() => endLocally(handle, resolved.world.environment.platform)));
      const spent = (): ProcessCost => processCost(handle) ?? PLATFORM_COST;
      if (outcome.kind === 'exit') {
        settled = yield* shell.joinCollector(collector, { ...localRunning, code: outcome.code, cost: spent() });
        return;
      }
      if (outcome.kind === 'signal') {
        settled = yield* shell.joinCollector(collector, { ...localRunning, signalDeath: outcome.message, cost: spent() });
        return;
      }
      settled = { ...localRunning, expired: true };
      yield* endLocally(handle, resolved.world.environment.platform);
      settled = yield* shell.joinCollector(collector, { ...settled, cost: spent() });
    }),
  ).pipe(
    Effect.onExit((exit) =>
      exit._tag === 'Success' ? Effect.void : shell.finish({ ...localRunning, aborted: true }).pipe(Effect.asVoid, Effect.uninterruptible),
    ),
  );
  const result = yield* shell.finish(settled).pipe(Effect.uninterruptible);
  return finishedAnswer(params, localEnded(time), shell.elsewhere, result, named);
});
