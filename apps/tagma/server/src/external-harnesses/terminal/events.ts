import { Clock, Effect } from 'effect';
import type { AgentApproval } from '@runlith/agent/contracts';
import type { ReportPlan, ReportResult } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { ThreadEventBody } from '@runlith/agent/thread/events';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import type { SessionAlignment } from '../sessions/alignment.js';
import type { ExternalSession, HarnessTurn } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import {
  type HarnessEvent,
  type HarnessField,
  type HarnessReceipt,
  type HarnessReportInput,
} from '../../threads/contract/wire/harness/observation.js';
import { HARNESS_DETAIL_MAX } from '@runlith/tagma/adapter/harness';
import type { SessionLookupStore } from '../../threads/store/sessionLookups.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessPermissions } from '../contract/service/permissions.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';
import { harnessReport } from '../contract/service/table.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { SessionObservations } from '../contract/service/observations.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { assistantWords, callOpened, callSettled, userWords } from './entries.js';
import type { TerminalJournal } from './journal.js';
import type { HarnessGuidance } from '../contract/service/guidance.js';
import type { ProvenEnd, TerminalWatch } from './watch.js';
import type { OpenRuns } from './open.js';
import type { TerminalClosing, TurnSpend } from './closing.js';
import { closedWords } from './words.js';
import { typedShape } from '../adapter/input.js';
import { armedConfirmed, confirmedBy } from './interrupts.js';
import { RUN_UNOWNED } from '../contract/wire/call.js';
import type { TerminalCommands } from './commands.js';

const UNTURNED = '';

const MOVING: ReadonlySet<HarnessEvent['occasion']> = new Set(['turn-start', 'activity', 'wait']);

type Landing = { readonly facet: ExternalSession; readonly after: Effect.Effect<void> };

type Seen = {
  readonly threadId: string;
  readonly adapter: HarnessAdapter;
  readonly event: HarnessEvent;
  readonly raw: Record<string, unknown>;
  readonly reported: HarnessReportInput;
  readonly approval: AgentApproval;
  readonly proven: ProvenEnd | null;
  readonly spent: TurnSpend | null;
};

type Ctx = Seen & {
  readonly unit: WriteUnit<'machine'>;
  readonly lost: { unowned: boolean };
};

type Opened = { readonly facet: ExternalSession; readonly run: string | null };

const evidenceOf = (event: HarnessEvent, part: string): string => `${event.receipt ?? crypto.randomUUID()}:${part}`;

const sameTurn = (open: string | null, event: string | null): boolean => open === null || event === null || open === event;

const sameStart = (open: string | null, event: string | null): boolean =>
  open !== null && open !== UNTURNED && event !== null && open === event;

export class TerminalEvents {
  constructor(
    private readonly lookups: SessionLookupStore['Service'],
    private readonly store: HarnessSessionStore,
    private readonly observations: SessionObservations['Service'],
    private readonly journal: TerminalJournal,
    private readonly threads: SessionThreads,
    private readonly open: OpenRuns,
    private readonly permissions: HarnessPermissions['Service'],
    private readonly titled: (threadId: string, runId: string) => Effect.Effect<void>,
    private readonly watch: TerminalWatch,
    private readonly guidance: HarnessGuidance['Service'],
    private readonly closing: TerminalClosing,
    private readonly raised: (threadId: string) => Effect.Effect<void, HarnessFailure>,
    private readonly restarted: (threadId: string, turn: string) => Effect.Effect<void>,
    private readonly commands: TerminalCommands,
    private readonly alignment: SessionAlignment,
    private readonly adapters: HarnessAdapters['Service'],
  ) {
    this.writes = writes('TerminalEvents.reported', [], journal.writes, alignment.writes);
  }

  private readonly writes: WriteSet;

