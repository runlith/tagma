import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { Loading } from '@runlith/tagma/rules';
import { Effect, Layer } from 'effect';
import { type ProgramEnding, ProgramRoad } from '../../executions/contract/service/programs.js';
import { Configs } from '../contract/service/configs.js';
import { configsLayer } from '../layer.js';

const spawned = ProgramRoad.of({
  run: (launch) =>
    Effect.promise(async (): Promise<ProgramEnding> => {
      const child = Bun.spawn([...launch.argv, ...(launch.operands ?? [])], {
        cwd: launch.cwd,
        stdin: new Blob([launch.stdin]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { _tag: 'Exited', exitCode, stdout, stderr, cut: false };
    }),
});

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const world = configsLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, gitLayer.pipe(Layer.provide(host)), Layer.succeed(ProgramRoad, spawned))),
);

const root = process.argv[2]!;
const answer = await Effect.runPromise(
  Effect.flatMap(Configs, (configs) => configs.read({ projectId: 1, actor: { _tag: 'Operator' }, root, tree: 'HEAD' })).pipe(
    Effect.map((config) => ({ inspections: Object.fromEntries(config?.inspections ?? []), format: config?.format ?? [] })),
    Effect.catchTag('GateRefusal', (refused) => Effect.succeed({ refused: refused.code, reason: refused.reason })),
    Effect.provide(world),
  ),
);
console.log(JSON.stringify({ answer, described: Loading.forbid({ from: ['a'], refuses: ['b'] }).builtin }));
