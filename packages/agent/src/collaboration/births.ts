import { Effect } from 'effect';
import { activity, note } from '@runlith/activity/Activity';
import { AGENT_RESULT, type CollaborationNote } from './activities';
import type { ThreadBindings } from '../agent/contracts';
import type { ThreadBornOf } from '../protocol/birth';
import type { RunEnded } from '../thread/ending';
import type { KeyedRequest } from '../thread/keyed';
import {
  forkSide,
  historyCannot,
  NATIVE_HARNESS,
  threadTarget,
  type ThreadForkCut,
  type ThreadReadFailure,
  type ThreadRecord,
} from '../thread/record';
import { ThreadCallBroke } from '../thread/ThreadBorder';
import { mintThreadId } from '../thread/identity';
import type { ReportDelivery, ThreadInboxItemValues } from '../thread/storage/inbox';
import { ThreadBudget, ThreadInbox } from '../thread/ThreadPorts';
import type { ThreadBirthPlace, ThreadHostBinding } from '../thread/rows';
import { SpawnSeats } from './collaborationResidency';
import { AgentProfileUnknownError } from '../thread/agents/AgentProfile';
import type { SpawnSubscription, ThreadModelAsk, ThreadPlaneFailure, ThreadSpawnResult } from './ThreadPlaneAccess';
import { type CollaborationConfig, DeclaredCollaboration, WORKTREE_INHERIT } from './CollaborationConfig';
import { collaborationBirth } from './CollaborationVoice';
import { bornElsewhere, WORKTREE_CONSENT } from './collaborationVerbs';
import { envelopePrefix } from './envelopeKeys';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { askedSwitches, birthModel, type ModelJudgment } from './modelChoice';
import { planeRefused, transportCannot } from './planeRefusal';
import { resolveThread, unreached } from './reach';
import type { PlaneRefusalCode } from './refusals';
import { ThreadRuns, ThreadRunUnavailable } from './runs';
import { type SpawnCeilings, spawnLimits } from './spawnLimits';
import { ThreadSpawnAccess } from './ThreadSpawnAccess';
import { type BirthRequest, Threads } from './threads';
import { ThreadTypes, type ThreadTypeOffer } from './types';

export type ThreadSpawnRequest = {
  readonly parent: ThreadRecord;
  readonly runId?: string;
  readonly bornOf?: ThreadBornOf;
  readonly requestId: string;
  readonly agentId: string;
  readonly task: string;
  readonly name?: string;
  readonly root?: boolean;
  readonly title?: string;
  readonly fork?: ThreadForkCut;
  readonly forkFrom?: string;
  readonly model?: ThreadModelAsk;
  readonly switches?: ModelSwitches;
  readonly host?: ThreadHostBinding;
  readonly bindings?: ThreadBindings;
  readonly project?: string | number;
  readonly worktree?: string;
  readonly asked?: readonly string[];
  readonly delegation?: boolean;
  readonly plain?: boolean;
  readonly subscribe?: SpawnSubscription;
  readonly reportDelivery?: ReportDelivery;
  readonly secondsCap?: number;
};

export type Provision = {
  readonly itemId: string;
  readonly task: string;
  readonly lowered?: ThreadSpawnResult['lowered'];
  readonly subscribe?: SpawnSubscription;
};

