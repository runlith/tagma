import { Result, Schema } from 'effect';
import type { FileEnding, FilePlan, FileSide, ProgramAnswer, ProgramInvocation } from '../../core/program.js';
import { countAnswer, fileInputs, noParameters } from '../files/counts.js';
import { sarifReading } from '../sarif/reading.js';
import { versionProblem } from '../files/version.js';

export const SEMGREP_MIN_VERSION = '1.56.0';
export const SEMGREP_COVERAGE = 'semgrep-coverage.json';
const Coverage = Schema.Struct({
  version: Schema.NonEmptyString,
  errors: Schema.Array(Schema.Unknown),
  paths: Schema.Struct({ scanned: Schema.Array(Schema.String) }),
});
const Rule = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[\w./-]+$/u)),
  languages: Schema.Tuple([Schema.Literal('python')]),
  severity: Schema.Literals(['ERROR', 'WARNING', 'INFO']),
  message: Schema.String,
  pattern: Schema.optionalKey(Schema.String),
  patterns: Schema.optionalKey(Schema.NonEmptyArray(Schema.Json)),
  'pattern-either': Schema.optionalKey(Schema.NonEmptyArray(Schema.Json)),
  'pattern-regex': Schema.optionalKey(Schema.String),
}).check(Schema.makeFilter((rule) => ['pattern', 'patterns', 'pattern-either', 'pattern-regex'].filter((key) => key in rule).length === 1));
const Config = Schema.Struct({ rules: Schema.NonEmptyArray(Rule) });
const MATCH_FIELDS = new Set([
  'pattern',
  'patterns',
  'pattern-either',
  'pattern-not',
  'pattern-inside',
  'pattern-not-inside',
  'pattern-regex',
  'pattern-not-regex',
  'metavariable-regex',
  'focus-metavariable',
]);

const localPattern = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  if (Array.isArray(value)) return value.every(localPattern);
  for (const [key, child] of Object.entries(value)) {
    if (!MATCH_FIELDS.has(key)) return false;
    if (key === 'metavariable-regex') {
      if (
        typeof child !== 'object' ||
        child === null ||
        Array.isArray(child) ||
        Object.keys(child).some((one) => one !== 'metavariable' && one !== 'regex')
      )
        return false;
    } else if (!localPattern(child)) return false;
  }
  return true;
};

export const planSemgrep = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  config: { readonly text: string; readonly absolute: string },
): Result.Result<FilePlan, string> => {
  const params = noParameters(input, 'a Semgrep rule takes no options: its YAML is the whole rule');
  if (Result.isFailure(params)) return Result.fail(params.failure);
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(config.text);
  } catch (error) {
    return Result.fail(`Semgrep config is not YAML: ${String(error)}`);
  }
  const decoded = Schema.decodeUnknownResult(Config, { onExcessProperty: 'error' })(raw);
  if (Result.isFailure(decoded)) return Result.fail(`Semgrep files config does not decode: ${decoded.failure.message}`);
  const rules = decoded.success.rules;
  const ids = new Set(rules.map((rule) => rule.id));
  if (ids.size !== rules.length || input.keys.some((key) => !ids.has(key.id)))
    return Result.fail('Semgrep rule ids repeat or a governed rule is absent');
  if (rules.some((rule) => !localPattern(rule.patterns ?? rule['pattern-either'] ?? [])))
    return Result.fail('Semgrep files layout supports local search patterns only');
  const files = fileInputs(sides, (path) => /\.py$/.test(path));
  if (Result.isFailure(files)) return Result.fail(files.failure);
  const targets = files.success.map((file) => file.path);
  return Result.succeed({
    files: files.success,
    targets,
    args: [
      'scan',
      '--config',
      config.absolute,
      '--sarif',
      '--json-output',
      SEMGREP_COVERAGE,
      '--error',
      '--strict',
      '--oss-only',
      '--no-rewrite-rule-ids',
      '--no-git-ignore',
      '--metrics=off',
      '--disable-version-check',
      '--jobs=1',
      '--max-target-bytes=0',
      '--timeout=0',
      '--',
      ...targets,
    ],
  });
};

export const readSemgrep = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  plan: FilePlan,
  ending: FileEnding | null,
): Result.Result<ProgramAnswer, string> => {
  const tool = { name: 'semgrep', version: SEMGREP_MIN_VERSION };
  if (ending === null) return plan.targets.length === 0 ? countAnswer(input, sides, tool, plan, []) : Result.fail('Semgrep did not run');
  if (ending.exitCode !== 0 && ending.exitCode !== 1) return Result.fail(`Semgrep exited ${ending.exitCode}`);
  let coverage: unknown;
  try {
    coverage = JSON.parse(ending.coverage ?? '');
  } catch (error) {
    return Result.fail(`Semgrep answered no coverage JSON: ${String(error)}`);
  }
  const covered = Schema.decodeUnknownResult(Coverage)(coverage);
  if (Result.isFailure(covered)) return Result.fail(`Semgrep coverage does not decode: ${covered.failure.message}`);
  const unsupported = versionProblem('Semgrep', covered.success.version, SEMGREP_MIN_VERSION);
  if (unsupported !== null) return Result.fail(unsupported);
  const paths = new Set(covered.success.paths.scanned);
  if (covered.success.errors.length > 0 || paths.size !== plan.targets.length || plan.targets.some((path) => !paths.has(path)))
    return Result.fail('Semgrep left a requested input unscanned or reported parse errors');
  const reading = sarifReading(
    ending.stdout,
    { name: 'Semgrep OSS', minimum: SEMGREP_MIN_VERSION },
    {
      documentVersion: '2.1.0',
      suppressed: 'drop',
      uriBaseId: '%SRCROOT%',
      pathEncoding: 'literal',
    },
  );
  if (Result.isFailure(reading)) return Result.fail(reading.failure);
  if (reading.success.version !== covered.success.version) return Result.fail('Semgrep coverage and SARIF report different versions');
  if (ending.exitCode === 1 && reading.success.reported === 0) return Result.fail('Semgrep exited for findings but answered none');
  return countAnswer(input, sides, { name: tool.name, version: covered.success.version }, plan, reading.success.diagnostics);
};
