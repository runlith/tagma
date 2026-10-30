import { isAbsolute, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Cause, Clock, Context, Effect, Exit, FileSystem, Layer, Schema, Scope } from 'effect';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { HostManagement, type HostPlacement } from '../../../executions/contract/service/host.js';
import { ASK_CALL, heldOrAsking } from './parityModel.js';
import { LEASE_RHYTHM } from '../../../threads/contract/wire/rhythm.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { HarnessPermissions } from '../../../external-harnesses/contract/service/permissions.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { claudeLogin, hostedDefaults, nativeLeads } from '../claudeLogin.js';
import { CLAUDE_CODE_PROVIDER } from '@runlith/adapter-anthropic/models/anthropic';
import { hostedChild } from './hostedChild.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { HARNESSES } from '../../../external-harnesses/contract/service/table.js';
import { TESTING_ADAPTERS } from '../adapters.js';
import { makeDoorWorld, WORLD_SOURCE, type DoorFixture } from '../doorFixture.js';
import { makeRuntime } from '../../runtime.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { EXECUTION_HOST_ROOT, SERVER_SRC } from '../repoRoot.js';
import { hostBundleRoot } from '../hostBundle.js';
import { gitEffect } from '../graphFixture.js';
import { until, whoSpeaks } from './terminalDeliveryRig.js';
import { terminalRig, type Cli } from './terminalRig.js';

export const LIBRARY = join(EXECUTION_HOST_ROOT, 'native', 'target', 'release', 'libexecution_platform.dylib');
const AGENT = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');
export type SeatName = 'native' | 'claude' | 'devin' | 'terminal';
export type Seat = {
  readonly name: SeatName;
  readonly opening: string;
  readonly asking: { readonly opening: string; raise(threadId: string): Effect.Effect<void, unknown, Scope.Scope> } | null;
  readonly endsOnAnswer: boolean;
  answers(questionId: string): readonly { readonly questionId: string; readonly values: readonly string[] }[];
  born(lead: string | null, task?: string): Effect.Effect<string, unknown, Scope.Scope>;
  held(threadId: string): Effect.Effect<void, unknown>;
  die(threadId: string): Effect.Effect<void, unknown>;
};
export type ParityWorld = {
  readonly world: DoorFixture['Service'];
  readonly projectId: number;
  readonly seats: Readonly<Record<SeatName, Seat>>;
  lead(mode?: 'review' | 'trust'): Effect.Effect<string, unknown>;
  handover(graceful?: boolean): Effect.Effect<void, unknown>;
  quiet(): Effect.Effect<void, unknown>;
  born(): readonly string[];
  release(threadId: string): Effect.Effect<void, unknown>;
  received(threadId: string): Effect.Effect<readonly string[], unknown>;
  configured(threadId: string): Effect.Effect<readonly Configured[], unknown>;
  holdOpening(held: boolean): Effect.Effect<void, unknown>;
};
export type Configured = { readonly configId: string; readonly value: string };
const decodeFrame = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.optional(Schema.String),
      params: Schema.optional(Schema.Struct({ configId: Schema.optional(Schema.String), value: Schema.optional(Schema.Unknown) })),
    }),
  ),
);