export const makeBirths = Effect.fnUntraced(function* ({ request }: { readonly request: (key: string) => Effect.Effect<KeyedRequest> }) {
  const threads = yield* Threads;
  const inbox = yield* ThreadInbox;
  const runs = yield* ThreadRuns;
  const types = yield* ThreadTypes;
  const budgets = yield* ThreadBudget;
  const spawnAccess = yield* ThreadSpawnAccess;
  const seats = yield* SpawnSeats;
  const config = yield* DeclaredCollaboration;

  const declared = (act: string): Effect.Effect<CollaborationConfig, ThreadCallBroke> =>
    config === null
      ? new ThreadCallBroke({ cause: new Error(`This host declared no collaboration, so nothing here can ${act}.`) })
      : Effect.succeed(config);

  const readLimits = Effect.fnUntraced(function* (
    parent: ThreadRecord,
    delegated: boolean,
    root: boolean,
  ): Effect.fn.Return<SpawnCeilings, ThreadPlaneFailure> {
    const collaboration = yield* declared('start an agent');
    const delegation = delegated ? yield* collaboration.delegation(parent) : null;
    if (root) return { parentId: parent.id, delegation, depth: null, budget: null, slots: undefined };
    const depth = yield* spawnAccess.depth(parent);
    const budget = yield* budgets.of({ spawnRootId: parent.spawnRootId, principal: parent.principal });
    return { parentId: parent.id, delegation, depth, budget, slots: collaboration.spawnSlots };
  });

  const forkSource = Effect.fnUntraced(function* (input: ThreadSpawnRequest): Effect.fn.Return<ThreadRecord, ThreadPlaneFailure> {
    if (input.forkFrom === undefined) return input.parent;
    const source = yield* resolveThread(threads, input.parent, input.forkFrom);
    if (source === null) return yield* unreached(threads, input.parent, input.forkFrom);
    return source;
  });

  const seat = Effect.fnUntraced(function* (parent: ThreadRecord, delegated: boolean, root: boolean, childId: string) {
    const reading = yield* readLimits(parent, delegated, root);
    return yield* Effect.sync(() => {
      const over = spawnLimits({ ...reading, resident: seats.resident() })[0];
      if (over === undefined && !root) seats.seat(childId);
      return over;
    });
  });

  const answer = Effect.fnUntraced(function* (
    parent: ThreadRecord,
    child: ThreadRecord,
    provision: Provision,
  ): Effect.fn.Return<ThreadSpawnResult, ThreadPlaneFailure> {
    const depth = yield* spawnAccess.depth(child);
    const text = child.plain
      ? provision.task
      : [collaborationBirth({ parent, child, depth, messaging: child.capabilities.messaging }), provision.task]
          .filter((part) => part.trim() !== '')
          .join('\n\n');
    const deadline = (yield* request(provision.itemId)).deadline;
    if (provision.subscribe !== undefined) {
      if (config?.subscribe === undefined) return yield* subscriptionsUnhosted();
      const provisioned = yield* inbox.receipt(provision.itemId);
      if (provisioned?.deliveredToRunId == null) yield* config.subscribe(parent.id, child.id, provision.subscribe.wakes);
    }
    yield* runs.start(child.id, { itemId: provision.itemId, text, deadline }).pipe(
      Effect.catchIf(
        (failure): failure is ThreadRunUnavailable => failure instanceof ThreadRunUnavailable && failure.reason === 'not-ready',
        (unavailable) =>
          Effect.fail(
            planeRefused(
              'spawn-not-ready',
              `child ${child.id} stands and request ${provision.itemId} still provisions it, ` +
                `but this host could not finish preparing it${unavailable.cause instanceof Error ? ` (${unavailable.cause.message})` : ''}. ` +
                'Nothing of it is running; repeat this spawn with the same name and inputs, or send_task to its thread id.',
            ),
          ),
      ),
    );
    const lowered = provision.lowered;
    return {
      status: 'started',
      ...threadTarget(child),
      agentId: child.typeId ?? child.agentId,
      name: child.name,
      model: child.model,
      lowered: lowered,
    };
  });

  return {
    limits: Effect.fnUntraced(function* (parent: ThreadRecord, delegated: boolean, root: boolean) {
      const reading = yield* readLimits(parent, delegated, root);
      return spawnLimits({ ...reading, resident: seats.resident() });
    }),

    answer,

    spawn: Effect.fnUntraced(function* (input: ThreadSpawnRequest): Effect.fn.Return<ThreadSpawnResult, ThreadPlaneFailure> {
      const collaboration = yield* declared('start an agent');
      const parent = input.parent;
      const root = input.root === true;
      if (input.title !== undefined && input.title.trim() === '') {
        return yield* planeRefused('title-empty', 'A thread title cannot be empty.');
      }
      if (root && input.plain === true) {
        return yield* planeRefused(
          'plain-root',
          'a plain agent takes your words for the operator’s only while you are its parent, and a root has none.',
        );
      }
      if (input.subscribe !== undefined && collaboration.subscribe === undefined) return yield* subscriptionsUnhosted();
      const project = yield* homeOf(collaboration, input);
      const source = yield* forkSource(input);
      const asked = birthRequest(input, project, source);
      const itemId = spawnRequestId(parent.id, input.requestId);
      const standing = yield* threads.readBirth(parent.id, parent.principal, asked);
      if (standing.status === 'born')
        return yield* answer(parent, standing.thread, {
          itemId: standing.itemId ?? itemId,
          task: input.task,
          subscribe: input.subscribe,
        });
      if (standing.status === 'spent') return yield* spawnSpent(input.requestId);
      const there = project === undefined ? {} : { project };
      const offer = yield* types.resolve({ caller: 'agent', under: parent, typeId: input.agentId, ...there });
      if (!offer) {
        const offered = yield* types.offered({ caller: 'agent', under: parent, ...there });
        return yield* new ThreadCallBroke({
          cause: new AgentProfileUnknownError(
            input.agentId,
            offered.map((type) => type.id),
          ),
        });
      }
      if ('withheld' in offer) return yield* planeRefused('type-withheld', offer.withheld, offer.unblock);
      if (input.fork && offer.capabilities.history === 'none') {
        return yield* planeRefused(
          'harness-contract',
          `agent type ${input.agentId} runs on a harness that takes no \`fork\` of this conversation.`,
        );
      }
      const side = input.fork === undefined ? null : forkSide(input.fork);
      const cannot = side === null ? null : historyCannot(source.capabilities, side);
      if (cannot !== null) return yield* transportCannot(source, cannot);
      if (input.plain === true && input.fork !== undefined) {
        return yield* planeRefused(
          'plain-fork',
          'a fork carries your own conversation, the spawn among it, so the child could not take your words for the operator’s.',
        );
      }
      if (input.plain === true && offer.harness !== NATIVE_HARNESS) {
        return yield* planeRefused(
          'harness-contract',
          `agent type ${input.agentId} runs on the ${offer.harness} harness, and \`plain\` starts a native agent: a CLI runs plain by its own harness profile.`,
        );
      }
      if (source.id !== parent.id && (yield* runs.current(source.id)) !== null) {
        return yield* planeRefused('thread-running', `thread ${source.id} is running; its history is forked between its runs.`);
      }
      const childId = mintThreadId();
      const over = yield* seat(parent, input.delegation === true, root, childId);
      if (over !== undefined) return yield* planeRefused(over.code, over.fact);
      const seated = Effect.gen(function* () {
        const selection = offer.capabilities.judgedModel
          ? yield* birthModel(collaboration.models(), source, offer, input.model, collaboration.menu?.(input.runId))
          : null;
        const switches = yield* birthSwitches(input, selection);
        if (input.name !== undefined && !root) {
          const holder = yield* threads.named(parent.principal, parent.spawnRootId, input.name);
          if (holder) return yield* nameTaken(input.name, holder.id);
        }
        const place = yield* placeOf(collaboration, input, project);
        const releasePlace = collaboration.placement?.released;
        const releasing = <A, E>(birth: Effect.Effect<A, E>): Effect.Effect<A, E> =>
          place === undefined || releasePlace === undefined ? birth : Effect.onError(birth, () => releasePlace(place));
        const created = yield* releasing(
          threads.create({
            request: asked,
            deadline: (yield* request(input.requestId)).deadline,
            childId,
            creatorThreadId: parent.id,
            principal: parent.principal,
            offer: secondsBounded(offer, input.secondsCap),
            authority: offer.approvalMode === undefined ? parent.authority : { mode: offer.approvalMode, bypassFrom: null },
            place: place ?? null,
            model:
              selection !== null
                ? {
                    judged: { provider: selection.option.provider, model: selection.option.id, reasoning: selection.reasoning },
                    switches,
                  }
                : input.model
                  ? { asked: input.model }
                  : null,
            bornOf: input.bornOf ?? null,
            spawnedByRunId: input.runId ?? null,
            plain: input.plain === true,
            provision: provision(parent, childId, input.requestId, input.task, input.plain === true, input.reportDelivery),
          }),
        );
        if (created.status === 'spent') return yield* spawnSpent(input.requestId);
        if (!created.acted) {
          seats.unseat(childId);
          if (place !== undefined && releasePlace !== undefined) yield* releasePlace(place);
        }
        if (created.acted && input.runId !== undefined) {
          yield* note<CollaborationNote>(
            { type: 'agent-spawned', agent: created.thread.typeId ?? created.thread.agentId, child: created.thread.id },
            { run: input.runId },
          );
        }
        return yield* answer(parent, created.thread, {
          itemId,
          task: input.task,
          lowered: selection?.lowered,
          subscribe: input.subscribe,
        });
      });
      return yield* seated.pipe(Effect.tapError(() => Effect.sync(() => seats.unseat(childId))));
    }),

    settled: Effect.fnUntraced(function* (ended: RunEnded): Effect.fn.Return<void, ThreadReadFailure> {
      if (ended.work === 'compaction') return;
      const child = yield* threads.find(ended.threadId, ended.principal);
      if (!child?.parentThreadId) return;
      const spawnedBy = child.spawnedByRunId;
      if (spawnedBy) {
        yield* activity(AGENT_RESULT, { child: child.id, outcome: ended.status }, Effect.void, {
          thread: child.parentThreadId,
          run: spawnedBy,
          parent: { run: spawnedBy },
          actor: { kind: 'thread', id: child.id },
        });
      }
    }),
  };
});

