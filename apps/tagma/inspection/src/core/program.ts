import { Result, Schema } from 'effect';
import { Site, Unjudged, valuedDuplicate } from './verdict.js';

const path = Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*\\)(?!(?:[^/]*\/)*(?:\.|\.\.)(?:\/|$)).*$/u));

export const FACT_KINDS = ['imports', 'declarations'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FactNeed = Schema.Literals(FACT_KINDS);
export type FactNeed = typeof FactNeed.Type;

export const FactNeeds = Schema.Struct({
  facts: Schema.NonEmptyArray(FactNeed),
  context: Schema.optional(Schema.Record(Schema.NonEmptyString, Schema.Record(Schema.String, Schema.Json))),
}).check(Schema.makeFilter((one) => (new Set(one.facts).size === one.facts.length ? undefined : 'a fact is needed once')));
export type FactNeeds = typeof FactNeeds.Type;

export const RunnerDescriptor = Schema.Struct({
  id: Schema.NonEmptyString,
  adapter: Schema.NonEmptyString,
  argv: Schema.optional(Schema.NonEmptyArray(Schema.NonEmptyString)),
  config: Schema.optional(path),
  layout: Schema.Literals(['program', 'files', 'tree']),
  needs: Schema.optional(FactNeeds),
}).check(Schema.makeFilter((one) => one.layout !== 'program' || (one.argv !== undefined && one.config === undefined)));
export type RunnerDescriptor = typeof RunnerDescriptor.Type;

export const BindingReach = Schema.Struct({ places: Schema.Array(path), files: Schema.optional(Schema.Array(Schema.NonEmptyString)) });
export type BindingReach = typeof BindingReach.Type;

export const ProgramKey = Schema.Struct({
  key: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  params: Schema.Record(Schema.String, Schema.Json),
  reach: BindingReach,
});
export type ProgramKey = typeof ProgramKey.Type;

export const ProgramSide = Schema.Struct({
  side: Schema.Literals(['tree', 'base']),
  paths: Schema.NullOr(Schema.Array(path)),
  files: Schema.NullOr(Schema.Array(Schema.Struct({ path, text: Schema.String }))),
});
export type ProgramSide = typeof ProgramSide.Type;

export type FileSide = {
  readonly side: ProgramSide['side'];
  readonly whole: boolean;
  readonly files: readonly { readonly path: string; readonly text: string }[];
};
export type FilePlan = {
  readonly files: readonly { readonly path: string; readonly text: string }[];
  readonly targets: readonly string[];
  readonly args: readonly string[];
};
export type FileEnding = { readonly exitCode: number; readonly stdout: string; readonly coverage?: string };
export type SourceText = { readonly path: string; readonly text: string };

const line = Schema.Int.check(Schema.isGreaterThan(0));

export const FactTarget = Schema.Union([
  Schema.Struct({ path }),
  Schema.Struct({ external: Schema.NonEmptyString }),
  Schema.Struct({ unlisted: Schema.String }),
  Schema.Struct({ unjudged: Schema.NonEmptyString }),
]);
export type FactTarget = typeof FactTarget.Type;

export const FactImport = Schema.Struct({
  specifier: Schema.String,
  line,
  kind: Schema.Literals(['value', 'type', 'dynamic', 'side-effect']),
  forwards: Schema.Boolean,
  target: FactTarget,
});
export type FactImport = typeof FactImport.Type;

export const FactDeclaration = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.Literals(['class', 'function', 'variable', 'type', 'interface', 'enum', 'namespace']),
  line,
  exported: Schema.Boolean,
});

export const FactFile = Schema.Struct({
  path,
  language: Schema.NonEmptyString,
  imports: Schema.optional(Schema.Array(FactImport)),
  declarations: Schema.optional(Schema.Array(FactDeclaration)),
  lacks: Schema.optional(Schema.Array(Schema.Literals(FACT_KINDS))),
  unjudged: Schema.optional(Schema.NonEmptyString),
});
export type FactFile = typeof FactFile.Type;

export const FactSide = Schema.Struct({
  side: Schema.Literals(['tree', 'base']),
  commit: Schema.NonEmptyString,
  tree: Schema.NonEmptyString,
  complete: Schema.Boolean,
  files: Schema.Array(FactFile),
  reached: Schema.Array(FactFile),
  unread: Schema.Array(path),
});
export type FactSide = typeof FactSide.Type;

export const ProgramFacts = Schema.Struct({
  adapters: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, context: Schema.NonEmptyString })),
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sides: Schema.NonEmptyArray(FactSide),
});
export type ProgramFacts = typeof ProgramFacts.Type;

export const ProgramMode = Schema.Literals(['change', 'measure']);
export type ProgramMode = typeof ProgramMode.Type;

