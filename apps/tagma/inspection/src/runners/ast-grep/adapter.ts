import { Result, Schema } from 'effect';
import type { FileEnding, FilePlan, FileSide, ProgramAnswer, ProgramInvocation } from '../../core/program.js';
import { countAnswer, fileInputs, noParameters } from '../files/counts.js';
import { sarifReading } from '../sarif/reading.js';

export const AST_GREP_MIN_VERSION = '0.41.1';
const Config = Schema.Struct({
  ruleDirs: Schema.NonEmptyArray(Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*\\)(?!(?:[^/]*\/)*(?:\.|\.\.)(?:\/|$)).+$/u))),
});
const Rule = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[\w./-]+$/u)),
  language: Schema.Literal('Python'),
  severity: Schema.Literals(['error', 'warning', 'info', 'hint']),
  message: Schema.optional(Schema.String),
  rule: Schema.Record(Schema.String, Schema.Json),
  constraints: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  utils: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
export type RuleFile = { readonly path: string; readonly text: string };

export const ruleDirectories = (text: string): Result.Result<readonly string[], string> => {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (error) {
    return Result.fail(`ast-grep config is not YAML: ${String(error)}`);
  }
  const decoded = Schema.decodeUnknownResult(Config, { onExcessProperty: 'error' })(raw);
  return Result.isFailure(decoded)
    ? Result.fail(`ast-grep files config does not decode: ${decoded.failure.message}`)
    : Result.succeed(decoded.success.ruleDirs);
};

export const planAstGrep = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  config: { readonly text: string; readonly absolute: string },
  rules: readonly RuleFile[],
): Result.Result<FilePlan, string> => {
  const params = noParameters(input, 'an ast-grep rule takes no options: its YAML is the whole rule');
  if (Result.isFailure(params)) return Result.fail(params.failure);
  const dirs = ruleDirectories(config.text);
  if (Result.isFailure(dirs)) return Result.fail(dirs.failure);
  const ids = new Set<string>();
  const nativeRules: string[] = [];
  for (const file of rules) {
    let raw: unknown;
    try {
      raw = Bun.YAML.parse(file.text);
    } catch (error) {
      return Result.fail(`${file.path} is not one YAML rule: ${String(error)}`);
    }
    const rule = Schema.decodeUnknownResult(Rule, { onExcessProperty: 'error' })(raw);
    if (Result.isFailure(rule)) return Result.fail(`${file.path} is not a file-local Python rule: ${rule.failure.message}`);
    if (ids.has(rule.success.id)) return Result.fail(`ast-grep repeats rule ${rule.success.id}`);
    ids.add(rule.success.id);
    nativeRules.push(JSON.stringify(rule.success));
  }
  if (input.keys.some((key) => !ids.has(key.id))) return Result.fail('a governed ast-grep rule is not present and enabled');
  const files = fileInputs(sides, (path) => /\.(?:py|pyi)$/.test(path));
  if (Result.isFailure(files)) return Result.fail(files.failure);
  const targets = files.success.map((file) => file.path);
  const filter = `^(?:${input.keys.map((key) => key.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
  const noIgnore = ['hidden', 'dot', 'exclude', 'global', 'parent', 'vcs'].flatMap((kind) => ['--no-ignore', kind]);
  return Result.succeed({
    files: files.success,
    targets,
    args: [
      'scan',
      '--config',
      config.absolute,
      '--inline-rules',
      nativeRules.join('\n---\n'),
      '--threads=1',
      '--format=sarif',
      '--error',
      '--filter',
      filter,
      ...noIgnore,
      '--',
      ...targets,
    ],
  });
};

export const readAstGrep = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  plan: FilePlan,
  ending: FileEnding | null,
): Result.Result<ProgramAnswer, string> => {
  const tool = { name: 'ast-grep', version: AST_GREP_MIN_VERSION };
  if (ending === null) return plan.targets.length === 0 ? countAnswer(input, sides, tool, plan, []) : Result.fail('ast-grep did not run');
  if (ending.exitCode !== 0 && ending.exitCode !== 1) return Result.fail(`ast-grep exited ${ending.exitCode}`);
  const reading = sarifReading(
    ending.stdout,
    { name: tool.name, minimum: AST_GREP_MIN_VERSION },
    {
      documentVersion: 'tool',
      pathEncoding: 'literal',
    },
  );
  if (Result.isFailure(reading)) return Result.fail(reading.failure);
  if ((ending.exitCode === 1) !== reading.success.diagnostics.length > 0) return Result.fail('ast-grep exit and finding count disagree');
  return countAnswer(input, sides, { name: tool.name, version: reading.success.version! }, plan, reading.success.diagnostics);
};
