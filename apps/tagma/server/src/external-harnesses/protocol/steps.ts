import { Clock, Effect, FiberMap, Semaphore } from 'effect';
import { act, answer as answerAsk, checkpoint, kept as unsealed, receive } from '@runlith/acp/client';
import type { Answer, ClientEvent, Intent, Observation, Outbound, Receipt, Step } from '@runlith/acp/events';
import type { Inbound } from '@runlith/ndjson-rpc/exchange';
import type { ClientState } from '@runlith/acp/state';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { ThreadEntry, ThreadToolEntry } from '@runlith/agent/transcript/entries';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { AdapterDisplay, ReportPlan, ReportResult } from '@runlith/agent/thread/run/lifecycle/RunReports';
import { completeJsonState } from '@runlith/utils/json';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { currentModel } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { VendorTurns } from '../store/turns.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import { harnessServed } from '../sessions/model.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { RunActivities } from './activities.js';
import { questionId, resolutionsOf } from './asks.js';
import type { AskLandings } from './landings.js';
import { settledFacet, type Seated } from './facets.js';
import { UNWRITTEN, type ProtocolJournal } from './journal.js';
import type { Written } from './link.js';
import type { Link, Linked, ProtocolLinks } from './links.js';
import type { Answers } from './methods/answers.js';
import type { Answered, AsideOutcome, Fate, WithdrawOutcome } from './methods/declaration.js';
import { doubted, read } from './methods/declared.js';
import type { AcpProfile } from '@runlith/tagma/adapter/harness';
import { MEASURED } from '../contract/wire/extensions.js';
import { liveOf } from './live.js';
import { contextsOf, measurementOf, measures, type Measurement } from './measure.js';
import { boundedClient } from './calls.js';
import type { HostedIntroductions } from './introductions.js';
import { textOf } from './content.js';
import { project, standingIds, type Interrupted, type Sealed } from './projection.js';
import { stamped, type OpenedTurn, type ProtocolRow } from './row.js';
import { begunOf, unsaidNotes } from './noted.js';
import type { HarnessRetry, HarnessTurnBegun, HarnessTurnEnded, HarnessTurnFate, HarnessTurnStarted } from './turns.js';
import { interruptedCompaction } from './methods/compact.js';
import { cancels, ProtocolWriter, type Cancel, type Landing } from './writing.js';

const REACTIONS: ReadonlySet<ClientEvent['_tag']> = new Set([
  'Initialized',
  'SessionReady',
  'ModeChanged',
  'ConfigChanged',
  'ExtensionAnswered',
  'RequestFailed',
  'Asked',
  'ToolCallEnded',
  'TurnEnded',
]);

export type Closed = { readonly ending: HarnessTurnEnded; readonly status: ReportResult['status'] };

export type Persisted = {
  readonly begun: readonly string[];
  readonly ended: readonly OpenedTurn[];
  readonly endings: readonly Closed[];
  readonly events: readonly ClientEvent[];
};

export type Issued = Persisted & { readonly request: string | null };

export type Received = { readonly persisted: Persisted; readonly taken: number };

export type Unitwork = (facet: ExternalSession, unit: WriteUnit<'machine'>, row: ProtocolRow) => Effect.Effect<Seated, HarnessFailure>;

export type StepPlan = {
  readonly row?: (row: ProtocolRow, request: string | null) => ProtocolRow;
  readonly interrupted?: { readonly turns: readonly string[]; readonly by: ThreadRunStoppedBy | null };
  readonly started?: readonly HarnessTurnStarted[];
  readonly begun?: readonly HarnessTurnBegun[];
  readonly ended?: readonly HarnessTurnEnded[];
  readonly boundaries?: readonly ThreadEntry[];
  readonly reports?: readonly ReportPlan[];
  readonly within?: Unitwork;
  readonly tail?: true;
};

export const IDLE: Persisted = { events: [], begun: [], ended: [], endings: [] };

const moved = (before: ClientState, event: ClientEvent): boolean =>
  event._tag === 'ToolCallChanged' &&
  event.update.status != null &&
  before.turn?.calls[event.call.toolCallId]?.status !== event.update.status;