function secondsBounded(offer: ThreadTypeOffer, cap: number | undefined): ThreadTypeOffer {
  const profile = offer.profile;
  if (cap === undefined || profile === undefined) return offer;
  return { ...offer, profile: { ...profile, budget: { ...profile.budget, seconds: Math.min(profile.budget?.seconds ?? cap, cap) } } };
}

export function spawnRequestId(parentThreadId: string, requestId: string): string {
  return `${envelopePrefix('spawn', parentThreadId)}${requestId}`;
}

function homeOf(collaboration: CollaborationConfig, input: ThreadSpawnRequest): Effect.Effect<number | undefined, ThreadPlaneFailure> {
  if (input.project === undefined) return Effect.succeed(undefined);
  if (!collaboration.placement)
    return planeRefused('home-unplaced', 'this host places no child in another project; spawn without `project`.');
  return Effect.map(collaboration.placement.home(input.parent, input.project), bornElsewhere);
}

function placeOf(
  collaboration: CollaborationConfig,
  input: ThreadSpawnRequest,
  project: number | undefined,
): Effect.Effect<ThreadBirthPlace | undefined, ThreadPlaneFailure> {
  const worktree = input.worktree ?? WORKTREE_INHERIT;
  if (project === undefined && worktree === WORKTREE_INHERIT) return Effect.succeed(undefined);
  if (!collaboration.placement) {
    return planeRefused('worktree-unplaced', 'this host places no child in a worktree of its own; spawn without `worktree`.');
  }
  return collaboration.placement.resolve({
    parent: input.parent,
    project: project,
    worktree,
    requestId: input.requestId,
    agentId: input.agentId,
    asked: input.asked?.includes(WORKTREE_CONSENT) === true,
    name: input.name,
    host: input.host,
  });
}

