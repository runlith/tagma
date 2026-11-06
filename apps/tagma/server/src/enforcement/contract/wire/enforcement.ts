import { Schema } from 'effect';
import { type Assembled, BUILTINS, relevant } from '@tagma/inspection/builtins';
import { CONCERNS, moduleMapSchema, type Reach } from '@tagma/inspection/rule';
import { Site, Unjudged } from '@tagma/inspection/verdict';
import { ProgramRemeasure } from '@tagma/inspection/program';
import { processProvenanceSchema } from '../../../platform/contract/wire/provenance.js';
import { wordsSchema } from '../../../platform/contract/wire/refusal.js';
import {
  commitSchema,
  countedDebtSchema,
  ENFORCED_STRICTNESS,
  STRICTNESS,
  triggerSchema,
} from '../../../graph/contract/wire/enforcement.js';
import { type Check, isLinter, isProgrammed, isUnrun, type Programmed } from './document.js';
import { type Norm, said } from './findings.js';

export const reachSaid = (places: readonly string[]): string =>
  places.length === 0 ? 'nothing' : places.map((place) => (place === '' ? 'the whole base' : place)).join(', ');

export const inspectionBase = (inspection: Check): string =>
  isUnrun(inspection) || isProgrammed(inspection) ? '' : inspection.params.base;

export const inspectionRelevant = (inspection: Check, path: string): boolean =>
  !isUnrun(inspection) && !isProgrammed(inspection) && relevant(inspection, path);

export const inspectionReach = (inspection: Assembled): Reach => BUILTINS[inspection.builtin].reach;

export const inspectionFileLocal = (inspection: Assembled): boolean => {
  const rule = BUILTINS[inspection.builtin];
  return 'fileLocal' in rule && rule.fileLocal === true;
};

export const inspectionHides = (inspection: Assembled): 'any' | 'file' | 'nothing' => {
  const rule = BUILTINS[inspection.builtin];
  if ('hides' in rule && rule.hides !== undefined) return rule.hides;
  return inspectionFileLocal(inspection) ? 'file' : 'any';
};

export const MeasurementIdentity = Schema.Struct({
  tree: commitSchema,
  declaration: Schema.NonEmptyString,
  implementation: Schema.optional(Schema.NonEmptyString),
});
export type MeasurementIdentity = typeof MeasurementIdentity.Type;

export type InspectionCoverage = { readonly prefix: string; readonly paths: readonly string[] | null };

export const Measurement = Schema.Struct({
  commit: commitSchema,
  ms: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  at: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u)),
  identity: Schema.optional(MeasurementIdentity),
  sources: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  remeasure: Schema.optional(ProgramRemeasure),
}).annotate({
  description:
    'The confirmed rule state in this checkout: its commit and identity, the duration of its last pass and the source files of its debt.',
});
export type Measurement = typeof Measurement.Type;

const strictness = Schema.Literals(STRICTNESS);
const triggers = Schema.Array(triggerSchema);
const debts = Schema.Array(countedDebtSchema);

export const EnforcementPlan = Schema.Struct({
  rule: Schema.String,
  title: Schema.String,
  strictness: Schema.Literals(ENFORCED_STRICTNESS),
  was: Schema.Union([Schema.Struct({ strictness, on: triggers }), Schema.Literal('unreadable'), Schema.Null]),
  on: Schema.NullOr(triggers),
  inspection: Schema.NullOr(Schema.String),
  head: Schema.NullOr(Schema.String),
  places: Schema.Array(Schema.String),
  debt: Schema.Struct({ before: debts, after: debts }),
  absorbed: debts,
  retired: Schema.Array(Schema.String),
  escaped: Schema.Array(Schema.String),
  unjudged: Schema.Array(Unjudged),
  ms: Schema.NullOr(Schema.Finite),
});
export type EnforcementPlan = typeof EnforcementPlan.Type;