  readonly reported = Effect.fnUntraced(function* (
    this: TerminalEvents,
    threadId: string,
    reported: HarnessReportInput,
  ): Effect.fn.Return<HarnessReceipt, HarnessFailure> {
    const born = yield* this.lookups.harnessOf(threadId);
    if (born === undefined)
      return yield* new GateRefusal('not-found', `Thread ${threadId} was not found.`, [
        'a thread is opened from the project that holds it',
      ]);
    if (born === null) {
      return yield* new GateRefusal(
        'not-a-harness-thread',
        `Thread ${threadId} runs an agent of this server, so it holds no external CLI session to name.`,
        ['post a session key from a thread opened as a harness type — harness:<name>'],
      );
    }
    if ((yield* this.store.binding(threadId))?.transport.adapter === 'acp') {
      return {
        outcome: 'unchanged' as const,
        revision: born.observation.revision,
        cause: null,
        harness: born.name,
        transport: 'acp' as const,
      };
    }
    yield* this.raised(threadId);
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const observedAt = reported.capturedAt ?? now;
    if (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt || observedAt > now) {
      return yield* new GateRefusal('observation-time', 'The hook capture time must be a canonical UTC instant no later than admission.', [
        'post the original hook capture time from the execution host',
      ]);
    }
    const adapter = yield* this.adapters.runningRow(born);
    const hook = reported.event ?? {};
    const raw: Record<string, unknown> = { ...hook };
    const read = harnessReport(adapter, raw);
    const named = hook.hook_event_name ?? hook.hookEventName;
    const occasion =
      named === undefined
        ? (reported.occasion ?? 'self-description')
        : adapter.occasionOf({ name: named, tool: hook.tool_name ?? hook.toolName, notification: hook.notification_type });
    const sessionKey = reported.sessionKey ?? read.sessionKey;
    const turnId = reported.turn ?? (read.turnId === sessionKey ? null : read.turnId);
    const scope = { rootKey: sessionKey, turnId };
    const said = reported.model ?? read.model ?? undefined;
    const model: HarnessField =
      said === undefined
        ? adapter.reportsModel
          ? { _tag: 'NotRead' }
          : { _tag: 'Unsupported', source: 'hook', scope, observedAt }
        : said.read === 'value'
          ? { _tag: 'Value', value: said.value, claim: said.claim, source: 'hook', scope, observedAt }
          : said.read === 'unreadable'
            ? { _tag: 'Unreadable', source: 'hook', scope, observedAt, reason: said.reason, lastKnown: null }
            : { _tag: said.read === 'absent' ? 'Absent' : 'Unsupported', source: 'hook', scope, observedAt };
    const event: HarnessEvent = {
      occasion,
      observedAt,
      childId: raw.agent_id === undefined ? undefined : String(raw.agent_id),
      transcriptPath: raw.transcript_path === undefined ? undefined : String(raw.transcript_path),
      sessionId: reported.session ?? null,
      rootKey: sessionKey,
      turnId,
      receipt: reported.receipt ?? null,
      atRevision: null,
      model,
    };
    const row = yield* this.threads.find(threadId, OPERATOR_PRINCIPAL);
    if (row === undefined) {
      return yield* new GateRefusal('not-found', `Thread ${threadId} was not found.`, [
        'a thread is opened from the project that holds it',
      ]);
    }
    const approval: AgentApproval = { mode: row.authority.mode, interactive: true };
    const proven =
      occasion === 'turn-start' || (occasion === 'turn-end' && hook.status === 'error') ? yield* this.watch.evidence(threadId) : null;
    const closing =
      (occasion === 'turn-start' || occasion === 'turn-end') && event.childId === undefined ? yield* this.store.read(threadId) : null;
    const ends = (turn: HarnessTurn): boolean => occasion === 'turn-end' || (turn.turn !== null && !sameStart(turn.turn, event.turnId));
    const spent = closing?.turn !== undefined && ends(closing.turn) ? yield* this.closing.spent(threadId, closing) : null;
    const reset =
      occasion === 'session-start' && (hook.source === 'compact' || hook.source === 'clear')
        ? yield* this.guidance.cleared(threadId, evidenceOf(event, 'guidance-reset'))
        : null;
    const seen: Seen = { threadId, adapter, event, raw, reported, approval, proven, spent };
    const landed = yield* this.store.change(threadId, (facet, unit) => this.admitted(facet, unit, seen, reset), this.writes);
    yield* landed.after;
    const call = reported.call;
    if (call?.done === true) yield* this.permissions.ended(threadId, call.id);
    const acted = landed.receipt.outcome !== 'refused' && landed.receipt.outcome !== 'duplicate';
    if (acted && call !== undefined) {
      if (call.done === true) yield* this.commands.settled(threadId, call.id);
      else if (reported.shell !== undefined) yield* this.commands.opened(threadId, call.id, reported.shell);
    }
    if (acted && occasion === 'turn-end' && event.childId === undefined) yield* this.commands.ended(threadId);
    return landed.receipt;
  });