const heard = (link: Link, key: string, event: ClientEvent): void => {
  const standing = link.noise.get(key);
  if (standing !== undefined) standing.count += 1;
  else link.noise.set(key, { count: 1, sample: JSON.stringify(event).slice(0, 512) });
};

const noisy = (link: Link, event: ClientEvent): void => {
  const key =
    event._tag === 'Unrecognized' ? event.method : event._tag === 'Malformed' ? '(malformed)' : event._tag === 'Stray' ? '(stray)' : null;
  if (key !== null && !link.profile.extensions.includes(key)) heard(link, key, event);
};

const cancelledTurn = (row: ProtocolRow): string | null =>
  row.client.requests.flatMap((request) => (request.meaning === 'prompt' && request.cancelled ? [request.turn] : [])).at(0) ?? null;

const fatesOf = (events: readonly ClientEvent[]): readonly Fate[] =>
  events.flatMap((event): Fate[] => {
    if (event._tag !== 'TurnEnded') return [];
    if (event.delivery === 'accepted') return [{ _tag: 'Confirmed', turn: event.turn, envelopes: event.envelopes }];
    return event.delivery === 'refused' ? [{ _tag: 'Returned', turn: event.turn, envelopes: event.envelopes }] : [];
  });

const FATES: Readonly<Record<Fate['_tag'], HarnessTurnFate['fate']>> = {
  Confirmed: 'read',
  Returned: 'returned',
  Unconfirmed: 'unconfirmed',
  Withdrawn: 'withdrawn',
  Acknowledged: 'acknowledged',
};

const fateOf = (fate: Fate): HarnessTurnFate => ({
  fate: FATES[fate._tag],
  turn: fate.turn,
  items: fate._tag === 'Acknowledged' ? fate.ids : fate.envelopes,
  noted: fate._tag === 'Acknowledged' ? undefined : fate.noted,
});

export class ProtocolSteps {
  private readonly joined;
  private readonly held;

  constructor(
    private readonly links: ProtocolLinks,
    private readonly answers: Answers<AsideOutcome>,
    private readonly withdrawals: Answers<WithdrawOutcome>,
    private readonly store: HarnessSessionStore,
    private readonly rows: ProtocolRows,
    private readonly turns: VendorTurns,
    private readonly journal: ProtocolJournal,
    private readonly inbox: ThreadInbox['Service'],
    private readonly writing: TerminalWriting['Service'],
    private readonly lanes: HarnessLanes,
    private readonly activities: RunActivities,
    private readonly landings: AskLandings,
    private readonly display: AdapterDisplay,
    private readonly tails: FiberMap.FiberMap<string, void, never>,
    private readonly introductions: HostedIntroductions,
  ) {
    this.joined = writes('ProtocolSteps.persist', [], rows.writes, turns.writes, journal.writes, inbox.writes);
    this.held = writes('ProtocolSteps.stored', [], rows.writes, turns.writes);
  }

  reacts(event: ClientEvent): boolean {
    return REACTIONS.has(event._tag);
  }

  private tailing(threadId: string): Effect.Effect<void> {
    const due = Effect.andThen(
      Effect.sleep(this.journal.tailEveryMs),
      Effect.suspend(() => this.tailed(threadId)),
    );
    const logged = Effect.flatMap(Effect.result(due), (done) =>
      done._tag === 'Failure'
        ? Effect.logWarning('the open tail of a turn was not saved', { threadId, failure: done.failure })
        : Effect.void,
    );
    return Effect.asVoid(FiberMap.run(this.tails, threadId, logged, { onlyIfMissing: true }));
  }

  private tailed(threadId: string): Effect.Effect<void, HarnessFailure> {
    const link = this.links.get(threadId);
    if (link === undefined || !this.journal.tailDue(threadId, link.row.client.turn?.id ?? null)) return Effect.void;
    return Effect.asVoid(this.links.locked(link, this.persist(link, {}, false)));
  }