export const EnforcedAnswer = Schema.Struct({
  ...EnforcementPlan.fields,
  debt: Schema.Struct({ before: Schema.Int, after: Schema.Int }),
  escaped: Schema.Int,
  revision: Schema.NullOr(Schema.String),
  graph: Schema.NullOr(Schema.String),
  warning: Schema.optional(
    Schema.String.annotate({
      description: 'Set when the rule is delivered by finding and its check now runs at no trigger: no agent gets it.',
    }),
  ),
});
export type EnforcedAnswer = typeof EnforcedAnswer.Type;

const concern = Schema.NullOr(Schema.Literals(CONCERNS)).annotate({
  description: 'The concern its rules group under on the Rules screen; null where each description declares its own, or for a linter.',
});

export const FormRow = Schema.Struct({
  name: Schema.String.annotate({ description: 'The function of `@runlith/tagma/rules` that describes it.' }),
  summary: Schema.String,
  concern,
  door: Schema.String.annotate({ description: 'The subpath of `@runlith/tagma` that exports the function.' }),
});
export type FormRow = typeof FormRow.Type;

export const InspectionForm = Schema.Struct({
  ...FormRow.fields,
  name: Schema.String.annotate({ description: 'The SDK function or builtin id this reading describes.' }),
  door: Schema.NullOr(Schema.String),
  builtin: Schema.NullOr(Schema.String),
  pack: Schema.NullOr(Schema.String),
  languages: Schema.Array(Schema.String),
  signature: Schema.String.annotate({
    description:
      'For a function name, its TypeScript call signature and the types it references, derived from the SDK declarations. For a builtin id, or a config key describing one, its params schema with defaults and field descriptions.',
  }),
  unit: Schema.String,
  reach: Schema.NullOr(Schema.Literals(['local', 'global'])),
  unblock: Schema.Array(Schema.String),
  limitations: Schema.optional(Schema.Array(Schema.String)),
});
export type InspectionForm = typeof InspectionForm.Type;

export const KeyNaming = Schema.Struct({
  rule: Schema.String,
  title: Schema.String,
  strictness: Schema.NullOr(strictness),
  enabled: Schema.Boolean.annotate({
    description: 'False for a rule switched off, which keeps its document and its key but runs nowhere.',
  }),
});
export type KeyNaming = typeof KeyNaming.Type;

export const KeyReading = Schema.Struct({
  key: Schema.String,
  description: Schema.String.annotate({ description: 'The description the key resolves to at HEAD, as JSON, every default filled in.' }),
  rules: Schema.Array(KeyNaming),
});
export type KeyReading = typeof KeyReading.Type;

export const AssembledMap = Schema.Struct({ ...moduleMapSchema.fields, problems: Schema.Array(Schema.String) }).annotate({
  description:
    'The module map the server assembled from the module cards, as a rule taking it runs over it, and what keeps it from holding together.',
});

export const InspectionsReading = Schema.Struct({
  rows: Schema.optional(Schema.Array(FormRow)),
  shown: Schema.optional(Schema.Int),
  total: Schema.optional(Schema.Int),
  next: Schema.optional(Schema.NullOr(Schema.String)),
  form: Schema.optional(InspectionForm),
  key: Schema.optional(KeyReading),
  map: Schema.optional(AssembledMap),
  graph: Schema.NullOr(Schema.String),
});
export type InspectionsReading = typeof InspectionsReading.Type;

export const RuleViolation = Schema.Struct({
  fingerprint: Schema.NonEmptyString,
  file: Schema.String,
  line: Schema.optional(Schema.Int),
  specifier: Schema.optional(Schema.String),
  chain: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.optional(Schema.String),
  fix: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Finite),
  sites: Schema.optional(Schema.Array(Site)),
});
export type RuleViolation = typeof RuleViolation.Type;

const programFix = ({ program }: Programmed): string =>
  isLinter(program)
    ? `Change the code so ${program.linter.tool}${'rule' in program ? ` rule ${program.rule}` : ''} no longer reports it here.`
    : 'Change the code at the reported location to resolve the problem described by the inspection.';

