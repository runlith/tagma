import { Predicate, Result, Schema } from 'effect';
import { BUILTIN_IDS, BUILTINS, type Inspection } from '@tagma/inspection/builtins';
import {
  type Config,
  type Descriptor,
  type FormatEntry,
  FormatCommand,
  KEY,
  LinterInspection,
  ProgramInspection,
} from './contract/wire/config.js';
export type Misfit = { readonly key: string | null; readonly reason: string };

const CLOSED = { onExcessProperty: 'error' } as const;

const Sections = Schema.Struct({
  inspections: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  format: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const Builtin = Schema.Struct({ builtin: Schema.Literals(BUILTIN_IDS), params: Schema.Unknown });

const decoded = <A>(schema: Schema.Codec<A, unknown>, value: unknown): Result.Result<A, string> =>
  Result.mapError(Schema.decodeUnknownResult(schema)(value, CLOSED), (failure) => failure.message);

const builtinOf = (value: unknown): Result.Result<Inspection, string> =>
  Result.flatMap(decoded(Builtin, value), ({ builtin, params }) => {
    const schema: Schema.Codec<unknown, unknown> = BUILTINS[builtin].params;
    return Result.map(decoded(schema, params), (canonical) => ({ builtin, params: canonical }) as Inspection);
  });

const descriptorOf = (value: unknown): Result.Result<Descriptor, string> => {
  if (!Predicate.isObject(value)) return Result.fail('it is no inspection: write a builtin, a defineInspection call or a linter rule');
  if ('builtin' in value) return builtinOf(value);
  if ('program' in value) return decoded(ProgramInspection, value);
  if ('linter' in value) return decoded(LinterInspection, value);
  return Result.fail('it is no inspection: write a builtin, a defineInspection call or a linter rule');
};

export const configOf = (value: unknown, footprint: readonly string[]): Result.Result<Config, Misfit> => {
  const at = (key: string | null, reason: string): Misfit => ({ key, reason });
  const sections = decoded(Sections, value);
  if (sections._tag === 'Failure')
    return Result.fail(at(null, `its default export is not defineConfig({ inspections, format }): ${sections.failure}`));
  const inspections = new Map<string, Descriptor>();
  for (const [key, one] of Object.entries(sections.success.inspections ?? {})) {
    if (!KEY.test(key)) return Result.fail(at(key, `the inspection key ${key} does not match ${KEY.source}`));
    const descriptor = descriptorOf(one);
    if (descriptor._tag === 'Failure') return Result.fail(at(key, `inspections.${key}: ${descriptor.failure}`));
    inspections.set(key, descriptor.success);
  }
  const format: FormatEntry[] = [];
  for (const [key, one] of Object.entries(sections.success.format ?? {})) {
    if (!KEY.test(key)) return Result.fail(at(key, `the format key ${key} does not match ${KEY.source}`));
    const command = decoded(FormatCommand, one);
    if (command._tag === 'Failure') return Result.fail(at(key, `format.${key}: ${command.failure}`));
    format.push({ key, command: command.success });
  }
  return Result.succeed({ inspections, format, footprint });
};
