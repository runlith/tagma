import { Deferred, Effect } from 'effect';
import { entryOf } from '../../../transcript/kinds';
import type { AgentApproval } from '../../../agent/contracts';
import { type ThreadEventBody, type ThreadEventInput, type ThreadTurnEvent } from '../../events';
import { mintThreadRunId } from '../../identity';
import { carriesWords, isCompactionRequest, isInboxRequest } from '../../inboxItems';
import { actDigest, type Keyed } from '../../keyed';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadMetadataRow, ThreadRow, ThreadRunKind, ThreadRunRow } from '../../rows';
import type { ThreadInboxItem, ThreadInboxItemValues } from '../../storage/inbox';
import type { ThreadRunStartKey } from '../../storage/runs';
import { type ThreadBorderFailed, type ThreadPortFailure } from '../../ThreadBorder';
import { sealThreadEvents } from '../../ThreadEventDoor';
import { ThreadBudget, ThreadInbox, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, transitionNow, type TransitionDeps } from '../../transition/kernel';
import type { Decision, TransitionPlan } from '../../transition/port';
import { RunLifecycle } from '../lifecycle/RunLifecycle';
import { RunExecution } from '../RunExecution';
import { spendable } from '../spendable';
import { ThreadSnapshots } from '../ThreadSnapshots';
import { decodeRecord, isRefusal, refusalFailure } from './answers';
import type { ThreadSaid } from './inputs';
import type { Handover, Opened } from './handover';
import { pendingInstructions } from '../assembly/prompt';

export type WordsConsumed = 'read' | 'handed';

const isSignal = entryOf('signal');

const saidToReader = (turn: ThreadTurnEvent): boolean => {
  const entry = turn.payload.entry;
  return !isSignal(entry) || entry.addressee === 'reader';
};

export type OpenRequest = {
  readonly kind?: ThreadRunKind;
  readonly turn?: (runId: string) => ThreadTurnEvent;
  readonly facts?: readonly ThreadEventBody[] | ((runId: string) => readonly ThreadEventBody[]);
  readonly seed?: readonly ThreadInboxItemValues[];
  readonly consume?: (runId: string, tx: ThreadWriteTx, words: WordsConsumed) => Effect.Effect<void, ThreadPortFailure>;
  readonly admits?: (tx: ThreadWriteTx, pending: readonly ThreadInboxItem[]) => Effect.Effect<boolean, ThreadPortFailure>;
  readonly inherits?: false;
  readonly keepsPrompt?: true;
  readonly startKey?: ThreadRunStartKey;
  readonly outputOptional?: boolean;
  readonly oriented?: boolean;
  readonly key?: Keyed;
  readonly answer?: (run: ThreadRunRow, turn: ThreadTurnEvent | null) => ThreadSaid;
  readonly approval?: AgentApproval;
  readonly spends?: false;
  readonly entered?: (run: ThreadRunRow, tx: ThreadWriteTx) => Effect.Effect<readonly ThreadEventInput[], ThreadPortFailure>;
  readonly works?: (run: ThreadRunRow) => Effect.Effect<void, ThreadBorderFailed>;
  readonly compacts?: Opened['compacts'];
};

export type Opening =
  | { readonly status: 'opened'; readonly run: ThreadRunRow; readonly turn: ThreadTurnEvent | null; readonly answer: ThreadSaid | null }
  | { readonly status: 'declined' }
  | { readonly status: 'replayed'; readonly run: ThreadRunRow }
  | { readonly status: 'recorded'; readonly answer: ThreadSaid };

type Refused = { readonly status: 'declined' } | { readonly status: 'replayed'; readonly run: ThreadRunRow };

export type ThreadBegun = { readonly runId: string; readonly acted: boolean };

export function begunOf(opened: Opening | null): ThreadBegun | null {
  switch (opened?.status) {
    case 'opened':
      return { runId: opened.run.id, acted: true };
    case 'replayed':
      return { runId: opened.run.id, acted: false };
    default:
      return null;
  }
}

export type Openings = Effect.Success<ReturnType<typeof makeOpenings>>;