  private readonly admitted = Effect.fnUntraced(function* (
    this: TerminalEvents,
    facet: ExternalSession,
    unit: WriteUnit<'machine'>,
    seen: Seen,
    reset: Effect.Success<ReturnType<HarnessGuidance['Service']['cleared']>> | null,
  ): Effect.fn.Return<{ facet: ExternalSession; value: { receipt: HarnessReceipt; after: Effect.Effect<void> } }, HarnessFailure> {
    const admitted = this.observations.admit(facet, seen.event, seen.adapter);
    if (admitted.receipt.outcome === 'refused' || admitted.receipt.outcome === 'duplicate') {
      return { facet: admitted.facet, value: { receipt: admitted.receipt, after: Effect.void } };
    }
    const lost = { unowned: false };
    const bound = yield* this.alignment.bound(unit, seen.threadId, admitted.facet);
    const acted = yield* this.act(bound, { ...seen, unit, lost }, admitted.receipt);
    if (lost.unowned) {
      return yield* new GateRefusal(RUN_UNOWNED, 'This server does not own the run this event belongs to yet.', [
        'the hook delivery retries; the event was not consumed',
      ]);
    }
    const receipt: HarnessReceipt =
      seen.event.occasion === 'session-start' && acted.facet.session?.seed === true
        ? { ...admitted.receipt, seeded: true }
        : admitted.receipt;
    if (reset === null) return { facet: acted.facet, value: { receipt, after: acted.after } };
    const emptied = this.journal.reports.outside(seen.threadId, [], evidenceOf(seen.event, 'context-reset'), { kind: 'stale' });
    yield* Effect.mapError(this.journal.apply(unit, [reset.plan, emptied]), (cause): HarnessFailure => cause as unknown as HarnessFailure);
    const compacted = seen.raw.source === 'compact' ? this.watch.compacted(seen.threadId) : Effect.void;
    return {
      facet: acted.facet,
      value: { receipt, after: Effect.andThen(Effect.andThen(acted.after, reset.delivered), compacted) },
    };
  });

  private readonly act = Effect.fnUntraced(function* (
    this: TerminalEvents,
    reached: ExternalSession,
    ctx: Ctx,
    receipt: HarnessReceipt,
  ): Effect.fn.Return<Landing, HarnessFailure> {
    const record = ctx.adapter.ends.interrupt === 'record';
    const facet = record && ctx.event.occasion === 'turn-end' ? armedConfirmed(reached, ctx.event.observedAt) : reached;
    const mark = facet.interrupted;
    if (mark !== undefined && SEALED.has(ctx.event.occasion) && ctx.event.childId === undefined) {
      const restart = ctx.event.occasion === 'turn-start';
      const heard =
        ctx.event.occasion === 'turn-end' &&
        record &&
        mark.heard === undefined &&
        sameTurn(mark.turn.turn === UNTURNED ? null : mark.turn.turn, ctx.event.turnId);
      return {
        facet: heard ? confirmedBy(facet, ctx.event.observedAt) : facet,
        after: restart ? this.restarted(ctx.threadId, ctx.event.turnId ?? evidenceOf(ctx.event, 'restart')) : Effect.void,
      };
    }
    const running = yield* this.threads.runningRun(ctx.threadId, ctx.unit);
    const standing = facet.turn !== undefined && facet.turn.run === running ? facet : stripped(facet);
    const dropped = standing === facet ? Effect.void : Effect.sync(() => facet.turn !== undefined && this.open.drop(facet.turn.run));
    if (standing.turn !== undefined) yield* this.diagnostics(standing.turn.run, ctx);
    const landing = yield* this.occasion(standing, ctx, receipt);
    if (standing.turn === undefined && landing.facet.turn !== undefined) yield* this.diagnostics(landing.facet.turn.run, ctx);
    const taken = takenTurn(standing.turn, landing.facet.turn);
    if (taken !== null) yield* this.alignment.taken(ctx.unit, ctx.threadId, taken.run, addressOf(ctx.adapter, taken));
    const at = ctx.event.observedAt;
    const turn = landing.facet.turn;
    const next =
      turn !== undefined && MOVING.has(ctx.event.occasion) && at >= turn.openedAt && at > (turn.movedAt ?? '')
        ? { ...landing.facet, turn: { ...turn, movedAt: at } }
        : landing.facet;
    const closed = facet.turn !== undefined && next.turn?.run !== facet.turn.run ? this.watch.quieted(ctx.threadId) : Effect.void;
    const silent =
      next.turn !== undefined && MOVING.has(ctx.event.occasion) && this.watch.silenceWatched(ctx.adapter)
        ? this.watch.waiting(ctx.threadId)
        : Effect.void;
    return { facet: next, after: Effect.andThen(Effect.andThen(Effect.andThen(dropped, landing.after), closed), silent) };
  });