  readonly link = Effect.fnUntraced(function* (
    this: ProtocolSteps,
    facet: ExternalSession,
    sessionId: string,
    { adapter, profile }: Linked,
    threadId: string,
    row: ProtocolRow,
  ) {
    const writer = yield* ProtocolWriter.make(this.writing, this.lanes, sessionId);
    const going = row.turns.at(-1);
    const asked = going === undefined ? yield* this.store.asked(threadId) : yield* this.store.ranOn(going.id);
    for (const turn of row.turns)
      yield* this.activities.open(threadId, facet.name, { turn: turn.id, model: currentModel(facet.observation), reasoning: null });
    for (const turn of row.turns) this.introductions.opening(threadId, turn.id, true);
    const active = row.client.turn;
    const turn = row.turns.find((turn) => turn.id === active?.id);
    if (active?.message != null && turn !== undefined) {
      const stream = active.message.stream === 'message' ? 'message' : 'reasoning';
      yield* this.journal.live(
        { id: turn.id, threadId },
        { op: 'append', stream, part: turn.parts[stream === 'message' ? 'text' : 'reasoning'], text: textOf(active.message.content) },
      );
    }
    const link: Link = {
      threadId,
      sessionId,
      name: facet.name,
      adapter,
      profile,
      lock: Semaphore.makeUnsafe(1),
      writer,
      row,
      facet,
      asked,
      tried: new Map(),
      refused: null,
      poisoned: null,
      refusal: null,
      halted: false,
      stale: false,
      ended: null,
      activeAt: 0,
      noise: new Map(),
    };
    return link;
  });

  observe(link: Link, observation: Observation, plan: StepPlan = {}): Effect.Effect<Persisted, HarnessFailure> {
    return Effect.suspend(() => this.run(link, receive(link.row.client, observation), plan, null));
  }

  received(link: Link, inbound: ReadonlyArray<Inbound>, from: number): Effect.Effect<Received, HarnessFailure> {
    return Effect.suspend(() => {
      let state = link.row.client;
      const frames: Outbound[] = [];
      const events: ClientEvent[] = [];
      let durable = false;
      let taken = 0;
      for (let index = from; index < inbound.length; index += 1) {
        const step = receive(state, { _tag: 'Frame', inbound: inbound[index]! });
        taken += 1;
        state = step.state;
        frames.push(...step.frames);
        events.push(...step.events);
        durable ||= step.durable;
        if (step.events.some((event) => this.reacts(event))) break;
      }
      return Effect.map(this.run(link, { state, frames, events, durable }, {}, null), (persisted) => ({ persisted, taken }));
    });
  }

  intend(link: Link, intent: Intent, plan: StepPlan = {}): Effect.Effect<Issued, HarnessFailure> {
    return Effect.suspend(() => {
      const acted = act(link.row.client, intent);
      return Effect.map(this.run(link, acted, plan, acted.request), (persisted) => ({ ...persisted, request: acted.request }));
    });
  }

  answer(link: Link, id: string | number, reply: Answer, plan: StepPlan = {}): Effect.Effect<Persisted | null, HarnessFailure> {
    return Effect.suspend(() => {
      const step = answerAsk(link.row.client, id, reply);
      return step._tag === 'Failure' ? Effect.succeed(null) : this.run(link, step.success, plan, null);
    });
  }

  persist(link: Link, plan: StepPlan, sealing = true): Effect.Effect<Persisted, HarnessFailure> {
    return Effect.suspend(() => this.run(link, (sealing ? checkpoint : unsealed)(link.row.client), plan, null));
  }

