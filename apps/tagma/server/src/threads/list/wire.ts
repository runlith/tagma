import type { FeedPosition, ThreadResumeOf } from '@runlith/agent/transcript/live';
import { capTranscript } from '@runlith/agent/protocol/cap';
import {
  serializeRun,
  serializeThread,
  threadFeedRecords,
  threadOpenChange,
  threadSnapshotPayload,
  threadStateView,
} from '@runlith/agent/protocol/http';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { pathValue, recordFacets, type ThreadQuery, type ThreadQueryPredicate } from '@runlith/agent/thread/ThreadQuery';
import type { WarmthBasis, WarmthSubject } from '../contract/wire/warmth.js';
import { limitTokens, occupiedTokens, type ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import type { ThreadBasis } from './basis.js';
import type { RecapReading } from '../contract/wire/recap.js';
import type { EvidenceQueryTerms, EvidenceInput } from '../contract/wire/evidenceInput.js';
import type {
  EvidenceQueryAnswer,
  ExpandedEvidenceRecord,
  ThreadEvidenceSnapshot,
  ThreadListAnswer,
} from '../contract/service/evidence.js';
import { type ThreadCacheWarmth, nextRequestWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import { agentTypeId } from '@runlith/agent/thread/agents/AgentProfile';
import type { ThreadEventRecord } from '@runlith/agent/thread/events';
import type { ThreadStateFrame } from '@runlith/agent/thread/state';
import { Clock, Effect, Result, Schema } from 'effect';
import { blockName } from '../../graph/contract/wire/references.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { NativeThreadSnapshot, NativeThreadState } from '../contract/service/state.js';
import type {
  EvidenceAnswer as EvidenceAnswerWire,
  ExpandedRecord as ExpandedRecordWire,
  ThreadFacts,
  ThreadJournalEntry,
  ThreadShape,
} from '../contract/wire/evidence.js';
import type { ThreadProjectionPage, ThreadProjectionWindow } from '../contract/service/list.js';
import type { ThreadListProjection } from './summary.js';
import { runFacts } from '../presence/projection.js';
import type { ThreadClockRange, ThreadCursor, ThreadSelection, ThreadStateTerm } from './select.js';
import type { ThreadContextTokens, ThreadListRow, ThreadListPage, ThreadListWindow } from '../contract/wire/list.js';
import type { ThreadWireFeedEvent, ThreadWireSnapshotPayload, WireState, WireThread } from '../contract/wire/snapshot.js';
import { hostingCli, processAccount, shownHarness } from '../voice/rowDetail.js';
import type { ThreadSelectionQuery } from '../contract/wire/selection.js';
import { ThreadInputRefused } from '../contract/service/failure.js';

export function threadSelectionOf(query: ThreadSelectionQuery): Effect.Effect<ThreadSelection> {
  return Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const refusals: ThreadInputRefused[] = [];
    const instant = (name: keyof ThreadSelectionQuery): Date | undefined => {
      const raw = query[name];
      if (raw === undefined) return undefined;
      const at = new Date(raw);
      if (!Number.isNaN(at.getTime())) return at;
      refusals.push(
        new ThreadInputRefused('selection-shape', `${name} is not an instant: ${raw}`, [
          'write it as an ISO instant, e.g. 2026-08-25T00:00:00Z',
        ]),
      );
      return undefined;
    };
    const whole = (name: keyof ThreadSelectionQuery): number | undefined => {
      const raw = query[name];
      if (raw === undefined) return undefined;
      const value = Number(raw);
      if (Number.isInteger(value) && value >= 0) return value;
      refusals.push(new ThreadInputRefused('selection-shape', `${name} is not a whole number: ${raw}`, ['write a non-negative integer']));
      return undefined;
    };
    const range = (since: keyof ThreadSelectionQuery, before: keyof ThreadSelectionQuery): ThreadClockRange | undefined => {
      const from = instant(since);
      const to = instant(before);
      if (from === undefined && to === undefined) return undefined;
      return { since: from, before: to };
    };
    const list = (name: keyof ThreadSelectionQuery): readonly string[] | undefined => {
      const raw = query[name];
      if (raw === undefined) return undefined;
      const values = raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length > 0) return values;
      refusals.push(new ThreadInputRefused('selection-shape', `${name} names nothing`, ['name at least one value']));
      return undefined;
    };
    const createdAt = range('createdSince', 'createdBefore');
    const updatedAt = range('updatedSince', 'updatedBefore');
    const readerOrderAt = range('readerSince', 'readerBefore');
    const archivedAt = range('archivedSince', 'archivedBefore');
    const active = range('activeSince', 'activeBefore');
    const limit = whole('limit');
    const before = threadPageCursor(query.before, refusals);
    const ids = list('ids');
    const models = list('models');
    const providers = list('providers');
    const ranSince = instant('ranSince');
    const ranBefore = instant('ranBefore');
    const ran =
      models === undefined && providers === undefined && ranSince === undefined && ranBefore === undefined
        ? undefined
        : {
            models,
            providers,
            since: ranSince,
            before: ranBefore,
          };
    const of = threadReachOf(query, refusals);
    const view = viewOf(query, refusals);
    const state = stateOf(query.state, now, refusals);
    const refused = refusals[0];
    if (refused !== undefined) return Effect.die(refused);
    return Effect.succeed<ThreadSelection>({
      view,
      state,
      ids,
      title: query.title,
      of,
      ran,
      active,
      createdAt,
      updatedAt,
      readerOrderAt,
      archivedAt,
      limit,
      before,
    });
  });
}