  private diagnostics(runId: string, ctx: Ctx): Effect.Effect<void, HarnessFailure> {
    const calls = ctx.reported.diagnostics ?? [];
    if (calls.length === 0) return Effect.void;
    return Effect.asVoid(
      this.apply(ctx, [
        this.journal.reports.recorded(
          { id: runId, threadId: ctx.threadId },
          calls.map((call) => callSettled(runId, call, ctx.event.observedAt)),
          evidenceOf(ctx.event, 'diagnostics'),
        ),
      ]),
    );
  }

  private occasion(facet: ExternalSession, ctx: Ctx, receipt: HarnessReceipt): Effect.Effect<Landing, HarnessFailure> {
    if ((ctx.raw.notification_type ?? ctx.raw.notificationType) === 'idle_prompt') {
      return Effect.succeed({ facet, after: this.watch.promptReturned(ctx.threadId) });
    }
    switch (ctx.event.occasion) {
      case 'turn-start':
        return Effect.map(this.started(facet, ctx), (landing) => {
          const run = landing.facet.turn?.run;
          return run === undefined
            ? landing
            : { ...landing, after: Effect.andThen(landing.after, Effect.andThen(this.titled(ctx.threadId, run), this.phase(ctx, run))) };
        });
      case 'activity':
      case 'wait':
        return this.active(facet, ctx);
      case 'turn-end':
        return this.ended(facet, ctx, receipt);
      default:
        return Effect.succeed({ facet, after: Effect.void });
    }
  }

  private phase(ctx: Ctx, run: string): Effect.Effect<void> {
    if (ctx.event.childId !== undefined) return Effect.void;
    const call = ctx.reported.call;
    const tools = ctx.event.occasion === 'activity' && call !== undefined && call.done !== true;
    return this.journal.reports.live({ id: run, threadId: ctx.threadId }, { op: 'phase', phase: tools ? 'tools' : null });
  }

  private apply(ctx: Ctx, plans: readonly ReportPlan[]): Effect.Effect<readonly ReportResult[], HarnessFailure> {
    return Effect.tap(
      Effect.mapError(this.journal.apply(ctx.unit, plans), (cause): HarnessFailure => cause as unknown as HarnessFailure),
      (results) =>
        Effect.sync(() => {
          if (results.some((each) => each.status === 'unowned')) ctx.lost.unowned = true;
        }),
    );
  }

  private readonly opened = Effect.fnUntraced(function* (
    this: TerminalEvents,
    facet: ExternalSession,
    ctx: Ctx,
    entries: (runId: string) => readonly ThreadEventBody[],
    displaces: string | null,
  ): Effect.fn.Return<Opened, HarnessFailure> {
    const [observed] = yield* this.apply(ctx, [
      this.journal.reports.observed(ctx.threadId, { displaces, approval: ctx.approval, entries }, evidenceOf(ctx.event, 'observed')),
    ]);
    if (observed === undefined || (observed.status !== 'applied' && observed.status !== 'replayed')) return { facet, run: null };
    yield* ctx.unit.afterCommit(this.journal.open({ id: observed.runId, threadId: ctx.threadId }, facet, []).pipe(Effect.orDie));
    const turn = {
      run: observed.runId,
      turn: reusedAs(facet, ctx.event.turnId),
      openedAt: ctx.event.observedAt,
      offset: null,
    };
    return { facet: { ...facet, turn }, run: observed.runId };
  });

