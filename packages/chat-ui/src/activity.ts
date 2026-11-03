import type { AgentRuntimeGuidance } from '@runlith/agent/contracts';
import { type ToolDisplay, toolDisplayOpensByDefault } from '@runlith/agent/tool/display';
import {
  toolFailed as producerToolFailed,
  toolReceipt,
  toolStanding,
  toolSettled as producerToolSettled,
} from '@runlith/agent/transcript/entries';
import { KEEP_WARM_SIGNAL_TYPE } from '@runlith/agent/transcript/keepWarm';
import { elapsedDuration } from './chatTime';
import type { ChatLiveStatus } from './liveStatus';
import { type NoticeEntry, noticeEntry, sameNotice } from './notices';
import type { ChatEntry } from './entries';
import type { EntryKinds } from './EntryKinds.svelte';
import type { ChatActivityIdentity } from './renderers';
import type { ChatStrings } from './strings';

const ACTIVITY_KINDS = ['tool', 'reasoning', 'signal', 'runtime-guidance', 'compaction', 'retry'] as const;

export type ActivityEntry = Extract<ChatEntry, { kind: (typeof ACTIVITY_KINDS)[number] }>;

export function isActivityEntry(entry: ChatEntry): entry is ActivityEntry {
  return ACTIVITY_KINDS.some((kind) => entry.kind === kind);
}
export type ToolActivityEntry = Extract<ChatEntry, { kind: 'tool' }>;
export type CompactionActivityEntry = Extract<ChatEntry, { kind: 'compaction' }>;

export type ActivityGroup = {
  id: string;
  key: string;
  entries: readonly ActivityEntry[];
};

export function activityKey(firstStepId: string): string {
  return `activity:${firstStepId}`;
}

export type RailPlace = 'only' | 'first' | 'middle' | 'last';

export function activityThoughtsOnly(rows: readonly ActivityRow[]): boolean {
  return rows.length === 1 && rows[0]?.kind === 'thoughts';
}

export function railPlace(index: number, count: number): RailPlace {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

export function firstLabelLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0);
  return line ? plainLine(line) : '';
}

function plainLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:>\s*)+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

export type ActivityRow =
  | { kind: 'step'; key: string; entry: ActivityEntry }
  | { kind: 'folded'; key: string; entries: readonly ToolActivityEntry[] }
  | { kind: 'thoughts'; key: string; entries: readonly ActivityEntry[] }
  | { kind: 'notices'; key: string; entries: readonly NoticeEntry[] };

export function chatThoughtLabel(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('**') || !trimmed.endsWith('**') || trimmed.length <= 4) return null;
  const inner = trimmed.slice(2, -2).trim();
  return inner.length > 0 && !inner.includes('**') ? inner : null;
}

function labelThought(entry: ActivityEntry): boolean {
  if (entry.kind !== 'reasoning' || entry.reasoningState === 'streaming') return false;
  return chatThoughtLabel(entry.text) !== null;
}

export const FOLD_RUN_MIN = 3;

function foldable(entry: ActivityEntry): entry is ToolActivityEntry {
  if (entry.kind !== 'tool') return false;
  if (
    !toolSettled(entry) ||
    toolFailed(entry) ||
    toolOperationRefused(entry) ||
    toolOutcomeUnknown(entry) ||
    toolCancelled(entry) ||
    toolInterrupted(entry) ||
    toolReceipt(entry)
  )
    return false;
  const display = entry.display;
  if (!display || display.mutates) return false;
  return display.form !== 'diff' && display.form !== 'message' && display.form !== 'binary';
}

export type ActivityFolding = {
  readonly keepsAlive?: (entry: ActivityEntry) => boolean;
  readonly growing?: boolean;
};

export function activityRows(entries: readonly ActivityEntry[], folding: ActivityFolding = {}): readonly ActivityRow[] {
  const { keepsAlive, growing = false } = folding;
  const rows: ActivityRow[] = [];
  let run: ToolActivityEntry[] = [];
  let thoughts: ActivityEntry[] = [];
  let notices: NoticeEntry[] = [];
  const flushNotices = () => {
    if (notices.length > 0) rows.push({ kind: 'notices', key: `notices:${notices[0]?.id}`, entries: notices });
    notices = [];
  };
  const flushRun = () => {
    if (!growing && run.length >= FOLD_RUN_MIN) {
      rows.push({ kind: 'folded', key: `folded:${run[0]?.id}`, entries: run });
    } else {
      for (const entry of run) rows.push({ kind: 'step', key: entry.id, entry });
    }
    run = [];
  };
  const flushThoughts = () => {
    if (!growing && thoughts.length > 1) {
      rows.push({ kind: 'thoughts', key: `thoughts:${thoughts[0]?.id}`, entries: thoughts });
    } else {
      for (const entry of thoughts) rows.push({ kind: 'step', key: entry.id, entry });
    }
    thoughts = [];
  };
  for (const entry of entries) {
    if (noticeEntry(entry)) {
      flushThoughts();
      flushRun();
      if (notices[0] !== undefined && !sameNotice(notices[0].notice, entry.notice)) flushNotices();
      notices.push(entry);
      continue;
    }
    flushNotices();
    if (labelThought(entry)) {
      flushRun();
      thoughts.push(entry);
      continue;
    }
    flushThoughts();
    if (foldable(entry) && keepsAlive?.(entry) !== true) {
      run.push(entry);
      continue;
    }
    flushRun();
    rows.push({ kind: 'step', key: entry.id, entry });
  }
  flushNotices();
  flushRun();
  flushThoughts();
  return rows;
}

