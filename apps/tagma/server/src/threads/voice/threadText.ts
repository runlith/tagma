import type { HarnessField } from '../contract/wire/harness/observation.js';
import type { HarnessRowDetail } from '../contract/wire/harness/externalSession.js';
import type { EvidenceAnswer, ExpandedRecord, ThreadFacts, ThreadJournalEntry, ThreadShape } from '../contract/wire/evidence.js';
import type { ConversationWindow } from '../contract/wire/conversation.js';
import { limitTokens, occupiedTokens } from '@runlith/agent/thread/compaction/limit';
import type { SearchAnswer } from '../contract/wire/operations/search.js';

type ThreadFailureView = {
  readonly provider: string | null;
  readonly stage: string;
  readonly type: string;
  readonly httpStatus?: number;
  readonly retryable: boolean | null;
  readonly modelStarted: boolean | null;
  readonly detail?: string;
  readonly record: { readonly threadId: string; readonly runId: string; readonly entryId: string };
};

function conciseThreadFailure(reason: string | null, failure: ThreadFailureView | null): string {
  if (!failure) return reason ?? 'failure details unavailable';
  const detail = reason ?? failure.detail;
  return [
    `${failure.type} at ${failure.stage}`,
    `provider ${failure.provider ?? 'unknown'}`,
    ...(failure.httpStatus === undefined ? [] : [`HTTP ${failure.httpStatus}`]),
    failure.retryable === null ? 'retryability unknown' : failure.retryable ? 'retryable' : 'not retryable',
    failure.modelStarted === null
      ? 'model execution start unknown'
      : failure.modelStarted
        ? 'model execution started'
        : 'model execution never started',
    ...(detail ? [detail] : []),
    `record ${failure.record.threadId}/${failure.record.runId}/${failure.record.entryId}`,
  ].join('; ');
}

export function threadLine(row: {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly model: string | null;
  readonly updatedAt: string;
  readonly outcome?: { readonly status: string; readonly failureReason: string | null; readonly failure: ThreadFailureView | null } | null;
}): string {
  const failure = row.outcome?.status === 'failed' ? ` · ${conciseThreadFailure(row.outcome.failureReason, row.outcome.failure)}` : '';
  return `${row.id} [${row.status}] ${row.title} · ${row.model ?? '—'} · ${row.updatedAt}${failure}`;
}

export function threadFactsLine(row: ThreadFacts): string {
  const set = `${row.thread.provider}/${row.thread.model ?? '—'}`;
  const ran = row.run === null ? '' : ` · ran ${row.run.provider ?? '—'}/${row.run.model ?? '—'}`;
  const under = row.parentThreadId === null ? '' : ` · under ${row.parentThreadId}`;
  const named = row.name === null ? '' : ` (${row.name})`;
  const ended = row.outcome === null ? row.status : row.outcome.status;
  const archived = row.archivedAt === null ? '' : ' · archived';
  const failure = row.outcome?.status === 'failed' ? ` · ${row.outcome.failureReason ?? 'failure details unavailable'}` : '';
  const harness = row.harness === null ? '' : ` · ${harnessFactsLine(row.harness)}`;
  const recap = row.recap === undefined ? '' : `\n  recap (${row.recap.status}): ${row.recap.summary}`;
  return `${row.id} [${ended}] ${row.title}${named} · ${row.agentId}${under} · set ${set}${ran} · ${row.updatedAt}${archived}${failure}${harness}${recap}`;
}

function recapLines(recap: ThreadShape['recap']): readonly string[] {
  if (recap === undefined) return [];
  return [
    `recap (${recap.status}, written ${recap.basis.generatedAt} through position ${recap.basis.position}): ${recap.summary}`,
    ...(recap.next === null ? [] : [`next: ${recap.next}`]),
  ];
}

