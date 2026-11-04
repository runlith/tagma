import { dirname, join } from 'node:path';
import { kindOf, runsAs } from '@runlith/testbed/kinds';
import { shardOf } from '@runlith/testbed/timings';
import { runsOn, type Package } from './packages.ts';
import { vitestConfigsOf } from './vitestConfigs.ts';

const VITEST = join(dirname(Bun.resolveSync('vitest/package.json', import.meta.dir)), 'vitest.mjs');

export type Suite = {
  readonly id: string;
  readonly directory: string;
  readonly script: string;
  readonly files: number | undefined;
  readonly stages: readonly string[];
  readonly outputs: readonly string[];
};
export type SuiteOptions = {
  readonly root: string;
  readonly jobs: number | undefined;
  readonly randomize: boolean;
  readonly seed: number | undefined;
  readonly reports: string;
  readonly combineVitest: boolean;
  readonly shard?: string | undefined;
};

export const SCRIPTS = ['test', 'test:integration', 'test:native'] as const;

const BUN_TEST = /\bbun(?:\s+--\S+)*\s+test\b|^(?:itest|e2e)\b/;
const TEST_FILE = /\.[cm]?[jt]sx?'?$/;

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const suitesOf = (packages: readonly Package[], paths: readonly string[], options: SuiteOptions): Suite[] => {
  if (options.jobs !== undefined && (!Number.isSafeInteger(options.jobs) || options.jobs < 1))
    throw new Error('--jobs must be a positive integer');
  const cli = `${quote(process.execPath)} ${quote(join(options.root, 'packages/testbed/src/cli.ts'))}`;
  const first = options.shard === undefined || shardOf(options.shard).index === 1;
  const sharded = options.shard === undefined ? '' : ` --shard=${options.shard}`;
  const listed = new Set(paths);
  const owners = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  for (const path of paths) {
    if (kindOf(path) !== 'resource') continue;
    const owner = owners.find((pkg) => pkg.dir === '' || path.startsWith(`${pkg.dir}/`));
    if (owner === undefined) continue;
    const script = owner.scripts['test:integration'];
    if (script === undefined) throw new Error(`${owner.dir || '.'} has no test:integration script to run ${path}`);
    const own = owner.dir === '' ? path : path.slice(owner.dir.length + 1);
    if (!/\bvitest\b/.test(script) && !runsAs('resource', own, (directory) => listed.has(join(owner.dir, directory, 'package.json'))))
      throw new Error(`${owner.dir || '.'}:test:integration never discovers ${path}: it lies in a dot, build or nested package directory`);
  }
  const result: Suite[] = [];
  const vitest = options.combineVitest ? new Set(vitestConfigsOf(packages, paths).map((config) => config.directory)) : new Set<string>();
  if (vitest.size > 0) {
    const output = join(options.reports, 'packages-vitest.json');
    const shuffled = options.randomize ? ` --randomize${options.seed === undefined ? '' : ` --sequence.seed=${options.seed}`}` : '';
    result.push({
      id: 'packages:vitest:test',
      directory: '',
      script: 'test',
      files: undefined,
      outputs: [output],
      stages: [
        `${cli} ${quote(process.execPath)} --bun ${quote(VITEST)} run --config ${quote(join(options.root, 'scripts/change/vitest-all.ts'))} --reporter=default --reporter=json --outputFile=${quote(output)}${shuffled}${sharded && `${sharded} --passWithNoTests`}`,
      ],
    });
  }
  for (const pkg of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) {
    if (!runsOn(pkg)) continue;
    for (const script of SCRIPTS) {
      const source = pkg.scripts[script];
      if (source === undefined || (script === 'test' && vitest.has(pkg.dir))) continue;
      const id = `${pkg.dir || '.'}:${script}`;
      const outputs: string[] = [];
      let named: number | undefined;
      let shardable = false;
      const stages = source.split(/\s*&&\s*/).map((part, index) => {
        let command = part.replace(/^testbed\s+/, '');
        if (BUN_TEST.test(command)) {
          shardable = true;
          if (!command.includes('$('))
            named = command.split(/\s+/).filter((part) => !part.startsWith('-') && TEST_FILE.test(part)).length || undefined;
          command = command.replace(/\s+--(?:randomize|seed=\S+)/g, '');
          if (options.randomize) command += ` --randomize${options.seed === undefined ? '' : ` --seed=${options.seed}`}`;
          command += sharded;
        } else if (/\bvitest\s+run\b/.test(command)) {
          shardable = true;
          command = command.replace(/\s+--sequence.seed(?:=\S+|\s+\d+)/g, '').replace(/\s+--(?:randomize|sequence.shuffle)/g, '');
          const output = join(options.reports, `${encodeURIComponent(id)}-${index}.vitest.json`);
          outputs.push(output);
          command += ` --reporter=default --reporter=json --outputFile=${quote(output)}`;
          if (options.randomize) command += ` --randomize${options.seed === undefined ? '' : ` --sequence.seed=${options.seed}`}`;
          if (sharded !== '') command += `${sharded} --passWithNoTests`;
        } else if (options.jobs !== undefined && /\bswift\s+test\b/.test(command)) {
          command = command.replace(/\s+-j\s+\d+/g, '') + ` -j ${options.jobs}`;
        } else if (options.jobs !== undefined && /\bcargo\s+test\b/.test(command)) {
          command = command.replace(/--test-threads=\d+/g, `--test-threads=${options.jobs}`);
        }
        return `${cli} ${command}`;
      });
      if (!shardable && !first) continue;
      result.push({ id, directory: pkg.dir, script, files: named, stages, outputs });
    }
  }
  return result;
};