function birthSwitches(input: ThreadSpawnRequest, selection: ModelJudgment | null): Effect.Effect<ModelSwitches, ThreadCallBroke> {
  if (input.switches === undefined || Object.keys(input.switches).length === 0) return Effect.succeed({});
  if (selection === null) {
    return Effect.fail(
      planeRefused(
        'switch-unoffered',
        `agent type ${input.agentId} starts on a model whose switches this host does not set; omit \`switches\`.`,
      ),
    );
  }
  return askedSwitches(selection.option, input.switches);
}

function birthRequest(input: ThreadSpawnRequest, project: number | undefined, source: ThreadRecord): BirthRequest {
  const bindings = Object.entries(input.bindings ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
  return {
    key: input.requestId,
    task: input.task,
    typeId: input.agentId,
    name: input.name ?? null,
    root: input.root === true ? true : undefined,
    title: input.title?.trim(),
    project: project,
    worktree: input.worktree === WORKTREE_INHERIT ? undefined : input.worktree,
    host: input.host ?? null,
    bindings: bindings.length === 0 ? undefined : Object.fromEntries(bindings),
    seed: input.fork ? { fork: input.fork, source: source.id } : { fresh: true },
    model: input.model ?? null,
    switches: input.switches === undefined || Object.keys(input.switches).length === 0 ? undefined : input.switches,
    plain: input.plain,
    subscribe: input.subscribe,
    reportDelivery: input.reportDelivery,
  };
}

function nameTaken(name: string, holderId: string): ThreadCallBroke {
  return planeRefused(
    'name-taken',
    `${name} already addresses thread ${holderId} in this team. ` +
      'Name the child something else, or rename that thread first — a name stays taken while its thread exists, archived or not.',
  );
}

function subscriptionsUnhosted(): Effect.Effect<never, ThreadCallBroke> {
  return Effect.fail(new ThreadCallBroke({ cause: new Error('This host keeps no thread subscriptions; spawn without `subscribe`.') }));
}

function spawnSpent(requestId: string): ThreadCallBroke {
  return planeRefused(
    'spawn-spent',
    `request ${requestId} already started a child that has since been deleted; ask for new work under a request id of its own.`,
  );
}

function provision(
  parent: ThreadRecord,
  childId: string,
  requestId: string,
  task: string,
  plain: boolean,
  reportDelivery: ReportDelivery | undefined,
): Extract<ThreadInboxItemValues, { kind: 'task' }> {
  return {
    id: spawnRequestId(parent.id, requestId),
    threadId: childId,
    sender: {
      kind: 'thread',
      threadId: parent.id,
      name: parent.name,
      ...(parent.projectId === undefined ? {} : { projectId: parent.projectId }),
      ...(plain ? { asOperator: true as const } : {}),
    },
    kind: 'task',
    body: { intent: 'task', text: task, inReplyTo: null, reportDelivery },
    occurredAt: new Date().toISOString(),
  };
}