export function conversationHitsText(answer: SearchAnswer): string {
  const lines = answer.matches.map((hit) => {
    const where = hit.project === null ? 'no project' : `${hit.project.name} (${hit.project.id})`;
    const named = hit.name === null ? hit.title : `${hit.title} (${hit.name})`;
    const match = hit.match;
    return [
      `${hit.threadId} · ${named} · ${where}${hit.parentId === null ? '' : ` · under ${hit.parentId}`}${hit.archived ? ' · archived' : ''}`,
      `  ${match.occurredAt} ${match.role} · position ${match.position} · ${match.entryId}${match.runId === null ? '' : ` · run ${match.runId}`}`,
      `  ${spanned(match.snippet, match.highlights)}`,
      `  read_thread_record(threadId="${hit.threadId}", at=[{ at: "${match.entryId}" }], conversation=true, around=3${hit.project === null ? '' : `, project="${hit.project.id}"`})`,
    ].join('\n');
  });
  const total =
    answer.total !== null
      ? `${answer.total} match${answer.total === 1 ? '' : 'es'}`
      : `at least ${answer.atLeast ?? answer.matches.length} — ${answer.totalCut === 'short-terms' ? 'a short word is not counted ahead; the last page answers the total' : 'counting stopped at its time limit'}`;
  const coverage = answer.coverage.complete
    ? 'coverage complete'
    : `coverage incomplete: ${answer.coverage.unindexed} thread${answer.coverage.unindexed === 1 ? '' : 's'} of this scope are not indexed, so no match there is not an absence`;
  return [
    lines.length === 0 ? 'no message matches these words' : lines.join('\n'),
    ...(answer.approximate === true ? ['approximate: no message holds these words as written; these hold their nearest spellings'] : []),
    `${total} · ${coverage}`,
    ...(answer.excluded === null ? [] : [`your own thread ${answer.excluded} is left out; name it as threadId to search it`]),
    ...(answer.cut === null ? [] : ['this page stopped at the matches it may look past; the cursor continues']),
    ...(answer.cursor === null ? [] : [`more · search_threads(cursor="${answer.cursor}") with the same query and scope`]),
  ].join('\n');
}

function spanned(text: string, highlights: readonly { readonly start: number; readonly end: number }[]): string {
  let shown = '';
  let at = 0;
  for (const span of highlights) {
    if (span.start < at) continue;
    shown += `${text.slice(at, span.start)}«${text.slice(span.start, span.end)}»`;
    at = span.end;
  }
  return (shown + text.slice(at)).replaceAll('\n', ' ');
}

export function conversationWindowsText(windows: readonly ConversationWindow[]): string {
  return windows
    .map((window) => {
      if ('missing' in window) return `${window.threadId} @${window.at} — ${window.missing}`;
      return [
        `${window.threadId} around ${window.at}:`,
        ...window.messages.map((said) => {
          const anchor = said.entryId === window.at || said.at === window.at ? '▶' : ' ';
          return `${anchor} ${said.occurredAt} ${said.role} · at ${said.at} · ${said.entryId}\n    ${said.text.replaceAll('\n', '\n    ')}`;
        }),
      ].join('\n');
    })
    .join('\n');
}

function harnessFactsLine(harness: HarnessRowDetail): string {
  const model = harness.observation.metadata.model;
  const effort = harness.observation.metadata.effort;
  const diagnosed = harness.observation.diagnostics.at(-1);
  return [
    `harness ${harness.name}`,
    `model ${fieldWords(model)}`,
    `effort ${fieldWords(effort)}`,
    ...(diagnosed === undefined ? [] : [`refused ${diagnosed.cause}`]),
  ].join(' · ');
}

function fieldWords(field: HarnessField): string {
  switch (field._tag) {
    case 'NotRead':
      return 'unread';
    case 'Value':
      return `${field.value} (${field.source}, ${field.claim})`;
    case 'Absent':
      return 'unset';
    case 'Unsupported':
      return 'unsupported';
    case 'Unreadable': {
      const last = field.lastKnown === null ? '' : `, last known ${field.lastKnown.value}`;
      return `unreadable: ${field.reason}${last}`;
    }
    case 'Stale': {
      const last = field.lastKnown;
      const from = last.source === null ? '' : ` from ${last.source}`;
      return `last known ${last.value}${from} (${last.why})`;
    }
  }
}

function harnessShapeLines(harness: HarnessRowDetail | null): readonly string[] {
  if (harness === null) return [];
  const process =
    harness.process === null
      ? 'process: never opened'
      : `process: ${harness.process.state} since ${harness.process.startedAt}${
          harness.process.origin === 'adopted'
            ? ` · adopted in terminal ${harness.execution === null ? 'unknown' : `${harness.execution.execution}/${harness.execution.incarnation}`}`
            : ''
        }`;
  const lines = [
    `harness: ${harness.name} · ${process}`,
    ...(harness.asked === null
      ? []
      : [`asked: ${harness.asked.model}${harness.asked.reasoning === null ? '' : ` at ${harness.asked.reasoning}`}`]),
    `model: ${fieldWords(harness.observation.metadata.model)}`,
    `effort: ${fieldWords(harness.observation.metadata.effort)}`,
    `vendor title: ${fieldWords(harness.observation.metadata.title)}`,
  ];
  for (const diagnostic of harness.observation.diagnostics) {
    lines.push(`refused ${diagnostic.cause} at ${diagnostic.at}: ${diagnostic.detail}`);
  }
  return lines;
}

