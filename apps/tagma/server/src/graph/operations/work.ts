import { Effect, Result } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { carriedSelection, pageRows } from '@runlith/paging';
import { BlockNames, type BlockRecord, type BlockRow } from '../contract/service/acts.js';
import { GateRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { AMENDMENTS_WALK, READY_WALK } from '../contract/wire/walks.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { REFLECTION_OPERATIONS } from '../contract/wire/operations/reflections.js';
import { admitted, pairsOf, routed, routesOf } from '../../platform/contract/service/routed.js';
import { READ_OPERATIONS, type ReadyTaskAnswer } from '../contract/wire/operations/reads.js';
import { GraphJournal } from '../contract/service/journal.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { WORK_OPERATIONS } from '../contract/wire/operations/work.js';
import { callerPath, documentReads, readSubject } from '../../platform/contract/service/subjects.js';
import { type ClaimFacts, heldRaised, PROPOSALS, TASKS } from '../contract/wire/operations/shared.js';
import { Tags } from '../contract/service/vocabulary.js';
import type { Raised } from '@runlith/agent/permissions';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { Selection } from '../contract/service/reads.js';
import { heldGroups, measuredOnce } from '../acts/far.js';
import type { FarHold } from '../contract/wire/far.js';
import { inlineBodyFiles } from '../work/Batch.js';
import { announceEnd } from '../work/tasks/ended.js';
import {
  Batch,
  Reflections,
  Review,
  Supersession,
  Tasks,
  type OpOutcome,
  type ProposalListRow,
  type ReviewConflict,
  type ReviewConflicts,
} from '../contract/service/work.js';
import { batchSource, type BatchInput } from '../contract/wire/batch.js';
import { blockName } from '../contract/wire/references.js';
import type { Crowded, IdleSpecAnswer } from '../contract/wire/answers.js';
import { blockResult, blockSummary, endResult, pricedBlockResult, pricedResult, specAnswers } from './answers.js';
import { priced, type Priced } from '../../platform/contract/service/start.js';
import { Blocks } from '../contract/service/blocks.js';
import { crowdedPages } from '../blocks/crowding.js';
import type { StartPrice } from '../../platform/contract/wire/start.js';
import { lawPricing, nodePricing } from './start.js';
import {
  atTarget,
  currentTarget,
  documentScope,
  reflectionPlace,
  scoped,
  targeted,
  peer,
  type CrossingRefusal,
  type GraphTarget,
} from './crossing.js';
import { projectOrNone } from '../serving/current.js';
import { CurrentGraph, GraphCall } from '../contract/service/serving.js';
import type { GraphServices } from '../contract/service/services.js';

const READS = READ_OPERATIONS;

const taskKey = (row: BlockRecord): readonly [number, number] => [row.createdAt.getTime(), row.id];

const proposalKey = (row: ProposalListRow): readonly [number, number] => [row.updatedAt.getTime(), row.id];

const answerNamed = <C extends string | true>(input: {
  readonly by?: string | undefined;
  readonly commit?: string | undefined;
  readonly checked?: C | undefined;
}): Effect.Effect<{ readonly by: string } | { readonly commit: string } | { readonly checked: C }, GateRefusal<'answer-shape'>> => {
  const named = [input.by, input.commit, input.checked].filter((one) => one !== undefined).length;
  if (named === 1) {
    if (input.by !== undefined) return Effect.succeed({ by: input.by });
    if (input.commit !== undefined) return Effect.succeed({ commit: input.commit });
    if (input.checked !== undefined) return Effect.succeed({ checked: input.checked });
  }
  return Effect.fail(
    new GateRefusal(
      'answer-shape',
      named === 0 ? 'nothing was named as the answer' : `an answer is named as one thing, and this named ${named}`,
      [
        '`by` names a block: finished work — a done or closed task, or a rule stating what holds now',
        '`commit` names the commit of a direct fix',
        '`checked` names what a check on current code found when nothing needed fixing',
      ],
    ),
  );
};

const answerOf = Effect.fn('answer_reflection.named')(function* <C extends string | true>(
  id: number,
  named: { readonly by: string } | { readonly commit: string } | { readonly checked: C },
) {
  if ('by' in named) return { id, byId: yield* (yield* BlockNames).idOfName(named.by) };
  return 'commit' in named ? { id, commit: named.commit } : { id, checked: named.checked };
});

const WORK_READ_ROUTED = {
  ready_work: routed(READS.ready_work, {
    ...targeted(
      (input: (typeof READS.ready_work)['input']['Type']) => input.scopeId ?? carriedSelection(READY_WALK, input.cursor)?.scopeId,
      Effect.fnUntraced(function* (input: (typeof READS.ready_work)['input']['Type']) {
        const call = yield* projectOrNone;
        const scopeName =
          input.scopeId ?? (input.cursor === undefined ? undefined : (yield* walks.recall(READY_WALK, input.cursor)).scopeId);
        const scope = scopeName === undefined ? undefined : yield* scoped(scopeName);
        const projectId = scope?.projectId ?? call?.project.id;
        const selection = yield* Selection;
        const tasks = yield* Tasks;
        const checkout = (yield* CurrentGraph)?.checkout ?? null;
        const { cut, held, idle, specs } = yield* measuredOnce(
          Effect.gen(function* () {
            const idle = projectId === undefined ? [] : yield* tasks.idle({ projectId, scopeId: scope?.id });
            const specs = projectId === undefined ? [] : yield* tasks.worklessSpecs({ projectId, scopeId: scope?.id });
            const also = { ids: idle.map((one) => one.id), uuids: specs.map((spec) => spec.uuid) };
            const cut = yield* walks.page({
              walk: READY_WALK,
              selection: { projectId, checkout, scopeId: scopeName },
              cursor: input.cursor,
              asked: pageRows(input.limit, TASKS, ceilingOf(TASKS)),
              keyOf: taskKey,
              read: (after, rows) => selection.readyPage({ projectId, scopeId: scope?.id, after, rows, also }),
            });
            return { cut, held: heldGroups(yield* selection.held({ projectId, scopeId: scope?.id })), idle, specs };
          }),
        );
        const authors = yield* (yield* GraphJournal).authors(cut.rows.map((row) => row.id));
        const writers = new Map(
          (yield* (yield* WriterRegister).named([...authors.values()].flatMap((id) => (id === null ? [] : [id])))).map(
            (row) => [row.id, row] as const,
          ),
        );
        const identity = yield* SessionIdentity;
        const spoken = (id: number | null | undefined) => {
          const writer = id === null || id === undefined ? undefined : writers.get(id);
          return writer === undefined ? null : sessionName(writer, identity);
        };
        const left = new Map(idle.map((one) => [one.id, one] as const));
        const workless = new Set(specs.map((spec) => spec.uuid));
        return {
          tasks: cut.rows.map((row): ReadyTaskAnswer => {
            const stopped = left.get(row.id);
            return {
              ...blockSummary(row),
              author: spoken(authors.get(row.id)),
              holder: stopped === undefined ? undefined : sessionName(stopped.holder, identity),
              standing: stopped?.standing,
              workless: workless.has(row.uuid) ? true : undefined,
            };
          }),
          shown: cut.shown,
          total: cut.total,
          next: cut.next,
          complete: cut.complete,
          held,
          idle: idle.length,
          workless: specs.length,
        };
      }),
    ),
    answer: (frontier: {
      readonly tasks: readonly ReadyTaskAnswer[];
      readonly shown: number;
      readonly total: number;
      readonly next: string | null;
      readonly complete: boolean;
      readonly held: readonly FarHold[];
      readonly idle: number;
      readonly workless: number;
    }) => ({
      status: 'ok' as const,
      tasks: frontier.tasks,
      total: frontier.total,
      shown: frontier.shown,
      next: frontier.next,
      complete: frontier.complete,
      held: frontier.held.length === 0 ? undefined : frontier.held,
      idle: frontier.idle === 0 ? undefined : frontier.idle,
      workless: frontier.workless === 0 ? undefined : frontier.workless,
    }),
  }),

  read_amendments: routed(READS.read_amendments, {
    ...targeted(
      (input: (typeof READS.read_amendments)['input']['Type']) => input.scopeId ?? carriedSelection(AMENDMENTS_WALK, input.cursor)?.scopeId,
      Effect.fnUntraced(function* (input: (typeof READS.read_amendments)['input']['Type']) {
        const call = yield* yield* GraphCall;
        const review = yield* Review;
        const recovered =
          input.cursor === undefined || input.scopeId !== undefined || input.decided !== undefined
            ? undefined
            : yield* walks.recall(AMENDMENTS_WALK, input.cursor);
        const scopeName = input.scopeId ?? recovered?.scopeId;
        const decided = input.decided ?? recovered?.decided ?? false;
        const scope = scopeName === undefined ? undefined : yield* scoped(scopeName);
        const projectId = scope?.projectId ?? call.project.id;
        const scopeId = scope?.id;
        const cut = yield* walks.page({
          walk: AMENDMENTS_WALK,
          selection: { projectId, checkout: (yield* CurrentGraph)?.checkout ?? null, decided, scopeId: scopeName },
          cursor: input.cursor,
          asked: pageRows(input.limit, PROPOSALS, ceilingOf(PROPOSALS)),
          keyOf: proposalKey,
          read: (after, rows) => review.proposalsPage({ projectId, scopeId, decided }, after, rows),
        });
        const conflicts = decided
          ? { found: [], total: 0, unread: [] }
          : yield* review.conflicts({ projectId, scopeId, names: cut.rows.map((row) => blockName(row.uuid)) });
        return {
          decided,
          proposals: cut.rows,
          shown: cut.shown,
          total: cut.total,
          next: cut.next,
          complete: cut.complete,
          conflicts: conflicts.found,
          totalConflicts: conflicts.total,
          unread: conflicts.unread,
        };
      }),
    ),
    answer: (answer: {
      readonly decided: boolean;
      readonly proposals: readonly ProposalListRow[];
      readonly shown: number;
      readonly total: number;
      readonly next: string | null;
      readonly complete: boolean;
      readonly conflicts: readonly ReviewConflict[];
      readonly totalConflicts: number;
      readonly unread: ReviewConflicts['unread'];
    }) => ({
      status: 'ok' as const,
      decided: answer.decided,
      total: answer.total,
      shown: answer.shown,
      next: answer.next,
      complete: answer.complete,
      proposals: answer.proposals.map((row) => ({ ...blockSummary(row), fields: row.fields })),
      conflicts: answer.conflicts.map((fight) => ({
        a: fight.a,
        b: fight.b,
        region: fight.region.kind === 'text' ? `text ${fight.region.blockName}` : `code ${fight.region.anchor}`,
      })),
      totalConflicts: answer.totalConflicts,
      unread: answer.unread,
    }),
  }),
};

export const WORK_READ_PAIRS = pairsOf(WORK_READ_ROUTED);
export const WORK_READ_ROUTES = routesOf(WORK_READ_ROUTED);

const R = REFLECTION_OPERATIONS;

const REFLECTION_ROUTED = {
  answer_reflection: routed(R.answer_reflection, {
    place: reflectionPlace,
    execute: Effect.fnUntraced(function* (input: (typeof R.answer_reflection)['input']['Type']) {
      const named = yield* answerNamed(input);
      return yield* Effect.gen(function* () {
        const reflection = yield* Reflections;
        const there = yield* BlockNames;
        const id = yield* there.idOfName(input.blockId);
        return yield* reflection.answer(yield* answerOf(id, named));
      });
    }),
    answer: blockResult,
  }),

  unanswer_reflection: routed(R.unanswer_reflection, {
    place: reflectionPlace,
    execute: Effect.fnUntraced(function* (input: (typeof R.unanswer_reflection)['input']['Type']) {
      const named = yield* answerNamed(input);
      return yield* Effect.gen(function* () {
        const reflection = yield* Reflections;
        const there = yield* BlockNames;
        const id = yield* there.idOfName(input.blockId);
        return yield* reflection.unanswer(yield* answerOf(id, named));
      });
    }),
    answer: blockResult,
  }),
};

export const REFLECTION_PAIRS = pairsOf(REFLECTION_ROUTED);
export const REFLECTION_ROUTES = routesOf(REFLECTION_ROUTED);

const W = WORK_OPERATIONS;

const heldFacts = (act: string) => (row: BlockRow) =>
  Effect.flatMap(Tasks, (tasks) =>
    Effect.map(tasks.heldElsewhere(row), (held): readonly Raised[] => (held === null ? [] : [heldRaised(held, act)])),
  );

const batchInput = (input: (typeof W.apply_batch)['input']['Type'], caller: Caller): BatchInput =>
  input.file !== undefined ? { file: callerPath(caller, input.file) } : { source: input.source ?? batchSource(input.ops ?? []) };

const WORK_ROUTED = {
  claim_block: routed(W.claim_block, {
    ...targeted(
      (input: (typeof W.claim_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (
        input: (typeof W.claim_block)['input']['Type'],
        _projectId: number | undefined,
        _caller: Caller,
        facts: ClaimFacts | null,
      ) {
        const task = yield* scoped(input.blockId);
        return yield* (yield* Tasks).claim({ id: task.id, over: facts?.over });
      }),
      (row: BlockRow) =>
        Effect.gen(function* () {
          const raised = yield* heldFacts('claiming takes that work over for this session')(row);
          return { raised, over: (yield* (yield* Tags).of(row.projectId)).holderOf(row) } satisfies ClaimFacts;
        }),
    ),
    answer: blockResult,
  }),

  release_block: routed(W.release_block, {
    ...targeted(
      (input: (typeof W.release_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.release_block)['input']['Type'], _prepared: number | undefined) {
        const task = yield* scoped(input.blockId);
        return yield* (yield* Tasks).release({ id: task.id });
      }),
      heldFacts('releasing takes that work from its session and returns it to its initial word'),
    ),
    answer: blockResult,
  }),

  finish_block: routed(W.finish_block, {
    ...targeted(
      (input: (typeof W.finish_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.finish_block)['input']['Type'], _prepared: number | undefined, caller: Caller) {
        const task = yield* scoped(input.blockId);
        const finished = yield* (yield* Tasks).finish({ id: task.id, commit: input.commit, operator: caller.actor.kind === 'operator' });
        yield* announceEnd(caller, finished, input.commit ?? null);
        return yield* endResult(finished, input.commit);
      }),
      heldFacts('finishing ends that session’s work at its done word'),
    ),
    answer: (answer) => answer,
  }),

  close_block: routed(W.close_block, {
    ...targeted(
      (input: (typeof W.close_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.close_block)['input']['Type'], _prepared: number | undefined, caller: Caller) {
        const { id } = yield* scoped(input.blockId);
        const closed = yield* (yield* Tasks).close({ id, reason: input.reason, operator: caller.actor.kind === 'operator' });
        yield* announceEnd(caller, closed, null);
        return yield* endResult(closed);
      }),
      heldFacts('closing ends that session’s work at its closed word'),
    ),
    answer: (answer) => answer,
  }),

  apply_batch: routed(W.apply_batch, {
    files: (input: (typeof W.apply_batch)['input']['Type'], caller: Caller) => [
      ...documentReads(caller, input.file),
      ...inlineBodyFiles(input.ops ?? input.source).map((path) => readSubject(path)),
    ],
    prepare: Effect.fn('apply_batch.prepare')(function* (
      input: (typeof W.apply_batch)['input']['Type'],
      caller: Caller,
    ): Effect.fn.Return<
      { readonly target: Result.Result<GraphTarget, GateRefusal<CrossingRefusal> | StoreFailure>; readonly facts: readonly Raised[] },
      StoreFailure | GateRefusal<'batch-source'>,
      GraphServices | GraphCall
    > {
      const target = yield* Effect.result(currentTarget);
      const found = Result.isFailure(target)
        ? []
        : yield* atTarget(
            target.success,
            Effect.flatMap(Batch, (batch) => batch.held(batchInput(input, caller))),
          );
      return {
        target,
        facts: found.map((work): Raised => heldRaised(work, 'the batch ends, takes or returns that work')),
      };
    }),
    execute: Effect.fnUntraced(function* (
      input: (typeof W.apply_batch)['input']['Type'],
      prepared: { readonly target: Result.Result<GraphTarget, GateRefusal<CrossingRefusal> | StoreFailure> },
      caller: Caller,
    ) {
      if (Result.isFailure(prepared.target)) return yield* prepared.target.failure;
      const target = prepared.target.success;
      const projectId = target.projectId;
      const running = Effect.gen(function* () {
        const batch = yield* Batch;
        const sources = [input.file, input.source, input.ops].filter((source) => source !== undefined).length;
        if (sources !== 1) {
          return yield* new GateRefusal('batch-source', 'a batch arrives one way: as a file, raw source, or structured ops', [
            'pass the raw document source, the structured ops, or the path of the file that holds it — exactly one',
          ]);
        }
        const { value: result, start } = yield* priced(
          lawPricing(projectId, true),
          batch.apply(batchInput(input, caller), projectId, caller.actor.kind === 'operator', yield* documentScope(projectId)),
        );
        const lines: string[] = [];
        for (const [index, outcome] of result.ops.entries()) {
          if ('uuid' in outcome) {
            const name = blockName(outcome.uuid);
            const file = result.bodyFiles?.[index];
            lines.push(`${index + 1}. ${name}${file === undefined ? '' : ` ← ${file}`}`);
          } else if ('path' in outcome) {
            lines.push(`${index + 1}. anchor ${outcome.path}`);
          } else {
            lines.push(`${index + 1}. ok`);
          }
        }
        for (const [handle, name] of Object.entries(result.ids)) lines.push(`$${handle} → ${name}`);
        return {
          status: 'ok' as const,
          overview: lines.join('\n'),
          ops: result.ops,
          ids: result.ids,
          specs: specAnswers(result.specs ?? []),
          crowded: result.crowded,
          start,
        };
      });
      return yield* admitted(W.apply_batch)(atTarget(target, running));
    }),
    answer: (applied: {
      readonly status: 'ok';
      readonly overview: string;
      readonly ops: OpOutcome[];
      readonly ids: Record<string, string>;
      readonly specs: readonly IdleSpecAnswer[] | undefined;
      readonly crowded: readonly Crowded[] | undefined;
      readonly start: StartPrice | undefined;
    }) => ({
      status: applied.status,
      overview: applied.overview,
      ids: applied.ids,
      specs: applied.specs,
      crowded: applied.crowded,
      start: applied.start,
    }),
  }),

  accept_amendment: routed(W.accept_amendment, {
    ...targeted(
      (input: (typeof W.accept_amendment)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.accept_amendment)['input']['Type'], _prepared: number | undefined) {
        const row = yield* scoped(input.blockId);
        const accepted = yield* priced(lawPricing(row.projectId, true), (yield* Review).accept({ id: row.id, reason: input.reason }));
        const [crowded] = yield* crowdedPages(yield* Blocks, yield* (yield* Tags).of(row.projectId), accepted.value.born);
        return { ...accepted, crowded };
      }),
    ),
    answer: (raw: Priced<BlockRecord> & { readonly crowded: Crowded | undefined }) => ({ ...pricedBlockResult(raw), crowded: raw.crowded }),
  }),

  revise_amendment: routed(W.revise_amendment, {
    ...targeted(
      (input: (typeof W.revise_amendment)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.revise_amendment)['input']['Type'], _prepared: number | undefined) {
        const { id } = yield* scoped(input.blockId);
        return yield* (yield* Review).revise({ id, ops: input.ops });
      }),
    ),
    answer: blockResult,
  }),

  uphold_amendment: routed(W.uphold_amendment, {
    ...targeted(
      (input: (typeof W.uphold_amendment)['input']['Type']) => [input.blockId, ...input.by],
      Effect.fnUntraced(function* (input: (typeof W.uphold_amendment)['input']['Type'], _prepared: number | undefined) {
        const proposal = yield* scoped(input.blockId);
        const { id } = proposal;
        return yield* (yield* Review).uphold({
          id,
          reason: input.reason,
          by: yield* Effect.forEach(input.by, (name) => Effect.map(peer(name, proposal, 'cross-project'), (row) => row.id)),
        });
      }),
    ),
    answer: blockResult,
  }),

  reject_amendment: routed(W.reject_amendment, {
    ...targeted(
      (input: (typeof W.reject_amendment)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.reject_amendment)['input']['Type'], _prepared: number | undefined) {
        const { id } = yield* scoped(input.blockId);
        return yield* (yield* Review).reject({ id, reason: input.reason });
      }),
    ),
    answer: blockResult,
  }),

  supersede_block: routed(W.supersede_block, {
    ...targeted(
      (input: (typeof W.supersede_block)['input']['Type']) => [input.oldId, input.withId],
      Effect.fnUntraced(function* (input: (typeof W.supersede_block)['input']['Type'], _prepared: number | undefined) {
        const old = yield* scoped(input.oldId);
        const replacement = yield* peer(input.withId, old, 'cross-project');
        const replaced = yield* priced(
          yield* nodePricing(old.projectId, old),
          (yield* Supersession).supersede({ oldId: old.id, withId: replacement.id }),
        );
        return { ...pricedResult(replaced), ...(yield* endResult(replaced.value)) };
      }),
      heldFacts('replacing it ends that hold and retires the work'),
    ),
    answer: (answer) => answer,
  }),

  unsupersede_block: routed(W.unsupersede_block, {
    ...targeted(
      (input: (typeof W.unsupersede_block)['input']['Type']) => input.blockId,
      Effect.fnUntraced(function* (input: (typeof W.unsupersede_block)['input']['Type'], _prepared: number | undefined) {
        const row = yield* scoped(input.blockId);
        return yield* priced(yield* nodePricing(row.projectId, row), (yield* Supersession).unsupersede({ id: row.id }));
      }),
    ),
    answer: pricedResult,
  }),
};

export const WORK_PAIRS = pairsOf(WORK_ROUTED);
export const WORK_ROUTES = routesOf(WORK_ROUTED);
