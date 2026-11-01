import { Clock, Effect } from 'effect';
import { page, pageRows, pastKey, readCursor, type PageKey, type PageQuestion } from '@runlith/paging';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import {
  ownSummarizer,
  type ResolvedSummarizer,
  type ThreadCompactionEstimate,
  type ThreadSummarizerAsk,
  type ThreadSummarizerSelection,
  type ThreadSummarizers,
} from '@runlith/agent/thread/compaction/summarizer';
import type { ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import type { ThreadSummarizerSkip } from '@runlith/agent/transcript/entries';
import { type ModelCatalog, type ModelOption, reasoningForModel } from '@runlith/llm/models/catalog';
import type { CompactionChoice, CompactionChoicesRead, CompactionWarmth, SummarizerRow } from '../contract/wire/compactionChoices.js';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import type { AskChoice, SettableScope } from '../../platform/contract/wire/setting.js';
import { signingAccount, spendability, textModelOf } from '../models/spendability.js';
import { admitSummarizer, foldOf, summarizerSpend, type SummarizedThread, type SummarizerSpend } from './spend.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { QuotaTable } from '../../providers/contract/wire/accounts.js';
import { type ProviderCatalog, ProviderRegistry } from '../../providers/contract/service/registry.js';
import { COMPACTION_CHOICES } from '../contract/wire/pages.js';
import { GateRefusal, cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { type SummarizerRule, compactionSummarizerRule, compactionSummarizers } from '../contract/wire/compactionSettings.js';
import { gateProject } from '../../threads/projectGate.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import type { ThreadSummary } from '../../threads/list/summary.js';
import type { NativeThreadRows } from '../rows/native.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { CacheWarmth, type ThreadEvidence } from '../../threads/contract/service/evidence.js';
import { CompactionChoices } from '../contract/service/compaction.js';
import { cacheWarmthOf } from '../../threads/list/wire.js';

export type SummarizerMember = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly spendability: SummarizerSpend;
};

export function summarizerChain(
  catalog: ProviderCatalog,
  configured: readonly AskChoice[],
  table: QuotaTable,
  now: number,
  thread?: SummarizedThread,
): readonly SummarizerMember[] {
  return configured.map((member) => ({
    provider: member.provider,
    model: member.model,
    reasoning: rungOf(catalog.models, member.provider, member.model, member.reasoning ?? null),
    spendability:
      thread === undefined
        ? spendability(catalog, member.provider, member.model, table, now)
        : summarizerSpend(catalog, thread, member, table, now),
  }));
}

export function summarizersOf(rule: SummarizerRule, chain: readonly SummarizerMember[], warm: boolean, foreign = false): ThreadSummarizers {
  if (!foreign) {
    if (rule === 'never') return { kind: 'own', reason: 'never' };
    if (chain.length === 0) return { kind: 'own', reason: 'unchained' };
    if (rule === 'when-cold' && warm) return { kind: 'own', reason: 'warm' };
  }
  const reason = foreign ? 'foreign' : rule === 'always' ? 'always' : 'cold';
  const members: ResolvedSummarizer[] = [];
  const skipped: ThreadSummarizerSkip[] = [];
  for (const member of chain) {
    const verdict = member.spendability;
    if (verdict.spendable) {
      members.push({ provider: member.provider, model: member.model, reasoning: member.reasoning, account: verdict.account ?? undefined });
    } else {
      skipped.push({
        provider: member.provider,
        model: member.model,
        reason: verdict.reason,
        until: verdict.until === undefined ? undefined : new Date(verdict.until).toISOString(),
      });
    }
  }
  return members.length === 0 ? { kind: 'none', reason, skipped } : { kind: 'chain', reason, members, skipped };
}

function rungOf(models: ModelCatalog, provider: string, model: string, asked: string | null): string | null {
  const option = optionOf(models, provider, model);
  return option === undefined ? asked : reasoningForModel(asked, option) || null;
}

function optionOf(models: ModelCatalog, provider: string, model: string | null): ModelOption | undefined {
  return models.registered(provider) ? textModelOf(models, provider, model ?? models.named(provider).defaultTextModel) : undefined;
}

function summarized(models: ModelCatalog, thread: ThreadSummary): SummarizedThread {
  return {
    provider: thread.provider,
    model: optionOf(models, thread.provider, thread.model)?.id ?? thread.model ?? '',
    account: thread.account,
    compaction: thread.capabilities.compaction,
  };
}

function summarizerRow(
  catalog: ProviderCatalog,
  provider: string,
  model: string,
  reasoning: string | null,
  verdict: SummarizerSpend,
  account: string | null,
): SummarizerRow {
  return {
    provider,
    model,
    label: optionOf(catalog.models, provider, model)?.label ?? model,
    providerLabel: catalog.models.providerLabel(provider),
    reasoning,
    spendable: verdict.spendable,
    skip: verdict.spendable
      ? null
      : { reason: verdict.reason, until: verdict.until === undefined ? null : new Date(verdict.until).toISOString() },
    pays: { provider: catalog.accountSource(provider), account },
  };
}

function isWarm(warmth: CompactionWarmth): boolean {
  return warmth.state === 'running' || warmth.state === 'warm' || warmth.state === 'likely';
}

type Settled = {
  readonly thread: ThreadSummary;
  readonly rule: SummarizerRule;
  readonly configured: readonly AskChoice[];
};

type Standing = {
  readonly catalog: ProviderCatalog;
  readonly thread: ThreadSummary;
  readonly rule: SummarizerRule;
  readonly warmth: CompactionWarmth;
  readonly chain: readonly SummarizerMember[];
  readonly table: QuotaTable;
  readonly now: number;
  readonly answer: ThreadSummarizers;
};

export type ChoiceReader = Effect.Success<ReturnType<typeof makeChoiceReader>>;

export const makeChoiceReader = Effect.fnUntraced(function* ({ rows }: { readonly rows: NativeThreadRows }) {
  const warmth = yield* CacheWarmth;
  const threads = yield* ThreadLookup;
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const quota = yield* AccountQuota;
  const registry = yield* ProviderRegistry;

  const settled = Effect.fnUntraced(function* (threadId: string): Effect.fn.Return<Settled, HarnessFailure> {
    const thread = yield* threads.summary(threadId);
    if (thread === undefined || thread.ownerId !== OPERATOR_PRINCIPAL) return yield* Effect.fail(new ThreadNotFoundError(threadId));
    const rule = yield* settings.value(compactionSummarizerRule, thread.projectId);
    const configured = yield* settings.value(compactionSummarizers, thread.projectId);
    return { thread, rule, configured };
  });

  const standing = Effect.fnUntraced(function* (
    { thread, rule, configured }: Settled,
    running: boolean | null,
    runId?: string,
    foreign = thread.capabilities.compaction === 'foreign',
  ): Effect.fn.Return<Standing, HarnessFailure> {
    const table = yield* quota.table();
    const now = yield* Clock.currentTimeMillis;
    const catalog = runId === undefined ? yield* registry.catalog : registry.forRun(runId);
    const warm: CompactionWarmth =
      (running ?? thread.activeRun !== null)
        ? { state: 'running', invalidatedBy: null }
        : yield* Effect.map(warmth.warmthBasis([thread]), (basis) => {
            const verdict = cacheWarmthOf(thread, false, basis);
            return { state: verdict?.state ?? 'unknown', invalidatedBy: verdict?.invalidatedBy ?? null };
          });
    const subject = summarized(catalog.models, thread);
    const chain = summarizerChain(catalog, configured, table, now, foreign ? { ...subject, compaction: 'foreign' } : subject);
    return {
      catalog,
      thread,
      rule,
      warmth: warm,
      chain,
      table,
      now,
      answer: summarizersOf(rule, chain, isWarm(warm), foreign),
    };
  });

  return {
    summarizers: Effect.fnUntraced(
      function* (ask: ThreadSummarizerAsk) {
        const chosen = yield* settled(ask.threadId);
        const foreign = ask.foreign === true || chosen.thread.capabilities.compaction === 'foreign';
        if (!foreign && (chosen.rule === 'never' || chosen.configured.length === 0)) return summarizersOf(chosen.rule, [], false);
        return (yield* standing(chosen, ask.running, ask.runId, foreign)).answer;
      },
      Effect.mapError((failure): ThreadNotFoundError | ThreadStorageFailed =>
        failure instanceof ThreadNotFoundError ? failure : new ThreadStorageFailed({ call: 'summarizers', cause: failure }),
      ),
    ),
    read: Effect.fnUntraced(function* (
      evidence: ThreadEvidence['Service'],
      compaction: ThreadCompaction,
      threadId: string,
      projectId: number,
      asked: { readonly limit?: number; readonly cursor?: string },
    ): Effect.fn.Return<CompactionChoicesRead, HarnessFailure> {
      yield* gateProject(records, threadId, projectId);
      const question: PageQuestion = { operation: 'read_compaction_choices', selection: { threadId }, order: COMPACTION_CHOICES.order };
      const at = asked.cursor === undefined ? null : readCursor(asked.cursor, question);
      if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
      const chosen = yield* settled(threadId);
      if (chosen.thread.capabilities.compaction === 'none') {
        return yield* new GateRefusal('harness-contract', 'This thread does not compact its context, so no summarizer is chosen.', [
          'read the thread; its context stands as it is',
        ]);
      }
      if (chosen.thread.capabilities.compaction === 'vendor') {
        return yield* new GateRefusal(
          'harness-contract',
          "The vendor owns this session's compaction and exposes no compaction API; choosing a summarizer would replace the session and lose its warm cache.",
          ['continue the thread; its vendor owns the compaction boundary'],
        );
      }
      const state = yield* standing(chosen, null);
      const { thread, catalog } = state;
      const { models } = catalog;
      const subject = summarized(models, thread);
      const ownModel = subject.model;
      const foreign = thread.capabilities.compaction === 'foreign';
      const offered = state.chain.filter(
        (member) => !foreign || member.provider !== thread.provider || catalog.asks.answers(member.provider, member.model, 'text'),
      );
      const chained = new Set(offered.map((member) => `${member.provider}:${member.model}`));
      const callables = models.modelsByCapability('text').filter((option) => catalog.asks.answers(option.provider, option.id, 'text'));
      const others = callables.flatMap((option, ordinal) =>
        option.key === `${thread.provider}:${ownModel}` || chained.has(option.key) ? [] : [{ option, ordinal }],
      );
      const keyOf = (row: { readonly ordinal: number }): PageKey => [row.ordinal];
      const rest = at === null ? others : pastKey(others, keyOf, ['asc'], at.at);
      const size = pageRows(asked.limit, COMPACTION_CHOICES, ceilingOf(COMPACTION_CHOICES));
      const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf, question, total: others.length });
      const estimable = offered.filter((member) => textModelOf(models, member.provider, member.model) !== undefined);
      const candidates: ResolvedSummarizer[] = [
        ...estimable.map((member) => ({ provider: member.provider, model: member.model, reasoning: member.reasoning })),
        ...cut.rows.map(({ option }) => ({
          provider: option.provider,
          model: option.id,
          reasoning: rungOf(models, option.provider, option.id, null),
        })),
      ];
      const history = (yield* rows.historyOf(threadId)) ?? [];
      const composition = yield* evidence.composition(threadId, projectId);
      const estimates = yield* compaction.estimate({
        threadId,
        ownerId: thread.ownerId,
        account: thread.account,
        provider: thread.provider,
        model: thread.model,
        reasoning: thread.reasoning,
        switches: thread.switches,
        fixedTokens: composition.parts
          .filter((part) => part.id === 'system' || part.id === 'tools')
          .reduce((sum, part) => sum + part.tokens, 0),
        history,
        candidates,
      });
      const chainEstimate = (member: SummarizerMember): ThreadCompactionEstimate | null => {
        const index = estimable.indexOf(member);
        return index < 0 ? null : (estimates.candidates[index] ?? null);
      };
      const choice = (
        provider: string,
        model: string,
        reasoning: string | null,
        estimate: ThreadCompactionEstimate | null,
      ): CompactionChoice => {
        const selection: ThreadSummarizerSelection = { provider, model };
        const isOwn = ownSummarizer(subject, selection);
        const folds = foldOf(subject, selection);
        return {
          ...summarizerRow(
            catalog,
            provider,
            model,
            reasoning,
            summarizerSpend(catalog, subject, selection, state.table, state.now),
            (isOwn ? thread.account : null) ?? signingAccount(catalog, provider, state.table),
          ),
          own: isOwn,
          folds,
          estimate: folds === 'session' ? null : estimate,
        };
      };
      const ownChoice = foreign
        ? null
        : choice(thread.provider, ownModel, rungOf(models, thread.provider, ownModel, thread.reasoning), estimates.own);
      const chain = offered.map((member) => choice(member.provider, member.model, member.reasoning, chainEstimate(member)));
      const answer = state.answer;
      return {
        threadId,
        rule: state.rule,
        warmth: state.warmth,
        resolved: {
          kind: answer.kind,
          reason: answer.reason,
          choice:
            answer.kind === 'own'
              ? ownChoice
              : answer.kind === 'chain'
                ? (chain.find((row) => row.provider === answer.members[0]?.provider && row.model === answer.members[0]?.model) ?? null)
                : null,
          skipped: answer.kind === 'own' ? [] : answer.skipped,
        },
        own: ownChoice,
        chain,
        others: {
          rows: cut.rows.map(({ option }, index) =>
            choice(
              option.provider,
              option.id,
              rungOf(models, option.provider, option.id, null),
              estimates.candidates[estimable.length + index] ?? null,
            ),
          ),
          shown: cut.shown,
          total: others.length,
          next: cut.next,
        },
      };
    }),
    admit: Effect.fnUntraced(function* (
      threadId: string,
      named: ThreadSummarizerSelection,
    ): Effect.fn.Return<ResolvedSummarizer, HarnessFailure> {
      const { thread } = yield* settled(threadId);
      const catalog = yield* registry.catalog;
      const resolved = admitSummarizer(catalog, summarized(catalog.models, thread), named);
      if (resolved === null) {
        return yield* new GateRefusal(
          'unknown-summarizer',
          `${named.provider}/${named.model} cannot summarize this thread: the server does not call it.`,
          ['name a row read_compaction_choices answers'],
        );
      }
      return resolved;
    }),
    chainAt: Effect.fnUntraced(function* (layer: SettableScope, projectId: number | undefined) {
      if (layer === 'project' && projectId === undefined) {
        return yield* new GateRefusal('project-required', 'A project layer is read inside a project.', ['?project=<name|id>']);
      }
      const resolvedIn = layer === 'project' ? projectId : undefined;
      const rule = yield* settings.value(compactionSummarizerRule, resolvedIn);
      const configured = yield* settings.value(compactionSummarizers, resolvedIn);
      const table = yield* quota.table();
      const now = yield* Clock.currentTimeMillis;
      const catalog = yield* registry.catalog;
      return {
        layer,
        rule,
        chain: summarizerChain(catalog, configured, table, now).map((member) =>
          summarizerRow(
            catalog,
            member.provider,
            member.model,
            member.reasoning,
            member.spendability,
            signingAccount(catalog, member.provider, table),
          ),
        ),
      };
    }),
  };
});

export const compactionChoices = (
  reader: ChoiceReader,
  evidence: ThreadEvidence['Service'],
  compaction: ThreadCompaction,
): CompactionChoices['Service'] =>
  CompactionChoices.of({
    summarizers: reader.summarizers,
    read: (threadId, projectId, asked) => reader.read(evidence, compaction, threadId, projectId, asked),
    admit: reader.admit,
    chainAt: reader.chainAt,
  });