export function evidenceText(answer: EvidenceAnswer): string {
  const over = `${answer.over} thread${answer.over === 1 ? '' : 's'}`;
  const lines = [`${answer.select} over ${over} · ${answer.coverage.read} facts read`];
  if (answer.groups !== undefined) {
    lines.push(`groups: ${answer.groups.length}`);
    for (const group of answer.groups) {
      const keyed = Object.entries(group.by).map(([path, value]) => `${path}=${groupKeyText(value)}`);
      const missing = (group.absent ?? []).map((path) => `${path}=(absent)`);
      const by = [...keyed, ...missing].join(' ');
      const counted = group.count === undefined ? '' : ` · ${group.count}`;
      const summed = Object.entries(group.sum ?? {})
        .map(([path, total]) => ` · ${path} ${total}`)
        .join('');
      const unknown = Object.entries(group.unknown ?? {})
        .map(([path, count]) => ` · ${path} unknown ${count}`)
        .join('');
      lines.push(`  ${by || '(all)'}${counted}${summed}${unknown}`);
    }
  } else {
    for (const row of answer.rows) lines.push(`  ${evidenceRowLine(row)}`);
  }
  if (answer.coverage.unavailable.length > 0) {
    lines.push(
      `unavailable: ${answer.coverage.unavailable.length} — named here but no longer readable, not an absence of facts`,
      ...answer.coverage.unavailable.map((named) => `  ${named}`),
    );
  }
  if (answer.coverage.cut === 'read-ceiling') {
    lines.push(
      `cut at the read ceiling after ${answer.coverage.read} facts — this covers what was examined, not the population; ${answer.cursor === null ? 'narrow the selection (fewer threads, a tighter where, a time range)' : 'continue from the cursor, or narrow the selection'}`,
    );
  }
  if (answer.cursor !== null) lines.push(`more · cursor ${answer.cursor}`);
  return lines.join('\n');
}

function evidenceRowLine(row: Readonly<Record<string, unknown>>): string {
  return Object.entries(row)
    .map(([path, value]) => `${path}=${value === null || value === undefined ? '—' : compact(value)}`)
    .join(' ');
}