export function foldedToolCounts(entries: readonly ToolActivityEntry[]): readonly { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.toolName, (counts.get(entry.toolName) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

export function foldedSubjects(entries: readonly ToolActivityEntry[]): readonly string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const title = entry.display?.title?.trim();
    if (title) seen.add(title);
  }
  return [...seen];
}

export type ChatToolActivity = {
  readonly toolName: string;
  readonly state: 'running' | 'done' | 'unknown';
  readonly title: string | null;
  readonly alone?: boolean;
  readonly verb?: string | null;
  readonly subtitle?: string | null;
};

export type ChatStepJoin = 'phrase' | 'apart';

export type ChatStepLine = {
  readonly lead: string | null;
  readonly subject: string | null;
  readonly join: ChatStepJoin;
  readonly detail?: string | null;
};

type ToolLineWords = Pick<ChatStrings, 'toolDone' | 'toolDoneAlone' | 'toolRunning' | 'toolRunningAlone' | 'toolUnknown'>;

export function chatToolActivityLine(activity: ChatToolActivity, strings: ToolLineWords): ChatStepLine {
  const named = activity.state === 'unknown' ? undefined : activity.verb?.trim();
  const subject = activity.title?.trim() || null;
  return {
    lead: named || (activity.alone && subject !== null ? null : toolLineLead(activity, subject, strings)),
    subject,
    join: 'phrase',
    detail: activity.subtitle?.trim() || undefined,
  };
}

function toolLineLead(activity: ChatToolActivity, subject: string | null, strings: ToolLineWords): string {
  if (activity.state === 'done')
    return (subject === null ? strings.toolDoneAlone(activity.toolName) : null) ?? strings.toolDone(activity.toolName);
  if (activity.state === 'unknown') return strings.toolUnknown(activity.toolName);
  if (subject !== null) return strings.toolRunning(activity.toolName);
  return strings.toolRunningAlone(activity.toolName) ?? strings.toolRunning(activity.toolName);
}

export const CALL_CLOCK_MIN_MS = 5_000;

export type RunningWork = {
  readonly label: string | null;
  readonly elapsedMs: number | null;
  readonly more: number;
  readonly queued: number;
};

export function runningWorkText(work: RunningWork, strings: Pick<ChatStrings, 'queuedCalls'>): string {
  const parts: string[] = [];
  if (work.label !== null) parts.push(work.label);
  if (work.elapsedMs !== null) parts.push(elapsedDuration(work.elapsedMs));
  if (work.more > 0) parts.push(`+${work.more}`);
  if (work.queued > 0) parts.push(strings.queuedCalls(work.queued));
  return parts.join(' · ');
}

export function chatGuidanceLine(guidance: AgentRuntimeGuidance, strings: Pick<ChatStrings, 'guidance' | 'guidanceAt'>): ChatStepLine {
  const where = new Set(guidance.sources.map((source) => strings.guidanceAt(source.hook, source.toolName ?? null)));
  return { lead: strings.guidance(), subject: where.size > 0 ? [...where].join(', ') : null, join: 'apart' };
}

export type ChatStepFact = { readonly label: string; readonly value?: string; readonly quiet?: true };

export function shownFacts(facts: readonly ChatStepFact[], verbose: boolean): readonly ChatStepFact[] {
  return verbose ? facts : facts.filter((fact) => fact.quiet !== true);
}

export function displayDraws(display: ToolDisplay | undefined): display is ToolDisplay {
  if (display === undefined) return false;
  switch (display.form) {
    case 'none':
    case 'binary':
      return false;
    case 'command':
      return true;
    case 'list':
      return display.items.length > 0;
    case 'diff':
      return display.files.some((file) => file.patch !== '');
    default:
      return display.text !== '';
  }
}

export function readableOutput(entry: ToolActivityEntry, text: (toolName: string, output: unknown) => string | null): string | null {
  if (entry.toolState !== 'output-available' || (entry.display !== undefined && entry.display.form !== 'none')) return null;
  return text(entry.toolName, entry.toolOutput)?.trim() || null;
}

