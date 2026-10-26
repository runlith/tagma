import { Result, Schema } from 'effect';
import type { FileSide, ProgramAnswer, ProgramInvocation } from '../../core/program.js';
import { countAnswer, type Diagnostic, fileInputs, ruleOptions, ruleSetting } from '../files/counts.js';
import { versionProblem } from '../files/version.js';
import type { DriverInput, DriverSide } from './driver.js';

export const ESLINT_MIN_VERSION = '9.0.0';
export const ESLINT_CAPABILITIES = { unit: 'count' } as const;

const LINTABLE: ReadonlySet<string> = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte']);

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
};

export const lintable = (path: string): boolean => LINTABLE.has(extensionOf(path));

export type EslintPlan = {
  readonly files: readonly { readonly path: string; readonly text: string }[];
  readonly targets: readonly string[];
  readonly stdin: string;
};

export type EslintEnding = { readonly exitCode: number; readonly stdout: string };

export type EslintEnv = { readonly env: string; readonly config: string | null };

export const planEslint = (
  invocation: ProgramInvocation,
  sides: readonly FileSide[],
  env: EslintEnv,
): Result.Result<EslintPlan, string> => {
  const options = ruleOptions(invocation);
  if (Result.isFailure(options)) return Result.fail(options.failure);
  const rules = Object.fromEntries([...options.success].map(([id, params]) => [id, ruleSetting(params)]));
  const laid = sides.map((side) => ({ ...side, files: side.files.filter((file) => lintable(file.path)) }));
  const files = fileInputs(laid, lintable);
  if (Result.isFailure(files)) return Result.fail(files.failure);
  const driven = laid.map((side): DriverSide => ({ side: side.side, dir: side.side, files: side.files.map((file) => file.path) }));
  const stdin = JSON.stringify({
    env: env.env,
    config: env.config,
    minimumVersion: ESLINT_MIN_VERSION,
    rules,
    sides: driven,
  } satisfies DriverInput);
  return Result.succeed({ files: files.success, targets: files.success.map((file) => file.path), stdin });
};

const Answered = Schema.Union([
  Schema.Struct({ failure: Schema.String }),
  Schema.Struct({
    version: Schema.NonEmptyString,
    files: Schema.Array(
      Schema.Struct({
        side: Schema.Literals(['tree', 'base']),
        path: Schema.NonEmptyString,
        messages: Schema.Array(
          Schema.Struct({ id: Schema.NullOr(Schema.String), line: Schema.Int, message: Schema.String, fatal: Schema.Boolean }),
        ),
      }),
    ),
  }),
]);

type Reading = { readonly version: string; readonly diagnostics: readonly Diagnostic[] };

const readingOf = (ending: EslintEnding, targets: readonly string[]): Result.Result<Reading, string> => {
  if (ending.exitCode !== 0) return Result.fail(`its driver exited ${ending.exitCode}`);
  let json: unknown;
  try {
    json = JSON.parse(ending.stdout);
  } catch {
    return Result.fail(`its driver answered no JSON: ${ending.stdout.slice(0, 500)}`);
  }
  const decoded = Schema.decodeUnknownResult(Answered, { onExcessProperty: 'error' })(json);
  if (Result.isFailure(decoded)) return Result.fail(`its driver's answer does not decode: ${decoded.failure.message}`);
  if ('failure' in decoded.success) return Result.fail(decoded.success.failure);
  const unsupported = versionProblem('ESLint', decoded.success.version, ESLINT_MIN_VERSION);
  if (unsupported !== null) return Result.fail(unsupported);
  const asked = new Set(targets);
  const answered = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const file of decoded.success.files) {
    const target = `${file.side}/${file.path}`;
    if (!asked.has(target) || answered.has(target)) return Result.fail(`its driver answered ${target}, which it was not asked once`);
    answered.add(target);
    for (const message of file.messages) {
      if (message.fatal) return Result.fail(`${target} could not be read: ${message.message}`);
      if (message.id === null) return Result.fail(`${target} drew a message from no rule: ${message.message}`);
      if (message.line < 1) return Result.fail(`${message.id} answered ${target} without a line`);
      diagnostics.push({ id: message.id, path: target, line: message.line, message: message.message });
    }
  }
  if (answered.size !== asked.size) return Result.fail('its driver left a requested file unanswered');
  return Result.succeed({ version: decoded.success.version, diagnostics });
};

export const readEslint = (
  invocation: ProgramInvocation,
  sides: readonly FileSide[],
  plan: EslintPlan,
  ending: EslintEnding | null,
): Result.Result<ProgramAnswer, string> => {
  const reading =
    ending === null
      ? plan.targets.length === 0
        ? Result.succeed({ version: ESLINT_MIN_VERSION, diagnostics: [] })
        : Result.fail('ESLint did not run over its targets')
      : readingOf(ending, plan.targets);
  if (Result.isFailure(reading)) return Result.fail(reading.failure);
  const tool = { name: 'eslint', version: reading.success.version };
  return countAnswer(invocation, sides, tool, { files: plan.files, targets: plan.targets, args: [] }, reading.success.diagnostics);
};
