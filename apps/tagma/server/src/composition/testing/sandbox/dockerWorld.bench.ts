import { unthreadedCaller } from '../callers';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { Clock, Console, Context, Effect, FileSystem, Layer } from 'effect';
import { dockerGuestWorld, guestRunCommand, buildGuestImage, dockerSaid, GUEST_TREE } from '../../../sandbox/testing/doubles.js';

const filesArgument = Bun.argv.find((argument) => argument.startsWith('--files='));
const files = filesArgument === undefined ? 300 : Number.parseInt(filesArgument.slice('--files='.length), 10);
if (!Number.isSafeInteger(files) || files <= 0) throw new Error('--files must be a positive integer');
const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const platform = Layer.merge(host, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));
const call = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('the tool declares no execution');
  const prepare = toolPrepare(tool);
  const resolved = prepare === null ? undefined : yield* prepare(input, { toolCallId: 'bench', caller: unthreadedCaller });
  const answer = yield* execute(input, { toolCallId: 'bench', caller: unthreadedCaller, messages: [], prepared: resolved?.prepared });
  return String(answer instanceof ToolAnswer ? answer.value : answer);
});
const took = Effect.fnUntraced(function* <A, E, R>(what: string, times: number, work: Effect.Effect<A, E, R>) {
  const clock = yield* Clock.Clock;
  const started = clock.monotonicTimeNanosUnsafe();
  for (let round = 0; round < times; round += 1) yield* work;
  const spent = Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000;
  yield* Console.log(`${what}: ${times} × ${(spent / times).toFixed(1)} ms (${spent.toFixed(0)} ms)`);
});
const main = Effect.gen(function* () {
  const context = yield* Layer.build(platform);
  const name = `tagma-guest-bench-${crypto.randomUUID()}`;
  const image = yield* buildGuestImage(undefined).pipe(Effect.provide(context));
  yield* Console.log(`image ${image.reference} ${image.digest}`);
  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      const made = yield* dockerSaid(['volume', 'create', name], 'create the bench volume');
      if (made.code !== 0) return yield* Effect.die(new Error(made.output));
    }),
    () =>
      Effect.gen(function* () {
        const guest = yield* dockerSaid(['rm', '--force', name], 'remove the bench guest');
        const volume = yield* dockerSaid(['volume', 'rm', '--force', name], 'remove the bench volume');
        if (guest.code !== 0 || volume.code !== 0)
          return yield* Effect.die(new Error(`guest cleanup: ${guest.output}; volume cleanup: ${volume.output}`));
      }).pipe(Effect.orDie),
  ).pipe(Effect.provide(context));
  const started = yield* dockerSaid(
    guestRunCommand({
      name,
      image: image.reference,
      volume: name,
      limits: { pids: 256, memory: '1g', cpus: '2' },
      marks: { installation: 'dockerworld-bench', kind: 'workload', subject: name },
      network: 'none',
    }),
    'start the bench guest',
  ).pipe(Effect.provide(context));
  if (started.code !== 0) return yield* Effect.die(new Error(started.output));
  const clock = yield* Clock.Clock;
  const opening = clock.monotonicTimeNanosUnsafe();
  const { world } = yield* dockerGuestWorld({ container: name }).pipe(Effect.provide(context));
  yield* Console.log(
    `opening the world, one guest round trip included: ${(Number(clock.monotonicTimeNanosUnsafe() - opening) / 1_000_000).toFixed(0)} ms`,
  );
  const tools = createTools({ cwd: GUEST_TREE(), world, commandTimes: unruledTimes, searchMs: LONGEST_ACT_MS });
  if (world.files === undefined) return yield* Effect.die('the benchmark world carries no files');
  const guestContext = yield* Layer.build(world.files);
  const guestFiles = Context.get(guestContext, FileSystem.FileSystem);
  yield* took('one stat over the open channel', 50, guestFiles.stat(GUEST_TREE()));
  yield* took(
    'write then read one kilobyte',
    20,
    guestFiles
      .writeFileString(`${GUEST_TREE()}/probe.txt`, 'x'.repeat(1024))
      .pipe(Effect.andThen(guestFiles.readFileString(`${GUEST_TREE()}/probe.txt`))),
  );
  yield* call(tools.bash, {
    command: `mkdir -p many && cd many && for n in $(seq 1 ${files}); do echo "needle $n" | tee f$n.txt >/dev/null; done`,
    description: 'make the search tree',
  });
  yield* took('one shell command', 5, call(tools.bash, { command: 'true', description: 'nothing at all' }));
  yield* took('one typed read', 5, call(tools.read, { path: 'many/f1.txt' }));
  yield* took(`grep over ${files} files`, 3, call(tools.grep, { pattern: 'needle' }));
  yield* took(`glob over ${files} files`, 3, call(tools.glob, { pattern: 'many/**/*.txt' }));
});

await Effect.runPromise(Effect.scoped(main));
