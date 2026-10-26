import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import type { CompactionChoice, CompactionChoicesRead } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import type { ThreadCompactionSummarizer, ThreadSummarizerSkip } from '@runlith/agent/transcript/entries';
import type { ChatStepFact } from '@runlith/chat-ui/activity';

import { providerName, type ServedModels } from '$lib/features/providers/served.js';
import { modelLabel, paysWords, skipWords } from '$lib/features/providers/usage/spendWords.js';
import { choiceKey, type ModelChoice, type ModelFlag, type ModelLead } from '$lib/shared/models/choice.js';

export function tokensWord(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export type CompactionList = {
  readonly choices: readonly ModelChoice[];
  readonly lead: readonly ModelLead[];
  readonly current: string | null;
  readonly rows: ReadonlyMap<string, CompactionChoice>;
};

function catalogOrder(models: ServedModels): (row: CompactionChoice) => number {
  const order = new Map(models.modelsByCapability('text').map((model, index) => [choiceKey(model.provider, model.id), index]));
  return (row) => order.get(choiceKey(row.provider, row.model)) ?? Number.MAX_SAFE_INTEGER;
}

const DEFAULT_NOTE: Record<CompactionChoicesRead['resolved']['reason'], string> = {
  named: 'named',
  never: "rule never → thread's model",
  warm: "cache warm → thread's model",
  unchained: "no chain → thread's model",
  cold: 'cache cold → chain',
  always: 'rule always → chain',
  foreign: 'foreign summarizer required → chain',
};

function warm(read: CompactionChoicesRead): boolean {
  return read.warmth.state === 'warm' || read.warmth.state === 'likely' || read.warmth.state === 'running';
}

function flagsOf(read: CompactionChoicesRead, row: CompactionChoice, now: number): readonly ModelFlag[] {
  const flags: ModelFlag[] = [];
  if (row.own) flags.push({ text: `thread's model · ${warmthWord(read.warmth)}`, tone: warm(read) ? 'good' : 'muted' });
  const passes = row.estimate === null ? undefined : row.estimate.passes;
  if (row.skip !== null) flags.push({ text: skipWords(row.skip.reason, row.skip.until, now), tone: 'bad' });
  else if (passes === null) flags.push({ text: 'does not fit its window', tone: 'bad' });
  else if (!row.own && passes !== undefined && passes > 1) flags.push({ text: `${passes} passes`, tone: 'warn' });
  return flags;
}

export function compactionList(
  models: ServedModels,
  read: CompactionChoicesRead,
  favorites: readonly { readonly provider: string; readonly model: string }[],
  now: number,
): CompactionList {
  const rows = new Map<string, CompactionChoice>();
  for (const row of [read.own, ...read.chain, ...read.others.rows]) {
    if (row === null) continue;
    const key = choiceKey(row.provider, row.model);
    if (!rows.has(key)) rows.set(key, row);
  }
  const orderOf = catalogOrder(models);
  const choices = [...rows.values()]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((row): ModelChoice => {
      const option = models.modelsFor(row.provider, 'text').find((one) => one.id === row.model);
      return {
        provider: row.provider,
        providerLabel: row.providerLabel,
        model: row.model,
        label: row.label,
        short: option?.short ?? '',
        ladder: (option?.reasoningOptions ?? []).map((step) => ({ id: step.id, label: step.label, short: step.short })),
        rung: row.reasoning,
        flags: flagsOf(read, row, now),
        disabled: !row.spendable && row.skip?.reason !== 'quota',
      };
    });
  const chosen = read.resolved.choice;
  const current = chosen === null ? null : choiceKey(chosen.provider, chosen.model);
  return {
    choices,
    rows,
    current,
    lead: [
      ...(current === null ? [] : [{ id: 'default', label: 'Default', note: DEFAULT_NOTE[read.resolved.reason], keys: [current] }]),
      { id: 'favorites', label: 'Favorites', starred: true, keys: favorites.map((pair) => choiceKey(pair.provider, pair.model)) },
      { id: 'chain', label: 'Chain', keys: read.chain.map((row) => choiceKey(row.provider, row.model)) },
    ],
  };
}

export function pickedSummarizer(
  read: CompactionChoicesRead,
  provider: string,
  model: string,
  rung: string | null,
): { readonly named: CompactionChoice | null } | null {
  const key = choiceKey(provider, model);
  const row = [read.own, ...read.chain, ...read.others.rows].find((one) => one !== null && choiceKey(one.provider, one.model) === key);
  if (row === undefined || row === null) return null;
  const chosen = read.resolved.choice;
  const standing = chosen !== null && choiceKey(chosen.provider, chosen.model) === key && rung === row.reasoning;
  return { named: standing ? null : { ...row, reasoning: rung } };
}

export function compactionDetail(
  models: ServedModels,
  read: CompactionChoicesRead,
  row: CompactionChoice,
  accounts: readonly AccountQuotaRow[],
  now: number,
): string {
  if (row.skip !== null) return `${row.label} — ${skipWords(row.skip.reason, row.skip.until, now)}`;
  const pays = `${paysWords(models, row.pays, accounts)} pays`;
  if (row.folds === 'session') return `folds in its own session · ${warmthWord(read.warmth)}`;
  if (row.own) return `sends the whole thread · ${warmthWord(read.warmth)} · ${pays}`;
  const estimate = row.estimate;
  const reads =
    estimate === null
      ? null
      : estimate.passes === null
        ? 'does not fit its window'
        : `≈${tokensWord(estimate.inputTokens)} in · ${estimate.passes === 1 ? '1 pass' : `${estimate.passes} passes`}`;
  return [reads, pays].filter((part): part is string => part !== null).join(' · ');
}

function warmthWord(warmth: CompactionChoicesRead['warmth']): string {
  if (warmth.state === 'running') return 'run going';
  const state = warmth.state === 'likely' ? 'warm' : warmth.state;
  if (warmth.invalidatedBy === 'account') return `cache ${state} · account changed`;
  if (warmth.invalidatedBy === 'selection') return `cache ${state} · model changed`;
  return `cache ${state}`;
}

function skippedLabel(models: ServedModels, read: CompactionChoicesRead, skip: ThreadSummarizerSkip): string {
  return (
    read.chain.find((row) => row.provider === skip.provider && row.model === skip.model)?.label ??
    modelLabel(models, skip.provider, skip.model)
  );
}

export function resolvedWords(models: ServedModels, read: CompactionChoicesRead, now: number): string {
  const choice = read.resolved.choice;
  if (read.resolved.kind === 'none' || choice === null) return 'no summarizer';
  const skipped = read.resolved.skipped[0];
  return [
    choice.label,
    choice.own ? "thread's model" : null,
    warmthWord(read.warmth),
    skipped === undefined ? null : `${skippedLabel(models, read, skipped)} ${skipWords(skipped.reason, skipped.until, now)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export function summarizerTitle(models: ServedModels, entry: { compactionSummarizer?: ThreadCompactionSummarizer }): string | undefined {
  const summarizer = entry.compactionSummarizer;
  return summarizer === undefined ? undefined : modelLabel(models, summarizer.provider, summarizer.model);
}

export function summarizerFacts(
  models: ServedModels,
  entry: { compactionSummarizer?: ThreadCompactionSummarizer; compactionUnsummarized?: { skipped: readonly ThreadSummarizerSkip[] } },
  now: number,
): readonly ChatStepFact[] {
  const skipped = (list: readonly ThreadSummarizerSkip[]): ChatStepFact[] =>
    list.map((skip) => ({
      label: 'skipped',
      value: `${modelLabel(models, skip.provider, skip.model)}: ${skipWords(skip.reason, skip.until, now)}`,
    }));
  const unsummarized = entry.compactionUnsummarized;
  if (unsummarized !== undefined) return [{ label: 'no summarizer' }, ...skipped(unsummarized.skipped)];
  const summarizer = entry.compactionSummarizer;
  if (summarizer === undefined) return [];
  return [
    ...(summarizer.own ? [{ label: "thread's model", quiet: true as const }] : []),
    { label: 'quota', value: providerName(models, summarizer.provider), quiet: true },
    ...(summarizer.passes !== undefined && summarizer.passes > 1
      ? [{ label: 'passes', value: String(summarizer.passes), quiet: true as const }]
      : []),
    ...skipped(summarizer.skipped),
  ];
}