  private readonly started = Effect.fnUntraced(function* (
    this: TerminalEvents,
    facet: ExternalSession,
    ctx: Ctx,
  ): Effect.fn.Return<Landing, HarnessFailure> {
    const markers = ctx.reported.inputs ?? [];
    const words = (ctx.reported.prompt ?? '').trim();
    const vendor = ctx.event.turnId;
    const turn = facet.turn;
    const at = ctx.event.observedAt;
    if (turn !== undefined && turn.turn === null) {
      if (markers.length > 0) {
        const run = { id: turn.run, threadId: ctx.threadId };
        const plans: ReportPlan[] = [this.journal.reports.fate(run, 'read', markers)];
        if (turn.words !== undefined)
          plans.push(this.journal.reports.recorded(run, [userWords(turn.run, turn.words)], `words:${turn.run}`));
        if (words !== '') {
          plans.push(
            this.journal.reports.recorded(run, [userWords(turn.run, words, `${turn.run}:${at}`)], evidenceOf(ctx.event, 'operator')),
          );
        }
        yield* this.apply(ctx, plans);
        const { words: _written, ...settled } = turn;
        return {
          facet: { ...facet, turn: { ...settled, turn: reusedAs(facet, vendor) }, unread: without(facet, markers) },
          after: this.watch.mark(ctx.threadId),
        };
      }
      if (words !== '' && (turn.typed ?? []).some((shape) => shape.digest === typedShape(words).digest))
        return { facet: { ...facet, turn: { ...turn, turn: reusedAs(facet, vendor) } }, after: this.watch.mark(ctx.threadId) };
      const landed = yield* this.opened(facet, ctx, (runId) => (words === '' ? [] : [userWords(runId, words)]), turn.run);
      return { facet: landed.facet, after: landed.run === null ? Effect.void : this.opening(landed.run, ctx.threadId, turn.run) };
    }
    if (turn !== undefined && sameStart(turn.turn, vendor)) {
      const run = { id: turn.run, threadId: ctx.threadId };
      const plans: ReportPlan[] = [];
      if (markers.length > 0) plans.push(this.journal.reports.fate(run, 'read', markers));
      if (markers.length > 0 && turn.words !== undefined) {
        plans.push(this.journal.reports.recorded(run, [userWords(turn.run, turn.words)], `words:${turn.run}`));
      }
      if (words !== '') {
        plans.push(this.journal.reports.recorded(run, [userWords(turn.run, words, `${turn.run}:${at}`)], evidenceOf(ctx.event, 'words')));
      }
      if (plans.length > 0) yield* this.apply(ctx, plans);
      if (markers.length === 0) return { facet, after: Effect.void };
      const { words: _written, ...settled } = turn;
      return { facet: { ...facet, turn: settled, unread: without(facet, markers) }, after: Effect.void };
    }
    if (turn !== undefined) {
      const run = { id: turn.run, threadId: ctx.threadId };
      const proof = ctx.proven !== null && ctx.proven.run === turn.run ? ctx.proven : null;
      const closing: ReportPlan[] =
        proof !== null && proof.message !== null && proof.ending.kind === 'completed'
          ? [this.journal.reports.recorded(run, [assistantWords(turn.run, turn.spoke ?? 0, proof.message, at)], `tail:${turn.run}`)]
          : [];
      yield* this.apply(ctx, [...closing, ...this.closing.close(run, proof?.ending ?? { kind: 'completed', unobserved: true }, ctx.spent)]);
      const settled = closedWords(this.journal, ctx.threadId, { ...stripped(facet), ...retired(turn) }, turn.run);
      yield* this.apply(ctx, settled.plans);
      const landed = yield* this.opened(settled.facet, ctx, (runId) => (words === '' ? [] : [userWords(runId, words)]), null);
      if (landed.run !== null && markers.length > 0) {
        const reader = { id: landed.run, threadId: ctx.threadId };
        const plans: ReportPlan[] = [this.journal.reports.fate(reader, 'read', markers)];
        if (turn.words !== undefined)
          plans.push(this.journal.reports.recorded(reader, [userWords(landed.run, turn.words)], `words:${landed.run}`));
        yield* this.apply(ctx, plans);
        return {
          facet: { ...landed.facet, unread: without(facet, markers) },
          after: this.replacing(turn.run, landed.run, ctx.threadId),
        };
      }
      return { facet: landed.facet, after: this.replacing(turn.run, landed.run, ctx.threadId) };
    }
    const landed = yield* this.opened(facet, ctx, (runId) => (words === '' ? [] : [userWords(runId, words)]), null);
    const reader = markers.length > 0 ? landed.run : null;
    if (reader !== null) yield* this.apply(ctx, [this.journal.reports.fate({ id: reader, threadId: ctx.threadId }, 'read', markers)]);
    return {
      facet: reader === null ? landed.facet : { ...landed.facet, unread: without(landed.facet, markers) },
      after:
        landed.run === null
          ? Effect.void
          : Effect.andThen(
              Effect.sync(() => this.open.add(landed.run!, ctx.threadId)),
              this.watch.mark(ctx.threadId),
            ),
    };
  });

