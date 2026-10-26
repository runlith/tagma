import { unthreadedCaller } from './testing/caller';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolExecute } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { createTools } from './index';
import { checkout, options, recorder } from './testing/toolHarness';

const committed: Record<string, string> = {};
for (let at = 0; at < 400; at += 1) committed[`src/${at % 20}/file-${at}.ts`] = `export const value${at} = ${at};\n`.repeat(40);

const bench = Effect.gen(function* () {
  const root = yield* checkout(committed);
  for (let at = 0; at < 60; at += 1)
    yield* Effect.promise(() => writeFile(join(root, `src/${at % 20}/file-${at}.ts`), `export const dirty${at} = true;\n`.repeat(80)));
  yield* Effect.promise(() => mkdir(join(root, 'notes'), { recursive: true }));
  for (let at = 0; at < 20; at += 1) yield* Effect.promise(() => writeFile(join(root, `notes/new-${at}.md`), `note ${at}\n`.repeat(50)));
  yield* Effect.promise(() => Bun.sleep(2100));
  const tools = createTools(options({ cwd: root, changes: recorder().port, unowned: ['.tagma'] }));
  const execute = toolExecute(tools.bash);
  if (execute === null) return yield* Effect.die(new Error('bash declares no execute'));
  const once = Effect.gen(function* () {
    const start = performance.now();
    yield* execute(
      { command: 'true', description: 'Run nothing' },
      { toolCallId: 'call-bench', caller: unthreadedCaller, messages: [] },
    ) as Effect.Effect<unknown>;
    return performance.now() - start;
  });
  for (let at = 0; at < 3; at += 1) yield* once;
  const times: number[] = [];
  for (let at = 0; at < 20; at += 1) times.push(yield* once);
  const sorted = [...times].sort((left, right) => left - right);
  console.log(
    JSON.stringify({
      median: sorted[Math.floor(sorted.length / 2)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      min: sorted[0],
      milliseconds: times.map((ms) => Math.round(ms * 10) / 10),
    }),
  );
});

await Effect.runPromise(Effect.scoped(bench));
