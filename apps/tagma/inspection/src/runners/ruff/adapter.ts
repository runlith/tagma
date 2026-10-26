import { Result, Schema } from 'effect';
import type { FileEnding, FilePlan, FileSide, ProgramAnswer, ProgramInvocation } from '../../core/program.js';
import { countAnswer, fileInputs, noParameters } from '../files/counts.js';

export const RUFF_VERSION = '0.13.3';
const LOCAL = new Set([
  'E501',
  'E711',
  'E712',
  'E713',
  'E714',
  'E721',
  'E722',
  'E731',
  'F401',
  'F541',
  'F601',
  'F602',
  'F621',
  'F622',
  'F631',
  'F632',
  'F633',
  'F634',
  'F701',
  'F702',
  'F704',
  'F821',
  'F822',
  'F823',
  'F841',
  'F901',
]);
const Config = Schema.Struct({
  'line-length': Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  'target-version': Schema.optional(Schema.String.check(Schema.isPattern(/^py3(?:[7-9]|1[0-4])$/u))),
  lint: Schema.Struct({ select: Schema.NonEmptyArray(Schema.NonEmptyString) }),
});
const Output = Schema.Array(
  Schema.Struct({
    code: Schema.NullOr(Schema.NonEmptyString),
    filename: Schema.NonEmptyString,
    message: Schema.String,
    fix: Schema.optional(Schema.NullOr(Schema.Struct({ message: Schema.optional(Schema.NullOr(Schema.String)) }))),
    url: Schema.optional(Schema.NullOr(Schema.String)),
    location: Schema.Struct({ row: Schema.Int.check(Schema.isGreaterThan(0)), column: Schema.Int.check(Schema.isGreaterThan(0)) }),
  }),
);

const ruffFix = (one: (typeof Output.Type)[number]): string | undefined => {
  const said = [one.fix?.message ?? '', one.url === undefined || one.url === null ? '' : `rule page: ${one.url}`].filter(
    (part) => part !== '',
  );
  return said.length === 0 ? undefined : said.join('; ');
};

export const planRuff = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  config: { readonly text: string; readonly absolute: string },
): Result.Result<FilePlan, string> => {
  const params = noParameters(input, 'Ruff takes no options per rule: its settings apply to every rule of a linter at once');
  if (Result.isFailure(params)) return Result.fail(params.failure);
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(config.text);
  } catch (error) {
    return Result.fail(`Ruff config is not TOML: ${String(error)}`);
  }
  const decoded = Schema.decodeUnknownResult(Config, { onExcessProperty: 'error' })(raw);
  if (Result.isFailure(decoded)) return Result.fail(`Ruff files config does not decode: ${decoded.failure.message}`);
  const selected = new Set(decoded.success.lint.select);
  if ([...selected].some((id) => !LOCAL.has(id)))
    return Result.fail('Ruff files layout supports only the declared file-local codes, without prefixes or tree-dependent rules');
  if (input.keys.some((key) => !selected.has(key.id))) return Result.fail('a governed Ruff code is not explicitly selected');
  const files = fileInputs(sides, (path) => /\.(?:py|pyi)$/.test(path));
  if (Result.isFailure(files)) return Result.fail(files.failure);
  const targets = files.success.map((file) => file.path);
  return Result.succeed({
    files: files.success,
    targets,
    args: [
      'check',
      '--config',
      config.absolute,
      '--no-cache',
      '--no-fix',
      '--no-respect-gitignore',
      '--no-force-exclude',
      '--output-format=json',
      '--',
      ...targets,
    ],
  });
};

export const readRuff = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  plan: FilePlan,
  ending: FileEnding | null,
  scratch: string,
): Result.Result<ProgramAnswer, string> => {
  if (ending === null)
    return plan.targets.length === 0
      ? countAnswer(input, sides, { name: 'ruff', version: RUFF_VERSION }, plan, [])
      : Result.fail('Ruff did not run');
  if (ending.exitCode !== 0 && ending.exitCode !== 1) return Result.fail(`Ruff exited ${ending.exitCode}`);
  let json: unknown;
  try {
    json = JSON.parse(ending.stdout);
  } catch (error) {
    return Result.fail(`Ruff JSON does not parse: ${String(error)}`);
  }
  const decoded = Schema.decodeUnknownResult(Output)(json);
  if (Result.isFailure(decoded)) return Result.fail(`Ruff JSON does not decode: ${decoded.failure.message}`);
  if ((ending.exitCode === 1) !== decoded.success.length > 0) return Result.fail('Ruff exit and finding count disagree');
  if (decoded.success.some((one) => one.code === null || one.code === 'invalid-syntax'))
    return Result.fail('Ruff could not parse an input');
  return countAnswer(
    input,
    sides,
    { name: 'ruff', version: RUFF_VERSION },
    plan,
    decoded.success.map((one) => ({
      id: one.code!,
      path: one.filename.startsWith(`${scratch}/`) ? one.filename.slice(scratch.length + 1) : one.filename,
      line: one.location.row,
      message: one.message,
      fix: ruffFix(one),
    })),
  );
};