  private opening(next: string, threadId: string, displaced: string): Effect.Effect<void> {
    return Effect.andThen(
      Effect.sync(() => {
        this.open.drop(displaced);
        this.open.add(next, threadId);
      }),
      this.watch.mark(threadId),
    );
  }

  private replacing(old: string, next: string | null, threadId: string): Effect.Effect<void> {
    return Effect.andThen(
      Effect.sync(() => {
        this.open.drop(old);
        if (next !== null) this.open.add(next, threadId);
      }),
      next === null ? Effect.void : this.watch.mark(threadId),
    );
  }

  private readonly active = Effect.fnUntraced(function* (
    this: TerminalEvents,
    facet: ExternalSession,
    ctx: Ctx,
  ): Effect.fn.Return<Landing, HarnessFailure> {
    const call = ctx.reported.call;
    const said = ctx.adapter.answerKey === null ? undefined : ctx.reported.said?.[ctx.adapter.answerKey];
    const at = ctx.event.observedAt;
    const turn = facet.turn;
    const entries = (runId: string, index: number): readonly ThreadEventBody[] => [
      ...(call === undefined ? [] : [call.done === true ? callSettled(runId, call, at) : callOpened(runId, call, at)]),
      ...(said === undefined || said === '' ? [] : [assistantWords(runId, index, said, at)]),
    ];
    if (turn !== undefined) {
      if (at < turn.openedAt) return { facet, after: Effect.void };
      const known = turn.turn === UNTURNED ? null : turn.turn;
      if (!sameTurn(known, ctx.event.turnId)) return { facet, after: Effect.void };
      const moved = this.phase(ctx, turn.run);
      const pending = entries(turn.run, turn.spoke ?? 0);
      if (pending.length === 0) return { facet, after: moved };
      yield* this.apply(ctx, [
        this.journal.reports.recorded({ id: turn.run, threadId: ctx.threadId }, pending, evidenceOf(ctx.event, 'activity')),
      ]);
      const spoke = said === undefined || said === '' ? turn.spoke : (turn.spoke ?? 0) + 1;
      return { facet: spoke === turn.spoke ? facet : { ...facet, turn: { ...turn, spoke } }, after: moved };
    }
    if (call === undefined) return { facet, after: Effect.void };
    const landed = yield* this.opened(facet, ctx, () => [], null);
    if (landed.run === null) return { facet: landed.facet, after: Effect.void };
    const spoke = said === undefined || said === '' ? 0 : 1;
    yield* this.apply(ctx, [
      this.journal.reports.recorded({ id: landed.run, threadId: ctx.threadId }, entries(landed.run, 0), evidenceOf(ctx.event, 'activity')),
    ]);
    const opened = landed.facet.turn;
    const run = landed.run;
    return {
      facet: opened === undefined ? landed.facet : { ...landed.facet, turn: { ...opened, spoke } },
      after: Effect.andThen(
        Effect.sync(() => this.open.add(run, ctx.threadId)),
        Effect.andThen(this.watch.mark(ctx.threadId), this.phase(ctx, run)),
      ),
    };
  });