export const parityWorld = Effect.fn('testing.parityWorld')(function* (
  own: string | undefined,
): Effect.fn.Return<ParityWorld, unknown, FileSystem.FileSystem | Scope.Scope> {
  const files = yield* FileSystem.FileSystem;
  const stage = yield* files.makeTempDirectoryScoped({ prefix: 'parity-' });
  const bin = join(stage, 'bin');
  yield* files.makeDirectory(bin);
  for (const binary of [WORLD_COMMAND, ...HARNESSES.map(({ binary }) => binary).filter((binary) => !isAbsolute(binary))])
    yield* files.writeFileString(join(bin, binary), '#!/bin/sh\nprintf "fixture\\n"\n', { mode: 0o755 });
  const path = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${bin}:${path ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (path === undefined) delete process.env.PATH;
        else process.env.PATH = path;
      }),
  );
  const world = yield* makeDoorWorld({
    models: heldOrAsking,
    own,
  });
  const original = world.runtime;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      world.runtime = original;
    }),
  );
  const generations = yield* Scope.fork(yield* Effect.scope);
  const account = yield* claudeLogin(world);
  const checkout = yield* world.directory('parity-project');
  yield* gitEffect(checkout, ['init', '-q', '-b', 'main']);
  const projectId = yield* world.stealthProject(checkout);
  yield* files.writeFileString(join(checkout, 'fixture.ts'), 'export const fixture = true;\n');
  yield* gitEffect(checkout, ['add', '--', 'fixture.ts']);
  yield* gitEffect(checkout, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Fixture']);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const folder = yield* world.directory('parity-terminal');
  let rig = yield* terminalRig(world, projectId, folder);
  const births = () => birthsOf(world.runtime.owners);
  const born: string[] = [];
  const clis = new Map<string, Cli>();
  const pids = new Map<string, string>();
  const reports = new Map<string, string>();
  let named = 0;
  yield* Context.get(world.runtime.graph, Settings).write({
    scope: 'project',
    projectId,
    key: 'threads.harnessTransport',
    value: { devin: 'acp' },
  });
  yield* nativeLeads(world, account);
  const hosted = Effect.fn('testing.parityHosted')(function* (lead: string | null, task: string) {
    if (lead !== null) return (yield* hostedChild(world, lead, task)).threadId;
    const { thread } = yield* Effect.scoped(
      Effect.andThen(hostedDefaults(world), births().create({ projectId, createdBySessionId: null, approvalMode: 'review' })),
    );
    if (thread.provider !== CLAUDE_CODE_PROVIDER)
      return yield* Effect.die(new Error(`the hosted seat was born on ${thread.provider}, not on the Claude login`));
    return thread.id;
  });
  const child = Effect.fn('testing.parityChild')(function* (lead: string | null, type: 'harness:devin' | undefined, task: string) {
    const { thread } = yield* births().create({
      projectId,
      createdBySessionId: null,
      approvalMode: lead === null ? 'review' : undefined,
      account: lead === null && type === undefined ? account : undefined,
      parent: lead ?? undefined,
      task: lead === null ? undefined : task,
      type,
    });
    born.push(thread.id);
    return thread.id;
  });
  const frames = Effect.fn('testing.parityFrames')(function* (report: string) {
    if (!(yield* files.exists(report))) return [];
    const lines = (yield* files.readFileString(report)).split('\n').filter((line) => line !== '');
    return yield* Effect.forEach(lines, (line) => decodeFrame(line));
  });
  const methods = (report: string) =>
    Effect.map(frames(report), (all) => all.flatMap((frame) => (frame.method === undefined ? [] : [frame.method])));
  const configured = (report: string) =>
    Effect.map(frames(report), (all) =>
      all.flatMap((frame): Configured[] =>
        frame.method === 'session/set_config_option' && frame.params?.configId !== undefined && typeof frame.params.value === 'string'
          ? [{ configId: frame.params.configId, value: frame.params.value }]
          : [],
      ),
    );
  const opened = Effect.fn('testing.parityOpened')(function* (report: string) {
    yield* until(
      Effect.map(methods(report), (seen) => (seen.includes('session/prompt') ? true : null)),
      'opened its turn at the agent',
    );
  });
  const kill = Effect.fn('testing.killParityProcess')(function* (path: string) {
    const pid = Number(yield* files.readFileString(path));
    yield* Effect.sync(() => {
      process.kill(pid, 'SIGKILL');
    });
  });
  const acp = (name: 'claude' | 'devin'): Seat => ({
    name,
    opening: name === 'claude' ? 'HOLD the turn' : 'HOLD',
    asking: { opening: 'ASK', raise: () => Effect.void },
    endsOnAnswer: true,
    answers: (questionId) => [{ questionId, values: ['allow-once'] }],
    die: (threadId) => kill(`${reports.get(threadId)!}.pid`),
    born: Effect.fn('testing.parityAcp')(function* (lead, task = '') {
      named += 1;
      const report = join(stage, `${name}-${named}.report`);
      const script =
        name === 'claude'
          ? [join(bin, WORLD_COMMAND), `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode tagma`]
          : [join(bin, 'devin'), `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode plain "$@"`];
      yield* files.writeFileString(script[0]!, ['#!/bin/sh', `echo $$ > '${report}.pid'`, script[1]!].join('\n'), { mode: 0o755 });
      const id = name === 'claude' ? yield* hosted(lead, task) : yield* child(lead, 'harness:devin', task);
      if (name === 'claude') born.push(id);
      reports.set(id, report);
      return id;
    }),
    held: (threadId) => opened(reports.get(threadId)!),
  });
  const native: Seat = {
    name: 'native',
    opening: 'Begin.',
    asking: { opening: 'ASK to push', raise: () => Effect.void },
    endsOnAnswer: true,
    answers: () => [{ questionId: ASK_CALL, values: ['confirm'] }],
    die: () => Effect.void,
    born: (lead, task = '') => child(lead, undefined, task),
    held: () => Effect.void,
  };
  const terminal: Seat = {
    name: 'terminal',
    opening: 'Begin.',
    endsOnAnswer: false,
    answers: (questionId) => [{ questionId, values: ['allow-once'] }],
    asking: {
      opening: 'Begin.',
      raise: Effect.fn('testing.parityTerminalQuestion')(function* (threadId) {
        const permissions = Context.get(world.runtime.owners, HarnessPermissions);
        const decision = yield* permissions.judge(threadId, { id: 'toolu_push', tool: 'bash', subject: 'git push origin main' });
        if (decision._tag !== 'Asked') return yield* Effect.die(new Error(`the terminal call was not asked: ${decision._tag}`));
        yield* Effect.forkScoped(permissions.outcome(threadId, decision.requestId, 10_000));
      }),
    },
    die: Effect.fn('testing.killParityTerminal')(function* (threadId) {
      const file = pids.get(threadId)!;
      yield* until(
        Effect.gen(function* () {
          return (yield* files.exists(file)) && (yield* files.readFileString(file)).trim() !== '' ? true : null;
        }),
        'started the scripted CLI process',
      );
      yield* kill(file);
    }),
    born: Effect.fn('testing.parityTerminal')(function* (lead, task = '') {
      named += 1;
      const name = `parity-${named}`;
      const report = join(stage, `${name}.stdin`);
      yield* files.writeFileString(
        join(bin, 'claude'),
        ['#!/bin/sh', `echo $$ > ${report}.pid`, "printf '\\033[?2004h'", `exec cat >> ${report}`].join('\n'),
        { mode: 0o755 },
      );
      const cli = yield* rig.raised({
        name,
        transcript: '',
        seeded: false,
        approvalMode: lead === null ? 'review' : undefined,
        parent: lead === null ? undefined : { threadId: lead, task },
      });
      clis.set(cli.threadId, cli);
      pids.set(cli.threadId, `${report}.pid`);
      born.push(cli.threadId);
      return cli.threadId;
    }),
    held: Effect.fn('testing.parityTerminalHeld')(function* (threadId) {
      const cli = clis.get(threadId)!;
      const first = yield* until(
        Effect.map(cli.facet(), (facet) =>
          facet?.session?.state === 'running' && facet.turn !== undefined && (facet.unread ?? []).length > 0 ? facet : null,
        ),
        'started its CLI with the first words',
      );
      const who = whoSpeaks(first);
      yield* cli.hook(
        'UserPromptSubmit',
        { prompt_id: 'p1', session_id: who.root },
        { inputs: first.unread![0]!.items, session: who.session },
      );
    }),
  };
  const quiet = Effect.fn('testing.quietParity')(function* () {
    const turns = turnsOf(world.runtime.owners);
    const standing = [...born].reverse();
    born.length = 0;
    const archived = yield* Effect.forEach(standing, (threadId) => Effect.exit(turns.archive(threadId, projectId, { kind: 'operator' })));
    reports.clear();
    pids.clear();
    clis.clear();
    const refused = archived.filter(Exit.isFailure).map((exit) => exit.cause);
    if (refused.length > 0) return yield* Effect.failCause(refused.reduce((all, cause) => Cause.combine(all, cause)));
  });
  const digest = Context.get(original.executions, HostManagement).connection.address.digest;
  if (digest == null) return yield* Effect.die(new Error('the parity host has no offered bundle'));
  const placedHost: HostPlacement = { _tag: 'Standing', digest, detail: 'the parity server keeps its one offered host bundle' };
  let currentScope: Scope.Closeable | undefined;
  yield* Effect.addFinalizer(() => quiet().pipe(Effect.orDie));
  const abandoned = Effect.fn('testing.abandonParityOwner')(function* (threadIds: readonly string[]) {
    const db = Context.get(world.runtime.graph, MachineStore).db;
    const ids = sql.join(
      threadIds.map((id) => sql`${id}`),
      sql`, `,
    );
    yield* db.run(sql`update external_session set lease_owner = 'a-server-that-died', lease_beat = 1 where id in (${ids})`);
    const quiet = (yield* Clock.currentTimeMillis) - LEASE_RHYTHM.takeoverAfterMs - 1_000;
    yield* db.run(
      sql`update thread_run set owner_id = 'a-server-that-died', handed_over_at = null, heartbeat_at = ${quiet}, progress = case when json_extract(progress, '$.stage') = 'awaiting-question' then progress else json_set(progress, '$.stage', 'running') end where thread_id in (${ids}) and status = 'running'`,
    );
  });
  return {
    world,
    projectId,
    seats: { native, claude: acp('claude'), devin: acp('devin'), terminal },
    born: () => born,
    release: (threadId) => files.writeFileString(`${reports.get(threadId)!}.release`, ''),
    received: (threadId) => methods(reports.get(threadId)!),
    configured: (threadId) => configured(reports.get(threadId)!),
    holdOpening: (held) =>
      held ? files.writeFileString(join(stage, 'opening.hold'), '') : files.remove(join(stage, 'opening.hold'), { force: true }),
    quiet,
    lead: Effect.fn('testing.parityLead')(function* (mode = 'review') {
      const lead = (yield* births().create({ projectId, createdBySessionId: null, title: 'lead', approvalMode: mode, account })).thread.id;
      born.push(lead);
      return lead;
    }),
    handover: Effect.fn('testing.parityHandover')(function* (graceful = true) {
      if (own === undefined) return yield* Effect.die(new Error('a parity world restarts its server only as its own world'));
      const previous = world.runtime;
      if (!graceful) yield* abandoned(born);
      yield* previous.closeStack;
      yield* previous.pool.dispose();
      yield* previous.runtime.disposeEffect;
      if (currentScope !== undefined) yield* Scope.close(currentScope, Exit.void);
      const scope = yield* Scope.fork(generations);
      currentScope = scope;
      const next = yield* makeRuntime(
        {
          adapters: TESTING_ADAPTERS,
          grants: testGrantSigner,
          profileWindowMs: () => 0,
          quotaProviders: [],
          databasePath: join(world.root, 'home/tagma.sqlite'),
          tokensPath: join(world.root, 'home/tokens.json'),
          attachmentsPath: join(world.root, 'home/attachments'),
          sourcePath: join(world.sourceCheckout, 'server'),
          hostBundlePath: yield* Effect.orDie(hostBundleRoot),
          placedHost,
          source: WORLD_SOURCE,
          models: heldOrAsking,
          drivers: [],
        },
        Layer.empty,
        yield* heldPool.pipe(Scope.provide(scope)),
      ).pipe(Scope.provide(scope));
      world.runtime = next;
      rig = yield* terminalRig(world, projectId, folder).pipe(Effect.provideService(FileSystem.FileSystem, files), Scope.provide(scope));
      for (const transport of Context.get(next.owners, ThreadHarness).runs.transports().all())
        if (transport.resource !== undefined) yield* transport.resource.watch().pipe(Effect.provide(next.owners));
    }),
  };
});