  sealed(run: ThreadRunRow): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      const link = this.links.get(run.threadId);
      if (link === undefined) return Effect.void;
      return this.links.locked(
        link,
        Effect.andThen(
          link.row.client.turn?.message != null ? this.persist(link, {}) : Effect.void,
          this.journal.live(run, { op: 'close' }),
        ),
      );
    });
  }

  forsaken(link: Link): Effect.Effect<void> {
    return Effect.forEach(link.row.turns, (turn) => this.journal.live({ id: turn.id, threadId: link.threadId }, { op: 'close' }), {
      discard: true,
    });
  }

  stored(threadId: string, work: Unitwork): Effect.Effect<Seated, HarnessFailure> {
    const { rows } = this;
    return this.store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const row = yield* rows.read(unit, threadId);
          if (row === null)
            return yield* new GateRefusal('harness-contract', 'This conversation has no protocol row.', [
              'read the thread; its conversation stands as it was',
            ]);
          const next = yield* work(facet, unit, row);
          yield* rows.write(unit, threadId, next.row);
          return { facet: next.facet, value: next };
        }),
      this.held,
    );
  }

  landed(link: Link, landing: Landing): Effect.Effect<Persisted, HarnessFailure> {
    return Effect.suspend(() =>
      landing._tag === 'Frame'
        ? this.settle(link, landing.receipt, landing.written)
        : this.interrupted(link, landing.cancel, landing.written),
    );
  }

  private readonly interrupted = Effect.fnUntraced(function* (this: ProtocolSteps, link: Link, cancel: Cancel, written: Written) {
    if (written._tag !== 'Admitted') {
      if (written.poisoned) link.poisoned ??= written.reason;
      cancel.written = written;
      return IDLE;
    }
    const turns = link.row.turns.filter((turn) => cancel.turns.has(turn.id)).map((turn) => turn.id);
    const key = link.facet.sessionKey;
    const going = key !== null && link.row.client.requests.some((request) => request.meaning === 'prompt' && !request.cancelled);
    if (turns.length === 0 && !going) {
      cancel.written = written;
      return IDLE;
    }
    const acted = key === null ? unsealed(link.row.client) : act(link.row.client, { _tag: 'Cancel', params: { sessionId: key } });
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const compaction = interruptedCompaction(link.row, turns, at);
    const persisted = yield* this.run(
      link,
      { ...acted, frames: acted.frames.filter((outbound) => !cancels(outbound)) },
      { interrupted: { turns, by: cancel.by }, boundaries: compaction === null ? undefined : [compaction], tail: true },
      null,
    );
    cancel.written = written;
    return persisted;
  });

  readonly close = Effect.fnUntraced(function* (
    this: ProtocolSteps,
    threadId: string,
    name: HarnessName,
    ending: HarnessTurnEnded,
    fates: readonly HarnessTurnFate[] = [],
    begun: readonly HarnessTurnBegun[] = [],
  ) {
    const { journal, store, joined, activities } = this;
    const written = yield* journal.prepare(threadId, {
      name,
      evidence: `close:${ending.turn}`,
      started: [],
      begun,
      boundaries: [],
      messages: undefined,
      fates,
      ended: [ending],
      contexts: [],
      retries: [],
      subject: ending.turn,
      tail: false,
    });
    if (written === null) return;
    const settled = yield* journal.cut(
      threadId,
      store.settle(
        threadId,
        (facet, unit) =>
          Effect.flatMap(written.opened(unit, []), () => Effect.map(written.closed(unit), () => ({ facet, value: undefined }))),
        joined,
      ),
    );
    yield* store.announce(threadId, settled);
    yield* activities.end(ending);
    yield* journal.publish(threadId);
  });

  readonly lapse = Effect.fnUntraced(function* (this: ProtocolSteps, threadId: string) {
    const { journal, store, joined, inbox } = this;
    yield* journal.cut(
      threadId,
      store.settle(
        threadId,
        (facet, unit) =>
          Effect.gen(function* () {
            const held = yield* inbox.unconfirmedOf(threadId, unit);
            const plans = [...held].map(([run, items]) => journal.lapsed({ id: run, threadId }, items));
            if (plans.length > 0) yield* UNWRITTEN.opened(unit, plans);
            return { facet, value: undefined };
          }),
        joined,
      ),
    );
    yield* journal.publish(threadId);
  });

  private readonly run = Effect.fnUntraced(function* (
    this: ProtocolSteps,
    link: Link,
    input: Step,
    plan: StepPlan,
    request: string | null,
  ) {
    const { journal, links } = this;
    const epoch = link.writer.generation();
    const step = {
      ...input,
      state: boundedClient(input, (ask) => link.row.asked.includes(ask.id)),
    };
    for (const event of step.events) noisy(link, event);
    const read = liveOf(link.row.turns, link.threadId, step.events);
    for (const event of read.unread) heard(link, event.method, event);
    for (const one of read.live) yield* journal.live(one.run, one.delta);
    if (read.live.length > 0) yield* this.tailing(link.threadId);
    let persisted: Persisted = { events: step.events, begun: [], ended: [], endings: [] };
    if (
      step.durable ||
      plan.row !== undefined ||
      plan.within !== undefined ||
      plan.boundaries !== undefined ||
      plan.begun !== undefined ||
      plan.interrupted !== undefined ||
      plan.tail === true ||
      step.events.some((event) => measures(event) || moved(link.row.client, event)) ||
      journal.tailDue(link.threadId, step.state.turn?.id ?? null)
    ) {
      persisted = yield* this.saved(link, step, plan, request);
    } else {
      const projected = project(
        step.events,
        link.row.turns,
        new Date(yield* Clock.currentTimeMillis).toISOString(),
        link.profile.hosts !== null,
        undefined,
        link.facet.session?.cwd || null,
      );
      links.landed(link, {
        ...link.row,
        turns: projected.turns,
        client: step.state,
        rejections: step.state.turn === null ? link.row.rejections : 0,
      });
    }
    yield* link.writer.enqueue(step.frames, epoch);
    return persisted;
  });

  private readonly settle = Effect.fnUntraced(function* (this: ProtocolSteps, link: Link, receipt: Receipt | null, written: Written) {
    const delivered = receipt?._tag === 'Answer' ? this.deliveredAsk(link, receipt.id, written) : undefined;
    const persisted = yield* this.landing(link, receipt, written, delivered);
    if (receipt?._tag === 'Answer') {
      const delivery = written._tag === 'Admitted' ? 'delivered' : written._tag === 'Unknown' ? 'unknown' : 'unwritten';
      yield* this.landings.settle(link.threadId, receipt.id, delivery);
    }
    return persisted;
  });

  private deliveredAsk(link: Link, id: string | number, written: Written): StepPlan | undefined {
    const ask = link.row.client.asks.find((standing) => standing.id === id);
    if (written._tag !== 'Admitted' || ask?.kind !== 'permission' || ask.turn === null || !link.row.asked.includes(id)) return undefined;
    return {
      row: (row) => ({ ...row, asked: row.asked.filter((standing) => standing !== id) }),
      reports: [this.journal.resolved({ id: ask.turn, threadId: link.threadId }, questionId(id), `delivered:${String(id)}`, 'answered')],
    };
  }

  private landing(
    link: Link,
    receipt: Receipt | null,
    written: Written,
    delivered: StepPlan | undefined,
  ): Effect.Effect<Persisted, HarnessFailure> {
    if (written._tag !== 'Admitted' && written.poisoned) link.poisoned = written.reason;
    if (receipt === null) return Effect.succeed(IDLE);
    const failed = written._tag === 'Admitted' ? null : written;
    const request = receipt._tag === 'Request' ? link.row.client.requests.find((standing) => standing.id === receipt.id) : undefined;
    const prompt = request?.meaning === 'prompt' ? request : undefined;
    if (failed === null) {
      const turn = prompt === undefined ? undefined : link.row.turns.find((opened) => opened.id === prompt.turn);
      const after = receive(link.row.client, { _tag: 'Admitted', receipt });
      const steering = request === undefined ? undefined : link.row.steering.find((standing) => standing.request === request.id);
      const handing: StepPlan =
        steering === undefined || request?.meaning !== 'extension'
          ? {}
          : { reports: [this.journal.handed({ id: steering.turn, threadId: link.threadId }, request.envelopes)] };
      if (prompt === undefined) return this.run(link, after, delivered ?? handing, null);
      return Effect.andThen(
        this.journal.live({ id: prompt.turn, threadId: link.threadId }, { op: 'phase', phase: 'calling' }),
        this.saved(link, after, { begun: turn === undefined ? [] : [begunOf(turn, prompt.envelopes)] }, null),
      );
    }
    if (failed._tag === 'Unknown') return this.observe(link, { _tag: 'Unknown', receipt });
    if (failed._tag === 'Unwritten') return this.observe(link, { _tag: 'Unwritten', receipt });
    if (prompt !== undefined) link.refused = failed.reason;
    const after = receive(link.row.client, { _tag: 'Unwritten', receipt });
    return prompt === undefined ? this.run(link, after, {}, null) : this.saved(link, after, {}, null);
  }

  private readonly saved = Effect.fnUntraced(function* (
    this: ProtocolSteps,
    link: Link,
    input: Step,
    plan: StepPlan,
    request: string | null,
  ) {
    const { journal, store, links, rows, turns, inbox, activities, answers, withdrawals: asideWithdrawals, display, joined } = this;
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    let base = plan.row === undefined ? link.row : plan.row(link.row, request);
    const events: ClientEvent[] = [];
    const projecting: (ClientEvent | Sealed | Interrupted)[] = [];
    const answered: ThreadEntry[] = [];
    const trims: string[] = [];
    const fates: Fate[] = [];
    const asides: Answered<AsideOutcome>[] = [];
    const withdrawals: Answered<WithdrawOutcome>[] = [];
    const measurements: Measurement[] = [];
    const retries: HarnessRetry[] = [];
    for (const event of input.events) {
      const measuring = measurementOf(event);
      if (measuring !== null) {
        if (measuring.context !== null) base = { ...base, context: measuring.context };
        measurements.push({ ...measuring, order: measurements.length + retries.length });
        if (measuring.unreadable) heard(link, MEASURED, event);
      }
      const declared = read(base, event, at);
      if (declared === null) {
        if (event._tag === 'Uncertain') {
          for (const doubt of doubted(base, event)) {
            base = doubt.row;
            fates.push(...doubt.fates);
          }
        }
        events.push(event);
        projecting.push(event);
        continue;
      }
      if (declared._tag === 'Undeclared') {
        heard(link, declared.method, event);
        continue;
      }
      const handled = declared.handled;
      base = handled.row;
      events.push(...handled.events);
      const sealed = handled.sealed === null || (base.turns.length === 0 && cancelledTurn(link.row) !== null) ? [] : [handled.sealed];
      projecting.push(...handled.events, ...sealed);
      answered.push(...handled.boundaries);
      if (handled.trim !== null) trims.push(handled.trim);
      fates.push(...handled.fates);
      asides.push(...handled.asides);
      withdrawals.push(...handled.withdrawals);
      retries.push(...handled.retries.map((retry) => ({ ...retry, order: measurements.length + retries.length })));
    }
    const by = plan.interrupted?.by ?? null;
    for (const turn of plan.interrupted?.turns ?? []) projecting.push({ _tag: 'Interrupted', turn, by });
    const step: Step = { ...input, events };
    let rejections = step.state.turn !== null || link.row.client.turn !== null ? 0 : base.rejections;
    let failure = base.failure;
    for (const event of events) {
      if (event._tag !== 'TurnEnded') continue;
      if (event.delivery === 'accepted') rejections = 0;
      if (event.delivery !== 'refused' || event.outcome._tag !== 'Failed') continue;
      const cause = event.outcome.cause;
      if (cause._tag !== 'Agent' && cause._tag !== 'Unwritten') continue;
      rejections += 1;
      if (rejections >= 2)
        failure = cause._tag === 'Agent' ? cause.error.message : 'The execution host refused to write to the agent twice.';
    }
    base = { ...base, rejections, failure };
    const admitted = new Set((plan.begun ?? []).map((turn) => turn.turn));
    for (const event of events) {
      if (event._tag === 'TurnEnded' && event.delivery === 'accepted') admitted.add(event.turn);
      else if ((event._tag === 'Message' || event._tag === 'ToolCallStarted') && event.turn !== null) admitted.add(event.turn);
      else if (event._tag === 'Asked' && event.ask.turn !== null) admitted.add(event.ask.turn);
    }
    const inputs = new Map(
      link.row.client.requests.flatMap((request) => (request.meaning === 'prompt' ? [[request.turn, request.envelopes] as const] : [])),
    );
    const begun = base.turns
      .filter((turn) => !turn.recorded && admitted.has(turn.id))
      .map((turn) => begunOf(turn, inputs.get(turn.id) ?? []));
    base = { ...base, turns: base.turns.map((turn) => (admitted.has(turn.id) ? { ...turn, recorded: true } : turn)) };
    const hosted = link.profile.hosts !== null;
    const standing = new Map<string, ThreadToolEntry>();
    for (const id of standingIds(events, hosted)) {
      const entry = yield* journal.tool(link.threadId, id);
      if (entry !== null) standing.set(id, entry);
    }
    const projected = project(projecting, base.turns, at, hosted, standing, link.facet.session?.cwd || null, (name, input) =>
      display(link.threadId, name, completeJsonState(input)),
    );
    const ended = [...projected.ended, ...(plan.ended ?? [])];
    const resolved = resolutionsOf(events, link.row.client.asks).map((each) =>
      journal.resolved({ id: each.turn, threadId: link.threadId }, questionId(each.ask), `resolved:${each.ask}`),
    );
    const compacted = link.row.compact !== null && base.compact === null;
    const last = ended.at(-1)?.turn ?? null;
    const measuredIn = base.turns.at(-1)?.id ?? last ?? cancelledTurn(link.row);
    const served = harnessServed(link.adapter, link.facet, link.asked);
    const contexts = contextsOf(measurements, {
      compacted: compacted ? (last ?? measuredIn) : null,
      measuredIn,
      at,
      served,
      base: base.context,
    });
    const settled = [
      ...fates.map(fateOf),
      ...fatesOf(events).map((fate) => ({ ...fateOf(unsaidNotes(base.turns, fate)), recorded: true as const })),
    ];
    const written = yield* journal.prepare(link.threadId, {
      name: link.name,
      evidence: `${step.state.incarnation}:${step.state.cursor.offset}:${step.state.counter}`,
      started: plan.started ?? [],
      begun,
      messages: projected.messages,
      boundaries: [...(plan.boundaries ?? []), ...answered, ...projected.boundaries],
      fates: settled,
      ended,
      contexts,
      retries,
      subject: base.turns.at(-1)?.id ?? last,
      tail: plan.tail === true,
    });
    const row: ProtocolRow = {
      ...base,
      client: step.state,
      failure: base.failure ?? projected.failure,
      turns: projected.turns,
      sent: stamped(base.sent, link.row.client.requests, step.state.requests, at),
    };
    const settledStep = yield* journal.cut(
      link.threadId,
      store.settle(
        link.threadId,
        (current, unit) =>
          Effect.gen(function* () {
            const within = plan.within === undefined ? { facet: current, row } : yield* plan.within(current, unit, row);
            const seated = settledFacet(within.facet, events, within, link.profile.reportedModel, at);
            yield* rows.write(unit, link.threadId, seated.row);
            for (const at of trims) yield* turns.cut(unit, link.threadId, current.sessionKey, at);
            yield* turns.record(unit, link.threadId, projected.vendor);
            if (projected.heard) yield* turns.heard(unit, link.threadId);
            yield* unit.afterCommit(
              Effect.sync(() => {
                links.landed(link, seated.row);
                link.facet = seated.facet;
              }),
            );
            const journaled = written ?? UNWRITTEN;
            yield* journaled.opened(unit, [...(plan.reports ?? []), ...resolved]);
            const held = step.state.requests.flatMap((sent) => (sent.meaning === 'extension' ? sent.envelopes : []));
            for (const turn of ended) {
              const released = yield* inbox.releaseInput(link.threadId, turn.turn, held, unit);
              if (released.length > 0)
                yield* UNWRITTEN.opened(unit, [journal.fated({ id: turn.turn, threadId: link.threadId }, 'returned', released)]);
            }
            const closed = yield* journaled.closed(unit);
            return { facet: seated.facet, value: { seated, closed } };
          }),
        joined,
      ),
    );
    yield* store.announce(link.threadId, settledStep);
    const landed = settledStep.value;
    for (const answer of asides) answers.settle(answer);
    for (const answer of withdrawals) asideWithdrawals.settle(answer);
    for (const started of plan.started ?? []) {
      yield* activities.open(link.threadId, link.name, { turn: started.turn, model: started.model, reasoning: null });
      yield* journal.began(link.threadId, started.turn);
      this.introductions.opening(link.threadId, started.turn, false);
    }
    for (const ending of ended) yield* activities.end(ending);
    this.introductions.recorded(link.threadId, projected.messages ?? [], projected.closed.length > 0 && projected.turns.length === 0);
    if (written !== null || settled.length > 0 || (plan.reports?.length ?? 0) + resolved.length > 0) yield* journal.publish(link.threadId);
    return {
      begun: (plan.started ?? []).filter((started) => started.kind === 'turn').map((started) => started.turn),
      ended: [
        ...projected.closed,
        ...(plan.ended ?? []).map((turn) => ({
          id: turn.turn,
          startedAt: turn.at,
          parts: { text: 0, reasoning: 0 },
          assistant: [],
          said: turn.failure ?? '',
          words: '',
          recorded: true,
        })),
      ],
      endings: ended.map((ending) => ({ ending, status: landed.closed.get(ending.turn) ?? ('settled' as const) })),
      events,
    };
  });
}
