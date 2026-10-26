import { Schema } from 'effect';
import { DEFAULT_COMPACTION_TRIGGER } from '@runlith/llm/models/description';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { nativeKey, nativeListKey } from './settings.js';

const COMPACTION_TRIGGER = {
  minimum: 0.05,
  maximum: 1,
} as const;

const COMPACTION_STRATEGIES = ['percent', 'reserve-output'] as const;
export type CompactionStrategySetting = (typeof COMPACTION_STRATEGIES)[number];

export const compactionStrategy = nativeKey({
  id: 'agent.compactionStrategy',
  order: 600,
  title: 'How the compaction trigger is read',
  description:
    "How the trigger below is read. `percent` holds a share of the model's window; `reserve-output` holds the window less everything the request could spend on output, which compacts far earlier on any row whose output ceiling is a large share of that window.",
  schema: Schema.Literals(COMPACTION_STRATEGIES),
  control: {
    kind: 'choice',
    choices: [
      {
        value: 'percent',
        label: 'Percent of window',
        hint: 'The share below, of whatever window the row has. A share means the same thing on every model.',
      },
      {
        value: 'reserve-output',
        label: 'Reserve output',
        hint: 'The window less the output reservation. On a row serving 128k of output under a 262k window this compacts at half the context.',
      },
    ],
  },
  fallback: 'percent' as CompactionStrategySetting,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const compactionTrigger = nativeKey({
  id: 'agent.compactionTrigger',
  order: 610,
  title: 'When a thread is compacted',
  description:
    "The share of a model's window a thread may hold before it is compacted. Read when the strategy above is `percent`; the tenth left at the shipped default holds one long answer plus the estimator's own error, and the provider's refusal remains the backstop beneath it. Lowering it on a live thread compacts sooner and discards a warm prefix.",
  schema: Schema.Number.check(Schema.isBetween({ minimum: COMPACTION_TRIGGER.minimum, maximum: COMPACTION_TRIGGER.maximum })),
  control: { kind: 'share', minimum: COMPACTION_TRIGGER.minimum, maximum: COMPACTION_TRIGGER.maximum },
  fallback: DEFAULT_COMPACTION_TRIGGER.trigger,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const CompactionPair = {
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
};
const COMPACTION_SHARE = Schema.Number.check(
  Schema.isBetween({ minimum: COMPACTION_TRIGGER.minimum, maximum: COMPACTION_TRIGGER.maximum }),
);
export const CompactionOverride = Schema.Union([
  Schema.Struct({ ...CompactionPair, strategy: Schema.Literal('percent'), trigger: COMPACTION_SHARE }),
  Schema.Struct({ ...CompactionPair, strategy: Schema.Literal('reserve-output') }),
]);
export type CompactionOverride = typeof CompactionOverride.Type;

export const compactionOverrides = nativeListKey({
  id: 'agent.compactionOverrides',
  order: 620,
  title: 'Per-model compaction triggers',
  description:
    'Each entry names a provider and a model whose thread compacts on its own trigger, over the two above. The last entry naming a pair is the one that answers for it.',
  member: CompactionOverride,
  control: {
    kind: 'rows',
    merging: true,
    fields: [
      { kind: 'model', path: ['provider', 'model'], label: 'Model' },
      {
        kind: 'choice',
        path: ['strategy'],
        label: 'Reads',
        choices: [
          { value: 'percent', label: 'Percent', hint: 'A share of this model’s window.' },
          {
            value: 'reserve-output',
            label: 'Reserve output',
            hint: 'This model’s window less its output reservation, as every thread read before the trigger existed.',
          },
        ],
      },
      {
        kind: 'share',
        path: ['trigger'],
        label: 'Compacts at',
        minimum: COMPACTION_TRIGGER.minimum,
        maximum: COMPACTION_TRIGGER.maximum,
        when: { path: ['strategy'], equals: 'percent' },
      },
    ],
  },
  fallback: [] as readonly CompactionOverride[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const SUMMARIZER_RULES = ['never', 'when-cold', 'always'] as const;
export type SummarizerRule = (typeof SUMMARIZER_RULES)[number];

export const compactionSummarizerRule = nativeKey({
  id: 'agent.compactionSummarizerRule',
  order: 630,
  title: 'Who summarizes a compaction you ask for',
  description:
    "Which model writes the summary when a compaction names none. `when-cold` keeps the thread's own model while its prompt cache is warm, where reading the prefix is cheapest, and hands a cold thread to the first model of the list below that can be spent; `always` hands every such compaction to that list; `never` keeps the thread's own model. With the list empty the thread's own model summarizes under every rule. A compaction a run does on its own always keeps the thread's model.",
  schema: Schema.Literals(SUMMARIZER_RULES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'never', label: 'Never', hint: "The thread's own model summarizes every compaction." },
      {
        value: 'when-cold',
        label: 'When the cache is cold',
        hint: "The thread's own model while its cache is warm; the list below once it has cooled.",
      },
      { value: 'always', label: 'Always', hint: 'The list below summarizes every compaction you ask for.' },
    ],
  },
  fallback: 'when-cold' as SummarizerRule,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const CompactionSummarizer = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CompactionSummarizer = typeof CompactionSummarizer.Type;

export const compactionSummarizers = nativeListKey({
  id: 'agent.compactionSummarizers',
  order: 640,
  title: 'Models that summarize instead',
  description:
    'Tried in order when the rule above hands a compaction over: the first whose provider is connected and whose account has quota writes the summary, and a provider failure hands it to the next. With none of them spendable the compaction refuses rather than spend the thread’s own model. The thread keeps its own selection; the summarizer serves one compaction.',
  member: CompactionSummarizer,
  control: { kind: 'rows', fields: [{ kind: 'model', path: ['provider', 'model'], label: 'Model' }] },
  fallback: [] as readonly CompactionSummarizer[],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});