export function threadPageBefore(cursor: ThreadCursor | null): string | null {
  return cursor === null
    ? null
    : Buffer.from(JSON.stringify({ at: cursor.orderAt.getTime(), id: cursor.id }), 'utf8').toString('base64url');
}

const decodePageCursor = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({
      at: Schema.Finite.check(Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 })),
      id: Schema.String.check(Schema.isNonEmpty()),
    }),
  ),
);

function threadPageCursor(raw: string | undefined, refusals: ThreadInputRefused[]): ThreadCursor | undefined {
  if (raw === undefined) return undefined;
  const refuse = (): undefined => {
    refusals.push(
      new ThreadInputRefused('selection-shape', `before is not a page cursor: ${raw}`, [
        'hand back the `before` the previous page answered',
        'omit it to read the set from its top',
      ]),
    );
    return undefined;
  };
  try {
    const held = decodePageCursor(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Result.isFailure(held)) return refuse();
    return { orderAt: new Date(held.success.at), id: held.success.id };
  } catch {
    return refuse();
  }
}

function viewOf(query: ThreadSelectionQuery, refusals: ThreadInputRefused[]): ThreadSelection['view'] {
  const named = query.set;
  if (named === undefined) return 'live';
  if (named !== 'live' && named !== 'archived' && named !== 'all') {
    refusals.push(new ThreadInputRefused('selection-shape', `set is not a thread set: ${named}`, ['live, archived or all']));
    return 'live';
  }
  return named;
}

function stateOf(named: string | undefined, now: number, refusals: ThreadInputRefused[]): ThreadStateTerm | undefined {
  if (named === undefined) return undefined;
  if (named === 'running') return { kind: 'running' };
  if (named === 'stalled') return { kind: 'stalled', now: new Date(now) };
  refusals.push(new ThreadInputRefused('selection-shape', `state is not a thread state: ${named}`, ['running or stalled']));
  return undefined;
}

