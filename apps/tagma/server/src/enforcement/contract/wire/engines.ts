import { Schema } from 'effect';
import { family } from '@runlith/paging';
import { CONCERNS, countsFigure, listsFigure, thresholdsFigure } from '@tagma/inspection/rule';
import { escapeSchema, STRICTNESS, triggerSchema } from '../../../graph/contract/wire/enforcement.js';
import { DELIVERIES } from '../../../graph/contract/wire/tags/law.js';
import { Measurement } from './enforcement.js';
import { FIX_CHARS } from './pages.js';

const instant = Schema.String;
const named = Schema.String;

export const RefusalActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('operator') }),
  Schema.Struct({ kind: Schema.Literal('thread'), threadId: Schema.NonEmptyString, projectId: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal('session'),
    session: Schema.Struct({ harness: Schema.NonEmptyString, key: Schema.NonEmptyString }),
    projectId: Schema.Int,
  }),
]);
export type RefusalActor = typeof RefusalActor.Type;

export const RefusalRow = Schema.Struct({
  id: Schema.Int,
  rule: named,
  op: named,
  file: Schema.String,
  line: Schema.NullOr(Schema.Int),
  fingerprint: named,
  said: Schema.NullOr(Schema.String).annotate({
    description: 'What the inspection said is wrong at the place; null for a refusal recorded before it said one.',
  }),
  reached: Schema.NullOr(Schema.String).annotate({ description: 'The import the place reached, where the crossing is an import.' }),
  fix: Schema.NullOr(Schema.String).annotate({
    description: "The inspection's own way to remove it; null where it named none, the rule's `generalFix` then applying.",
  }),
  base: Schema.NullOr(Schema.String).annotate({ description: 'The commit the refused tree was judged against.' }),
  branch: Schema.NullOr(Schema.String),
  actor: Schema.NullOr(RefusalActor),
  at: instant,
});
export type RefusalRow = typeof RefusalRow.Type;

export const RefusalPlace = Schema.Struct({
  ...RefusalRow.fields,
  times: Schema.Int.annotate({ description: 'How many refusals the record keeps at this place, this newest one included.' }),
  first: instant.annotate({ description: 'When the oldest of them was recorded.' }),
}).annotate({ description: 'The newest refusal at one place — one fingerprint of the rule — with how often the place was refused.' });
export type RefusalPlace = typeof RefusalPlace.Type;

export const Checker = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('builtin'), builtin: named, concern: Schema.Literals(CONCERNS) }),
  Schema.Struct({ kind: Schema.Literal('program'), name: named, concern: Schema.Literals(CONCERNS) }),
  Schema.Struct({ kind: Schema.Literal('linter'), tool: named, rule: Schema.NullOr(named) }),
  Schema.Struct({ kind: Schema.Literal('unread'), reason: Schema.String }),
]);
export type Checker = typeof Checker.Type;

export const EngineRow = Schema.Struct({
  rule: named,
  title: Schema.String,
  places: Schema.Array(Schema.String),
  delivery: Schema.Literals(DELIVERIES),
  enabled: Schema.Boolean,
  inspection: Schema.NullOr(named).annotate({
    description: 'The key of `tagma.config.ts` the rule names; null for a rule followed as text.',
  }),
  function: Schema.NullOr(named).annotate({
    description:
      'What describes that key: the SDK function (`Loading.forbid`), the builtin id where none is public, the name of its own inspection, or the linter function.',
  }),
  unreadable: Schema.Boolean.annotate({ description: 'The rule carries an enforcement document this server does not decode.' }),
  strictness: Schema.NullOr(Schema.Literals(STRICTNESS)),
  on: Schema.Array(triggerSchema),
  checker: Schema.NullOr(Checker),
  debt: Schema.Struct({
    count: Schema.Int,
    owners: Schema.Int,
    was: Schema.NullOr(Schema.Struct({ count: Schema.Int, until: instant })),
  }),
  escaped: Schema.Int,
  refused: Schema.NullOr(Schema.Struct({ at: instant, file: Schema.String, line: Schema.NullOr(Schema.Int), op: named })),
  measured: Schema.NullOr(Measurement),
});
export type EngineRow = typeof EngineRow.Type;

const Door = Schema.Struct({ at: named, for: Schema.optional(Schema.Array(named)), role: Schema.optional(named) });

export const Neighbourhood = Schema.Struct({
  module: named,
  territory: Schema.Array(named),
  entries: Schema.NullOr(Schema.Array(Door)),
  imports: Schema.Array(Schema.Struct({ to: named, role: Schema.optional(named) })),
  importedBy: Schema.Array(Schema.Struct({ from: named, role: Schema.optional(named) })),
});
export type Neighbourhood = typeof Neighbourhood.Type;

export const modulesSummary = Schema.Struct({
  kind: Schema.Literal('modules'),
  modules: Schema.Int,
  relations: Schema.Int,
  focus: Schema.NullOr(Neighbourhood),
});

export const AnsweredFigure = Schema.Union([thresholdsFigure, listsFigure, countsFigure, modulesSummary]);
export type AnsweredFigure = typeof AnsweredFigure.Type;

export const UnitRow = Schema.Struct({
  id: named,
  territory: Schema.Int,
  entries: Schema.NullOr(Schema.Int),
  imports: Schema.Int,
  importedBy: Schema.Int,
});
export type UnitRow = typeof UnitRow.Type;

