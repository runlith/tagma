import { dirname, join } from 'node:path';
import type { Package } from './packages.ts';
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
};

const BUN_TEST = /\bbun(?:\s+--\S+)*\s+test\b/;
const TEST_FILE = /\.[cm]?[jt]sx?'?$/;

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const suitesOf = (packages: readonly Package[], paths: readonly string[], options: SuiteOptions): Suite[] => {
  if (options.jobs !== undefined && (!Number.isSafeInteger(options.jobs) || options.jobs < 1))
    throw new Error('--jobs must be a positive integer');
  const cli = `${quote(process.execPath)} ${quote(join(options.root, 'packages/testbed/src/cli.ts'))}`;
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
        `${cli} ${quote(process.execPath)} --bun ${quote(VITEST)} run --config ${quote(join(options.root, 'scripts/change/vitest-all.ts'))} --reporter=default --reporter=json --outputFile=${quote(output)}${shuffled}`,
      ],
    });
  }
  for (const pkg of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) {
    for (const script of ['test', 'test:integration']) {
      const source = pkg.scripts[script];
      if (source === undefined || (script === 'test' && vitest.has(pkg.dir))) continue;
      const id = `${pkg.dir || '.'}:${script}`;
      const outputs: string[] = [];
      let named: number | undefined;
      const stages = source.split(/\s*&&\s*/).map((part, index) => {
        let command = part.replace(/^testbed\s+/, '');
        if (BUN_TEST.test(command)) {
          if (!command.includes('$('))
            named = command.split(/\s+/).filter((part) => !part.startsWith('-') && TEST_FILE.test(part)).length || undefined;
          command = command.replace(/\s+--(?:randomize|seed=\S+)/g, '');
          if (options.randomize) command += ` --randomize${options.seed === undefined ? '' : ` --seed=${options.seed}`}`;
        } else if (/\bvitest\s+run\b/.test(command)) {
          command = command.replace(/\s+--sequence.seed(?:=\S+|\s+\d+)/g, '').replace(/\s+--(?:randomize|sequence.shuffle)/g, '');
          const output = join(options.reports, `${encodeURIComponent(id)}-${index}.vitest.json`);
          outputs.push(output);
          command += ` --reporter=default --reporter=json --outputFile=${quote(output)}`;
          if (options.randomize) command += ` --randomize${options.seed === undefined ? '' : ` --sequence.seed=${options.seed}`}`;
        } else if (options.jobs !== undefined && /\bswift\s+test\b/.test(command)) {
          command = command.replace(/\s+-j\s+\d+/g, '') + ` -j ${options.jobs}`;
        } else if (options.jobs !== undefined && /\bcargo\s+test\b/.test(command)) {
          command = command.replace(/--test-threads=\d+/g, `--test-threads=${options.jobs}`);
        }
        return `${cli} ${command}`;
      });
      result.push({ id, directory: pkg.dir, script, files: named, stages, outputs });
    }
  }
  return result;
};
