import { Result } from 'effect';
import type { ProgramAnswer, ProgramFinding, ProgramInvocation, ProgramResult, ProgramSide } from '../../core/program.js';
import { ruleOptions } from '../files/counts.js';
import { LAW_CONFIG, lawConfig } from './config.js';
import { readSarif } from './sarif.js';

export const OXLINT_MIN_VERSION = '1.63.0';
//! oxlint supplies no semantic locator and no partialFingerprints, so a check keys by (check, file) with its count as value: tier (c) of d11108eb.
export const OXLINT_CAPABILITIES = { unit: 'count' } as const;

export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx']);
export const EMBEDDED_EXTENSIONS: ReadonlySet<string> = new Set(['vue', 'astro', 'svelte']);

export const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
};

export type LaidSide = {
  readonly side: ProgramSide['side'];
  readonly whole: boolean;
  readonly files: readonly { readonly path: string; readonly text: string }[];
};

export type OxlintPlan = {
  readonly sources: readonly { readonly path: string; readonly text: string }[];
  readonly config: { readonly path: string; readonly text: string };
  readonly targets: readonly string[];
  readonly args: readonly string[];
};

export type OxlintEnding = { readonly exitCode: number; readonly stdout: string };

export const lintable = (path: string): boolean => {
  const extension = extensionOf(path);
  return SCRIPT_EXTENSIONS.has(extension) || EMBEDDED_EXTENSIONS.has(extension);
};

export const planOxlint = (
  invocation: ProgramInvocation,
  sides: readonly LaidSide[],
  project: { readonly path: string; readonly absolute: string; readonly text: string } | null,
  threads: number,
): Result.Result<OxlintPlan, string> => {
  const options = ruleOptions(invocation);
  if (Result.isFailure(options)) return Result.fail(options.failure);
  const config = lawConfig(project, options.success);
  if (Result.isFailure(config)) return Result.fail(config.failure);
  const sources: { path: string; text: string }[] = [];
  for (const side of sides) {
    for (const file of side.files) {
      if (!lintable(file.path)) continue;
      sources.push({ path: `${side.side}/${file.path}`, text: file.text });
    }
  }
  const targets = sources.map((file) => file.path);
  const args = [`--threads=${Math.max(1, Math.floor(threads))}`, ...OXLINT_FLAGS, '-c', LAW_CONFIG, '--format=sarif', ...targets];
  return Result.succeed({ sources, config: { path: LAW_CONFIG, text: config.success }, targets, args });
};

const answerOf = (
  invocation: ProgramInvocation,
  sides: readonly LaidSide[],
  version: string,
  found: ReadonlyMap<string, ProgramFinding[]>,
): ProgramAnswer => ({
  request: invocation.request,
  tree: invocation.tree,
  base: invocation.base,
  checker: invocation.checker,
  run: { tool: 'oxlint', version, capabilities: OXLINT_CAPABILITIES },
  readings: invocation.keys.flatMap((key) =>
    sides.map((side): ProgramResult => ({
      key: key.key,
      side: side.side,
      covered: side.whole ? { scope: 'reach' } : side.files.map((file) => file.path),
      findings: found.get(`${side.side}\0${key.id}`) ?? [],
      unjudged: [],
    })),
  ),
});

export const OXLINT_FLAGS = ['--disable-nested-config', '--no-ignore'] as const;

type Tally = {
  readonly version: string;
  readonly counted: ReadonlyMap<string, ReadonlyMap<string, { count: number; line: number; message: string }>>;
};

const tallyOf = (ending: OxlintEnding, targets: ReadonlySet<string>, ids: ReadonlySet<string>): Result.Result<Tally, string> => {
  if (ending.exitCode !== 0 && ending.exitCode !== 1) return Result.fail(`oxlint exited ${ending.exitCode}`);
  const reading = readSarif(ending.stdout, OXLINT_MIN_VERSION);
  if (Result.isFailure(reading)) return Result.fail(reading.failure);
  const errors = reading.success.diagnostics.filter((one) => one.error).length;
  if ((ending.exitCode === 1) !== errors > 0) return Result.fail(`oxlint exited ${ending.exitCode} with ${errors} error diagnostics`);
  const counted = new Map<string, Map<string, { count: number; line: number; message: string }>>();
  for (const diagnostic of reading.success.diagnostics) {
    if (!targets.has(diagnostic.uri)) return Result.fail(`oxlint reported ${diagnostic.uri}, which it was not asked to lint`);
    if (!ids.has(diagnostic.id)) continue;
    const files = counted.get(diagnostic.id) ?? new Map();
    counted.set(diagnostic.id, files);
    const held = files.get(diagnostic.uri);
    if (held === undefined) files.set(diagnostic.uri, { count: 1, line: diagnostic.line, message: diagnostic.message });
    else {
      held.count += 1;
      if (diagnostic.line < held.line) Object.assign(held, { line: diagnostic.line, message: diagnostic.message });
    }
  }
  return Result.succeed({ version: reading.success.version, counted });
};

export const readOxlint = (
  invocation: ProgramInvocation,
  sides: readonly LaidSide[],
  plan: OxlintPlan,
  ending: OxlintEnding | null,
): Result.Result<ProgramAnswer, string> => {
  if (ending === null) {
    return plan.targets.length === 0
      ? Result.succeed(answerOf(invocation, sides, OXLINT_MIN_VERSION, new Map()))
      : Result.fail('oxlint did not run over its targets');
  }
  const tally = tallyOf(ending, new Set(plan.targets), new Set(invocation.keys.map((key) => key.id)));
  if (Result.isFailure(tally)) return Result.fail(tally.failure);
  const found = new Map<string, ProgramFinding[]>();
  for (const [id, files] of tally.success.counted) {
    for (const [uri, held] of files) {
      const slash = uri.indexOf('/');
      const bucket = `${uri.slice(0, slash)}\0${id}`;
      const path = uri.slice(slash + 1);
      found.set(bucket, [
        ...(found.get(bucket) ?? []),
        {
          fingerprint: path,
          path,
          line: held.line,
          message: `${held.count} × ${held.message}`,
          value: held.count,
        },
      ]);
    }
  }
  return Result.succeed(answerOf(invocation, sides, tally.success.version, found));
};
