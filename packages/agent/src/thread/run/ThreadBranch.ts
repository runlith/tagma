import { ThreadJournalLane } from '../transition/lane';
import { ThreadEntryKinds, coreEntry } from '../../transcript/kinds';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { Context, Effect, Layer } from 'effect';
import { toolEntryId } from '../../transcript/entryNames';
import { settleTool, toolSettled } from '../../transcript/entries';
import { attributionDisagrees, type HistoryAttribution } from '../HistoryAttribution';
import { ThreadAttributions } from './ThreadAttributions';
import { spliceThreadHistory } from '../HistoryFold';
import { ThreadRewindRefusedError } from '../rewind';
import type { ThreadProfileBirth } from '../agents/AgentProfile';
import { forkCutLabel, historyCannot, TransportCannotError, type ThreadForkCut, type TransportCapabilities } from '../record';
import { ThreadAgents } from '../agents/ThreadAgents';
import { threadBranchEvent, threadEntryEvent, threadStepMessagesEvent } from '../events';
import type { ThreadBranchedCut } from '../../transcript/eventFold';
import { agentOf, type ThreadAuthority, type ThreadBirthPlace, type ThreadHistory, type ThreadMetadataRow, type ThreadRow } from '../rows';
import type { ThreadBindings } from '../../agent/contracts';
import { opensTurnMessage } from '../../agent/AgentSignal';
import type { ThreadBornOf } from '../../protocol/birth';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import { ThreadRunConflictError } from '../storage/runs';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadInteractionConflictError } from './ThreadQuestion';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { sealThreadEvents } from '../ThreadEventDoor';
import { actDigest, type Keyed } from '../keyed';
import { mintThreadId } from '../identity';
import { controlIfPresent, readBirthRecord, sameVersion, writeBirthRecord, type BirthSettled } from '../transition/kernel';
import { ThreadVersionStaleError, type Decision } from '../transition/port';
import type { ThreadBranchBase, ThreadBranchEntries, ThreadBranchSeed } from '../storage/aggregate';
import {
  ThreadBirthRecords,
  ThreadEventJournal,
  ThreadReadiness,
  ThreadResidence,
  ThreadResourceLedger,
  ThreadStore,
  ThreadTransitions,
  type ThreadTx,
  type ThreadWriteTx,
} from '../ThreadPorts';
export type ThreadDuplicateInput = {
  ownerId: string;
  createdBy?: string;
  sourceThreadId: string;
  agentId?: string;
  cut?: ThreadForkCut;
  title?: string;
  bornOf?: ThreadBornOf | null;
  bindings?: ThreadBindings;
  spawned?: {
    readonly parentThreadId: string | null;
    readonly spawnedByRunId: string | null;
    readonly name?: string;
    readonly authority?: ThreadAuthority;
    readonly profile?: ThreadProfileBirth | null;
    readonly capabilities?: TransportCapabilities;
    readonly rehomed?: true;
    readonly model?: {
      readonly account?: string | null;
      readonly provider: string;
      readonly model: string;
      readonly reasoning: string | null;
      readonly switches: ModelSwitches;
    };
  };
  commit?: (child: ThreadRow, tx: ThreadWriteTx) => Effect.Effect<void, ThreadBorderFailed>;
  place?: ThreadBirthPlace;
  birth?: Keyed;
};
export type ThreadForkAnswer =
  | {
      readonly born: ThreadRow;
    }
  | {
      readonly settled: BirthSettled;
    };
const STALE = { stale: true } as const;
const WHOLE: ThreadForkCut = { kind: 'all' };
type Bearing =
  | {
      readonly settled: BirthSettled;
    }
  | {
      readonly born: ThreadRow;
      readonly base: ThreadBranchBase;
    }
  | typeof STALE;
