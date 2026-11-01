import { unthreadedCaller } from '../callers';
import { fixtureMigrations } from '../migrations.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Exit, Layer, Schema, Stream } from 'effect';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { eq } from 'drizzle-orm';
import { Tool, ToolAnswer, toolExecute } from '@runlith/agent/tool';
import type { ToolCatalog } from '@runlith/agent/catalog';
import { GraphStore, MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { seededMachineLayer } from '../../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { workspaceChange } from '../../../change-record/testing/doubles.js';
import { retirementProof } from '../../../change-record/store/retirement.js';
import { block, blockField, blockTag } from '../../../graph/store/tables.js';
import { project } from '../../../projects/testing/doubles.js';
import { session } from '../../../platform/store/writers.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { bornRecord, recordsOver, scopeRecord } from '../../../thread-record/testing/records.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { asThreadToolAnswer } from '../../../threads/testing/doubles.js';
import {
  asCacheWarmth,
  asEvidenceQueries,
  asThreadEvidence,
  cacheWarmthTag,
  evidenceQueriesTag,
  threadEvidenceTag,
  threadRolloutsTag,
  asThreadRollouts,
} from '../../../threads/testing/doubles.js';
import { tagsOfCatalogs } from '../../../catalogs/contract/wire/registry.js';
import { routedStubs, tagIndex } from '../../../graph/testing/doubles.js';

import type { ProjectRow } from '../../../projects/contract/wire/project.js';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { ThreadList } from '../../../threads/contract/service/list.js';
import { fixtureNativeCatalog as nativeCatalog } from '../nativeCatalog.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { NO_RULES } from '../../../enforcement/testing/doubles.js';
import { changeRecordOf, intakeOf, reporterOf } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths, gitCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { liveGitLayer } from '../liveGit.js';
import { Git } from '@runlith/git/Git';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { CommandChanges, type CommandUnattributed } from '../../../change-record/contract/service/commands.js';
import { ChangesAnswer } from '../../../change-record/contract/wire/changes.js';
import { ThreadChanges, type WholeChanges } from '../../../change-record/contract/service/threadChanges.js';
import type { Holding, HoldingsView } from '../../../change-record/contract/wire/holdings.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { heldTasks } from '../../../graph/testing/doubles.js';
import { GraphScopes, ServedTree, TaskHolders } from '../../../graph/contract/service/serving.js';
import { idleCommands, quietCommands } from '../../../change-record/testing/doubles.js';
import { BEHAVIOUR_REGISTRY } from '../composed.js';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { ProtocolStates } from '../../../external-harnesses/contract/service/protocol.js';
import type { ProtocolState } from '../../../external-harnesses/contract/wire/protocolState.js';

const walks = makeWalks();

const ROOT = '/work/repo';
const PATHS = fixedCheckoutPaths(1, [{ checkout: 'repo', root: ROOT }]);

const scratch = { path: `${ROOT}/.scratch`, resolve: (candidate: string) => `${ROOT}/.scratch/${candidate}` };

const signedBy = { harness: 'tagma', key: 'thread-one' };

const registryOf = (named?: Projects['Service']['named']): Projects['Service'] =>
  ({
    byId: () => Effect.succeed({ id: 1, name: 'runlith' } as ProjectRow),
    named,
  }) as unknown as Projects['Service'];

const shippedTable = tagIndex(tagsOfCatalogs(['tagma', 'software-development']), BEHAVIOUR_REGISTRY);

const vocabulary: Tags['Service'] = {
  of: () => Effect.succeed(shippedTable),
  reader: () => Effect.succeed(() => shippedTable),
  forget: () => Effect.void,
  publish: () => Effect.void,
};

type SessionOwners =
  | MachineStore
  | Tags
  | Projects
  | GraphStore
  | ReturnType<typeof asThreadEvidence>
  | ReturnType<typeof asEvidenceQueries>
  | ReturnType<typeof asCacheWarmth>
  | ReturnType<typeof asThreadRollouts>
  | ThreadRecords
  | ProtocolStates;

type SessionCatalogOptions = {
  readonly store: MachineStore['Service'];
  readonly graph: GraphStore['Service'];
  readonly queries?: ReturnType<typeof asEvidenceQueries>['Service'];
  readonly rollouts?: ReturnType<typeof asThreadRollouts>['Service'];
  readonly projects?: Projects['Service'];
  readonly commands?: CommandChanges['Service'];
  readonly changeRecord?: ChangeRecord['Service'];
  readonly protocol?: ProtocolState;
  readonly paths: CheckoutPaths['Service'];
  readonly slice?: WholeChanges;
};

const held = (path: string): Holding => ({
  path,
  from: null,
  git: 'modified',
  verdict: {
    verdict: 'proven',
    hands: [{ holder: { kind: 'thread', thread: 'thread-one' }, added: 1, removed: 1, writing: false, retired: false }],
    nobody: [],
  },
  lines: { added: 1, removed: 1 },
});

const VIEW: HoldingsView = {
  checkout: 'repo',
  revision: 2,
  head: null,
  row: null,
  state: { kind: 'current' },
  paths: [
    held('src/a.ts'),
    {
      path: 'src/b.ts',
      from: null,
      git: 'untracked',
      verdict: { verdict: 'unknown', reason: { kind: 'budget' }, writers: [{ kind: 'thread', thread: 'thread-two' }] },
      lines: 'unweighed',
    },
    held('lib/c.ts'),
  ],
  totals: { paths: 3, held: 2, operator: 0, nobody: 0, unproven: 1 },
};

const judged = { settled: () => Effect.void, read: () => Effect.succeed(VIEW) };

const SLICE: WholeChanges = {
  outcomes: { commits: [], unread: [] },
  kind: 'whole',
  threadId: 'thread-one',
  held: { paths: 1, unproven: 0 },
  uncommitted: { added: 1, removed: 1 },
  checkouts: [
    {
      checkout: RootId.make('repo'),
      projectId: 1,
      root: ROOT,
      branch: 'main',
      revision: 2,
      state: { kind: 'current' },
      uncommitted: { added: 1, removed: 1 },
      entries: [
        {
          section: 'uncommitted',
          path: 'src/a.ts',
          from: null,
          git: 'modified',
          lines: { added: 1, removed: 1 },
          writing: false,
          others: [],
          nobody: false,
        },
      ],
    },
  ],
  commits: [],
  moreCommits: false,
  ends: [],
};

const sessionCatalog = Effect.fnUntraced(function* (options: SessionCatalogOptions) {
  const projects = options.projects ?? registryOf();
  const graphContext = Context.empty().pipe(
    Context.add(GraphStore, options.graph),
    Context.add(Tags, vocabulary),
    Context.add(Projects, projects),
  );
  const noPlaces: GraphScopes['Service'] = {
    scopeByPlace: () => Effect.succeed(undefined),
    zoneByPlace: () => Effect.succeed(undefined),
    placeOf: (_projectId, spelling) => Effect.succeed({ place: spelling, symbol: undefined }),
    scope: () => Effect.die(new Error('this world resolves no scope')),
    lens: () => Effect.succeed({}),
  };
  const commands = options.commands ?? quietCommands;
  const changeRecord = options.changeRecord ?? ({} as ChangeRecord['Service']);
  const owners = Context.merge(
    graphContext,
    Context.empty().pipe(
      Context.add(GraphScopes, noPlaces),
      Context.add(ChangeRecord, changeRecord),
      Context.add(CheckoutPaths, options.paths),
      Context.add(Holdings, judged as unknown as Holdings['Service']),
      Context.add(CommandChanges, commands),
      Context.add(ThreadChanges, { read: () => Effect.succeed(options.slice ?? SLICE), subscribe: () => Stream.empty }),
      Context.add(ThreadList, { row: () => Effect.succeed(undefined) } as unknown as ThreadList['Service']),
      Context.add(MachineStore, options.store),
      Context.add(ThreadRecords, yield* recordsOver(options.store, yield* MachineUnits)),
      Context.add(threadEvidenceTag(), {} as ReturnType<typeof asThreadEvidence>['Service']),
      Context.add(evidenceQueriesTag(), options.queries ?? ({} as ReturnType<typeof asEvidenceQueries>['Service'])),
      Context.add(cacheWarmthTag(), {} as ReturnType<typeof asCacheWarmth>['Service']),
      Context.add(threadRolloutsTag(), options.rollouts ?? ({} as ReturnType<typeof asThreadRollouts>['Service'])),
      Context.add(
        ProtocolStates,
        ProtocolStates.of({
          read: () =>
            options.protocol === undefined ? Effect.die('This fixture has no protocol state.') : Effect.succeed(options.protocol),
        }),
      ),
    ),
  );
  const caller: Caller = {
    actor: {
      kind: 'thread',
      threadId: 'thread-one',
      projectId: 1,
      principalId: 'owner-1',
      session: signedBy,
    },
    files: scratch,
  };
  return yield* nativeCatalog(
    {
      place: { root: ROOT, origin: null },
      caller,
      project: { id: 1, name: 'runlith' },
      vocabulary: () => shippedTable,
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: ROOT,
      served: {
        context: routedStubs().pipe(
          Context.add(TaskHolders, { forHolders: (threadIds) => heldTasks(shippedTable, options.graph, 1, threadIds) }),
          Context.add(ServedTree, {} as never),
          Context.add(Tags, vocabulary),
        ),
      } as never,
      owners: Context.add(owners as Context.Context<GraphServices | SessionOwners>, RuleChecks, NO_RULES).pipe(
        Context.add(OperationChecks, operationChecks(NO_RULES)),
      ),
    },
    ['read_changes', 'read_thread_rollout', 'read_thread_record', 'read_harness_protocol'],
  );
});

const catalog = Effect.fnUntraced(function* (store: MachineStore['Service'], graph: GraphStore['Service'], units: MachineUnits['Service']) {
  const paths = yield* PATHS;
  const commands = yield* idleCommands();
  const changeRecord = yield* changeRecordOf(store, units, paths, yield* intakeOf(store, units, yield* Git, paths), commands, walks);
  return yield* sessionCatalog({ store, graph, paths, commands, changeRecord });
});

const stubDown: unknown = (() => {
  const down: Effect.Effect<never, EffectDrizzleQueryError> = Effect.fail(
    new EffectDrizzleQueryError({ query: 'select', params: [], cause: new Error('the store is down') }),
  );
  return new Proxy(down, {
    get: (target, property, receiver) => {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => stubDown;
    },
  });
})();

const settle = Effect.fnUntraced(function* (
  store: MachineStore['Service'],
  input: {
    readonly path?: string;
    readonly agent?: string;
    readonly observed?: boolean;
    readonly limit?: number;
    readonly cursor?: string;
  },
) {
  const tool = (yield* catalog(store, yield* GraphStore, yield* MachineUnits)).read_changes;
  expect(tool).toBeDefined();
  const execute = toolExecute(tool as Tool);
  expect(execute).not.toBeNull();
  const answered = yield* (execute as Tool.ToolDispatch)(input, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] });
  expect(answered).toBeInstanceOf(ToolAnswer);
  const answer = answered as ToolAnswer;
  return {
    value: answer.value as
      | (ChangesAnswer & { readonly status: 'ok' })
      | { readonly status: 'refused'; readonly code: string; readonly reason: string },
    display: answer.display,
    model: answer.text,
  };
});

