import { Clock, Effect } from 'effect';
import { pageCeiling, pageRows, readCursor, type Cursor, type PageFamily } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '../agent/ToolOutputSpool';
import { type ToolPageInput, type ToolPageRow, toolPageText } from '../tool/page';
import type { ThreadCacheWarmth } from '../thread/cache/ThreadCacheWarmth';
import { limitTokens } from '../thread/compaction/limit';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { ThreadReadFailure } from '../thread/record';
import type { ThreadDirectoryAccess, ThreadDirectoryContext, ThreadDirectoryEntry } from './ThreadDirectory';
import { THREAD_LIST } from './threads';
import { tokensFigure } from '../agent/figures';

export const AGENT_PAGE_ROWS = 20;

const AGENTS: PageFamily = {
  id: 'agents',
  order: 1,
  rowBytes: { text: 363, json: 362 },
  road: 'text',
  defaultRows: AGENT_PAGE_ROWS,
  sample: () => ({
    label: 'x'.repeat(36),
    facts: [
      'agent',
      'project 9007199254740991',
      'test-provider/test-model high',
      'idle',
      'finished',
      'context 712k/1M (71%)',
      'likely',
      '712k from cache',
      '74% warm after 30–60m',
      `root ${'x'.repeat(36)}`,
    ],
  }),
};

export const AGENT_CEILING = pageCeiling(AGENTS, TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES);

export type Roster = {
  readonly rows: readonly ToolPageRow[];
  readonly total: number;
  readonly cursor: string | null;
  readonly continued: boolean;
};

type CursorWords = { readonly reason: string; readonly unblock: string };

export type RosterCursorRefused = CursorWords & { readonly refused: 'cursor-stale' | 'bad-cursor' };

const CURSOR_REFUSALS: Record<RosterCursorRefused['refused'], CursorWords> = {
  'cursor-stale': {
    reason: 'this cursor was minted by another reading',
    unblock: 'call list_agents with no cursor to open a new walk',
  },
  'bad-cursor': {
    reason: 'this is not a cursor list_agents answered',
    unblock: 'hand back the cursor a page printed, unchanged, or call with no cursor',
  },
};

const OPENING_CHARS = 60;

export function opening(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  if (line === undefined) return undefined;
  return line.length > OPENING_CHARS ? `${line.slice(0, OPENING_CHARS - 1).trimEnd()}…` : line;
}

export function rosterPage(roster: Roster): ToolPageInput {
  return {
    rows: roster.rows,
    total: roster.total,
    order: 'working first, then awaiting, then idle; newest movement first',
    next: roster.cursor === null ? undefined : `list_agents(cursor="${roster.cursor}")`,
    empty: roster.continued ? 'no agents past this cursor' : 'no agents run on this server',
  };
}

export const listedOutput = (roster: Roster) => ({
  status: 'listed' as const,
  page: toolPageText(rosterPage(roster)),
  total: roster.total,
  cursor: roster.cursor,
});

export const readRoster = Effect.fnUntraced(function* (
  directory: ThreadDirectoryAccess,
  ask: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
): Effect.fn.Return<Roster | RosterCursorRefused, ThreadBorderFailed | ThreadReadFailure> {
  const continued = ask.cursor === undefined ? undefined : readCursor(ask.cursor, THREAD_LIST);
  if (continued !== undefined && 'refused' in continued) {
    return { refused: continued.refused, ...CURSOR_REFUSALS[continued.refused] };
  }
  const agents = yield* directory.list({
    limit: pageRows(ask.limit, AGENTS, AGENT_CEILING),
    cursor: ask.cursor === undefined ? undefined : (ask.cursor as Cursor),
  });
  const now = yield* Clock.currentTimeMillis;
  return {
    rows: agents.rows.map((entry) => agentRow(entry, now)),
    total: agents.total,
    cursor: agents.cursor,
    continued: continued !== undefined,
  };
});

