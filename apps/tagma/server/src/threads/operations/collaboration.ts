import { Effect } from 'effect';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import { type Raised } from '@runlith/agent/permissions';
import { listedOutput, readRoster } from '@runlith/agent/collaboration/agentRoster';
import {
  APPROVAL_REFUSAL_OF,
  approvalChoiceOf,
  approvalOutput,
  approvalReason,
  type ApprovalRefusal,
  approvalText,
  bornAt,
  bornElsewhere,
  type ContinuedOutput,
  continuedOutput,
  continuedText,
  lineageRaised,
  type SentOutput,
  sentOutput,
  sentText,
  spawnAsk,
  startedText,
  stoppedText,
  worktreeRaised,
} from '@runlith/agent/collaboration/collaborationVerbs';
import { planeRefusalOf } from '@runlith/agent/collaboration/planeRefusal';
import { PLANE_REFUSALS } from '@runlith/agent/collaboration/refusals';
import type { ThreadPlaneFailure, ThreadVerbs } from '@runlith/agent/collaboration/ThreadPlaneAccess';
import { causeSentence, ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadRecordUnreadable, type ThreadTarget } from '@runlith/agent/thread/record';
import { threadCauseOf, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { body, pair } from '../../platform/contract/service/body.js';
import { said, saidLines, UNVOICED } from '../../platform/contract/service/presentation.js';
import { SignedCall } from '../../platform/contract/service/writers.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import { PlacementRefused } from '../birth/placement.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { COLLABORATION_OPERATIONS as OPS, type SpawnPrepared } from '../contract/wire/operations/collaboration.js';

type Declared = { readonly refusals: readonly string[] };

type Answer<K extends keyof typeof OPS> = DeclaredAnswer<(typeof OPS)[K]['answer']>;

const sentVoice = saidLines((answer: Answer<'send_message'>) =>
  answer.status === 'sent' || answer.status === 'not-found' ? sentText(answer as SentOutput).split('\n') : UNVOICED,
);

type Refusal<D extends Declared> = GateRefusal<D['refusals'][number]>;

const NO_CALLING_THREAD: Unblock = [
  'make the call from the CLI session Tagma started as a thread: its environment carries the grant that names the thread',
  'as the operator, write to the thread in the app, or open one with create_thread',
];

const NOTHING_CROSSED: readonly Raised[] = [];

const COLLABORATION_REFUSED: Unblock = ['act on what the reason names; list_agents reads the agents as they stand now'];

const refusalOf = <D extends Declared>(declared: D, failure: ThreadBorderFailed): Effect.Effect<never, Refusal<D>> => {
  const cause = threadCauseOf(failure);
  if (failure instanceof ThreadStorageFailed || cause instanceof ThreadStorageFailed || cause instanceof ThreadRecordUnreadable) {
    return Effect.die(failure);
  }
  const plane = planeRefusalOf(failure);
  const refusal =
    cause instanceof GateRefusal
      ? cause
      : cause instanceof PlacementRefused
        ? cause.refusal
        : plane === null
          ? null
          : new GateRefusal(plane.code, plane.reason, plane.unblock);
  if (refusal === null)
    return Effect.fail(new GateRefusal('collaboration-refused', causeSentence(cause), COLLABORATION_REFUSED) as Refusal<D>);
  if (declared.refusals.includes(refusal.code)) return Effect.fail(refusal as Refusal<D>);
  return Effect.fail(new GateRefusal('collaboration-refused', `${refusal.code}: ${refusal.reason}`, refusal.unblock) as Refusal<D>);
};

const noCallingThread = () =>
  new GateRefusal(
    'no-calling-thread',
    'this call carries no thread, and the agent verbs act as the thread that calls them',
    NO_CALLING_THREAD,
  );

export const callingThread = (caller: Caller): Effect.Effect<string, GateRefusal<'no-calling-thread'>> =>
  caller.actor.kind === 'thread' ? Effect.succeed(caller.actor.threadId) : Effect.fail(noCallingThread());

export const collaborating = Effect.fnUntraced(function* <D extends Declared, A>(
  declared: D,
  caller: Caller,
  work: (verbs: ThreadVerbs, key: string) => Effect.Effect<A, ThreadPlaneFailure | GateRefusal>,
) {
  const actor = caller.actor;
  if (actor.kind !== 'thread') return yield* Effect.fail(noCallingThread() as Refusal<D>);
  const key = (yield* SignedCall) ?? crypto.randomUUID();
  const harness = yield* ThreadHarness;
  return yield* harness.collaboration
    .collaborate(actor.threadId, actor.principalId, (verbs) => work(verbs, key))
    .pipe(Effect.catch((failure) => refusalOf(declared, failure)));
});

function targetDisplay(target: ThreadTarget): ToolDisplay {
  return {
    form: 'none',
    reference: {
      kind: 'agent',
      address: target.threadId,
      id: target.threadId,
      ...(target.projectId === undefined ? {} : { projectId: target.projectId }),
    },
  };
}

function sentDisplay(answer: DeclaredAnswer<(typeof OPS.send_message)['answer']>): ToolDisplay {
  return answer.status === 'sent'
    ? {
        form: 'none',
        reference: {
          kind: 'agents',
          recipients: answer.deliveries.map(({ recipient }) => ({
            address: recipient.name ?? recipient.threadId,
            id: recipient.threadId,
            ...(recipient.projectId === undefined ? {} : { projectId: recipient.projectId }),
          })),
        },
      }
    : { form: 'none' };
}

export const COLLABORATION_PAIRS = {
  list_agents: pair(
    OPS.list_agents,
    body(OPS.list_agents, {
      execute: (input, _prepared, caller) =>
        collaborating(OPS.list_agents, caller, (verbs) => readRoster(verbs.directory, input)).pipe(
          Effect.flatMap((read) =>
            'refused' in read
              ? Effect.fail(new GateRefusal(read.refused, read.reason, [read.unblock]))
              : Effect.succeed(listedOutput(read)),
          ),
        ),
      voice: saidLines((answer: Answer<'list_agents'>) =>
        answer.status !== 'listed'
          ? UNVOICED
          : [
              ...(answer.cursor === null ? [] : [`${answer.total} agents; the next page is list_agents(cursor="${answer.cursor}")`]),
              ...answer.page.split('\n'),
            ],
      ),
    }),
  ),

  send_message: pair(
    OPS.send_message,
    body(OPS.send_message, {
      display: sentDisplay,
      voice: sentVoice,
      execute: (input, _prepared, caller) =>
        collaborating(OPS.send_message, caller, (verbs, key) =>
          Effect.map(
            verbs.messaging.send({
              to: input.to,
              intent: 'message',
              text: input.message,
              key,
              inReplyTo: input.inReplyTo,
              final: input.final === true ? true : undefined,
              wake: input.wake,
            }),
            sentOutput,
          ),
        ),
    }),
  ),

  send_task: pair(
    OPS.send_task,
    body(OPS.send_task, {
      display: sentDisplay,
      voice: sentVoice,
      prepare: (input, caller) =>
        input.compact === undefined
          ? Effect.succeed(NOTHING_CROSSED)
          : collaborating(OPS.send_task, caller, (verbs) => verbs.messaging.aheadCrossing(input.to)),
      execute: (input, crossing, caller) =>
        collaborating(OPS.send_task, caller, (verbs, key) =>
          Effect.map(
            verbs.messaging.send({
              to: input.to,
              intent: 'task',
              text: input.task,
              key,
              wake: input.wake,
              compact: input.compact,
              asked: input.compact === undefined ? undefined : crossing.map((raised) => raised.condition),
            }),
            sentOutput,
          ),
        ),
    }),
  ),

  answer_approval: pair(
    OPS.answer_approval,
    body(OPS.answer_approval, {
      display: targetDisplay,
      execute: (input, _prepared, caller) =>
        collaborating(OPS.answer_approval, caller, (verbs) =>
          Effect.gen(function* () {
            const refused = (code: ApprovalRefusal) => new GateRefusal(code, approvalReason(code, input), PLANE_REFUSALS[code]);
            const choice = approvalChoiceOf(input);
            if (choice === null) return yield* refused('answer-unoffered');
            const answer = yield* verbs.approvals.answer({ threadId: input.threadId, questionId: input.questionId, choice });
            if (answer.status !== 'answered') return yield* refused(APPROVAL_REFUSAL_OF[answer.status]);
            return approvalOutput(answer, input);
          }),
        ),
      voice: said((answer: Answer<'answer_approval'>) => (answer.status === 'answered' ? approvalText(answer) : UNVOICED)),
    }),
  ),

  interrupt_agent: pair(
    OPS.interrupt_agent,
    body(OPS.interrupt_agent, {
      display: sentDisplay,
      voice: sentVoice,
      prepare: (input, caller) =>
        collaborating(OPS.interrupt_agent, caller, (verbs) => Effect.map(verbs.messaging.lineage(input.to), lineageRaised)),
      execute: (input, _prepared, caller) =>
        collaborating(OPS.interrupt_agent, caller, (verbs, key) =>
          Effect.map(verbs.messaging.send({ to: input.to, intent: 'interrupt', text: input.reason, key }), sentOutput),
        ),
    }),
  ),

  spawn_agent: pair(
    OPS.spawn_agent,
    body(OPS.spawn_agent, {
      display: (answer) => ({
        form: 'none',
        title: answer.name ?? answer.agentId,
        reference: { kind: 'thread', id: answer.threadId, ...(answer.projectId === undefined ? {} : { projectId: answer.projectId }) },
      }),
      prepare: (input, caller) =>
        Effect.flatMap(CallerAim, (aim) =>
          collaborating(OPS.spawn_agent, caller, (verbs) =>
            Effect.gen(function* () {
              const over = (yield* verbs.spawnLimits(input.link === 'root'))[0];
              if (over !== undefined) return yield* new GateRefusal(over.code, over.fact, PLANE_REFUSALS[over.code]);
              const named = aim?.project ?? input.project;
              const home = named === undefined ? null : yield* verbs.spawnHome(named);
              const asking = input.worktree === undefined ? null : (home?.worktrees ?? (yield* verbs.worktreeAsking));
              const elsewhere = bornElsewhere(home);
              return { asking, home: elsewhere } satisfies SpawnPrepared;
            }),
          ),
        ),
      execute: (input, prepared, caller) =>
        collaborating(OPS.spawn_agent, caller, (verbs, key) =>
          verbs.spawn(spawnAsk(bornAt(input, prepared.home), key, worktreeRaised(input.worktree, prepared.asking))),
        ),
      voice: said((answer: Answer<'spawn_agent'>) => (answer.status === 'started' ? startedText(answer) : UNVOICED)),
    }),
  ),

  stop_agent: pair(
    OPS.stop_agent,
    body(OPS.stop_agent, {
      display: targetDisplay,
      prepare: (input, caller) => collaborating(OPS.stop_agent, caller, (verbs) => verbs.crossing({ to: input.threadId, within: 'child' })),
      execute: (input, crossing, caller) =>
        collaborating(OPS.stop_agent, caller, (verbs, key) =>
          verbs.stop({ threadId: input.threadId, key, asked: crossing.map((raised) => raised.condition) }),
        ),
      voice: said((answer: Answer<'stop_agent'>) =>
        answer.status === 'stopped' || answer.status === 'stopping' || answer.status === 'not-running' || answer.status === 'spent'
          ? stoppedText({ ...answer, status: answer.status })
          : UNVOICED,
      ),
    }),
  ),

  continue_agent: pair(
    OPS.continue_agent,
    body(OPS.continue_agent, {
      display: targetDisplay,
      prepare: (input, caller) =>
        collaborating(OPS.continue_agent, caller, (verbs) => verbs.crossing({ to: input.threadId, within: 'child' })),
      execute: (input, crossing, caller) =>
        collaborating(OPS.continue_agent, caller, (verbs, key) =>
          Effect.map(verbs.continue({ threadId: input.threadId, key, asked: crossing.map((raised) => raised.condition) }), continuedOutput),
        ),
      voice: said((answer: Answer<'continue_agent'>) =>
        answer.status === 'continued' || answer.status === 'spent' ? continuedText(answer as ContinuedOutput) : UNVOICED,
      ),
    }),
  ),
};
