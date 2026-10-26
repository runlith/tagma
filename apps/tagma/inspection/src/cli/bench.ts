import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Inspection } from '../builtins';
import { ready } from '../builtins.node';
import { selects } from '../core/node/implementations';
import { gitRoot } from '../core/node/run';

const flag = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const args = Bun.argv.slice(2);
const snapshot = args.find((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--touch');
if (snapshot === undefined) throw new Error('usage: bun src/cli/bench.ts <inspection.json> [--touch <path>]');
const repository = gitRoot(process.cwd());
const inspection = JSON.parse(readFileSync(resolve(snapshot), 'utf8')) as Inspection;
await ready(inspection.builtin);
const RUNS = 3;

const command = (argv: readonly string[]) => {
  const ran = Bun.spawnSync([...argv], { cwd: repository, stdout: 'pipe', stderr: 'pipe' });
  if (ran.exitCode !== 0 && ran.exitCode !== 1) throw new Error(`${argv.join(' ')} exited ${ran.exitCode}: ${ran.stderr.toString()}`);
  return ran.stdout.toString().trim();
};
const commit = command(['git', 'rev-parse', 'HEAD']);
const files = command(['git', 'ls-tree', '-r', '--name-only', commit])
  .split('\n')
  .filter((path) => selects(inspection, path));
if (files.length === 0) throw new Error(`${inspection.builtin} selected no benchmark files at ${commit}`);
const touched = flag(args, '--touch') ?? files[0];
if (touched === undefined || !files.includes(touched))
  throw new Error(`${inspection.builtin} has no selected one-file landing at ${touched}`);

type Reading = {
  readonly paths: number;
  readonly ms: number;
  readonly violations: readonly unknown[];
  readonly unjudged: readonly unknown[];
};
type Sample = { readonly elapsed: number; readonly answer: Reading };
const run = (extra: readonly string[]): Sample => {
  const started = performance.now();
  const ran = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, 'inspect.ts'), resolve(snapshot), '--repo', repository, '--at', commit, ...extra, '--json'],
    {
      cwd: repository,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const elapsed = performance.now() - started;
  if (ran.exitCode !== 0 && ran.exitCode !== 1) throw new Error(`inspection exited ${ran.exitCode}: ${ran.stderr.toString()}`);
  return { elapsed, answer: JSON.parse(ran.stdout.toString()) as Reading };
};
const sample = (extra: readonly string[]) => Array.from({ length: RUNS }, () => run(extra));
const median = (values: readonly Sample[]): Sample =>
  [...values].sort((a, b) => a.elapsed - b.elapsed)[Math.floor(values.length / 2)] as Sample;
const cold = median(sample([]));
const landing = median(sample(['--base', commit, '--paths', touched]));
console.log(
  `${inspection.builtin} at ${commit.slice(0, 10)}: ${files.length} selected files; ${cold.answer.violations.length} violations, ${cold.answer.unjudged.length} unjudged`,
);
console.log(
  `real cold HEAD reach ${cold.elapsed.toFixed(1)} ms (inspection ${cold.answer.ms} ms); one-file landing of ${touched} ${landing.elapsed.toFixed(1)} ms (inspection ${landing.answer.ms} ms)`,
);
console.log(
  `Each of ${RUNS} readings started a fresh Bun process, read git objects from disk, and used the same runner as a gate. One machine sample, not a ceiling for another machine or repository.`,
);