const machineLayers = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededMachineLayer(fixtureMigrations, {}, sharedPool))),
);

const seeded = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* store.db.insert(project()).values({ id: 1, name: 'runlith', repoKey: ROOT, rootPath: ROOT, createdAt: new Date(0) });
  yield* store.db.insert(session).values([
    { id: 1, harness: 'tagma', key: 'thread-one', createdAt: new Date(0) },
    { id: 2, harness: 'tagma', key: 'thread-two', createdAt: new Date(0) },
  ]);
  const agent = {
    ownerId: 'owner-1',
    agentId: 'tagma',
    provider: 'openai-oauth' as const,
    model: 'gpt-test',
    reasoning: 'high' as const,
    authority: { mode: 'trust' as const, bypassFrom: null },
    rights: { interrupt: true },
    status: 'idle' as const,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  yield* bornThread(store.db, { ...agent, id: 'thread-one', spawnRootId: 'thread-one', cacheGroup: 'thread-one', name: 'reader' });
  yield* bornThread(store.db, {
    ...agent,
    id: 'thread-two',
    spawnRootId: 'thread-one',
    cacheGroup: 'thread-one',
    parentThreadId: 'thread-one',
    name: 'builder',
  });
  yield* scopeRecord(store.db, 'thread-one', { projectId: 1, title: 'Reader', readerOrderAt: new Date(0) });
  yield* scopeRecord(store.db, 'thread-two', { projectId: 1, title: 'Builder', readerOrderAt: new Date(0) });
  yield* store.db.insert(block).values({
    id: 2,
    projectId: 1,
    uuid: '00000000-0000-0000-0000-000000000002',
    parentId: null,
    ord: 0,
    tags: ['task'],
    title: 'Build the change',
    body: '',
    fields: { status: 'in_work', holder: 2 },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  yield* store.db.insert(blockTag).values({ blockId: 2, tag: 'task' });
  yield* store.db.insert(blockField).values([
    { blockId: 2, tag: 'task', name: 'status', value: 'in_work' },
    { blockId: 2, tag: 'task', name: 'holder', value: '2' },
  ]);
  const paths = yield* PATHS;
  const mine = reporterOf(yield* intakeOf(store, units, yield* Git, paths), 1, 'thread-one');
  const neighbour = reporterOf(yield* intakeOf(store, units, yield* Git, paths), 1, 'thread-two');
  yield* mine.record({
    origin: 'edit',
    path: `${ROOT}/src/a.ts`,
    at: new Date(1_000),
    hunk: { firstLine: 12, oldLines: 3, newLines: 3, windowBefore: 0, oldText: 'was\n', newText: 'is\n' },
  });
  yield* neighbour.record({
    origin: 'write',
    path: `${ROOT}/src/a.ts`,
    at: new Date(3_000),
    hunk: { firstLine: 40, oldLines: 1, newLines: 1, windowBefore: 0, oldText: 'their old\n', newText: 'their new\n' },
  });
  return store;
});

layer(Layer.effectDiscard(seeded).pipe(Layer.provideMerge(machineLayers), Layer.provideMerge(liveGitLayer)), { excludeTestServices: true })(
  'session tools',
  (it) => {
    it.effect('a stale checkout with a pending proof preserves the readable checkout and leaves its unverified turn held', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        const paths = yield* PATHS;
        const id = 'pending-in-stale-root';
        const checkout = RootId.make('stale-root');
        yield* store.db.insert(workspaceChange()).values({
          id,
          projectId: 1,
          holderProjectId: 1,
          holder: 'thread-one',
          checkout,
          path: 'pending.ts',
          state: 'held',
          origin: 'write',
          afterHash: 'pending-after',
          at: new Date(4_000),
        });
        yield* Effect.addFinalizer(() => Effect.orDie(store.db.delete(workspaceChange()).where(eq(workspaceChange().id, id))));
        yield* store.db
          .insert(retirementProof)
          .values({ row: id, checkout, path: 'pending.ts', commit: 'a'.repeat(40), after: 'pending-after', reason: 'committed' });
        const reason = 'the checkout is temporarily unavailable';
        const slice: WholeChanges = {
          ...SLICE,
          outcomes: { commits: [], unread: [{ checkout, reason }] },
          checkouts: [
            ...SLICE.checkouts,
            { ...SLICE.checkouts[0]!, checkout, root: '/missing', state: { kind: 'stale', reason }, entries: [] },
          ],
        };
        const changeRecord = yield* changeRecordOf(store, units, paths, yield* intakeOf(store, units, yield* Git, paths));
        const tools = yield* sessionCatalog({ store, graph: yield* GraphStore, paths, changeRecord, slice });
        const execute = toolExecute(tools.read_changes!);
        if (execute === null) return yield* Effect.die('The native change tool has no dispatch.');
        const answer = yield* execute({ limit: 10 }, { toolCallId: 'stale-proof', caller: unthreadedCaller, messages: [] });
        if (!(answer instanceof ToolAnswer)) return yield* Effect.die('The native change tool returned no answer.');
        expect(answer.value).toMatchObject({
          status: 'ok',
          checkouts: expect.arrayContaining([
            expect.objectContaining({ checkout: 'repo', state: { kind: 'current' } }),
            expect.objectContaining({ checkout, state: { kind: 'stale', reason } }),
          ]),
          turns: expect.arrayContaining([expect.objectContaining({ checkout, path: 'pending.ts', state: 'held', commit: null })]),
        });
      }),
    );
    it.effect('a native protocol read delivers the runner diagnostics and active turns to the agent', () =>
      Effect.gen(function* () {
        const protocol: ProtocolState = {
          threadId: 'thread-two',
          session: { state: 'running', owner: 'this server', startedAt: '2026-10-21T14:00:00.000Z' },
          driven: true,
          driverFailure: null,
          execution: { execution: 'runner-execution', incarnation: 1, held: true },
          phase: 'ready',
          stdout: { parsed: '123', written: '456', unread: null, torn: false },
          requests: [
            {
              id: 'request-prompt',
              method: 'session/prompt',
              turn: 'protocol-run',
              admitted: true,
              uncertain: false,
              sentAt: '2026-10-21T14:01:00.000Z',
              ageMs: 1_000,
            },
          ],
          asks: [],
          turns: [{ runId: 'protocol-run', startedAt: '2026-10-21T14:01:00.000Z' }],
          failure: null,
        };
        const tools = yield* sessionCatalog({
          store: yield* MachineStore,
          graph: yield* GraphStore,
          paths: yield* PATHS,
          protocol,
        });
        const execute = toolExecute(tools.read_harness_protocol!);
        if (execute === null) return yield* Effect.die('The native protocol tool has no dispatch.');
        const answered = yield* execute(
          { threadId: protocol.threadId },
          {
            toolCallId: 'call-protocol',
            caller: unthreadedCaller,
            messages: [],
          },
        );
        expect(answered).toBeInstanceOf(ToolAnswer);
        const answer = answered as ToolAnswer;
        expect(answer.value).toEqual({ status: 'ok', ...protocol });
        expect(answer.text).toContain('runner-execution');
        expect(answer.text).toContain('request-prompt');
        expect(answer.text).toContain('protocol-run');
        expect(answer.text).toContain('123');
        expect(answer.text).toContain('456');
      }),
    );

    it.effect('an agent read answers its Holdings slice beside the paths each of its turns wrote and what stands of them', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        yield* store.db
          .update(workspaceChange())
          .set({ state: 'committed', committedAt: new Date(9_000), commit: 'abc1234' })
          .where(eq(workspaceChange().holder, 'thread-two'));

        const own = yield* settle(store, {});
        expect(own.value).toMatchObject({
          status: 'ok',
          path: null,
          self: 'thread-one',
          held: SLICE.held,
          checkouts: SLICE.checkouts,
          turns: [{ runId: null, checkout: 'repo', path: 'src/a.ts', state: 'held', commit: null }],
          total: 2,
        });
        expect(own.display).toMatchObject({ form: 'none', facts: [{ label: 'held', value: '1' }] });

        const named = yield* settle(store, { agent: 'builder' });
        expect(named.value).toMatchObject({
          status: 'ok',
          agent: 'builder',
          subject: 'thread-two',
          turns: [{ path: 'src/a.ts', state: 'committed', commit: 'abc1234' }],
        });
      }),
    );

    it.effect('a path read answers the judgement of every path under it, page by page', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const first = yield* settle(store, { path: 'src', limit: 1 });
        expect(first.value).toMatchObject({
          status: 'ok',
          path: 'src',
          holdings: [{ checkout: 'repo', holding: { path: 'src/a.ts' }, debts: [] }],
          total: 2,
        });
        const next = 'next' in first.value ? first.value.next : null;
        expect(next).not.toBeNull();

        const rest = yield* settle(store, { cursor: next! });
        expect(rest.value).toMatchObject({ status: 'ok', path: 'src', holdings: [{ holding: { path: 'src/b.ts' } }], next: null });

        const one = yield* settle(store, { path: 'src/b.ts' });
        expect(one.value).toMatchObject({ holdings: [{ holding: { path: 'src/b.ts', verdict: { verdict: 'unknown' } } }], total: 1 });
      }),
    );

    it.effect('read_changes shares its page with unattributed observations and continues every selected row', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        const paths = yield* PATHS;
        const observation: CommandUnattributed = {
          projectId: 1,
          threadId: 'thread-one',
          checkout: 'repo',
          path: 'src/b.ts',
          reason: 'overlap',
          team: null,
          digest: null,
          commandLine: null,
          at: 4_000,
        };
        const sessionRows = [observation, { ...observation, checkout: 'other' }];
        const pathRows = [observation, { ...observation, threadId: 'thread-two' }];
        const checkout = SLICE.checkouts[0]!;
        const entry = checkout.entries[0]!;
        const slice: WholeChanges = {
          ...SLICE,
          checkouts: [
            { ...checkout, entries: [entry, { ...entry, path: 'src/other.ts' }, { ...entry, path: 'src/last.ts' }] },
            { ...checkout, checkout: RootId.make('empty'), root: '/empty-checkout', entries: [], state: { kind: 'opening', paths: 1 } },
          ],
        };
        const commands: CommandChanges['Service'] = {
          ...quietCommands,
          unattributed: () => sessionRows,
          unattributedUnder: () => pathRows,
        };
        const changes = yield* changeRecordOf(store, units, paths, yield* intakeOf(store, units, yield* Git, paths), undefined, walks);
        const tools = yield* sessionCatalog({
          store,
          graph: yield* GraphStore,
          paths,
          commands,
          changeRecord: { ...changes, unattributed: commands.unattributed },
          slice,
        });
        const execute = toolExecute(tools.read_changes as Tool);
        if (execute === null) return yield* Effect.die('read_changes has no dispatch');
        const read = Effect.fnUntraced(function* (input: { readonly path?: string; readonly cursor?: string; readonly limit: number }) {
          const answer = yield* execute(input, { toolCallId: 'paging', caller: unthreadedCaller, messages: [] });
          if (!(answer instanceof ToolAnswer)) return yield* Effect.die('read_changes returned no tool answer');
          return { ...(yield* Schema.decodeUnknownEffect(ChangesAnswer)(answer.value)), text: answer.text };
        });
        for (const selection of [{}, { path: 'src/b.ts' }]) {
          const first = yield* read({ ...selection, limit: 2 });
          expect(
            first.checkouts.reduce((sum, side) => sum + Math.max(1, side.entries.length), 0) +
              first.turns.length +
              first.holdings.length +
              first.unattributed.length,
          ).toBeLessThanOrEqual(2);
          const pages = [first];
          let cursor = first.next;
          let observedCursor: string | null = null;
          while (cursor !== null) {
            const previous = pages[pages.length - 1]!;
            expect(previous.text).toContain(cursor);
            if (previous.unattributed.length > 0) observedCursor = cursor;
            const next = yield* read({ cursor, limit: 2 });
            pages.push(next);
            cursor = next.next;
          }
          for (const one of pages) {
            const shown =
              one.checkouts.reduce((sum, side) => sum + Math.max(1, side.entries.length), 0) +
              one.turns.length +
              one.holdings.length +
              one.unattributed.length;
            expect(shown).toBeGreaterThan(0);
            expect(shown).toBeLessThanOrEqual(2);
            expect(one.total).toBe('path' in selection ? 3 : 7);
            expect(one.totals).toEqual({
              checkouts: 'path' in selection ? 0 : 4,
              turns: 'path' in selection ? 0 : 1,
              holdings: 'path' in selection ? 1 : 0,
              unattributed: 2,
            });
            expect(one.text).toContain(`showing ${shown} of ${one.total}`);
          }
          const expected = 'path' in selection ? pathRows : sessionRows;
          const identity = (row: ChangesAnswer['unattributed'][number]) => [row.checkout, row.path, row.thread, row.reason];
          expect(
            pages
              .flatMap((one) => one.unattributed)
              .map(identity)
              .sort(),
          ).toEqual(expected.map((row) => [row.checkout, row.path, row.threadId, row.reason]).sort());
          if ('path' in selection) {
            expect(pages.flatMap((one) => one.holdings).map((row) => row.holding.verdict)).toEqual([VIEW.paths[1]!.verdict]);
          } else {
            expect(first.held).toEqual(SLICE.held);
            expect(pages.flatMap((one) => one.checkouts.flatMap((side) => side.entries.map((row) => row.path))).sort()).toEqual(
              ['src/a.ts', 'src/other.ts', 'src/last.ts'].sort(),
            );
            expect(pages.flatMap((one) => one.checkouts).filter((side) => side.entries.length === 0)).toEqual([slice.checkouts[1]!]);
            expect(pages.flatMap((one) => one.turns.map((turn) => [turn.path, turn.state]))).toEqual([['src/a.ts', 'held']]);
            expect(first.text).not.toContain('/empty-checkout');
          }
          if (observedCursor === null) return yield* Effect.die('read_changes lost the observation continuation');
          expected.splice(0, 1);
          const stale = yield* execute(
            { cursor: observedCursor, limit: 2 },
            { toolCallId: 'stale-page', caller: unthreadedCaller, messages: [] },
          );
          if (!(stale instanceof ToolAnswer)) return yield* Effect.die('read_changes returned no tool answer');
          expect(stale.value).toMatchObject({ status: 'refused', code: 'cursor-stale' });
        }
      }),
    );

    it.effect('an unknown address refuses, and naming both a path and an agent refuses the shape', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;

        const unknown = yield* settle(store, { agent: 'nobody' });
        expect(unknown.value).toMatchObject({ status: 'refused', code: 'unknown-address' });
        expect('reason' in unknown.value && unknown.value.reason).toContain('nobody');

        const both = yield* settle(store, { agent: 'builder', path: 'src/a.ts' });
        expect(both.value).toMatchObject({ status: 'refused', code: 'selection-shape' });
      }),
    );

    it.effect('the rollout read is a session tool, and both projections render its two sides', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const disagreement = {
          threadId: 'thread-one',
          path: '/home/threads/1/thread-one.jsonl',
          fileForm: 'plain' as const,
          refusal: {
            reason: 'out-of-order' as const,
            message: 'the rollout carries position 2 where 3 was expected',
            nextByteOffset: 240,
            nextPosition: 3,
            seenAt: '2026-09-02T04:00:00.000Z',
          },
          file: [{ byteOffset: 240, position: 2, id: 'b-again', kind: 'message' }],
          bounded: false,
          rows: [{ position: 2, id: 'b', kind: 'message' }],
        };
        const tools = yield* sessionCatalog({
          store,
          graph: yield* GraphStore,
          paths: yield* PATHS,
          rollouts: { report: () => Effect.succeed(disagreement) } as unknown as ReturnType<typeof threadRolloutsTag>['Service'],
        });
        const tool = tools.read_thread_rollout as Tool;
        const answered = yield* (toolExecute(tool) as Tool.ToolDispatch)(
          { threadId: 'thread-one' },
          { toolCallId: 'call-2', caller: unthreadedCaller, messages: [] },
        );
        const answer = (answered as ToolAnswer).value as ReturnType<typeof asThreadToolAnswer>;

        expect(answer).toMatchObject({ status: 'ok', rollout: { refusal: { reason: 'out-of-order' } } });
        expect((answered as ToolAnswer).text).toContain('out-of-order');
        expect((answered as ToolAnswer).display).toMatchObject({
          title: 'thread-one',
          facts: [
            { label: 'refused', value: 'out-of-order' },
            { label: 'at position', value: '3' },
            { label: 'records read', value: '1' },
          ],
        });
      }),
    );

    it.effect('a thread read resolves its named project and refuses one contradicting its subject', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        yield* store.db.insert(project()).values({ id: 7, name: 'away', repoKey: '/away', rootPath: '/away', createdAt: new Date(0) });
        yield* bornRecord(store.db, {
          id: 'thread-away',
          projectId: 7,
          spawnRootId: 'thread-away',
          principalId: 'owner-1',
          agentId: 'tagma',
        });
        const handed: number[] = [];
        const registry = {
          named: (ref: string) =>
            ref === 'away'
              ? Effect.succeed({ id: 7, name: 'away' } as ProjectRow)
              : Effect.fail(
                  new GateRefusal('unknown-project', `no unique project named "${ref}"`, ['the registry names what is registered']),
                ),
        } as unknown as Projects['Service'];
        const tools = yield* sessionCatalog({
          store: yield* MachineStore,
          graph: stubDown as GraphStore['Service'],
          projects: {
            ...registryOf(registry.named),
            byId: (id) => Effect.succeed({ id, name: id === 7 ? 'away' : 'runlith' } as ProjectRow),
          },
          paths: gitCheckoutPaths('repo'),
          rollouts: {
            report: (_thread: string, projectId: number) => {
              handed.push(projectId);
              return Effect.succeed({ refusal: null, file: [], bounded: false, rows: [] });
            },
          } as unknown as ReturnType<typeof threadRolloutsTag>['Service'],
        });
        const read = (input: { readonly threadId: string; readonly project?: string }) =>
          Effect.map(
            (toolExecute(tools.read_thread_rollout as Tool) as Tool.ToolDispatch)(input, {
              toolCallId: 'call-3',
              caller: unthreadedCaller,
              messages: [],
            }),
            (answered) => (answered as ToolAnswer).value as ReturnType<typeof asThreadToolAnswer>,
          );

        const own = yield* read({ threadId: 'thread-one' });
        const away = yield* read({ threadId: 'thread-away', project: 'away' });
        const unknown = yield* read({ threadId: 'thread-one', project: 'nowhere' });
        const mismatch = yield* read({ threadId: 'thread-one', project: 'away' });

        expect(own).toMatchObject({ status: 'ok' });
        expect(away).toMatchObject({ status: 'ok' });
        expect(handed).toEqual([1, 7]);
        expect(unknown).toMatchObject({ status: 'refused', code: 'unknown-project' });
        expect(mismatch).toMatchObject({ status: 'refused', code: 'place-mismatch' });
      }),
    );

    it.effect('a failing record fails read_changes instead of answering an empty page', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const down = {
          ...store,
          db: new Proxy(store.db, {
            get: () => () => stubDown,
          }),
        } as MachineStore['Service'];
        const tool = (yield* catalog(down, yield* GraphStore, yield* MachineUnits)).read_changes as Tool;
        const execute = toolExecute(tool) as Tool.ToolDispatch;
        const exit = yield* Effect.exit(execute({}, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] }));
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it.effect('a failing address lookup fails read_changes instead of refusing unknown-address', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const down = {
          ...store,
          db: new Proxy(store.db, {
            get: () => () => stubDown,
          }),
        } as MachineStore['Service'];
        const tool = (yield* catalog(down, yield* GraphStore, yield* MachineUnits)).read_changes as Tool;
        const execute = toolExecute(tool) as Tool.ToolDispatch;
        const exit = yield* Effect.exit(execute({ agent: 'builder' }, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] }));
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it.effect('an empty answer is an arm of the union, not a sentence', () =>
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const empty = yield* settle(store, { path: 'src/untouched.ts' });

        expect(empty.value).toMatchObject({ status: 'ok', path: 'src/untouched.ts' });
        expect(empty.value).toMatchObject({ holdings: [], total: 0, next: null });
        expect(empty.display).toMatchObject({ facts: [{ label: 'paths', value: '0' }] });
      }),
    );

    it.effect('an expansion address stands in the call’s thread, and one with nowhere to stand refuses', () =>
      Effect.gen(function* () {
        const handed: Array<{ readonly threadId: string; readonly at: number | string }> = [];
        const tools = yield* sessionCatalog({
          store: yield* MachineStore,
          graph: stubDown as GraphStore['Service'],
          paths: gitCheckoutPaths('repo'),
          queries: {
            expand: (_project: number, asked: { readonly addresses: ReadonlyArray<{ threadId: string; at: number | string }> }) => {
              handed.push(...asked.addresses);
              return Effect.succeed([]);
            },
          } as unknown as ReturnType<typeof evidenceQueriesTag>['Service'],
        });
        const expand = (input: Record<string, unknown>) =>
          Effect.map(
            (toolExecute(tools.read_thread_record as Tool) as Tool.ToolDispatch)(input, {
              toolCallId: 'call-4',
              caller: unthreadedCaller,
              messages: [],
            }),
            (answered) => (answered as ToolAnswer).value as ReturnType<typeof asThreadToolAnswer>,
          );

        const standing = yield* expand({ threadId: 'thread-two', at: [{ at: 3517 }, { threadId: 'thread-one', at: 'record-id' }] });

        expect(standing).toMatchObject({ status: 'ok' });
        expect(handed).toEqual([
          { threadId: 'thread-two', at: 3517 },
          { threadId: 'thread-one', at: 'record-id' },
        ]);
        const homeless = yield* expand({ at: [{ at: 3517 }] });
        expect(homeless).toMatchObject({ status: 'refused', code: 'selection-shape' });
        expect('reason' in homeless && homeless.reason).toContain('3517');
      }),
    );
  },
);