  private readonly ended = Effect.fnUntraced(function* (
    this: TerminalEvents,
    facet: ExternalSession,
    ctx: Ctx,
    receipt: HarnessReceipt,
  ): Effect.fn.Return<Landing, HarnessFailure> {
    const turn = facet.turn;
    const name = ctx.raw.hook_event_name ?? ctx.raw.hookEventName;
    const events = ctx.adapter.hooks?.events;
    if (turn === undefined || (name !== undefined && name === events?.sessionEnd)) return { facet, after: Effect.void };
    const known = turn.turn === UNTURNED ? null : turn.turn;
    if (ctx.event.occasion === 'turn-end' && !sameTurn(known, ctx.event.turnId)) return { facet, after: Effect.void };
    if (ctx.event.observedAt < turn.openedAt) return { facet, after: Effect.void };
    const run = { id: turn.run, threadId: ctx.threadId };
    const text = ctx.adapter.answerKey === null ? '' : (ctx.reported.said?.[ctx.adapter.answerKey] ?? '').trim();
    if (receipt.outcome === 'kept' && ctx.event.rootKey !== null && text !== '') {
      return { facet: held(facet, ctx, text), after: Effect.void };
    }
    const status = typeof ctx.raw.status === 'string' ? ctx.raw.status : null;
    const failure = name !== undefined && name === events?.stopFailure;
    const interrupted = ctx.proven !== null && ctx.proven.run === turn.run && ctx.proven.ending.kind === 'aborted';
    const ending =
      status === 'aborted' || (status === 'error' && interrupted)
        ? ({ kind: 'aborted', stoppedBy: 'reader' } as const)
        : status === 'error' || failure
          ? ({ kind: 'failed', reason: failureLine(ctx), cause: (failure ? ctx.adapter.failureOf?.(ctx.raw) : null) ?? undefined } as const)
          : ({ kind: 'completed' } as const);
    const plans: ReportPlan[] = [];
    if (text !== '' && ending.kind === 'completed') {
      plans.push(
        this.journal.reports.recorded(
          run,
          [assistantWords(turn.run, turn.spoke ?? 0, text, ctx.event.observedAt)],
          evidenceOf(ctx.event, 'answer'),
        ),
      );
    }
    plans.push(...this.closing.close(run, ending, ctx.spent));
    const results = yield* this.apply(ctx, plans);
    const closed = results.at(-1)?.status;
    if (closed === 'unowned') return { facet, after: Effect.void };
    const { turn: _gone, ...bare } = facet;
    const settled = closedWords(this.journal, ctx.threadId, { ...bare, ...retired(turn) }, turn.run);
    yield* this.apply(ctx, settled.plans);
    return { facet: settled.facet, after: Effect.sync(() => this.open.drop(turn.run)) };
  });
}

const failureLine = (ctx: Ctx): string => {
  const detail = ctx.raw.error ?? ctx.raw.reason;
  return typeof detail === 'string' && detail !== '' ? detail.slice(0, HARNESS_DETAIL_MAX) : 'the CLI ended its turn with an error';
};

const SEALED: ReadonlySet<HarnessEvent['occasion']> = new Set(['turn-start', 'activity', 'wait', 'turn-end']);

const stripped = (facet: ExternalSession): ExternalSession => {
  if (facet.turn === undefined) return facet;
  const { turn: _gone, ...rest } = facet;
  return rest;
};

const without = (facet: ExternalSession, items: readonly string[]): ExternalSession['unread'] => {
  const taken = new Set(items);
  return (facet.unread ?? [])
    .map((entry) => ({ ...entry, items: entry.items.filter((id) => !taken.has(id)) }))
    .filter((entry) => entry.items.length > 0);
};

const held = (facet: ExternalSession, ctx: Ctx, text: string): ExternalSession => {
  const session = facet.session;
  const rootKey = ctx.event.rootKey;
  if (session === undefined || rootKey === null) return facet;
  const turn = ctx.event.turnId ?? ctx.reported.receipt ?? crypto.randomUUID();
  const standing = facet.held;
  const kept = standing === undefined || standing.session !== session.id ? [] : standing.entries;
  if (kept.some((entry) => entry.turn === turn)) return facet;
  return {
    ...facet,
    held: { session: session.id, entries: [...kept, { turn, text, rootKey, at: ctx.event.observedAt }].slice(-8) },
  };
};

const takenTurn = (before: HarnessTurn | undefined, after: HarnessTurn | undefined): HarnessTurn | null =>
  after === undefined || after.turn === null || (before?.run === after.run && before.turn !== null) ? null : after;

const addressOf = (adapter: HarnessAdapter, turn: HarnessTurn): string | null => {
  const address = adapter.launch?.address;
  if (address === undefined) return null;
  return address.reads === 'turn' ? address.of({ turn: turn.turn === UNTURNED ? null : turn.turn, before: null }) : (turn.address ?? null);
};

const reusedAs = (facet: ExternalSession, vendor: string | null): string =>
  vendor === null || vendor === facet.lastTurn ? UNTURNED : vendor;

const retired = (turn: NonNullable<ExternalSession['turn']>): { readonly lastTurn?: string } =>
  turn.turn === null || turn.turn === UNTURNED ? {} : { lastTurn: turn.turn };
