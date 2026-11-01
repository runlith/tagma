import { Effect } from 'effect';
import { foldedReferences } from '@runlith/agent/AgentDeferredTools';
import { vendorBoundaryMessage } from '@runlith/agent/AgentSignal';
import { requestDeployment } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { HarnessThreads } from '@runlith/agent/thread/AgentHarness';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadTranscript } from '@runlith/agent/transcript/rows';
import type { ThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import type {
  AdapterReports,
  ContextReport,
  MeasuredRequest,
  ReportPlan,
  ReportResult,
  RunEnding,
} from '@runlith/agent/thread/run/lifecycle/RunReports';
import {
  threadCompactionEvent,
  threadGuidanceEvent,
  threadRunMessagesEvent,
  threadUserMessageEvent,
  type ThreadEventBody,
} from '@runlith/agent/thread/events';
import type { StoredThreadAttachment } from '@runlith/agent/thread/attachmentStorage';
import type { ThreadWordFate } from '@runlith/agent/thread/storage/inbox';
import type { ThreadCompactionEntry, ThreadEntry, ThreadQuestionEntry, ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { entryOf } from '@runlith/agent/transcript/kinds';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { NativeThreadState } from '../../threads/contract/service/state.js';
import type { ThreadAttachmentStore } from '../../threads/resources/attachments.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import {
  type HarnessTurnBegun,
  type HarnessTurnContext,
  type HarnessTurnEnded,
  type HarnessTurnMessage,
  type HarnessTurnStep,
} from './turns.js';

const readingOf = (
  models: ModelCatalog,
  context: HarnessTurnContext,
  measured: { readonly used: number; readonly size: number },
): ThreadContextReading => {
  const served = context.served;
  const sent = served === null ? null : requestDeployment(models, served);
  const request = context.request;
  return {
    usage: request?.usage ?? Usage.from({ inputTokens: measured.used, totalTokens: measured.used }),
    contextWindow: measured.size,
    runId: context.turn,
    stepNumber: 0,
    provider: served?.provider ?? null,
    model: sent?.model ?? null,
    reasoning: sent?.rung === undefined ? undefined : sent.rung,
    measuredAt: context.at,
    sentAt: request?.sentAt,
    cache: request === null ? undefined : { ttlSeconds: request.ttlSeconds },
    stale: false,
  };
};

const readingFor = (models: ModelCatalog, contexts: readonly HarnessTurnContext[]): ContextReport | undefined => {
  const context = contexts.findLast((each) => each.request === null);
  return context === undefined
    ? undefined
    : context.measured === null
      ? { kind: 'stale' }
      : { kind: 'measured', reading: readingOf(models, context, context.measured) };
};

const requestsOf = (models: ModelCatalog, contexts: readonly HarnessTurnContext[]) =>
  contexts.flatMap((context) => {
    const request = context.request;
    if (request === null) return [];
    const measured: MeasuredRequest = {
      usage: request.usage,
      attempt: request.attempt,
      reading: context.measured === null ? undefined : readingOf(models, context, context.measured),
    };
    return [{ order: context.order, run: context.turn, message: request.message, measured }];
  });

const eventsOf = (
  entries: readonly ThreadEntry[],
  history: readonly Message[],
  opened: number,
  messages?: readonly HarnessTurnMessage[],
): readonly ThreadEventBody[] => {
  let length = history.length + opened;
  return [
    ...entries.map((entry): ThreadEventBody => {
      if (entry.type === 'message' && entry.text !== '' && (entry.role === 'user' || messages === undefined)) {
        length += 1;
        return {
          kind: 'message',
          payload: { entry, messages: [entry.role === 'user' ? Message.user(entry.text) : Message.assistant(entry.text)] },
        };
      }
      if (entry.type === 'compaction' && entry.status === 'completed' && entry.summary !== undefined && entry.summary !== '') {
        const keepFrom = length;
        length = 1;
        const head = Message.make({ role: 'user', content: entry.summary, metadata: foldedReferences(history) });
        return threadCompactionEvent(entry, { keepFrom, messages: [head] });
      }
      if (entry.type === 'compaction' && entry.status === 'completed' && entry.summary === '') {
        length += 1;
        return { kind: entry.type, payload: { entry, messages: [vendorBoundaryMessage(foldedReferences(history))] } };
      }
      return { kind: entry.type, payload: { entry } };
    }),
    ...byRun(messages ?? []),
  ];
};

const byRun = (messages: readonly HarnessTurnMessage[]): readonly ThreadEventBody[] => {
  const runs: { turn: string; messages: Message[] }[] = [];
  for (const { turn, message } of messages) {
    const last = runs.at(-1);
    if (last?.turn === turn) last.messages.push(message);
    else runs.push({ turn, messages: [message] });
  }
  return runs.map((run) => threadRunMessagesEvent(run.turn, run.messages));
};

const saidOf = (begun: HarnessTurnBegun, pictured: ReadonlyMap<string, readonly StoredThreadAttachment[]>) => {
  const attachments = pictured.get(begun.turn) ?? [];
  if (begun.words === '' && attachments.length === 0) return null;
  const said = threadUserMessageEvent({ id: begun.turn }, { text: begun.words, attachments, reader: true });
  return { ...said, payload: { ...said.payload, entry: { ...said.payload.entry, occurredAt: begun.at } } };
};

const openingOf = (step: HarnessTurnStep, pictured: ReadonlyMap<string, readonly StoredThreadAttachment[]>): readonly ThreadEntry[] => [
  ...step.begun.flatMap((begun) => {
    const said = saidOf(begun, pictured);
    return said === null ? [] : [said.payload.entry];
  }),
  ...step.boundaries,
];

const openingEvents = (
  step: HarnessTurnStep,
  pictured: ReadonlyMap<string, readonly StoredThreadAttachment[]>,
  history: readonly Message[],
): readonly ThreadEventBody[] => {
  const said = step.begun.flatMap((begun): readonly ThreadEventBody[] => {
    const opening = saidOf(begun, pictured);
    return opening === null ? [] : [opening, ...(begun.noted === undefined ? [] : [threadGuidanceEvent(begun.noted)])];
  });
  return [...said, ...eventsOf(step.boundaries, history, said.length, step.messages)];
};

const endingOf = (ended: HarnessTurnEnded): RunEnding =>
  ended.status === 'completed'
    ? { kind: 'completed', finish: ended.finish }
    : ended.status === 'failed'
      ? {
          kind: 'failed',
          reason: ended.failure ?? 'The agent turn failed.',
          cause: ended.cause,
          launch: ended.launch === undefined ? undefined : (true as const),
        }
      : { kind: 'aborted', stoppedBy: ended.stoppedBy };

const storage =
  (call: string) =>
  (failure: unknown): ThreadStorageFailed =>
    failure instanceof ThreadStorageFailed ? failure : new ThreadStorageFailed({ call, cause: failure });

const minted = (unit: WriteUnit<'machine'>): ThreadWriteTx => unit as unknown as ThreadWriteTx;

const unadopted = (run: string): ThreadStorageFailed =>
  new ThreadStorageFailed({
    call: 'protocolJournal.step',
    cause: new Error(`Run ${run} belongs to another server until it is adopted, so this step is read again after the adoption.`),
  });

export type TurnClosed = ReadonlyMap<string, ReportResult['status']>;

export type TurnWrite = {
  readonly opened: (unit: WriteUnit<'machine'>, plans: readonly ReportPlan[]) => Effect.Effect<void, ThreadStorageFailed>;
  readonly closed: (unit: WriteUnit<'machine'>) => Effect.Effect<TurnClosed, ThreadStorageFailed>;
};

export const UNWRITTEN: TurnWrite = {
  opened: (unit, plans) =>
    Effect.forEach(plans, (plan) => plan.run(minted(unit)), { discard: true }).pipe(Effect.mapError(storage('protocolJournal.opened'))),
  closed: () => Effect.succeed(new Map()),
};

export class ProtocolJournal {
  constructor(
    private readonly reports: AdapterReports,
    private readonly threads: NativeStorage['Service']['threads'],
    private readonly publishing: (threadId: string) => Effect.Effect<void, ThreadBorderFailed>,
    private readonly projecting: HarnessThreads<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>,
    private readonly inbox: ThreadInbox['Service'],
    private readonly pictures: ThreadAttachmentStore,
    private readonly asides: ThreadAsides,
    private readonly providers: ProviderRegistry['Service'],
    readonly writes: WriteSet,
  ) {}

  get live(): AdapterReports['live'] {
    return this.reports.live;
  }

  get stepped(): AdapterReports['stepped'] {
    return this.reports.stepped;
  }

  get cut(): AdapterReports['cut'] {
    return this.reports.cut;
  }

  get tailEveryMs(): number {
    return this.reports.tailEveryMs;
  }

  seed(run: ThreadRunRef, tail: ThreadTranscript): void {
    this.reports.seed(run, tail);
  }

  tailDue(threadId: string, turn: string | null): boolean {
    return turn !== null && this.reports.tailDue({ id: turn, threadId });
  }

  get asked(): AdapterReports['asked'] {
    return this.reports.asked;
  }

  get resolved(): AdapterReports['resolved'] {
    return this.reports.resolved;
  }

  guided(run: ThreadRunRef, events: readonly ThreadEventBody[]): ReportPlan {
    return this.reports.recorded(run, events, `guidance:${run.id}`);
  }

  handed(run: ThreadRunRef, ids: readonly string[]): ReportPlan {
    return this.reports.handed(run, ids);
  }

  fated(run: ThreadRunRef, fate: ThreadWordFate, ids: readonly string[]): ReportPlan {
    return this.reports.fate(run, fate, ids);
  }

  lapsed(run: ThreadRunRef, ids: readonly string[]): ReportPlan {
    return this.reports.lapsed(run, ids);
  }

  readonly compaction = Effect.fnUntraced(
    function* (this: ProtocolJournal, threadId: string, turn: string | null) {
      const { threads } = this;
      const row = yield* threads.find(threadId);
      const entries = turn === null ? [] : yield* threads.entriesOfRun(threadId, turn);
      const compaction: { readonly history: number; readonly entry: ThreadCompactionEntry | null } = {
        history: row?.history.length ?? 0,
        entry: entries.findLast(entryOf('compaction')) ?? null,
      };
      return compaction;
    },
    Effect.mapError(storage('protocolJournal.compaction')),
  );

  tool(threadId: string, entryId: string): Effect.Effect<ThreadToolEntry | null, ThreadStorageFailed> {
    return this.threads.entryById(threadId, entryId).pipe(
      Effect.map((entry) => (entry !== undefined && entryOf('tool')(entry) ? entry : null)),
      Effect.mapError(storage('protocolJournal.tool')),
    );
  }

  questions(threadId: string, turn: string): Effect.Effect<readonly ThreadQuestionEntry[], ThreadStorageFailed> {
    return this.threads.entriesOfRun(threadId, turn).pipe(
      Effect.map((entries) => entries.filter(entryOf('question'))),
      Effect.mapError(storage('protocolJournal.questions')),
    );
  }

  began(threadId: string, turn: string): Effect.Effect<void> {
    return this.asides.opened(threadId, turn, false);
  }

  publish(threadId: string) {
    return this.publishing(threadId);
  }

  claim(threadId: string, unit: WriteUnit<'machine'>) {
    return this.projecting.stepping(threadId, unit).pipe(Effect.mapError(storage('protocolJournal.claim')));
  }

  unseen(threadId: string, unit: WriteUnit<'machine'>) {
    return this.projecting.unseen(threadId, unit);
  }

  settle(threadId: string, unit: WriteUnit<'machine'>) {
    return this.projecting.stepped(threadId, unit).pipe(Effect.mapError(storage('protocolJournal.settle')));
  }

  readonly prepare = Effect.fnUntraced(
    function* (this: ProtocolJournal, threadId: string, step: HarnessTurnStep) {
      const { inbox, pictures, providers, reports } = this;
      const pictured = new Map(
        yield* Effect.forEach(step.begun, (begun) =>
          inbox.picturesOf(threadId, begun.inputs).pipe(
            Effect.flatMap((refs) => pictures.addressed(threadId, refs)),
            Effect.map((held) => [begun.turn, held] as const),
          ),
        ),
      );
      const opening = openingOf(step, pictured);
      const models = (yield* providers.catalog).models;
      const reading = readingFor(models, step.contexts);
      const requests = requestsOf(models, step.contexts);
      const entered = opening.length > 0 || !!step.messages?.length;
      const tailing = step.subject !== null && (step.tail || reports.tailDue({ id: step.subject, threadId }));
      if (
        !entered &&
        !tailing &&
        reading === undefined &&
        requests.length === 0 &&
        step.retries.length === 0 &&
        step.started.length === 0 &&
        step.fates.length === 0 &&
        step.ended.length === 0
      )
        return null;
      const subject = step.subject ?? [...opening, ...step.boundaries].find((entry) => 'runId' in entry && entry.runId)?.runId ?? null;
      const evidence = [
        step.evidence,
        ...step.begun.map((begun) => `begun:${begun.turn}`),
        ...step.ended.map((ended) => `ended:${ended.turn}`),
        ...step.boundaries.map((entry) => entry.id),
      ].join('|');
      const write: TurnWrite = {
        opened: Effect.fnUntraced(
          function* (unit: WriteUnit<'machine'>, plans: readonly ReportPlan[]) {
            const entries = (history: readonly Message[]) => openingEvents(step, pictured, history);
            if (subject === null && entered) yield* reports.outside(threadId, entries, evidence).run(minted(unit));
            if (subject !== null && (entered || tailing || reading !== undefined)) {
              const reported = yield* reports
                .recorded({ id: subject, threadId }, entries, entered || reading !== undefined ? evidence : `${evidence}|tail`, {
                  reading,
                  unconfirming:
                    step.begun.length > 0 || step.ended.some((ended) => ended.launch !== undefined) ? (true as const) : undefined,
                })
                .run(minted(unit));
              if (reported.status === 'unowned') return yield* unadopted(subject);
            }
            const asked = [
              ...requests.map((request) => ({
                order: request.order,
                run: request.run,
                plan: reports.measured({ id: request.run, threadId }, request.measured, `measured:${request.message}`),
              })),
              ...step.retries.map(({ order, turn, uuid, status, ...retried }) => ({
                order,
                run: turn,
                plan: reports.retried({ id: turn, threadId }, { ...retried, status: status ?? undefined }, `retried:${uuid}`),
              })),
            ].sort((left, right) => left.order - right.order);
            for (const { run, plan } of asked) {
              const reported = yield* plan.run(minted(unit));
              if (reported.status === 'unowned') return yield* unadopted(run);
            }
            for (const ended of step.ended) {
              if (ended.launch !== undefined)
                yield* reports
                  .refused({ id: ended.turn, threadId }, ended.launch === 'lasting' ? (true as const) : undefined)
                  .run(minted(unit));
            }
            for (const fate of step.fates) {
              yield* reports.fate({ id: fate.turn, threadId }, fate.fate, fate.items, fate.recorded).run(minted(unit));
              if (fate.fate === 'read' && fate.noted !== undefined)
                yield* reports
                  .recorded({ id: fate.turn, threadId }, [threadGuidanceEvent(fate.noted)], `notes:${fate.noted.id}`)
                  .run(minted(unit));
            }
            for (const plan of plans) yield* plan.run(minted(unit));
          },
          Effect.mapError(storage('protocolJournal.opened')),
        ),
        closed: Effect.fnUntraced(
          function* (unit: WriteUnit<'machine'>) {
            const closed = new Map<string, ReportResult['status']>();
            for (const ended of step.ended) {
              const done = yield* reports
                .ended({ id: ended.turn, threadId }, endingOf(ended), { rest: ended.rest, cost: ended.cost })
                .run(minted(unit));
              closed.set(ended.turn, done.status);
            }
            return closed;
          },
          Effect.mapError(storage('protocolJournal.closed')),
        ),
      };
      return write;
    },
    Effect.mapError(storage('protocolJournal.prepare')),
  );
}