export const DebtRow = Schema.Struct({
  fingerprint: named,
  file: Schema.NullOr(Schema.String).annotate({
    description: "The file the violation stands in, as this checkout's measurement of the rule found it; null before one.",
  }),
  owner: named,
  value: Schema.NullOr(Schema.Finite),
  count: Schema.NullOr(Schema.Int),
});
export type DebtRow = typeof DebtRow.Type;

export const OWNER_STANDINGS = ['open', 'ended', 'replaced', 'not-owner', 'missing'] as const;

export const OwnerRow = Schema.Struct({
  name: named,
  title: Schema.String,
  status: Schema.NullOr(Schema.String),
  standing: Schema.Literals(OWNER_STANDINGS),
  entries: Schema.Int,
});
export type OwnerRow = typeof OwnerRow.Type;

export const HistoryPoint = Schema.Struct({ at: instant, count: Schema.Int });
export type HistoryPoint = typeof HistoryPoint.Type;

export const RuleChange = Schema.Struct({ at: instant, session: Schema.NullOr(Schema.Int), act: named });
export type RuleChange = typeof RuleChange.Type;

const rowsOf = <S extends Schema.Top>(row: S) =>
  Schema.Struct({ rows: Schema.Array(row), total: Schema.Int, next: Schema.NullOr(Schema.String) });

export const EngineRows = rowsOf(EngineRow);
export const DebtRows = rowsOf(DebtRow);
export const RefusalPlaces = Schema.Struct({
  ...rowsOf(RefusalPlace).fields,
  times: Schema.Int.annotate({ description: 'How many refusals the record keeps for the rule, over all its places.' }),
});
export type RefusalPlaces = typeof RefusalPlaces.Type;
export const EscapeRows = rowsOf(escapeSchema);
export const UnitRows = rowsOf(UnitRow);

const generalFix = Schema.NullOr(Schema.String).annotate({
  description:
    'The general way out of the function describing the rule, for each listed violation without a `fix` of its own; null where its check cannot be read.',
});

export const Engine = Schema.Struct({
  row: EngineRow,
  generalFix,
  base: Schema.String,
  figures: Schema.Array(AnsweredFigure),
  owners: Schema.Array(OwnerRow),
  history: Schema.Array(HistoryPoint),
  historyEnds: Schema.NullOr(Schema.String),
  revision: Schema.NullOr(Schema.String),
  changed: Schema.NullOr(RuleChange),
});
export type Engine = typeof Engine.Type;

export const RuleCounts = Schema.Struct({
  rules: Schema.Int,
  enforced: Schema.Int,
  gate: Schema.Int,
  watch: Schema.Int,
  note: Schema.Int,
  debt: Schema.Int,
  escaped: Schema.Int.annotate({ description: 'Violations standing in the enforced rules’ escaped lists: they got past a check.' }),
});
export type RuleCounts = typeof RuleCounts.Type;

export const ENGINE_LISTS = ['rules', 'debt', 'refusals', 'escaped', 'units'] as const;
export type EngineList = (typeof ENGINE_LISTS)[number];

export const RuleNorm = Schema.Struct({
  rule: named,
  title: Schema.String,
  strictness: Schema.optional(Schema.Literals(STRICTNESS)),
  generalFix,
}).annotate({ description: 'The norm the listed violations break, on a page that continues one rule’s list without its engine.' });

export const EnforcementReading = Schema.Struct({
  counts: Schema.optional(RuleCounts),
  rules: Schema.optional(EngineRows),
  rule: Schema.optional(named),
  norm: Schema.optional(RuleNorm),
  engine: Schema.optional(Engine),
  debt: Schema.optional(DebtRows),
  owners: Schema.optional(Schema.Array(OwnerRow)),
  refusals: Schema.optional(RefusalPlaces),
  escaped: Schema.optional(EscapeRows),
  units: Schema.optional(UnitRows),
  graph: Schema.NullOr(Schema.String),
});
export type EnforcementReading = typeof EnforcementReading.Type;

export const ENGINES = family('engines', 1, 'text', { text: 260, json: 720 }, 50, () => ({
  rule: 'x'.repeat(8),
  title: 'x'.repeat(160),
  places: ['x'.repeat(40)],
  inspection: 'x'.repeat(24),
  function: 'Effect.noSwallowedFailures',
  checker: { kind: 'builtin', builtin: 'x'.repeat(18), concern: 'imports' },
}));

export const DEBT = family('debt', 1, 'text', { text: 130, json: 260 }, 100, () => ({
  fingerprint: 'x'.repeat(90),
  file: 'x'.repeat(70),
  owner: 'x'.repeat(8),
  value: 1000,
  count: null,
}));

export const REFUSALS = family('refusals', 2, 'text', { text: 500, json: 700 }, 20, () => ({
  rule: 'x'.repeat(8),
  op: 'x'.repeat(14),
  file: 'x'.repeat(70),
  line: 120,
  said: 'x'.repeat(60),
  reached: 'x'.repeat(40),
  fix: 'x'.repeat(FIX_CHARS),
  times: 120,
  first: 'x'.repeat(24),
  at: 'x'.repeat(24),
}));

export const ESCAPES = family('escapes', 1, 'text', { text: 440, json: 520 }, 50, () => ({
  fingerprint: 'x'.repeat(90),
  path: 'x'.repeat(60),
  said: 'x'.repeat(60),
  fix: 'x'.repeat(FIX_CHARS),
  commit: 'x'.repeat(40),
}));

export const UNITS = family('units', 1, 'text', { text: 70, json: 110 }, 100, () => ({
  id: 'x'.repeat(24),
  territory: 40,
  entries: 90,
  imports: 30,
  importedBy: 30,
}));
