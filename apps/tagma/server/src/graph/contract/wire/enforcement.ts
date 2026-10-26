import { Schema } from 'effect';

export const STRICTNESS = ['note', 'watch', 'gate'] as const;
export type Strictness = (typeof STRICTNESS)[number];

export const ENFORCED_STRICTNESS = ['off', ...STRICTNESS] as const;
export type EnforcedStrictness = (typeof ENFORCED_STRICTNESS)[number];

export const TRIGGER_PHASES = ['before', 'after'] as const;
export type TriggerPhase = (typeof TRIGGER_PHASES)[number];

export const triggerSchema = Schema.Struct({ op: Schema.NonEmptyString, phase: Schema.Literals(TRIGGER_PHASES) });
export type Trigger = typeof triggerSchema.Type;

export const hasTrigger = (on: readonly Trigger[], op: string, phase?: TriggerPhase): boolean =>
  on.some((one) => one.op === op && (phase === undefined || one.phase === phase));

export const sameTrigger = (left: Trigger, right: Trigger): boolean => left.op === right.op && left.phase === right.phase;

export const triggersSaid = (on: readonly Trigger[]): string => {
  if (on.length === 0) return 'only through check_rules';
  const phase = (which: TriggerPhase) => on.filter((one) => one.phase === which).map((one) => one.op);
  const before = phase('before');
  const after = phase('after');
  return [
    ...(before.length === 0 ? [] : [`before ${before.join(', ')}`]),
    ...(after.length === 0 ? [] : [`after ${after.join(', ')}`]),
  ].join('; ');
};

export const commitSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u));
const fingerprint = Schema.NonEmptyString;

export const heldDebtSchema = Schema.Struct({ base: commitSchema, path: Schema.NonEmptyString }).annotate({
  description:
    'The HEAD at which the violation stood only in the uncommitted change of the session that absorbed it, and the file it stands on: the entry waits for a landing to carry it, and retires once that file changes without it.',
});
export type HeldDebt = typeof heldDebtSchema.Type;

export const debtSchema = Schema.Struct({
  fingerprint,
  owner: Schema.NonEmptyString,
  value: Schema.optional(Schema.Finite),
  held: Schema.optional(heldDebtSchema),
});
export type Debt = typeof debtSchema.Type;

export const countedDebtSchema = Schema.Struct({
  ...debtSchema.fields,
  count: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});

export const escapeSchema = Schema.Struct({
  fingerprint,
  path: Schema.NonEmptyString,
  line: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  said: Schema.optional(
    Schema.String.annotate({ description: 'What the inspection said is wrong at the place when the violation got past it.' }),
  ),
  fix: Schema.optional(Schema.String.annotate({ description: 'How the inspection said to remove it.' })),
  commit: commitSchema,
  changed: Schema.optional(
    Schema.Literal('check').annotate({
      description:
        "Set when no commit let the violation in: it already stood at `commit`, the last version measured before the rule's check changed — Tagma's inspection, the rule's reach, its module map or its debt — and the changed check found it there.",
    }),
  ),
  holder: Schema.optional(Schema.Union([Schema.NonEmptyString, Schema.Int.check(Schema.isGreaterThan(0))])),
});
export type Escape = typeof escapeSchema.Type;

export const lawEnforcementSchema = Schema.Struct({
  strictness: Schema.Literals(STRICTNESS),
  on: Schema.Array(triggerSchema),
  inspection: Schema.NonEmptyString.annotate({
    description: 'The key of the inspection in `tagma.config.ts`: the version a judgement reads describes what it judges.',
  }),
  debt: Schema.Array(countedDebtSchema),
  escaped: Schema.Array(escapeSchema),
});
export type LawEnforcement = typeof lawEnforcementSchema.Type;