function groupKeyText(value: unknown): string {
  const json = JSON.stringify(value) ?? 'undefined';
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

function compact(value: unknown): string {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value) ?? '—';
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

export function expandedText(expanded: readonly ExpandedRecord[]): string {
  return expanded
    .map((held) => {
      if ('missing' in held) return `${held.threadId} @${held.at} — ${held.missing}`;
      if ('unread' in held) return `${held.threadId} @${held.at} — ${held.unread}`;
      if ('output' in held) {
        const { text, from, bytes, next } = held.output;
        const end = next ?? bytes;
        const more = next === null ? 'the end of the output' : `continue with outputFrom ${next}`;
        const subject = String(held.at).startsWith('activity:') ? 'activity body' : 'tool output';
        return `${held.threadId} @${held.at} ${subject}, bytes ${from}–${end} of ${bytes}: ${more}\n${text}`;
      }
      if ('fact' in held) {
        return `${held.threadId} @${held.at} ${String(held.fact.kind ?? 'fact')}\n${JSON.stringify(held.fact, null, 2)}`;
      }
      const record = held.record;
      return `${held.threadId} #${record.at} ${record.kind} [${record.origin}] · ${record.id}\n${JSON.stringify(record, null, 2)}`;
    })
    .join('\n');
}

export function threadShapeText(shape: ThreadShape): string {
  const thread = shape.thread;
  const scope = thread.scope === null ? '' : ` · scope ${thread.scope}`;
  const lines = [
    `${thread.id} [${thread.status}] ${thread.title}${scope}`,
    `${thread.provider}/${thread.model ?? '—'}${thread.reasoning ? ` ${thread.reasoning}` : ''} · created ${thread.createdAt} · updated ${thread.updatedAt}`,
    `log: ${shape.entries} records · prompt: ${thread.systemPrompt === null ? 'none' : `${thread.systemPrompt.length} chars`}`,
    contextLine(thread.contextReading, thread.contextLimit),
    warmthLine(thread.cacheWarmth),
    ...recapLines(shape.recap),
    ...harnessShapeLines(thread.harness),
    `runs: ${shape.runs.length}`,
    ...shape.runs.flatMap((run) => {
      const spent = run.usage === null ? '' : ` · ${usageLine(run.usage)}`;
      const ended = run.finishedAt ?? 'running';
      const failure = run.status === 'failed' ? ` · ${conciseThreadFailure(run.failureReason, run.failure)}` : '';
      const reading = [`  ${run.id} ${run.status} ${run.startedAt} → ${ended}${spent}${failure}`];
      const notification = run.notification;
      if (notification !== null) {
        reading.push(
          `    notification: ${notification.state} · reclaims ${notification.reclaims}/${notification.maxReclaims} (initial publication excluded)`,
        );
        const attempt = notification.attempt;
        if (attempt === null) reading.push('    notification evidence: unavailable');
        else {
          reading.push(
            `    phase: ${attempt.phase}${attempt.subscriber === null ? '' : ` · ${attempt.subscriber}`} · started ${attempt.startedAt} · ${attempt.finishedAt ?? `claim expires ${notification.claimExpiresAt}`}`,
          );
          for (const [label, failed] of [
            ['last failure', attempt.lastFailure],
            ['diagnostic recording failure', attempt.observationFailure],
          ] as const) {
            if (failed === null) continue;
            reading.push(`    ${label}: ${failed.phase}${failed.subscriber === null ? '' : ` · ${failed.subscriber}`} · ${failed.at}`);
            for (const cause of failed.cause) {
              reading.push(
                `      ${cause.kind}${cause.tag === null ? '' : ` ${cause.tag}`}${cause.port === null ? '' : ` (${cause.port})`}: ${cause.message}`,
              );
              if (cause.detail !== cause.message) reading.push(`      ${cause.detail.replaceAll('\n', '\n      ')}`);
            }
          }
        }
      }
      return reading;
    }),
  ];
  const acts = shape.acts;
  lines.push(
    acts.name === null
      ? 'acts: none — this thread never wrote to the graph'
      : `acts: ${acts.entries}${acts.bounded ? '+' : ''} by session ${acts.name} over ${acts.blocks.length} blocks${acts.blocks.length > 0 ? `: ${acts.blocks.join(' ')}` : ''}`,
  );
  return lines.join('\n');
}

export function contextLine(reading: ThreadShape['thread']['contextReading'], limit: ThreadShape['thread']['contextLimit']): string {
  if (reading === null) return 'context: unmeasured';
  const used = occupiedTokens(reading.usage) ?? 0;
  const stale = reading.stale ? ` · stale — ${reading.staleBy === 'rewind' ? 'rewound' : 'compacted'} since` : '';
  return `context: ${used}${limitPhrase(used, limit)} tokens · step ${reading.stepNumber} of run ${reading.runId}${stale}`;
}

function limitPhrase(used: number, limit: ThreadShape['thread']['contextLimit']): string {
  if (limit === null) return '';
  const share = `${Math.round((used / limitTokens(limit)) * 100)}%`;
  if (limit.compaction === null) return ` of ${limit.window} (${share}) · no automatic compaction`;
  return ` of ${limit.compaction.at} before automatic compaction (${share}) · window ${limit.window}`;
}

export function warmthLine(warmth: ThreadShape['thread']['cacheWarmth']): string {
  if (warmth === null) return 'warmth: not asked — a run stands, or nothing was measured';
  if (warmth.invalidatedBy !== null) return `warmth: ${warmth.state} · prefix invalidated by ${warmth.invalidatedBy}`;
  if (warmth.basis === 'promise' && warmth.expiresAt !== null) {
    const left = Math.round((Date.parse(warmth.expiresAt) - Date.now()) / 60_000);
    return `warmth: ${warmth.state} · ${left >= 0 ? `expires in ${left}m` : `expired ${-left}m ago`} · promised`;
  }
  if (warmth.basis === 'local' || warmth.basis === 'prior') {
    const share = warmth.warmShare === null ? '—' : `${Math.round(warmth.warmShare * 100)}%`;
    return `warmth: ${warmth.state} · ${share} warm of ${warmth.sample ?? 0} · ${warmth.basis === 'local' ? 'your data' : 'prior'}`;
  }
  return `warmth: ${warmth.state} · no figure`;
}

function usageLine(usage: NonNullable<ThreadJournalEntry['usage']>): string {
  const caches = [
    usage.cacheReadInputTokens === undefined ? '' : `cache read ${usage.cacheReadInputTokens}`,
    usage.cacheWriteInputTokens === undefined ? '' : `cache write ${usage.cacheWriteInputTokens}`,
  ].filter((part) => part.length > 0);
  const cached = caches.length > 0 ? ` (${caches.join(' · ')})` : '';
  return `usage: in ${usage.inputTokens ?? 0}${cached} · out ${usage.outputTokens ?? 0}`;
}

export function tokensLabel(tokens: number, approximate: boolean): string {
  const mark = approximate ? '~' : '';
  return tokens >= 1000 ? `${mark}${(tokens / 1000).toFixed(1)}k tok` : `${mark}${tokens} tok`;
}
