import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { ToolCaller } from '../agent/contracts';
import { callerInThread } from '../agent/testing/caller';
import type { ThreadRecord, TransportCapabilities } from '../thread/record';
import { NATIVE_CAPABILITIES } from '../thread/record';
import { spawnSeatsLayer } from './collaborationResidency';
import { threadCauseOf } from '../thread/ThreadBorder';
import { ThreadBudget, ThreadInbox } from '../thread/ThreadPorts';
import { ContextCompaction } from './compaction';
import { DeclaredCollaboration, type CollaborationPlacement, type ThreadDelegation } from './CollaborationConfig';
import { ThreadModel } from './model';
import { ThreadRuns } from './runs';
import { ThreadDirectory } from './ThreadDirectory';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnAccess } from './ThreadSpawnAccess';
import { ThreadPlanes, threadPlanesLayer } from './ThreadPlanes';
import { ThreadSpawnTree, threadSpawnTreeLayer } from './ThreadSpawnTree';
import { ThreadRewind } from '../thread/run/ThreadRewind';
import { runAdmissionLayer } from '../thread/run/runAdmission';
import { type BirthInput, Threads } from './threads';
import { ThreadTypes } from './types';
import { planeRefusalOf } from './planeRefusal';
const models = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
const OWNER = 'owner-1';
const unused = () => Effect.die('This spawn tree contract does not use this operation');
const callerOf = (threadId: string, runId = `run-of-${threadId}`): ToolCaller => ({ ...callerInThread(threadId, runId), ownerId: OWNER });
const CAPABLE: TransportCapabilities = NATIVE_CAPABILITIES;
function record(id: string, parentThreadId: string | null): ThreadRecord {
  return {
    id,
    principal: OWNER,
    agentId: 'tagma',
    typeId: 'tagma',
    name: null,
    spawnRootId: 'root',
    parentThreadId,
    spawnedByRunId: null,
    bornOf: null,
    createdBy: null,
    harness: 'native',
    host: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    budgetTokens: null,
    capabilities: CAPABLE,
    model: { provider: 'subscription', model: models.defaultTextModelId('subscription'), reasoning: null },
    profile: null,
  };
}
type WorldInput = {
  readonly delegation?: ThreadDelegation;
  readonly born?: readonly string[];
  readonly placement?: CollaborationPlacement;
  readonly projectId?: number;
  readonly running?: readonly string[];
  readonly floorsLeft?: number;
};
const world = Effect.fnUntraced(function* (input: WorldInput = {}) {
  const records = new Map<string, ThreadRecord>(
    [record('root', null), record('child', 'root'), record('grandchild', 'child'), record('stranger', null)].map((thread) => [
      thread.id,
      thread,
    ]),
  );
  const created: BirthInput[] = [];
  const started: string[] = [];
  const compacted: string[] = [];
  const rewound: string[] = [];
  const threads = Threads.of({
    find: (id, principal) =>
      Effect.sync(() => {
        const found = records.get(id);
        return found && found.principal === principal ? found : null;
      }),
    named: (principal, root, name) =>
      Effect.sync(
        () =>
          [...records.values()].find((thread) => thread.principal === principal && thread.spawnRootId === root && thread.name === name) ??
          null,
      ),
    lineage: (id) =>
      Effect.sync(() => {
        const ancestors: ThreadRecord[] = [];
        let above = records.get(id)?.parentThreadId ?? null;
        while (above !== null) {
          const next = records.get(above);
          if (!next) return { ancestors, complete: false };
          ancestors.push(next);
          above = next.parentThreadId;
        }
        return { ancestors, complete: true };
      }),
    list: unused,
    watch: unused,
    birthReceipt: unused,
    readBirth: (_parent, _principal, request) =>
      Effect.sync(() =>
        (input.born ?? []).includes(request.key)
          ? { status: 'born' as const, thread: { ...record(`member-${request.key}`, 'child'), projectId: input.projectId } }
          : { status: 'unborn' as const },
      ),
    create: (birth) =>
      Effect.sync(() => {
        created.push(birth);
        const made = { ...record(birth.childId, birth.request.root ? null : birth.creatorThreadId), projectId: input.projectId };
        records.set(made.id, made);
        return { status: 'created' as const, thread: made, acted: true };
      }),
  });
  const layers = Layer.mergeAll(
    runAdmissionLayer,
    Layer.succeed(Threads, threads),
    Layer.succeed(
      ThreadRuns,
      ThreadRuns.of({
        current: (threadId) =>
          Effect.succeed(
            input.running?.includes(threadId)
              ? { runId: `run-${threadId}`, life: 'working' as const, askPrompt: null, since: new Date(0), stalledSince: null }
              : null,
          ),
        stopReceipt: unused,
        start: (threadId, start) =>
          Effect.sync(() => {
            started.push(`${threadId}:${start.itemId}`);
            return { status: 'started' as const, runId: `run-${threadId}`, acted: true };
          }),
        deliver: unused,
        continue: (threadId) => Effect.succeed({ status: 'continued' as const, runId: `run-${threadId}`, acted: true }),
        stop: () => Effect.succeed({ status: 'not-running' as const, acted: false }),
      }),
    ),
    Layer.succeed(
      ContextCompaction,
      ContextCompaction.of({
        choosesSummarizer: false,
        summarizer: unused,
        compact: (threadId) =>
          Effect.sync(() => {
            compacted.push(threadId);
            return {
              status: 'unchanged' as const,
              runId: `compaction-${threadId}`,
              history: { before: 5, after: 5 },
              summarizer: null,
              skipped: [],
              acted: true,
            };
          }),
        compactAhead: unused,
      }),
    ),
    Layer.succeed(ThreadModel, ThreadModel.of({ move: unused, adapted: unused })),
    Layer.succeed(
      ThreadTypes,
      ThreadTypes.of({
        resolve: () => Effect.succeed({ baseAgentId: 'tagma', harness: 'native', capabilities: CAPABLE }),
        offered: () => Effect.succeed([]),
      }),
    ),
    Layer.succeed(
      ThreadDirectory,
      ThreadDirectory.of({ access: () => ({ list: () => Effect.succeed({ rows: [], total: 0, cursor: null }) }), warmth: unused }),
    ),
    Layer.succeed(
      ThreadEnvelopes,
      ThreadEnvelopes.of({
        deliver: unused,
        completeRun: unused,
        withdrawRequest: unused,
        access: () => ({ send: unused, recipients: unused, sendAhead: unused, settle: unused, waitFor: unused, collect: unused }),
      }),
    ),
    Layer.succeed(
      ThreadInbox,
      ThreadInbox.of({
        put: unused,
        deliver: unused,
        acknowledge: unused,
        returnTo: unused,
        fated: unused,
        pending: unused,
        pendingOf: unused,
        arrivals: unused,
        delivered: unused,
        unconfirmed: unused,
        receipt: unused,
        intendWake: unused,
        pendingWakes: unused,
        woke: unused,
        openRequests: unused,
        openRequestsUnder: unused,
        closeRequests: unused,
        control: unused,
      }),
    ),
    Layer.succeed(
      DeclaredCollaboration,
      DeclaredCollaboration.of({
        models: () => models,
        subAgentDepth: () => Effect.succeed(2),
        delegation: () => Effect.succeed(input.delegation ?? { allowed: true, setAt: null }),
        reconcileIntervalMs: 30_000,
        placement: input.placement,
      }),
    ),
    Layer.succeed(
      ThreadBudget,
      ThreadBudget.of({
        of: () => Effect.succeed({ allowed: null, spent: 0, remaining: null, unmeasuredCount: 0, unmeasuredSample: [] }),
      }),
    ),
    Layer.succeed(
      ThreadSpawnAccess,
      ThreadSpawnAccess.of({
        depth: () => Effect.succeed({ current: 2 - (input.floorsLeft ?? 2), maximum: 2, remaining: input.floorsLeft ?? 2 }),
      }),
    ),
    Layer.succeed(
      ThreadRewind,
      ThreadRewind.of({
        rewind: (threadId, _ownerId, ask) =>
          Effect.sync(() => {
            rewound.push(`${threadId} ${ask.scope} ${ask.at} by ${ask.by} under ${ask.call?.actor}:${ask.call?.key}`);
            return { rewindId: 'rewind-1', scope: ask.scope, runIds: [ask.at], draft: null, taken: [], stopped: null };
          }),
        restore: unused,
        preview: unused,
        points: unused,
        draft: unused,
      }),
    ),
  );
  const context = yield* Layer.build(
    threadPlanesLayer.pipe(Layer.provideMerge(threadSpawnTreeLayer), Layer.provideMerge(spawnSeatsLayer), Layer.provideMerge(layers)),
  );
  return {
    planes: Context.get(context, ThreadPlanes),
    tree: Context.get(context, ThreadSpawnTree),
    records,
    created,
    started,
    compacted,
    rewound,
  };
});
type World = Effect.Success<ReturnType<typeof world>>;
const planeOf = Effect.fnUntraced(function* (made: World, caller: string) {
  const thread = made.records.get(caller);
  if (!thread) return yield* Effect.die(`Missing caller ${caller}`);
  const access = yield* made.planes.access(thread);
  if (!access) return yield* Effect.die(`Missing plane for ${caller}`);
  return yield* access.acting(callerOf(caller));
});
describe('ThreadSpawnTree.access(...) across the spawn tree', () => {
  it.effect(
    'a new and a recovered birth both address the child’s actual home',
    Effect.fnUntraced(function* () {
      const made = yield* world({
        born: ['recovered'],
        projectId: 7,
        placement: {
          asking: () => Effect.succeed('allow'),
          home: () => Effect.succeed({ projectId: 7, parentProjectId: 1, worktrees: 'allow' }),
          resolve: () => Effect.succeed({ projectId: 7 }),
        },
      });
      const plane = yield* planeOf(made, 'root');
      const fresh = yield* plane.spawn({ requestId: 'fresh', agentId: 'tagma', task: 'Read the module.', project: 7 });
      const recovered = yield* plane.spawn({ requestId: 'recovered', agentId: 'tagma', task: 'Read the module.' });
      expect(fresh).toMatchObject({ status: 'started', projectId: 7 });
      expect(made.records.get(fresh.threadId)?.parentThreadId).toBe('root');
      expect(recovered).toMatchObject({ status: 'started', threadId: 'member-recovered', projectId: 7 });
    }),
  );
  it.effect(
    'tree acts retain the addressed member’s home through their result',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      made.records.set('child', { ...made.records.get('child')!, projectId: 7 });
      const plane = yield* planeOf(made, 'root');
      const at = { threadId: 'child', key: 'home' };
      expect(yield* plane.stop(at)).toEqual({ threadId: 'child', projectId: 7, status: 'not-running' });
      expect(yield* plane.continue(at)).toEqual({ threadId: 'child', projectId: 7, runId: 'run-child' });
      expect(yield* plane.compact(at)).toMatchObject({ threadId: 'child', projectId: 7, status: 'unchanged' });
      expect(yield* plane.rewind({ ...at, at: 'run-child', scope: 'turn' })).toMatchObject({
        threadId: 'child',
        projectId: 7,
        scope: 'turn',
      });
    }),
  );
  it.effect(
    'a descendant needs no consent; a thread beyond the subtree names the one its act needs',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      const plane = yield* planeOf(made, 'child');
      const crossing = (to: string, within: 'child' | 'descendant') =>
        Effect.map(plane.crossing({ to, within }), (consents) => consents.map((consent) => consent.condition));
      expect(yield* crossing('grandchild', 'descendant')).toEqual([]);
      expect(yield* crossing('grandchild', 'child')).toEqual([]);
      expect(yield* crossing('root', 'descendant')).toEqual(['not-a-descendant']);
      expect(yield* crossing('stranger', 'child')).toEqual(['not-a-child']);
      expect(yield* crossing('child', 'descendant')).toEqual(['not-a-descendant']);
    }),
  );
  it.effect(
    'child acts resolve names within the calling team and return the same target as its id',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      made.records.set('child', { ...made.records.get('child')!, name: 'worker' });
      made.records.set('stranger', { ...made.records.get('stranger')!, name: 'outsider', spawnRootId: 'another-team' });
      const plane = yield* planeOf(made, 'root');
      expect(yield* plane.stop({ threadId: 'worker', key: 'stop' })).toMatchObject({ threadId: 'child' });
      expect(yield* plane.continue({ threadId: 'worker', key: 'continue' })).toMatchObject({ threadId: 'child' });
      expect(yield* plane.compact({ threadId: 'worker', key: 'compact' })).toMatchObject({ threadId: 'child' });
      expect(yield* plane.rewind({ threadId: 'worker', key: 'rewind', at: 'run-7', scope: 'turn' })).toMatchObject({ threadId: 'child' });
      expect(yield* plane.approvals.answer({ threadId: 'worker', questionId: 'q', choice: { allow: true } })).toMatchObject({
        threadId: 'child',
      });
      expect(planeRefusalOf(yield* Effect.flip(plane.stop({ threadId: 'outsider', key: 'outside' })))?.code).toBe('thread-unknown');
      expect(yield* plane.stop({ threadId: 'stranger', key: 'by-id', asked: ['not-a-child'] })).toMatchObject({ threadId: 'stranger' });
    }),
  );
  it.effect(
    'a compaction beyond the subtree refuses without its consent and lands with it',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      const plane = yield* planeOf(made, 'root');
      const compact = (threadId: string, asked?: readonly string[]) => plane.compact({ threadId, key: `call-${threadId}`, asked });
      expect(yield* compact('grandchild')).toEqual({
        threadId: 'grandchild',
        status: 'unchanged',
        runId: 'compaction-grandchild',
        history: { before: 5, after: 5 },
        summarizer: null,
        skipped: [],
      });
      expect(planeRefusalOf(yield* Effect.flip(compact('stranger')))?.code).toBe('not-a-descendant');
      yield* compact('stranger', ['not-a-descendant']);
      expect(planeRefusalOf(yield* Effect.flip(compact('nobody', ['not-a-descendant'])))?.code).toBe('thread-unknown');
      expect(made.compacted).toEqual(['grandchild', 'stranger']);
    }),
  );
  it.effect(
    'a rewind is stopped by the parent only when the caller is the parent',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      const plane = yield* planeOf(made, 'root');
      const rewind = (threadId: string, key: string, asked?: readonly string[]) =>
        plane.rewind({ threadId, at: 'run-7', scope: 'from', key, asked });
      yield* rewind('child', 'call-1');
      yield* rewind('grandchild', 'call-2');
      expect(planeRefusalOf(yield* Effect.flip(rewind('stranger', 'call-3')))?.code).toBe('not-a-descendant');
      yield* rewind('stranger', 'call-4', ['not-a-descendant']);
      expect(made.rewound).toEqual([
        'child from run-7 by parent under root:call-1',
        'grandchild from run-7 by agent under root:call-2',
        'stranger from run-7 by agent under root:call-4',
      ]);
    }),
  );
});
describe('spawn_agent link and history', () => {
  it.effect(
    'a root is born outside the caller’s tree from any addressable thread’s history; a running or unknown source births nothing',
    Effect.fnUntraced(function* () {
      const made = yield* world({ running: ['child'] });
      const verbs = yield* planeOf(made, 'root');
      const before = { kind: 'before', runId: 'run-9' } as const;
      const born = yield* verbs.spawn({
        requestId: 'call-root',
        agentId: 'tagma',
        task: 'lead the desk',
        root: true,
        title: '  Desk  ',
        fork: before,
        forkFrom: 'stranger',
      });
      expect(made.records.get(born.threadId)?.parentThreadId).toBeNull();
      expect(made.created[0]).toMatchObject({
        creatorThreadId: 'root',
        request: { root: true, title: 'Desk', seed: { fork: before, source: 'stranger' } },
      });
      const refused = (forkFrom: string) =>
        Effect.map(
          Effect.flip(verbs.spawn({ requestId: `call-${forkFrom}`, agentId: 'tagma', task: 'go on', fork: { kind: 'all' }, forkFrom })),
          (failure) => planeRefusalOf(failure)?.code,
        );
      expect(yield* refused('child')).toBe('thread-running');
      expect(yield* refused('nobody')).toBe('thread-unknown');
      expect(made.created).toHaveLength(1);
    }),
  );
  it.effect(
    'a blank title, a plain root and a source holding no conversation are refused before anything is born',
    Effect.fnUntraced(function* () {
      const made = yield* world();
      made.records.set('cli', { ...made.records.get('stranger')!, id: 'cli', capabilities: { ...CAPABLE, history: 'none' } });
      const verbs = yield* planeOf(made, 'root');
      const ask = { agentId: 'tagma', task: 'go on' };
      const code = (failure: unknown) => planeRefusalOf(failure)?.code;
      expect(code(yield* Effect.flip(verbs.spawn({ ...ask, requestId: 'call-blank', title: '   ' })))).toBe('title-empty');
      expect(code(yield* Effect.flip(verbs.spawn({ ...ask, requestId: 'call-plain', root: true, plain: true })))).toBe('plain-root');
      const copied = yield* Effect.flip(verbs.spawn({ ...ask, requestId: 'call-cli', fork: { kind: 'all' }, forkFrom: 'cli' }));
      expect(threadCauseOf(copied)).toMatchObject({ _tag: 'TransportCannot', threadId: 'cli', capability: 'history' });
      expect(made.created).toEqual([]);
    }),
  );
});
describe('ThreadSpawnTree delegation and depth', () => {
  it.effect(
    'delegation-off refuses a child and a root alike while a plan birth still lands',
    Effect.fnUntraced(function* () {
      const made = yield* world({ delegation: { allowed: false, setAt: 'root' } });
      const verbs = yield* planeOf(made, 'child');
      const code = (root: boolean) =>
        Effect.map(
          Effect.flip(verbs.spawn({ requestId: `call-${root}`, agentId: 'code', task: 'read it', root })),
          (failure) => planeRefusalOf(failure)?.code,
        );
      expect(yield* code(false)).toBe('delegation-off');
      expect(yield* code(true)).toBe('delegation-off');
      expect(yield* verbs.spawnLimits({ root: true })).toMatchObject([{ code: 'delegation-off' }]);
      yield* made.tree.spawn({ parent: made.records.get('child')!, requestId: 'step-1', agentId: 'code', task: 'the plan' });
      expect(made.created.map((birth) => birth.request.key)).toEqual(['step-1']);
    }),
  );
  it.effect(
    'a spawn the operator asked for passes delegation-off while depth still binds it',
    Effect.fnUntraced(function* () {
      const made = yield* world({ delegation: { allowed: false, setAt: 'root' }, floorsLeft: 0 });
      const verbs = yield* planeOf(made, 'child');
      const child = yield* Effect.flip(verbs.spawn({ requestId: 'call-child', agentId: 'code', task: 'review it', operatorAsked: true }));
      expect(planeRefusalOf(child)?.code).toBe('depth-exhausted');
      yield* verbs.spawn({ requestId: 'call-root', agentId: 'code', task: 'review it', root: true, operatorAsked: true });
      expect(made.created.map((birth) => birth.request.key)).toEqual(['call-root']);
    }),
  );
  it.effect(
    'an exhausted depth refuses a child but not a root',
    Effect.fnUntraced(function* () {
      const made = yield* world({ floorsLeft: 0 });
      const verbs = yield* planeOf(made, 'child');
      const child = yield* Effect.flip(verbs.spawn({ requestId: 'call-child', agentId: 'code', task: 'read it' }));
      expect(planeRefusalOf(child)?.code).toBe('depth-exhausted');
      yield* verbs.spawn({ requestId: 'call-root', agentId: 'code', task: 'read it', root: true });
      expect(made.created.map((birth) => birth.request.key)).toEqual(['call-root']);
    }),
  );
  it.effect(
    'a provisioned request survives delegation-off and a fresh one refuses',
    Effect.fnUntraced(function* () {
      const made = yield* world({ delegation: { allowed: false, setAt: null }, born: ['call-1'] });
      const { started, created } = made;
      const verbs = yield* planeOf(made, 'child');
      const taken = yield* verbs.spawn({ requestId: 'call-1', agentId: 'code', task: 'read it' });
      expect(planeRefusalOf(yield* Effect.flip(verbs.spawn({ requestId: 'call-2', agentId: 'code', task: 'more' })))?.code).toBe(
        'delegation-off',
      );
      expect(taken.threadId).toBe('member-call-1');
      expect(started).toEqual(['member-call-1:envelope:spawn:child:call-1']);
      expect(created).toEqual([]);
    }),
  );
});