export const ProgramInvocation = Schema.Struct({
  mode: Schema.optional(ProgramMode),
  request: Schema.NonEmptyString,
  checker: Schema.NonEmptyString,
  keys: Schema.NonEmptyArray(ProgramKey),
  root: Schema.NonEmptyString,
  tree: Schema.NonEmptyString,
  base: Schema.NullOr(Schema.NonEmptyString),
  sides: Schema.NonEmptyArray(ProgramSide),
  facts: Schema.optional(ProgramFacts),
  workdir: Schema.optional(Schema.NonEmptyString),
});
export type ProgramInvocation = typeof ProgramInvocation.Type;

export const ProgramFinding = Schema.Struct({
  fingerprint: Schema.NonEmptyString,
  path,
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  message: Schema.String.annotate({
    description: 'What is wrong at this place, one phrase without the file: every reader prints it after `path:line`.',
  }),
  fix: Schema.optional(
    Schema.String.annotate({
      description:
        'How to remove this one finding. Absent, readers print the general way out: remove it where the message points, or name the work that removes it.',
    }),
  ),
  value: Schema.optional(Schema.Finite),
  sites: Schema.optional(Schema.Array(Site).check(Schema.isMinLength(1))),
});
export type ProgramFinding = typeof ProgramFinding.Type;

export const ProgramCoverage = Schema.Union([Schema.Array(path), Schema.Struct({ scope: Schema.Literal('reach') })]);
export type ProgramCoverage = typeof ProgramCoverage.Type;

export const ProgramRemeasure = Schema.Literal('delta');
export type ProgramRemeasure = typeof ProgramRemeasure.Type;

export const ProgramResult = Schema.Struct({
  remeasure: Schema.optional(ProgramRemeasure),
  key: Schema.NonEmptyString,
  side: Schema.Literals(['tree', 'base']),
  covered: ProgramCoverage,
  findings: Schema.Array(ProgramFinding),
  unjudged: Schema.Array(Unjudged),
});
export type ProgramResult = typeof ProgramResult.Type;

export const ProgramAnswer = Schema.Struct({
  request: Schema.NonEmptyString,
  tree: Schema.NonEmptyString,
  base: Schema.NullOr(Schema.NonEmptyString),
  checker: Schema.NonEmptyString,
  run: Schema.Struct({
    tool: Schema.NonEmptyString,
    version: Schema.NonEmptyString,
    capabilities: Schema.Struct({ unit: Schema.optional(Schema.Literal('count')) }),
  }),
  readings: Schema.Array(ProgramResult),
  unanswered: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.NonEmptyString,
        why: Schema.Literals(['unprepared', 'threw']),
        reason: Schema.NonEmptyString,
      }),
    ),
  ),
  failure: Schema.optional(Schema.NonEmptyString),
});
export type ProgramAnswer = typeof ProgramAnswer.Type;

export const readProgramAnswer = (input: ProgramInvocation, output: unknown): Result.Result<ProgramAnswer, string> => {
  const decoded = Schema.decodeUnknownResult(ProgramAnswer, { onExcessProperty: 'error' })(output);
  if (Result.isFailure(decoded)) return Result.fail(`the program answer does not decode: ${decoded.failure.message}`);
  const answer = decoded.success;
  if (answer.failure !== undefined) return Result.fail(answer.failure);
  for (const field of ['request', 'tree', 'base', 'checker'] as const) {
    if (answer[field] !== input[field]) return Result.fail(`the answer echoes a different ${field}`);
  }
  const asked = new Set(input.keys.map((one) => one.key));
  const unanswered = new Set((answer.unanswered ?? []).map((one) => one.key));
  for (const key of unanswered) if (!asked.has(key)) return Result.fail(`an unknown key was left unanswered: ${key}`);
  const keys = new Set([...asked].filter((key) => !unanswered.has(key)));
  const sides = new Set(input.sides.map((one) => one.side));
  const seen = new Set<string>();
  for (const reading of answer.readings) {
    if (!keys.has(reading.key) || !sides.has(reading.side))
      return Result.fail(`an unknown key or side was answered: ${reading.key}/${reading.side}`);
    const id = JSON.stringify([reading.key, reading.side]);
    if (seen.has(id)) return Result.fail(`a key and side were answered twice: ${reading.key}/${reading.side}`);
    seen.add(id);
    if (reading.unjudged.length > 0) return Result.fail(`the reading ${reading.key}/${reading.side} leaves sites unjudged`);
    const repeated = valuedDuplicate(reading.findings.map((one) => ({ ...one, file: one.path })));
    if (repeated !== undefined) return Result.fail(`a valued fingerprint is repeated: ${repeated}`);
    if (Array.isArray(reading.covered) && new Set(reading.covered).size !== reading.covered.length)
      return Result.fail(`coverage repeats a path: ${reading.key}/${reading.side}`);
  }
  if (seen.size !== keys.size * sides.size) return Result.fail('the answer is missing a requested key and side');
  return Result.succeed(answer);
};