export function messagePreview(entry: ToolActivityEntry): string | null {
  return entry.display?.form === 'message' ? firstLabelLine(entry.display.text) || null : null;
}

export function chatCompactionLabel(
  entry: CompactionActivityEntry,
  strings: Pick<ChatStrings, 'compacted' | 'compacting'>,
  summarizer: string | null,
): string {
  return entry.compactionStatus === 'running' ? strings.compacting(summarizer) : strings.compacted(summarizer);
}

export function chatCompactionFacts(
  entry: CompactionActivityEntry,
  strings: Pick<ChatStrings, 'alreadyCompact' | 'auto' | 'budget' | 'failed' | 'manual' | 'measured' | 'projected' | 'stopped'>,
): readonly ChatStepFact[] {
  const facts: ChatStepFact[] = [{ label: entry.mode === 'automatic' ? strings.auto() : strings.manual(), quiet: true }];
  const receipt = entry.compactionReceipt;
  if (receipt?.measuredTokens !== undefined) {
    facts.push({ label: strings.measured(), value: thousandTokens(receipt.measuredTokens), quiet: true });
  } else if (receipt?.projectedTokens !== undefined) {
    facts.push({ label: strings.projected(), value: thousandTokens(receipt.projectedTokens), quiet: true });
  }
  if (receipt?.usableTokens !== undefined) {
    facts.push({ label: strings.budget(), value: thousandTokens(receipt.usableTokens), quiet: true });
  }
  const ending = compactionEnding(entry.compactionStatus, strings);
  if (ending) facts.push({ label: ending });
  return facts;
}

function compactionEnding(
  status: CompactionActivityEntry['compactionStatus'],
  strings: Pick<ChatStrings, 'alreadyCompact' | 'failed' | 'stopped'>,
): string | null {
  if (status === 'unchanged') return strings.alreadyCompact();
  if (status === 'aborted') return strings.stopped();
  if (status === 'failed') return strings.failed();
  return null;
}

function thousandTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}K`;
}

export function chatKeepWarmFacts(
  entry: Extract<ChatEntry, { kind: 'signal' }>,
  strings: Pick<ChatStrings, 'cacheRead' | 'cacheWritten' | 'failed' | 'interrupted' | 'stopped'>,
): readonly ChatStepFact[] {
  const kept = entry.keptWarm;
  if (kept === undefined) return [];
  const read = kept.usage?.cacheReadInputTokens;
  const written = kept.usage?.cacheWriteInputTokens;
  return [
    ...(read === undefined ? [] : [{ label: strings.cacheRead(), value: thousandTokens(read) }]),
    ...(written === undefined || written === 0 ? [] : [{ label: strings.cacheWritten(), value: thousandTokens(written) }]),
    ...(kept.status === 'completed'
      ? []
      : [{ label: kept.status === 'failed' ? strings.failed() : kept.status === 'aborted' ? strings.stopped() : strings.interrupted() }]),
  ];
}

const MARK_MOVING = 'animate-breathe bg-chat-live-mark';

const MARK_STILL = 'border border-muted-foreground/50 bg-transparent';

export const liveMark = (pulse: boolean): string => (pulse ? MARK_MOVING : MARK_STILL);

export const markMoves = (mark: string): boolean => /\banimate-/.test(mark);

export function chatCompactionMark(entry: CompactionActivityEntry): string {
  if (entry.compactionStatus === 'running') return MARK_MOVING;
  if (entry.compactionStatus === 'completed') return 'bg-chat-mutation';
  if (entry.compactionStatus === 'failed') return 'bg-chat-failure/80';
  return 'bg-muted-foreground/25';
}

export function toolSettled(entry: ToolActivityEntry): boolean {
  return producerToolSettled(entry.toolState);
}

export function toolFailed(entry: ToolActivityEntry): boolean {
  return entry.toolState !== 'output-unknown' && entry.toolState !== 'output-refused' && producerToolFailed(entry.toolState);
}

export function toolOutcomeUnknown(entry: ToolActivityEntry): boolean {
  return entry.toolState === 'output-unknown';
}

export function toolQueued(entry: ToolActivityEntry): boolean {
  return toolStanding(entry)?.state === 'queued';
}

export function toolStartedAt(entry: ToolActivityEntry): number | null {
  const standing = toolStanding(entry);
  return standing?.state === 'running' ? standing.since : null;
}

export function toolOperationRefused(entry: ToolActivityEntry): boolean {
  return entry.toolState === 'output-refused';
}

export function toolRefusalWord(entry: ToolActivityEntry, unsaid: string): string | null {
  const refusal = entry.toolRefusal;
  if (!toolOperationRefused(entry) || refusal === undefined) return null;
  const said = refusal.words ?? unsaid;
  const names = (text: string | undefined) => text === refusal.code || text === said;
  return entry.display?.facts?.some((fact) => names(fact.label) || names(fact.value)) ? null : said;
}

export function toolOpensByDefault(entry: ToolActivityEntry, override: boolean | undefined): boolean {
  if (entry.toolError) return true;
  if (toolOperationRefused(entry)) return false;
  if (override !== undefined) return override;
  return entry.display ? toolDisplayOpensByDefault(entry.display) : false;
}

export function toolInterrupted(entry: ToolActivityEntry): boolean {
  return entry.toolState === 'input-interrupted';
}

export function toolCancelled(entry: ToolActivityEntry): boolean {
  return entry.toolState === 'output-denied' || entry.toolState === 'output-cancelled';
}

export type ChatStepMoment = {
  readonly still: boolean;
  readonly live: boolean;
  readonly clock: ChatLiveStatus | null;
  readonly standing?: boolean;
};

export function chatToolActivity(
  entry: ToolActivityEntry,
  identity: ChatActivityIdentity | undefined,
  still: boolean,
  standing = false,
): ChatToolActivity {
  const settled = toolSettled(entry) && !standing;
  const done = settled && !toolOperationRefused(entry);
  return {
    toolName: entry.toolName,
    state: done ? 'done' : standing ? 'running' : still && !settled ? 'unknown' : 'running',
    title: identity?.title ?? entry.display?.title ?? null,
    alone: identity?.title === undefined && entry.display?.alone === true,
    verb: (done || !settled ? entry.display?.verb : undefined) ?? null,
    subtitle: entry.display?.subtitle ?? null,
  };
}

const stateLine = (lead: string): ChatStepLine => ({ lead, subject: null, join: 'phrase' });

export function chatStepLine(
  entry: ActivityEntry,
  identity: ChatActivityIdentity | undefined,
  moment: ChatStepMoment,
  strings: ChatStrings,
  plain = false,
): ChatStepLine {
  if (entry.kind === 'tool')
    return chatToolActivityLine(chatToolActivity(entry, identity, moment.still, moment.standing === true), strings);
  if (entry.kind === 'signal') {
    const from = entry.signalType === KEEP_WARM_SIGNAL_TYPE ? null : (identity?.title ?? (entry.title?.trim() || null));
    return { lead: strings.signal(entry.signalType, from !== null), subject: from, join: 'phrase' };
  }
  if (entry.kind === 'runtime-guidance') return chatGuidanceLine(entry.runtimeGuidance, strings);
  if (entry.kind === 'compaction') return stateLine(chatCompactionLabel(entry, strings, identity?.title ?? null));
  if (entry.kind === 'retry') {
    const left = Math.max(0, entry.delayMs - (moment.clock?.phaseMs ?? 0));
    return stateLine(moment.live ? strings.retryingIn(elapsedDuration(left)) : strings.retry());
  }
  if (plain) {
    const name = chatThoughtLabel(entry.text);
    if (name) return stateLine(name);
  }
  const line = firstLabelLine(entry.text);
  return {
    lead: entry.reasoningState === 'streaming' ? strings.thinking() : strings.thought(),
    subject: line || null,
    join: 'apart',
  };
}

export function chatStepMark(entry: ActivityEntry, kinds: EntryKinds, moment: ChatStepMoment): string {
  const held = entry.kind === 'tool' ? (kinds.toolStatus(entry)?.dot?.(entry) ?? null) : null;
  if (held !== null) return held;
  if (entry.kind === 'tool' && (toolQueued(entry) || (moment.still && !toolSettled(entry)))) return MARK_STILL;
  if (moment.live) return liveMark(entry.kind === 'tool' ? moment.clock === null || moment.clock.pulse : (moment.clock?.pulse ?? false));
  if (entry.kind === 'tool') {
    if (!toolSettled(entry)) return MARK_MOVING;
    if (toolFailed(entry)) return 'bg-chat-failure/80';
    if (toolOperationRefused(entry)) return 'bg-chat-refused/80';
    return entry.display?.mutates && !toolOutcomeUnknown(entry) ? 'bg-chat-mutation' : 'bg-muted-foreground/40';
  }
  if (entry.kind === 'compaction') return chatCompactionMark(entry);
  return 'bg-muted-foreground/25';
}

export function groupFailureCount(group: ActivityGroup): number {
  return group.entries.filter((entry) => entry.kind === 'tool' && toolFailed(entry)).length;
}

export function groupDurationSeconds(group: ActivityGroup): number | null {
  const stamps = group.entries.flatMap((entry) => (entry.occurredAt ? [Date.parse(entry.occurredAt)] : []));
  if (stamps.length < 2) return null;
  const span = Math.max(...stamps) - Math.min(...stamps);
  return span >= 1000 ? Math.round(span / 1000) : null;
}