export const makeOpenings = Effect.fnUntraced(function* ({
  kernel,
  handover,
}: {
  readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  readonly handover: Handover;
}) {
  const lifecycle = yield* RunLifecycle;
  const execution = yield* RunExecution;
  const inbox = yield* ThreadInbox;
  const snapshots = yield* ThreadSnapshots;
  const budgets = yield* ThreadBudget;
  const store = kernel.store;

  const open = Effect.fnUntraced(function* (
    thread: ThreadMetadataRow,
    request: OpenRequest,
  ): Effect.fn.Return<Opening, ThreadBorderFailed> {
    if (request.spends !== false) yield* spendable(budgets, thread);
    const words = yield* handover.words(thread);
    const runId = mintThreadRunId();
    const turn = request.turn?.(runId) ?? null;
    const facts = typeof request.facts === 'function' ? request.facts(runId) : (request.facts ?? []);
    const approval = request.approval ?? { mode: thread.authority.mode, interactive: true };
    const entryOf = (event: ThreadEventBody) => (event.payload as { entry?: { id?: string } }).entry?.id;
    const unrecorded = (tx: ThreadTx | undefined) =>
      Effect.filter(facts, (event) => {
        const id = entryOf(event);
        return id === undefined ? Effect.succeed(true) : Effect.map(store.entryById(thread.id, id, tx), (held) => held === undefined);
      });
    const taken = yield* unrecorded(undefined);
    const pending = {
      taken,
      declared: sealThreadEvents([...taken, ...(turn && (words === 'opening' || !saidToReader(turn)) ? [turn] : [])]),
    };
    const accepted: { run: ThreadRunRow | null; thread: ThreadRow | null; answer: ThreadSaid | null } = {
      run: null,
      thread: null,
      answer: null,
    };
    const published = yield* Deferred.make<void>();
    const plan: TransitionPlan<unknown, ThreadWriteTx> = {
      declared: pending.declared,
      decide: Effect.fnUntraced(function* (view, tx) {
        const still = yield* unrecorded(tx);
        if (still.length !== pending.taken.length) {
          const kept = new Set(still);
          const redeclare = pending.declared.filter((_, index) => index >= pending.taken.length || kept.has(pending.taken[index]!));
          pending.taken = still;
          pending.declared = redeclare;
          return { redeclare } as Decision<unknown, ThreadWriteTx>;
        }
        const inboxNow = request.inherits === false && request.admits === undefined ? [] : yield* inbox.pending(thread.id, tx);
        if (request.admits !== undefined && !(yield* request.admits(tx, inboxNow)))
          return { refuse: { status: 'declined' } satisfies Refused } as const;
        const start = yield* lifecycle.create(thread, approval, {
          tx,
          runId,
          kind: request.kind ?? 'turn',
          startKey: request.startKey,
        });
        if (start._tag === 'Replayed') return { refuse: { status: 'replayed', run: start.run } satisfies Refused } as const;
        const run = start.run;
        const entered = request.entered === undefined ? [] : yield* request.entered(run, tx);
        const prompts = request.keepsPrompt ? null : yield* store.systemPromptOf(thread.id, tx);
        const earlier =
          request.inherits === false ? [] : inboxNow.filter((item) => item.state === 'delivered' && item.deliveredToRunId !== run.id);
        const standing = earlier.filter(carriesWords);
        const inherited = standing.filter(isInboxRequest).map((item) => item.id);
        const read = words === 'receipt' ? [] : standing.filter((item) => !isInboxRequest(item)).map((item) => item.id);
        const unanswered = earlier.filter(isCompactionRequest).map((item) => item.id);
        const promoted = prompts === null || prompts === undefined ? undefined : pendingInstructions(prompts);
        const opened: ThreadRow = {
          ...view.row,
          agentId: promoted?.agentId ?? view.row.agentId,
          profile: promoted?.profile === undefined ? view.row.profile : promoted.profile,
          systemPrompt: promoted?.systemPrompt ?? prompts?.systemPrompt ?? view.row.systemPrompt,
          pendingSystemPrompt: promoted === undefined ? (prompts?.pendingSystemPrompt ?? view.row.pendingSystemPrompt) : null,
          pendingDefinition: promoted === undefined ? prompts?.pendingDefinition : null,
          history: view.state.history,
          contextReading: view.state.contextReading,
        };
        accepted.run = run;
        accepted.thread = opened;
        if (request.works === undefined) {
          const seed =
            words === 'receipt'
              ? (request.seed ?? []).map((item) => ({ ...item, state: 'delivered' as const, deliveredToRunId: run.id }))
              : [];
          yield* tx.afterCommit(
            handover.begin(
              {
                thread: opened,
                run,
                oriented: request.oriented ?? turn !== null,
                outputOptional: request.outputOptional === true,
                seed,
                compacts: request.compacts,
              },
              Deferred.await(published),
            ),
          );
        }
        accepted.answer = request.answer?.(run, turn) ?? null;
        return {
          apply: true,
          result: accepted.answer ?? run.id,
          events: entered.length === 0 ? undefined : entered,
          patch: promoted ?? undefined,
          participants: Effect.fnUntraced(function* (unit) {
            if (request.consume) yield* request.consume(run.id, unit, words === 'receipt' ? 'handed' : 'read');
            if (inherited.length > 0) yield* inbox.deliver(inherited, run.id, unit);
            if (read.length > 0) yield* inbox.acknowledge(read, run.id, unit);
            if (unanswered.length > 0) yield* inbox.acknowledge(unanswered, null, unit);
          }),
        } as Decision<unknown, ThreadWriteTx>;
      }),
    };
    const key = request.key ?? { evidence: { decidedBy: `open:${runId}` }, digest: actDigest(['open', runId]) };
    return yield* Effect.gen(function* () {
      const outcome = yield* transitionNow(kernel, thread.id, plan, key);
      if ('replayed' in outcome) {
        const record = decodeRecord(outcome.replayed);
        if (record === null) {
          return yield* new ThreadStorageFailed({
            call: 'open',
            cause: new Error(`Thread ${thread.id}: the record under this key holds no answer an opening can replay.`),
          });
        }
        return isRefusal(record) ? yield* refusalFailure(record) : ({ status: 'recorded', answer: record } satisfies Opening);
      }
      if ('refused' in outcome) return outcome.refused as Refused;
      yield* answerOf(thread.id, outcome);
      const run = accepted.run;
      if (run === null || accepted.thread === null) return { status: 'declined' } satisfies Opening;
      if (request.works !== undefined) {
        const works = request.works;
        yield* execution.settling(
          run,
          Effect.gen(function* () {
            handover.hold(run);
            yield* execution.open(run, approval.mode);
            yield* works(run);
            return yield* snapshots.publish(thread.id);
          }),
        );
      } else {
        yield* snapshots.publish(thread.id);
      }
      return { status: 'opened', run, turn, answer: accepted.answer } satisfies Opening;
    }).pipe(Effect.ensuring(Deferred.succeed(published, undefined)));
  });

  return { words: handover.words, open };
});