export const generalFix = (check: Assembled | Programmed): string =>
  isProgrammed(check) ? programFix(check) : BUILTINS[check.builtin].unblock.join(' ');

const rule = Schema.NonEmptyString;

export const RuleCrossing = Schema.Struct({
  rule,
  title: Schema.String.annotate({
    description: "The norm the crossing breaks: its rule's title; for an inspection no rule enforces, `inspection <key>`.",
  }),
  strictness: Schema.optional(
    Schema.Literals(STRICTNESS).annotate({ description: "The rule's strictness; absent for an inspection no rule enforces." }),
  ),
  ...RuleViolation.fields,
  message: Schema.String.annotate({
    description:
      'What is wrong at `file:line`, one phrase of the inspection; `chain` adds where it runs through when it has more than one link.',
  }),
  fix: Schema.optional(
    Schema.String.annotate({ description: "The inspection's own way to remove this crossing; absent where it names none." }),
  ),
  generalFix: Schema.String.annotate({
    description: 'The general way out of the function describing the rule, for each crossing of its norm without a `fix` of its own.',
  }),
  withheld: Schema.optional(
    Schema.NonEmptyString.annotate({
      description:
        'The one path the crossing stands on that the working tree holds uncommitted and the judged tree lacks: a commit that also carries it ends the crossing.',
    }),
  ),
  holders: Schema.optional(
    Schema.Array(Schema.NonEmptyString).annotate({
      description:
        "The other writers whose uncommitted lines the crossing stands in, or who wrote `withheld`; the caller's own lines name none.",
    }),
  ),
});
export type RuleCrossing = typeof RuleCrossing.Type;

export const RuleBodies = Schema.Record(Schema.String, Schema.String).annotate({
  description: "Each rule's body by its name, once for every finding of that rule in this answer; a rule with an empty body is absent.",
});
export type RuleBodies = typeof RuleBodies.Type;

export const bodiesOf = (rules: readonly { readonly name: string; readonly body: string }[], named: Iterable<string>): RuleBodies => {
  const wanted = new Set(named);
  return Object.fromEntries(rules.filter((rule) => wanted.has(rule.name) && rule.body.trim() !== '').map((rule) => [rule.name, rule.body]));
};

export const shownBodies = (bodies: RuleBodies | undefined, rows: readonly { readonly rule: string }[]): RuleBodies | undefined => {
  const shown = new Set(rows.map((one) => one.rule));
  const kept = Object.entries(bodies ?? {}).filter(([rule]) => shown.has(rule));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
};

const messageOf = (violation: RuleViolation): string =>
  violation.message === undefined || violation.message === '' ? (violation.specifier ?? '') : violation.message;

export const crossingOf = (
  norm: Norm,
  check: Assembled | Programmed,
  violation: RuleViolation,
  withheld?: string,
  holders?: readonly string[],
): RuleCrossing => ({
  ...violation,
  rule: norm.rule,
  title: norm.title,
  strictness: norm.strictness,
  message: messageOf(violation),
  generalFix: generalFix(check),
  withheld,
  holders: holders === undefined || holders.length === 0 ? undefined : holders,
});

export const toldOf = (violation: RuleViolation): { readonly said: string; readonly fix: string | undefined } => ({
  said: said({ message: messageOf(violation), chain: violation.chain }),
  fix: violation.fix,
});

export const INSPECTION_FAILURES = [
  'deadline',
  'worker',
  'git',
  'source',
  'program',
  'host',
  'setup',
  'caller',
  'envelope',
  'unsupported',
  'module-map',
] as const;
export type InspectionFailure = (typeof INSPECTION_FAILURES)[number];

export const Watched = Schema.Union([
  RuleCrossing,
  Schema.Struct({ rule, cause: Schema.Literals(INSPECTION_FAILURES), failed: Schema.String }),
]);
export type Watched = typeof Watched.Type;

export const CarriedViolation = Schema.Struct({ ...RuleCrossing.fields, holders: Schema.Array(Schema.NonEmptyString) });
export type CarriedViolation = typeof CarriedViolation.Type;

