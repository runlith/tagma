import { Effect, Layer } from 'effect';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import type { ChangeSource } from '../changeSource';
import { CheckoutBaselines } from '../CheckoutBaselines';
import { CheckoutFlights } from '../CheckoutFlights';
import { unruledTimes } from '../CommandWork';
import { localRunning, ShellRun } from '../ShellRun';
import { resolveToolOptions } from '../workspace/runtime';
import type { World } from '../world';
import type { WorkspaceChanges } from '../WorkspaceChanges';
import { preflight } from './preflight';

export type WitnessedCommand = {
  readonly settle: Effect.Effect<void>;
};

export type WitnessedCall = {
  readonly cwd: string;
  readonly changes: WorkspaceChanges;
  readonly command: string;
  readonly workdir: string;
};

export const commandWitness = (input: {
  readonly world: World;
  readonly unowned: readonly string[];
  readonly source: ChangeSource | null;
}) => {
  const world: World = { ...input.world, commands: undefined };
  const { exec, files, git } = world;
  const services = exec === undefined || files === undefined || git === undefined ? null : Layer.mergeAll(files, exec, git);
  const flights = new CheckoutFlights(input.source);
  const baselines = new CheckoutBaselines(flights);
  return Effect.fn('BashTool.witness')(function* (call: WitnessedCall) {
    if (services === null) return null;
    const resolved = resolveToolOptions({
      cwd: call.cwd,
      allowOutsideCwd: true,
      world,
      changes: call.changes,
      unowned: input.unowned,
      flights,
      commandTimes: unruledTimes,
      searchMs: LONGEST_ACT_MS,
    });
    const shell = yield* Effect.gen(function* () {
      const ready = yield* preflight(resolved, { command: call.command, workdir: call.workdir }, baselines);
      const run = new ShellRun(resolved, baselines, services, ready.workdir, call.command);
      yield* run.open(ready);
      return run;
    }).pipe(Effect.provide(services), Effect.uninterruptible);
    shell.opened();
    return {
      settle: shell.finish(localRunning).pipe(Effect.asVoid, Effect.provide(services), Effect.uninterruptible),
    } satisfies WitnessedCommand;
  });
};