function threadReachOf(query: ThreadSelectionQuery, refusals: ThreadInputRefused[]): ThreadSelection['of'] | undefined {
  const { of, reach } = query;
  if (of === undefined && reach === undefined) return undefined;
  if (of === undefined || reach === undefined) {
    refusals.push(
      new ThreadInputRefused('selection-shape', 'a relation names a thread and a reach', ['of=<threadId> reach=children|descendants|tree']),
    );
    return undefined;
  }
  if (reach !== 'children' && reach !== 'descendants' && reach !== 'tree') {
    refusals.push(new ThreadInputRefused('selection-shape', `reach is not a thread relation: ${reach}`, ['children, descendants or tree']));
    return undefined;
  }
  return { thread: of, reach };
}

export function wireThreadPage(page: ThreadProjectionPage, basis: ThreadBasis): ThreadListPage {
  return { rows: page.rows.map((row) => wireThread(row, basis)), total: page.total, before: threadPageBefore(page.before) };
}

export function wireThreadAnswer(page: ThreadListAnswer, basis: ThreadBasis): ThreadListPage {
  return { rows: page.rows.map((row) => wireThread(row, basis)), total: page.total, before: page.cursor };
}

export function wireThreadListWindow(window: ThreadProjectionWindow, basis: ThreadBasis): ThreadListWindow {
  return {
    rows: window.rows.map((row) => wireThread(row, basis)),
    roots: window.roots,
    windowBefore: window.windowBefore?.toISOString() ?? null,
  };
}