export const RuleUnjudged = Schema.Struct({ rule: Schema.String, file: Schema.String, line: Schema.Int, specifier: Schema.String });
export type RuleUnjudged = typeof RuleUnjudged.Type;

export const GateUnjudged = Schema.Struct({ gate: Schema.Literal('unread'), cause: Schema.String });
export type GateUnjudged = typeof GateUnjudged.Type;

const InspectionUnjudged = Schema.Struct({
  rule: Schema.String,
  cause: Schema.Literals([...INSPECTION_FAILURES, 'undecodable']),
  failed: Schema.String,
  ways: Schema.optional(Schema.Array(Schema.String)),
});
export const LandingUnjudged = Schema.Union([RuleUnjudged, GateUnjudged, InspectionUnjudged]);
export type LandingUnjudged = typeof LandingUnjudged.Type;

export const unjudgedSaid = (one: LandingUnjudged | Unjudged): string =>
  'gate' in one
    ? one.cause
    : 'failed' in one
      ? `${one.rule === '' ? 'the inspection' : one.rule} could not run (${one.cause}): ${one.failed}`
      : `${'rule' in one && one.rule !== '' ? `${one.rule} ` : ''}${one.file}:${one.line} ${one.specifier}`;

export const JUDGE_REFUSALS = ['rule-violated', 'inspection-failed', 'module-map-invalid'] as const;
export type JudgeRefusalCode = (typeof JUDGE_REFUSALS)[number];

export const JudgeRefusalReport = Schema.Struct({
  code: Schema.Literals(JUDGE_REFUSALS),
  reason: Schema.String,
  unblock: Schema.NonEmptyArray(Schema.String),
  words: Schema.optional(wordsSchema),
});
export type JudgeRefusalReport = typeof JudgeRefusalReport.Type;

export const CHECK_OVER = ['change', 'all', 'staged'] as const;
export type CheckOver = (typeof CHECK_OVER)[number];

export const CheckedViolation = Schema.Struct({
  ...RuleCrossing.fields,
  owed: Schema.optional(Schema.Literal(true)),
});
export type CheckedViolation = typeof CheckedViolation.Type;

export const RuleRun = Schema.Struct({
  rule: Schema.String,
  strictness: Schema.optional(strictness),
  on: Schema.optional(triggers),
  ms: Schema.Finite,
  reached: Schema.Boolean,
  failed: Schema.optional(Schema.String),
  owed: Schema.optional(Schema.Int).annotate({
    description:
      'How many of the findings this run measured stand inside the rule’s debt. Over a change they are counted here and left out of `violations`; over `all` they are listed with `owed` set.',
  }),
});
export type RuleRun = typeof RuleRun.Type;

export const CheckAnswer = Schema.Struct({
  over: Schema.Literals(CHECK_OVER),
  head: Schema.String,
  paths: Schema.Array(Schema.String),
  formed: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      'Over the change: the paths the format commands of tagma.config.ts rewrote, judged in that form; submit_work carries it into the working files.',
  }),
  violations: Schema.Array(CheckedViolation),
  shown: Schema.Int,
  total: Schema.Int,
  next: Schema.NullOr(Schema.String),
  fingerprints: Schema.Array(Schema.String).annotate({
    description: 'The distinct fingerprints of the violations on this page; the next page, by the same cursor, carries the next ones.',
  }),
  bodies: Schema.optional(RuleBodies),
  unjudged: Schema.Array(LandingUnjudged),
  rules: Schema.Array(RuleRun),
  refuses: Schema.optional(Schema.Boolean),
  refusal: Schema.optional(JudgeRefusalReport),
  reader: Schema.NullOr(processProvenanceSchema),
});
export type CheckAnswer = typeof CheckAnswer.Type;

export const CommitRecord = Schema.Struct({
  commit: Schema.String,
  holder: Schema.String,
  waiting: Schema.optional(Schema.Int),
  unjudged: Schema.optional(Schema.String),
});
export type CommitRecord = typeof CommitRecord.Type;
