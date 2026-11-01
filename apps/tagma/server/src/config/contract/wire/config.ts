import { Effect, Schema } from 'effect';
import type { Inspection } from '@tagma/inspection/builtins';
import { FACT_KINDS } from '@tagma/inspection/program';
import { CONCERNS } from '@tagma/inspection/rule';
import { Argv, type DeriveCommand, RepositoryPath } from '../../../change-record/contract/wire/derivation.js';

export const CONFIG_FILE = 'tagma.config.ts';

export const KEY = /^[a-z][a-z0-9-]*$/u;

export type ConfigRefusal = 'config-invalid' | 'config-unstored' | 'config-unrunnable';

const defaulted = <S extends Schema.Top>(schema: S, value: S['Encoded']) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

const Globs = Schema.Array(Schema.NonEmptyString);

export const ProgramInspection = Schema.Struct({
  program: RepositoryPath,
  name: Schema.NonEmptyString,
  concern: Schema.Literals(CONCERNS),
  needs: defaulted(Schema.Array(Schema.Literals(FACT_KINDS)), []),
  params: Schema.Record(Schema.String, Schema.Unknown),
  files: Schema.optional(Globs),
});
export type ProgramInspection = typeof ProgramInspection.Type;

const NamedTool = Schema.Struct({
  tool: Schema.Literals(['eslint', 'oxlint', 'ruff', 'semgrep', 'ast-grep']),
  config: Schema.optional(Schema.NonEmptyString),
  argv: Schema.optional(Argv),
});

const SarifCommand = Schema.Struct({ tool: Schema.Literal('command'), argv: Argv, output: Schema.Literal('sarif') });

const FindingsCommand = Schema.Struct({ tool: Schema.Literal('command'), argv: Argv, output: Schema.Literal('findings') });

export const LinterInspection = Schema.Union([
  Schema.Struct({ linter: Schema.Union([NamedTool, SarifCommand]), rule: Schema.NonEmptyString, files: Schema.optional(Globs) }),
  Schema.Struct({ linter: FindingsCommand, files: Schema.optional(Globs) }),
]);
export type LinterInspection = typeof LinterInspection.Type;

export type Descriptor = Inspection | ProgramInspection | LinterInspection;

export const FormatCommand = Schema.Struct({
  run: Argv,
  files: Schema.Array(Schema.String),
  ok: defaulted(Schema.Array(Schema.Int), [0]),
  reads: defaulted(Schema.Literals(['tree', 'nearby']), 'tree'),
  on: defaulted(Schema.Literal('commit'), 'commit'),
});
export type FormatCommand = typeof FormatCommand.Type;

export type FormatEntry = { readonly key: string; readonly command: FormatCommand };

export type DeriveEntry = { readonly key: string; readonly command: DeriveCommand };

export type Config = {
  readonly inspections: ReadonlyMap<string, Descriptor>;
  readonly format: readonly FormatEntry[];
  readonly derive: readonly DeriveEntry[];
  readonly footprint: readonly string[];
};
