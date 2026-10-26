import { dirname, join } from 'node:path';
import { planChunks, type Costs } from './chunking.ts';
import type { Package } from './packages.ts';
import { vitestConfigsOf } from './vitestConfigs.ts';

const VITEST = join(dirname(Bun.resolveSync('vitest/package.json', import.meta.dir)), 'vitest.mjs');

export type Suite = {
  readonly id: string;
  readonly directory: string;
  readonly script: string;
  readonly shard: string | undefined;
  readonly files: number | undefined;
  readonly command: string;
  readonly outputs: readonly string[];
};
export type SuiteOptions = {
  readonly root: string;
  readonly jobs: number | undefined;
  readonly width: number;
  readonly randomize: boolean;
  readonly seed: number | undefined;
  readonly reports: string;
  readonly combineVitest: boolean;
  readonly history: ChunkHistory | undefined;
};
export type ChunkHistory = {
  readonly costs: Costs;
  readonly lifeMs: number;
  readonly select: (directory: string, selector: string) => readonly string[];
};

const FILES_PER_SHARD = 24;
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
      shard: undefined,
      files: undefined,
      outputs: [output],
      command: `${cli} ${quote(process.execPath)} --bun ${quote(VITEST)} run --config ${quote(join(options.root, 'scripts/change/vitest-all.ts'))} --reporter=default --reporter=json --outputFile=${quote(output)}${shuffled}`,
    });
  }
  const resources = new Map<string, number>();
  for (const path of paths) {
    if (!/\.itest\.[cm]?[jt]sx?$/.test(path)) continue;
    const owner = packages.find((pkg) => pkg.dir === '' || path.startsWith(`${pkg.dir}/`));
    if (owner !== undefined) resources.set(owner.dir, (resources.get(owner.dir) ?? 0) + 1);
  }
  for (const pkg of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) {
    for (const script of ['test', 'test:integration']) {
      const source = pkg.scripts[script];
      if (source === undefined || (script === 'test' && vitest.has(pkg.dir))) continue;
      const integration = script === 'test:integration' && BUN_TEST.test(source);
      const selector = integration && options.history !== undefined && !source.includes('&&') ? /\$\((.+)\)/.exec(source)?.[1] : undefined;
      const selected = selector === undefined ? [] : options.history!.select(pkg.dir, selector);
      const chunks =
        selected.length === 0
          ? undefined
          : planChunks({
              files: selected.map((file) => join(pkg.dir, file)),
              costs: options.history!.costs,
              lifeMs: options.history!.lifeMs,
              jobs: options.width,
              filesPerFallbackChunk: FILES_PER_SHARD,
            }).map((chunk) => chunk.files.map((file) => `./${pkg.dir === '' ? file : file.slice(pkg.dir.length + 1)}`));
      const count = chunks?.length ?? (integration ? Math.max(1, Math.ceil((resources.get(pkg.dir) ?? 0) / FILES_PER_SHARD)) : 1);
      for (let shard = 1; shard <= count; shard++) {
        const label = count === 1 ? undefined : `${shard}/${count}`;
        const id = `${pkg.dir || '.'}:${script}${label === undefined ? '' : `:${label}`}`;
        const outputs: string[] = [];
        const files = chunks?.[shard - 1];
        let named = files?.length;
        const command = source
          .split(/\s*&&\s*/)
          .map((part, index) => {
            let command = part.replace(/^testbed\s+/, '');
            const bun = BUN_TEST.test(command);
            const vitest = /\bvitest\s+run\b/.test(command);
            if (bun) {
              if (files !== undefined) command = command.replace(`$(${selector})`, () => files.map(quote).join(' '));
              else if (!command.includes('$('))
                named = command.split(/\s+/).filter((part) => !part.startsWith('-') && TEST_FILE.test(part)).length || undefined;
              command = command.replace(/\s+--(?:randomize|seed=\S+|shard=\S+)/g, '');
              if (count > 1 && files === undefined) command += ` --shard=${shard}/${count}`;
              if (options.randomize) command += ` --randomize${options.seed === undefined ? '' : ` --seed=${options.seed}`}`;
            } else if (vitest) {
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
          })
          .join(' && ');
        result.push({ id, directory: pkg.dir, script, shard: label, files: named, command, outputs });
      }
    }
  }
  return result;
};