export class ThreadBranch extends Context.Service<
  ThreadBranch,
  {
    fork(input: ThreadDuplicateInput): Effect.Effect<ThreadForkAnswer, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadBranch') {}
export const makeThreadBranch = Effect.gen(function* () {
  const agents = yield* ThreadAgents;
  const journal = yield* ThreadEventJournal;
  const attributions = yield* ThreadAttributions;
  const births = yield* ThreadBirthRecords;
  const readiness = yield* ThreadReadiness;
  const residence = yield* ThreadResidence;
  const resources = yield* ThreadResourceLedger;
  const ledger = yield* ThreadRunLedger;
  const store = yield* ThreadStore;
  const kernel = {
    store,
    log: journal,
    transitions: yield* ThreadTransitions,
    lane: yield* ThreadJournalLane,
    kinds: yield* ThreadEntryKinds,
  };
  const carriedCut = Effect.fnUntraced(function* (input: ThreadDuplicateInput, source: ThreadMetadataRow, tx: ThreadTx) {
    const asked = input.cut ?? WHOLE;
    if (asked.kind !== 'all' || input.spawned !== undefined || source.capabilities.history !== 'session') return asked;
    const going = yield* ledger.activeRunIn(source.id, tx);
    if (going === null) return asked;
    const cannot = historyCannot(source.capabilities, 'point');
    if (cannot !== null) {
      return yield* new ThreadCallBroke({
        cause: new TransportCannotError({ threadId: source.id, capability: cannot, adapter: source.transport.adapter }),
      });
    }
    const before: ThreadForkCut = { kind: 'before', runId: going.id };
    return before;
  });
  const discard = (branch: ThreadRow): Effect.Effect<void, ThreadBorderFailed> =>
    Effect.andThen(
      controlIfPresent<undefined, ThreadWriteTx>(
        kernel,
        branch.id,
        {
          decide: () =>
            Effect.succeed({
              apply: true,
              result: undefined,
              participants: Effect.fnUntraced(function* (unit: ThreadWriteTx) {
                yield* resources.end([branch.id], unit);
                yield* store.delete([branch.id], unit);
              }),
            } as Decision<undefined, ThreadWriteTx>),
        },
        { evidence: { decidedBy: `discard:${branch.id}` }, digest: actDigest(['discard', branch.id]) },
      ),
      resources.letGo(),
    );
  const sealed = Effect.fnUntraced(function* (input: ThreadDuplicateInput, source: ThreadRow, history: ThreadHistory, tx: ThreadTx) {
    const open = input.spawned ? null : openCalls(history);
    if (open === null) return { history, replaced: [] };
    const held = yield* Effect.forEach(open.calls, (call) => store.entryById(source.id, toolEntryId(call.id), tx));
    return sealOpenCalls(
      history,
      open,
      held.flatMap((entry) => (entry === undefined ? [] : [entry])),
    );
  });
  const prepare = (input: ThreadDuplicateInput, childId: string, within?: ThreadTx) =>
    kernel.transitions.readAt(
      input.sourceThreadId,
      Effect.fnUntraced(function* ({ row: source, version, tx }) {
        const sameAgent = input.agentId === undefined || input.agentId === agentOf(source);
        const profile: ThreadProfileBirth | null =
          input.spawned !== undefined ? (input.spawned.profile ?? null) : sameAgent ? source.profile : null;
        const agentChanged = input.spawned?.rehomed === true || !sameAgent || (profile?.id ?? null) !== (source.profile?.id ?? null);
        const cut = yield* carriedCut(input, source, tx);
        const planned =
          cut.kind === 'before'
            ? cutBefore(
                source.history,
                source.id,
                cut.runId,
                yield* attributions.read(source.id, version.head, tx),
                input.cut?.kind !== 'before',
              )
            : forkCut(source.history, cut);
        if ('refused' in planned) return yield* new ThreadCallBroke({ cause: planned.refused });
        const carried = yield* sealed(input, source, planned.history, tx);
        const seed: ThreadBranchSeed = {
          sourceId: source.id,
          childId,
          entries: planned.entries,
          prompts: agentChanged ? 'dropped' : 'kept',
        };
        const values = {
          id: childId,
          ownerId: source.ownerId,
          agentId: input.agentId ?? source.agentId,
          bornOf: input.bornOf ?? null,
          cacheGroup: source.cacheGroup,
          createdBy: input.createdBy ?? null,
          hostKind: source.hostKind || undefined,
          hostId: source.hostKind ? source.hostId : undefined,
          bindings: input.bindings,
          account: input.spawned?.model ? (input.spawned.model.account ?? null) : source.account,
          provider: input.spawned?.model?.provider ?? source.provider,
          model: input.spawned?.model ? input.spawned.model.model : source.model,
          reasoning: input.spawned?.model ? input.spawned.model.reasoning : source.reasoning,
          switches: input.spawned?.model?.switches ?? {},
          capabilities: input.spawned?.capabilities,
          authority: input.spawned?.authority ?? source.authority,
          profile: profile ?? undefined,
          systemPrompt: agentChanged ? undefined : source.systemPrompt,
        };
        const answer = carried.history.length > planned.history.length ? (carried.history[carried.history.length - 1] ?? null) : null;
        return { source, version, cut, values, seed, history: carried.history, sealed: carried.replaced, cuts: planned.cuts, answer };
      }),
      within,
    );
  type Prepared = NonNullable<Effect.Success<ReturnType<typeof prepare>>>;
  const told = Effect.fnUntraced(function* (childId: string, prepared: Prepared, base: ThreadBranchBase, tx: ThreadWriteTx) {
    const { seed, history, sealed: replaced, cuts, answer } = prepared;
    const cut = {
      hidden: seed.entries.kind === 'kept' ? seed.entries.taken : [],
      prompts: seed.prompts,
      from: base.from,
      cuts,
    };
    const differs = seed.entries.kind !== 'all' || seed.prompts === 'dropped' || cuts.length > 0;
    const told = answer === null ? null : threadStepMessagesEvent([answer]);
    const events =
      base.through === 0
        ? []
        : [...(differs ? [threadBranchEvent(cut)] : []), ...(told === null ? [] : [told]), ...replaced.map(threadEntryEvent)];
    const declared = sealThreadEvents(events);
    for (const [at, { id, body }] of declared.entries()) {
      const appended = yield* journal.append({ threadId: childId, id, kind: body.kind, payload: body.payload }, tx);
      if (appended.position !== base.through + at + 1) {
        return yield* new ThreadStorageFailed({
          call: 'birth',
          cause: new Error(`Thread ${childId}: its birth landed at ${appended.position} over a prefix of ${base.through}.`),
        });
      }
    }
    const head = base.through + declared.length;
    const fold = { history, covered: { from: base.through, through: head } };
    yield* kernel.transitions.writeFold(childId, { fold, standing: base.through, head, base: [] }, tx);
    return history;
  });
  const bear = (input: ThreadDuplicateInput, childId: string, ahead: Prepared | null) =>
    kernel.transitions.writeAt(
      input.sourceThreadId,
      Effect.fnUntraced(function* ({ row: current, version, tx }) {
        const holder = birthHolder(input, childId);
        if (input.birth) {
          const settled = yield* readBirthRecord(kernel.transitions, holder, input.birth, tx);
          if (settled !== null) return { settled } as Bearing;
        }
        if (current.ownerId !== input.ownerId) {
          return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${input.sourceThreadId}.`) });
        }
        if (input.spawned) {
          const asked = current.pendingInteraction;
          if (asked) {
            return yield* new ThreadCallBroke({
              cause: new ThreadInteractionConflictError({
                threadId: current.id,
                runId: String(asked.runId ?? ''),
                questionId: String(asked.questionId ?? asked.id),
                reason: `Thread ${current.id} is waiting for an answer to its question, so no child of it is born until the question is answered or cleared.`,
              }),
            });
          }
          const activeRun = yield* ledger.activeRunIn(current.id, tx);
          if (activeRun && activeRun.id !== input.spawned.spawnedByRunId) {
            return yield* Effect.fail(new ThreadRunConflictError({ threadId: current.id, runId: activeRun.id }));
          }
        }
        if (ahead !== null && !sameVersion(version, ahead.version)) return STALE;
        if (ahead !== null && forkCutLabel(yield* carriedCut(input, current, tx)) !== forkCutLabel(ahead.cut)) return STALE;
        const prepared = ahead ?? (yield* prepare(input, childId, tx));
        if (prepared === undefined) {
          return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${input.sourceThreadId}.`) });
        }
        const { source, cut, seed } = prepared;
        if (yield* store.metadata(childId, tx)) return { settled: { taken: true } } as Bearing;
        const spawned = input.spawned;
        const creatorId = spawned === undefined ? source.id : (spawned.parentThreadId ?? input.createdBy ?? source.id);
        const creator = creatorId === source.id ? null : yield* store.find(creatorId, tx);
        if (creator === undefined) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${creatorId}.`) });
        const values =
          creator === null
            ? prepared.values
            : { ...prepared.values, hostKind: creator.hostKind || undefined, hostId: creator.hostKind ? creator.hostId : undefined };
        const duplicate =
          spawned === undefined
            ? yield* store.insert(values, tx)
            : spawned.parentThreadId === null
              ? yield* store.insert({ ...values, name: spawned.name || undefined }, tx)
              : yield* store.insertChild(
                  spawned.parentThreadId,
                  { ...values, spawnedByRunId: spawned.spawnedByRunId, name: spawned.name || undefined },
                  tx,
                );
        const base = yield* store.branch(seed, tx);
        const history = yield* told(duplicate.id, prepared, base, tx);
        if (births !== null) {
          yield* births.record(
            {
              child: duplicate,
              parent: { ...source, ...current },
              creator: creator ?? undefined,
              carried: cut.kind,
              cut,
              title: input.title,
              place: input.place,
            },
            tx,
          );
        }
        if (input.commit) yield* input.commit(duplicate, tx);
        if (input.birth) yield* writeBirthRecord(kernel.transitions, holder, input.birth, tx, duplicate.id);
        return { born: { ...duplicate, history }, base } as Bearing;
      }),
    );
  return ThreadBranch.of({
    fork: Effect.fn('ThreadBranch.fork')(function* (input) {
      yield* Effect.annotateCurrentSpan({ sourceId: input.sourceThreadId, cut: input.cut?.kind ?? 'all' });
      if (input.agentId !== undefined && !(yield* agents.get(input.agentId)).runPolicy.userStartable) {
        return yield* Effect.die(new Error(`Agent ${input.agentId} cannot be started by a user.`));
      }
      if (input.birth && !input.spawned) {
        const settled = yield* readBirthRecord(kernel.transitions, input.sourceThreadId, input.birth);
        if (settled !== null) return { settled };
      }
      const childId = mintThreadId();
      const copied = Effect.gen(function* () {
        const ahead = yield* prepare(input, childId).pipe(
          Effect.catchIf(
            (failure): failure is ThreadVersionStaleError => failure instanceof ThreadVersionStaleError,
            () => Effect.succeed(null),
          ),
        );
        if (ahead === undefined) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${input.sourceThreadId}.`) });
        const first = yield* bear(input, childId, ahead);
        const moved = first !== undefined && 'stale' in first;
        yield* Effect.annotateCurrentSpan({ preparedInside: ahead === null || moved });
        return moved ? yield* bear(input, childId, null) : first;
      });
      const answer = yield* residence === null ? copied : residence.holding(input.sourceThreadId, copied);
      if (answer === undefined || 'stale' in answer) {
        return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${input.sourceThreadId}.`) });
      }
      if ('settled' in answer) return answer;
      yield* Effect.annotateCurrentSpan({ through: answer.base.through });
      const child = answer.born;
      if (!input.spawned && readiness !== null) {
        yield* readiness.ready(child).pipe(Effect.tapError(() => discard(child)));
      }
      return { born: child };
    }),
  });
});

export const threadBranchLayer = Layer.effect(ThreadBranch, makeThreadBranch);

function birthHolder(input: ThreadDuplicateInput, childId: string): string {
  return input.spawned ? childId : input.sourceThreadId;
}
const ANSWERED_ON_THE_SOURCE = 'This call ran on the source thread, not on this branch: its result belongs to the source.';
export type ThreadBranchSealed = {
  readonly history: ThreadHistory;
  readonly replaced: ThreadTranscript;
};
export type ThreadOpenCalls = {
  readonly origin: ThreadHistory[number]['origin'];
  readonly calls: readonly {
    id: string;
    name: string;
  }[];
};
export function openCalls(history: ThreadHistory): ThreadOpenCalls | null {
  const at = history.findLastIndex((message) => message.role === 'assistant');
  const last = history[at];
  if (!last) return null;
  const answered = new Set(
    history
      .slice(at + 1)
      .flatMap((message) =>
        message.role === 'tool' ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.id] : [])) : [],
      ),
  );
  const calls = last.content.flatMap((part) =>
    part.type === 'tool-call' && part.providerExecuted !== true && !answered.has(part.id) ? [{ id: part.id, name: part.name }] : [],
  );
  return calls.length === 0 ? null : { origin: last.origin, calls };
}
export function sealOpenCalls(history: ThreadHistory, open: ThreadOpenCalls, held: ThreadTranscript): ThreadBranchSealed {
  const answer = Message.make({
    role: 'tool',
    content: open.calls.map((call) =>
      ToolResultPart.from({ id: call.id, name: call.name, result: ANSWERED_ON_THE_SOURCE, resultType: 'error' }),
    ),
    origin: open.origin,
  });
  const ids = new Set(open.calls.map((call) => toolEntryId(call.id)));
  const replaced = held.flatMap((entry) =>
    coreEntry(entry) && entry.type === 'tool' && ids.has(entry.id) && !toolSettled(entry.toolState)
      ? [{ ...entry, ...settleTool({ kind: 'failed', error: ANSWERED_ON_THE_SOURCE }) }]
      : [],
  );
  return { history: [...history, answer], replaced };
}
export type ThreadBranchCut = {
  readonly history: ThreadHistory;
  readonly entries: ThreadBranchEntries;
  readonly cuts: ThreadBranchedCut['cuts'];
};
function cutBefore(
  history: ThreadHistory,
  threadId: string,
  runId: string,
  attribution: HistoryAttribution,
  going: boolean,
):
  | ThreadBranchCut
  | {
      refused: Error;
    } {
  const plan = attribution.plan(runId, 'from');
  if ('blocked' in plan && going && plan.blocked === 'rewind-unknown') {
    return { history, entries: { kind: 'kept', taken: [...new Set([runId, ...attribution.cut()])] }, cuts: [] };
  }
  if ('blocked' in plan) return { refused: new ThreadRewindRefusedError(plan.blocked, threadId, runId) };
  if (attribution.size !== history.length) return { refused: attributionDisagrees(threadId) };
  return {
    history: spliceThreadHistory(
      history,
      plan.cuts.map((cut) => ({ ...cut, insert: [] })),
    ),
    entries: { kind: 'kept', taken: [...new Set([...plan.runIds, ...attribution.cut()])] },
    cuts: plan.cuts,
  };
}
export function forkCut(
  history: ThreadHistory,
  cut: Exclude<
    ThreadForkCut,
    {
      kind: 'before';
    }
  >,
): ThreadBranchCut {
  if (cut.kind === 'all') return { history, entries: { kind: 'all' }, cuts: [] };
  if (cut.kind === 'none') return { history: [], entries: { kind: 'none' }, cuts: [] };
  const opens: number[] = [];
  history.forEach((message: ThreadHistory[number], index: number) => {
    if (opensTurnMessage(message)) opens.push(index);
  });
  if (opens.length <= cut.turns) return { history, entries: { kind: 'all' }, cuts: [] };
  const kept = opens[opens.length - cut.turns] ?? 0;
  return { history: history.slice(kept), entries: { kind: 'turns', turns: cut.turns }, cuts: kept === 0 ? [] : [{ from: 0, to: kept }] };
}