function agentRow(entry: ThreadDirectoryEntry, now: number): ToolPageRow {
  return {
    label: entry.name ?? entry.threadId,
    facts: [
      entry.agentId,
      ...(entry.projectId === null ? [] : [`project ${entry.projectId}`]),
      ...selectionFacts(entry),
      entry.life,
      ...stallFacts(entry, now),
      ...askFacts(entry),
      ...(entry.assignment === 'never-started' ? [] : [entry.assignment]),
      ...failureFacts(entry),
      ...contextFacts(entry),
      ...warmthFacts(entry, now),
      `root ${entry.spawnRootId}`,
      ...(entry.parentThreadId === null ? [] : [`parent ${entry.parentThreadId}`]),
      ...(entry.name === null ? [] : [`thread ${entry.threadId}`]),
      entry.movedAt,
    ],
  };
}

function failureFacts(entry: ThreadDirectoryEntry): readonly string[] {
  if (entry.assignment !== 'failed') return [];
  const failure = entry.failure;
  if (!failure) return [entry.failureReason ? `failure ${entry.failureReason}` : 'failure details unavailable'];
  const detail = entry.failureReason ?? failure.detail;
  return [
    [
      `failure ${failure.type} at ${failure.stage}`,
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
    ].join('; '),
  ];
}

function contextFacts(entry: ThreadDirectoryEntry): readonly string[] {
  const context = entry.context;
  if (context === null) return [];
  return [context.stale ? `${contextFigure(context)} stale` : contextFigure(context)];
}

function contextFigure(context: ThreadDirectoryContext): string {
  const used = tokensFigure(context.tokens);
  const share = (whole: number) => `${Math.round((context.tokens / whole) * 100)}%`;
  const limit = context.limit;
  if (limit !== null && limit.compaction !== null)
    return `context ${used} of ${tokensFigure(limit.compaction.at)} before auto-compaction (${share(limitTokens(limit))}), window ${tokensFigure(limit.window)}`;
  if (limit !== null) return `context ${used}/${tokensFigure(limit.window)} (${share(limit.window)}), no auto-compaction`;
  if (context.window !== null && context.window > 0)
    return `context ${used}/${tokensFigure(context.window)} (${share(context.window)} of the window; compaction point unknown)`;
  return `context ${used}`;
}

function warmthFacts(entry: ThreadDirectoryEntry, now: number): readonly string[] {
  const warmth = entry.warmth;
  if (warmth === null || warmth.state === 'unknown') return [];
  if (warmth.invalidatedBy === 'compaction') return ['cold', 'compacted since its last request'];
  const held =
    warmth.heldTokens === null ? [] : [`${tokensFigure(warmth.heldTokens)} ${warmth.state === 'cold' ? 'to rewrite' : 'from cache'}`];
  return [warmth.state, ...held, ...warmthHorizon(warmth, now)];
}

function warmthHorizon(warmth: ThreadCacheWarmth, now: number): readonly string[] {
  if (warmth.invalidatedBy !== null) return [`${warmth.invalidatedBy} changed`];
  if (warmth.expiresAt !== null) {
    const minutes = Math.round((Date.parse(warmth.expiresAt) - now) / 60_000);
    return [minutes > 0 ? `${minutes}m left` : minutes < 0 ? `expired ${-minutes}m ago` : 'expiring'];
  }
  if (warmth.warmShare !== null && warmth.gap !== null) return [`${Math.round(warmth.warmShare * 100)}% warm after ${warmth.gap}`];
  return [];
}

function selectionFacts(entry: ThreadDirectoryEntry): readonly string[] {
  const selection = entry.selection;
  if (selection === null) return [];
  const pair = `${selection.provider}/${selection.model ?? 'default'}`;
  return [selection.reasoning === null ? pair : `${pair} ${selection.reasoning}`];
}

function stallFacts(entry: ThreadDirectoryEntry, now: number): readonly string[] {
  if (entry.stalledSince === null) return [];
  return [`stalled since ${entry.stalledSince} (${Math.floor((now - Date.parse(entry.stalledSince)) / 60_000)}m without durable movement)`];
}

function askFacts(entry: ThreadDirectoryEntry): readonly string[] {
  const asked = entry.askPrompt === null ? undefined : opening(entry.askPrompt);
  return asked === undefined ? [] : [`asks “${asked}”`];
}