export function wireThread(row: ThreadListProjection, basis: ThreadBasis): ThreadListRow {
  const context = contextTokens(row.contextReading, basis.limits.get(row.id) ?? null);
  return {
    id: row.id,
    projectId: row.projectId,
    scopeName: row.scopeBlockUuid === null ? null : blockName(row.scopeBlockUuid),
    title: row.title,
    titleOrigin: row.titleOrigin,
    life: row.life,
    owes: row.owes ? (true as const) : undefined,
    halt: row.activeRun?.halt ?? undefined,
    activeRunId: row.activeRun?.id ?? null,
    ...runFacts(row),
    activeRunSelection:
      row.activeRun === null ? null : { provider: row.activeRun.provider, model: row.activeRun.model, reasoning: row.activeRun.reasoning },
    contextShare: context === null ? null : context.used / limitTokens(context.limit),
    contextTokens: context,
    recap: row.recap ?? undefined,
    cacheWarmth: cacheWarmthOf(row, row.activeRun !== null, basis.warmth),
    liveSpellStartedAt: row.liveSpellStartedAt?.toISOString() ?? null,
    spawnRootId: row.spawnRootId,
    parentThreadId: row.parentThreadId,
    detachedFrom: row.detachedFrom,
    bornOf: row.bornOf === null ? null : `${row.bornOf.by}:${row.bornOf.step}`,
    name: row.name,
    agentId: agentTypeId(row.agentId, row.profile?.id ?? null, row.transport.agent),
    profileId: row.profile?.id ?? null,
    harness: shownHarness(row.harness, row),
    cli: hostingCli(row.harness, row),
    capabilities: row.capabilities,
    phase: row.phase,
    held: row.held,
    launchBlocked: row.launchBlocked === true ? (true as const) : undefined,
    account: row.account,
    processAccount: processAccount(row.harness),
    provider: row.provider,
    model: row.model,
    reasoning: row.reasoning,
    switches: row.switches ?? {},
    createdBySessionId: row.createdBySessionId,
    readerOrderAt: row.readerOrderAt.toISOString(),
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    folderId: row.folderId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function contextTokens(reading: ThreadContextReading | null, limit: ThreadContextLimit | null): ThreadContextTokens | null {
  if (reading === null || reading.stale || limit === null || limitTokens(limit) <= 0) return null;
  const tokens = occupiedTokens(reading.usage);
  return tokens === null ? null : { used: tokens, limit };
}

export function cacheWarmthOf(
  thread: WarmthSubject,
  running: boolean,
  basis: WarmthBasis,
  now: number = Date.now(),
): ThreadCacheWarmth | null {
  const { contextReading: reading, provider } = thread;
  if (running || reading === null) return null;
  return nextRequestWarmth({
    reading,
    next: {
      provider,
      model: thread.model,
      reasoning: thread.reasoning,
      account: thread.account ?? basis.accounts.get(provider) ?? null,
    },
    models: basis.models,
    curve: basis.curves.get(provider) ?? null,
    now,
  });
}

function wireThreadOf(state: NativeThreadState, basis: ThreadBasis): WireThread {
  return {
    ...serializeThread(state.thread),
    projectId: state.home,
    title: state.title,
    ...(state.parent === undefined ? {} : { parent: state.parent }),
    ...(state.detachedFrom === undefined ? {} : { detachedFrom: state.detachedFrom }),
    cacheWarmth: cacheWarmthOf(state.thread, state.activeRun !== null, basis.warmth),
    harness: shownHarness(state.harness, state.thread),
    cli: hostingCli(state.harness, state.thread),
    processAccount: processAccount(state.harness),
    delegation: state.delegation,
    approving: state.approving,
    spawnDepth: state.spawnDepth,
    place: state.place,
    recap: state.recap,
    recapAttempt: state.recapAttempt,
    modes: state.modes,
    pins: state.pins,
  };
}

function wireStateOf(state: NativeThreadState, basis: ThreadBasis): WireState {
  return { ...threadStateView(state), contextLimit: basis.limits.get(state.thread.id) ?? null, thread: wireThreadOf(state, basis) };
}

export function wireSnapshotPayload(snapshot: NativeThreadSnapshot, basis: ThreadBasis): ThreadWireSnapshotPayload {
  const base = threadSnapshotPayload(snapshot);
  return {
    status: 'loaded',
    snapshot: { ...base.snapshot, contextLimit: basis.limits.get(snapshot.thread.id) ?? null, thread: wireThreadOf(snapshot, basis) },
  };
}

export function wireSnapshotEvent(snapshot: NativeThreadSnapshot, basis: ThreadBasis): ThreadWireFeedEvent {
  return { type: 'snapshot', at: snapshot.live.at, payload: wireSnapshotPayload(snapshot, basis) };
}

export function wireResumeEvent(resumed: ThreadResumeOf<NativeThreadState>, from: FeedPosition, basis: ThreadBasis): ThreadWireFeedEvent {
  return {
    type: 'resume',
    at: resumed.live.at,
    payload: {
      from,
      records: threadFeedRecords(resumed.deltas),
      open: capTranscript(resumed.live.open),
      progress: resumed.live.progress,
      snapshot: wireStateOf(resumed.state, basis),
    },
  };
}

export function wireOpenEvent(event: Extract<ThreadLiveEvent<NativeThreadState>, { readonly type: 'open' }>): ThreadWireFeedEvent {
  return { type: 'open', at: event.at, change: threadOpenChange(event.change) };
}

export function wireStateEvent(
  event: Extract<ThreadLiveEvent<NativeThreadState>, { readonly type: 'state' }>,
  basis: ThreadBasis,
): ThreadWireFeedEvent {
  return {
    type: 'state',
    at: event.at,
    payload: { records: threadFeedRecords(event.frame.deltas), snapshot: wireStateOf(event.frame.state, basis) },
  };
}

export function wireThreadShape(evidence: ThreadEvidenceSnapshot, basis: ThreadBasis, recap?: RecapReading): ThreadShape {
  const thread = evidence.shape.thread;
  return {
    recap,
    thread: {
      ...serializeThread(thread),
      title: evidence.facet.title,
      projectId: evidence.facet.projectId,
      scope: evidence.facet.scope,
      systemPrompt: thread.systemPrompt,
      cacheWarmth: cacheWarmthOf(
        thread,
        evidence.shape.runs.some((run) => run.status === 'running'),
        basis.warmth,
      ),
      contextLimit: basis.limits.get(thread.id) ?? null,
      harness: shownHarness(evidence.facet.harness, thread),
    },
    entries: evidence.shape.entries,
    runs: evidence.shape.runs.map((run) => ({ ...serializeRun(run), notification: run.notification })),
    acts: evidence.acts,
  };
}

export function evidenceQueryOf(request: EvidenceInput | EvidenceQueryTerms): ThreadQuery {
  const { threads: _threads, selection: _selection, cursor: _cursor, where, ...terms } = request as EvidenceInput;
  return {
    ...terms,
    where: where?.map((predicate) => ({
      field: predicate.field,
      op: predicate.op,
      value: predicate.value as ThreadQueryPredicate['value'],
    })),
  };
}

export function wireThreadFacts(row: ThreadListProjection): ThreadFacts {
  return {
    recap: row.recap ?? undefined,
    id: row.id as ThreadId,
    title: row.title,
    agentId: agentTypeId(row.agentId, row.profile?.id ?? null, row.transport.agent),
    name: row.name,
    parentThreadId: row.parentThreadId as ThreadId | null,
    spawnRootId: row.spawnRootId,
    status: row.status,
    activeRunId: row.activeRun?.id ?? null,
    outcome:
      row.outcome === null
        ? null
        : {
            runId: row.outcome.runId,
            status: row.outcome.status,
            failureReason: row.outcome.failureReason,
            finishedAt: row.outcome.finishedAt.toISOString(),
          },
    thread: { provider: row.provider, model: row.model, reasoning: row.reasoning },
    run:
      row.outcome === null
        ? null
        : {
            runId: row.outcome.runId,
            provider: row.outcome.provider,
            model: row.outcome.model,
            reasoning: row.outcome.reasoning,
          },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    readerOrderAt: row.readerOrderAt.toISOString(),
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    harness: shownHarness(row.harness, row),
  };
}

export function wireEvidenceAnswer(answer: EvidenceQueryAnswer): EvidenceAnswerWire {
  return {
    select: answer.select,
    threads: [...answer.threads],
    over: answer.over,
    rows: answer.rows.map((row) => ({ ...row })),
    groups: answer.groups?.map((group) => ({ ...group })),
    coverage: {
      ...answer.coverage,
      unavailable: [...answer.coverage.unavailable],
    },
    cursor: answer.cursor,
  };
}

export function wireExpanded(held: ExpandedEvidenceRecord, fields: readonly string[] | undefined): ExpandedRecordWire {
  if ('missing' in held) return { threadId: held.threadId, at: held.at, missing: held.missing };
  if ('unread' in held) return { threadId: held.threadId, at: held.at, unread: held.unread };
  if ('output' in held) return { threadId: held.threadId, at: held.at, output: { ...held.output } };
  if ('fact' in held) {
    return {
      threadId: held.threadId,
      at: held.at,
      fact: fields === undefined ? { ...held.fact } : narrowed(held.fact, fields),
    };
  }
  const record = wireThreadRecord(held.record, held.origin);
  if (fields === undefined) return { threadId: held.threadId, at: held.at, record };
  return {
    threadId: held.threadId,
    at: held.at,
    record: { ...narrowed(record, fields), at: record.at, id: record.id, kind: record.kind, origin: record.origin },
  };
}

function narrowed(record: object, fields: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const path of fields) {
    const held = pathValue(record, path);
    if (held !== undefined) kept[path] = held;
  }
  return kept;
}

export function threadRecordAddress(at: string | number): { readonly position: number } | { readonly recordId: string } {
  const parsed = typeof at === 'number' ? at : Number(at);
  return Number.isInteger(parsed) && parsed > 0 ? { position: parsed } : { recordId: String(at) };
}

export function wireThreadRecord(record: ThreadEventRecord, origin?: ThreadJournalEntry['origin']): ThreadJournalEntry {
  return {
    at: record.position,
    id: record.id,
    kind: record.kind,
    origin: origin ?? 'unknown',
    ...recordFacets(record.payload),
  } as ThreadJournalEntry;
}
