import { kind, shared } from '@runlith/testbed/worlds';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { unthreadedCaller } from './callers';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { fixtureMigrations } from './migrations.js';
import { sessionIdentityLayer } from '../../external-harnesses/testing/builtin.js';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem, Layer, Schema, Scope, Semaphore } from 'effect';
import { eq, getTableColumns, inArray } from 'drizzle-orm';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { Git, GitUnavailable } from '@runlith/git/Git';
import { MachineStore } from '../../platform/contract/service/store.js';
import { unitsLayer } from '../../platform/store/units.js';
import { runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { machineFileLayer } from '../../platform/store/open.js';
import { workspaceChange } from '../../change-record/testing/doubles.js';
import { workspaceChangeText } from '../../change-record/store/tables.js';
import { commandUnattributed } from '../../change-record/store/commandTables.js';
import { block as blockRow } from '../../graph/store/tables.js';
import { project as projectRow } from '../../projects/testing/doubles.js';
import { session as sessionRow } from '../../platform/store/writers.js';
import { thread } from '../../threads/testing/doubles.js';
import { threadRecord } from '../../thread-record/testing/doubles.js';
import { bornThread } from '../../native-harness/testing/born.js';
import { projectsLayer } from '../../projects/testing/doubles.js';
import { fixtureGraph } from './fixtureGraph.js';
import { ProvedRoot } from '../../workspace/contract/wire/place.js';
import { UNCHECKED } from '../../enforcement/contract/wire/checks.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { TEST_CHECKOUT, testPlace } from '../../workspace/testing/doubles.js';
import { evidenceInGroups } from '../../change-record/testing/doubles.js';
import { pathsOfThread } from '../../change-record/testing/doubles.js';
import { changeDebt, changeLanded, changeLanding, checkoutSeen } from '../../change-record/store/retirement.js';
import { recordWrite } from '../../change-record/testing/doubles.js';
import { submitOver } from '../../landing/testing/doubles.js';
import { landingServices } from './landingServices.js';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmission } from '../preparedChanges.js';
import { makePreparedChanges } from '../../change-record/testing/doubles.js';
import { quietCommands } from '../../change-record/testing/doubles.js';
import type { CommandChanges } from '../../change-record/contract/service/commands.js';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import type { CommitShape } from '../../change-record/contract/service/shape.js';
import { claimPreparedInstance, preparedBase } from '../../change-record/testing/doubles.js';
import { judgingFns } from '../../change-record/testing/doubles.js';
import { eligiblePaths, pathChunks } from '../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { doctrineText } from '../doctrine.js';
import { ASSEMBLY } from './composed.js';
import { Doctrine } from '../../platform/contract/service/sections.js';

export const MINE = 'mirror-git';
export const THEIRS = 'amber-fox';

export const FILE = ['const one = 1;', 'const two = 2;', 'const three = 3;', 'const four = 4;', 'const five = 5;'];

export function unstartedOn(git: Git['Service'], verb: string): Git['Service'] {
  let armed = true;
  return {
    run: (args, options) => {
      if (armed && args.includes(verb)) {
        armed = false;
        return Effect.fail(new GitUnavailable({ command: args, reason: `nothing could run ${verb} here` }));
      }
      return git.run(args, options);
    },
  };
}

export function unreadableAt(git: Git['Service'], path: string): Git['Service'] {
  return {
    run: (args, options) =>
      args.includes(`HEAD:${path}`)
        ? Effect.fail(new GitUnavailable({ command: args, reason: `nothing could read ${path} here` }))
        : git.run(args, options),
  };
}

export function diesOn(git: Git['Service'], verb: string): Git['Service'] {
  let armed = true;
  return {
    run: (args, options) => {
      if (armed && args.includes(verb)) {
        armed = false;
        return Effect.die(new Error(`the process ended during ${verb}`));
      }
      return git.run(args, options);
    },
  };
}

export const call = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const execute = toolExecute(tool);
  if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
  const prepare = toolPrepare(tool);
  const resolved = prepare ? yield* prepare(input, { toolCallId: 'call-1', caller: unthreadedCaller }) : undefined;
  const settled = yield* execute(input, {
    toolCallId: 'call-1',
    caller: unthreadedCaller,
    messages: [],
    prepared: resolved?.prepared,
  }).pipe(Effect.catchTag('Tool.Failed', (failure) => Effect.succeed(failure.reason)));
  return String(settled instanceof ToolAnswer ? settled.value : settled);
});

const plantCheckout = Effect.fn('checkoutFixture.plant')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const run = (args: readonly string[]) => runGit(git, 'test', ['-C', root, ...args]);
  yield* run(['init', '-q', '-b', 'main', '.']);
  yield* run(['config', 'user.name', 't']);
  yield* run(['config', 'user.email', 't@t']);
  yield* files.writeFileString(join(root, 'src', 'a.ts'), `${FILE.join('\n')}\n`);
  yield* run(['add', '--', 'src']);
  yield* run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the file as it stood']);
});

export const PLACE = Schema.decodeUnknownSync(ProvedRoot)({
  environment: {
    environmentId: 'host',
    kind: 'host',
    namespaceId: 'host',
    identityWitness: { provider: 'test', format: 'v1', token: 'host' },
  },
  root: { namespaceId: 'host', path: '/repo' },
  witness: { provider: 'test', format: 'v1', token: 'repo' },
  registration: null,
});

export type SubmitOptions = {
  subject?: string;
  paths?: readonly string[];
  whole?: readonly string[];
  taking?: readonly { threadId: string; label: string }[];
  git?: Git['Service'];
  checks?: ActChecks;
  commands?: CommandChanges['Service'];
  record?: ChangeRecord['Service'];
  shape?: CommitShape['Service'];
  withoutFormat?: boolean;
};

export const noRuleInPlay: ActChecks = { before: () => Effect.succeed(UNCHECKED), after: () => Effect.void };

export const makeCheckout = Effect.fnUntraced(
  function* (directory?: string) {
    const files = yield* FileSystem.FileSystem;
    const given = directory ?? (yield* files.makeTempDirectoryScoped({ prefix: 'tagma-checkout-' }));
    yield* files.makeDirectory(given, { recursive: true });
    const home = yield* files.realPath(given);
    const root = join(home, 'checkout');
    yield* files.makeDirectory(join(root, 'src'), { recursive: true });
    const pool = yield* heldPool;
    const context = yield* Layer.build(
      Layer.mergeAll(
        fixtureGraph({ sourcePath: root }).pipe(Layer.provideMerge(projectsLayer())),
        unitsLayer(MachineUnits, MachineStore),
      ).pipe(
        Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, { durable: false }, pool))),
        Layer.provideMerge(sessionIdentityLayer),
        Layer.provideMerge(Layer.succeed(Doctrine, doctrineText(ASSEMBLY))),
      ),
    );
    const git = Context.get(context, Git);
    const store = Context.get(context, MachineStore);
    const units = Context.get(context, MachineUnits);
    const landing = yield* Effect.provide(landingServices, context);
    const run = (args: readonly string[]) => Effect.provide(runGit(git, 'test', ['-C', root, ...args]), context);
    const file = join(root, 'src', 'a.ts');

    yield* plantCheckout(root).pipe(Effect.provide(context));
    const seed = join(home, 'seed');
    yield* files.copy(root, seed, { overwrite: true });

    const project = yield* store.db
      .insert(projectRow())
      .values({ name: 'w', repoKey: 'w', rootPath: root, createdAt: new Date(yield* Clock.currentTimeMillis) })
      .returning();
    const projectId = project[0]?.id;
    if (projectId === undefined) return yield* Effect.die('the checkout fixture inserted no project');

    const originFor = (threadId: string) =>
      ({ ...PLACE, generation: 0, work: { projectId, threadId } }) as Parameters<typeof submitOver>[4];

    const record = Effect.fnUntraced(function* (
      threadId: string,
      before: string,
      after: string,
      options: {
        path?: string;
        origin?: 'edit' | 'write' | 'delete';
        afterHash?: string | null;
      } = {},
    ) {
      const place = options.path ?? 'src/a.ts';
      const head = yield* run(['rev-parse', 'HEAD']);
      yield* recordWrite(units, store, projectId, threadId, testPlace(place), {
        before,
        after: options.origin === 'delete' ? null : after,
        mode: '100644',
        head,
      });
    });

    const wrote = Effect.fnUntraced(function* (
      threadId: string,
      lines: readonly string[],
      options: {
        path?: string;
        origin?: 'edit' | 'write' | 'delete';
        afterHash?: string | null;
      } = {},
    ) {
      const at = join(root, options.path ?? 'src/a.ts');
      const before = yield* files.readFileString(at);
      const after = `${lines.join('\n')}\n`;
      yield* files.writeFileString(at, after);
      yield* record(threadId, before, after, options);
    });

    const written = Effect.fnUntraced(function* (threadId: string, path: string, text: string) {
      const at = join(root, path);
      const before = (yield* files.exists(at)) ? yield* files.readFileString(at) : '';
      yield* files.makeDirectory(dirname(at), { recursive: true });
      yield* files.writeFileString(at, text);
      yield* record(threadId, before, text, { path });
    });

    const based = Effect.fnUntraced(function* (texts: Readonly<Record<string, string>>) {
      for (const [path, text] of Object.entries(texts)) {
        yield* files.makeDirectory(dirname(join(root, path)), { recursive: true });
        yield* files.writeFileString(join(root, path), text);
      }
      yield* run(['add', '--', ...Object.keys(texts)]);
      yield* run(['commit', '-qm', 'base']);
    });

    const head = (path: string) => Effect.provide(runGitBytes(git, 'test', ['-C', root, 'show', `HEAD:${path}`]), context);

    const admission = makeLandingHolds();
    const producerOn = (dir: string, options: SubmitOptions) =>
      makePreparedChanges(
        { commands: options.commands ?? quietCommands, pathsOfThread, evidenceInGroups },
        landingAdmission(admission),
        judgingFns(CHECKOUT_DIRECTORY),
        dir,
        options.shape,
      );

    const submitAs = Effect.fnUntraced(function* (threadId: string, options: SubmitOptions = {}) {
      const inst = yield* claimPreparedInstance(preparedBase(store));
      const producer = producerOn(inst.dir, options);
      const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
        options.record === undefined ? work : Effect.provideService(work, ChangeRecord, options.record);
      return yield* Effect.ensuring(
        Effect.provideContext(
          recorded(
            submitOver(
              options.git ?? git,
              root,
              store,
              units,
              originFor(threadId),
              {
                projectId,
                tasks: [{ name: 'ab12cd34', title: 'the work this commit answers', stealth: false }],
                taking: (options.taking ?? []).map((session) => ({
                  projectId: session.threadId === 'operator' ? null : projectId,
                  threadId: session.threadId,
                  tasks: [],
                })),
                subject: options.subject,
                coAuthored: true,
                paths: options.paths,
                whole: options.whole,
                withoutFormat: options.withoutFormat,
              },
              options.checks ?? noRuleInPlay,
              producer,
            ),
          ),
          landing,
        ),
        inst.release,
      );
    });

    const builtAs = (threadId: string, options: SubmitOptions = {}) =>
      Effect.scoped(
        Effect.gen(function* () {
          const inst = yield* claimPreparedInstance(preparedBase(store));
          yield* Effect.addFinalizer(() => inst.release);
          const outcome = yield* producerOn(inst.dir, options).prepare({
            projectId,
            git: options.git ?? git,
            root,
            store,
            units,
            origin: originFor(threadId),
            checkout: TEST_CHECKOUT,
            input: { taking: [], withoutFormat: options.withoutFormat },
            job: 'built-as',
            caller: undefined,
            act: { kind: 'thread', ...originFor(threadId).work },
          });
          const built = outcome.prepared?.subject.built ?? null;
          if (outcome.prepared !== null) yield* producerOn(inst.dir, options).release(outcome.prepared);
          return built;
        }),
      );

    const named = { threads: [] as string[], sessions: [] as number[], blocks: [] as number[] };

    const namedAgent = Effect.fnUntraced(function* (
      threadId: string,
      who: { name: string; task: string; ended?: boolean; parent?: string; running?: boolean; failed?: boolean },
    ) {
      named.threads.push(threadId);
      const agent = {
        ownerId: 'owner',
        agentId: 'tagma',
        provider: 'openai-oauth' as const,
        model: 'gpt-test',
        reasoning: 'high' as const,
        authority: { mode: 'trust' as const, bypassFrom: null },
        status: who.running === true ? ('running' as const) : who.failed === true ? ('failed' as const) : ('idle' as const),
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      yield* bornThread(
        store.db,
        {
          ...agent,
          id: threadId,
          spawnRootId: who.parent ?? threadId,
          cacheGroup: threadId,
          name: who.name,
          parentThreadId: who.parent,
        },
        {
          projectId,
          title: who.name,
          readerOrderAt: new Date(0),
          archivedAt: who.ended === true ? new Date(1_000) : undefined,
        },
      );
      const session = yield* store.db
        .insert(sessionRow)
        .values({ harness: 'tagma', key: threadId, createdAt: new Date(0) })
        .returning();
      const writer = session[0]?.id;
      if (writer === undefined) return yield* Effect.die('the checkout fixture inserted no writer');
      named.sessions.push(writer);
      const task = yield* store.db
        .insert(blockRow)
        .values({
          projectId,
          uuid: `00000000-0000-0000-0000-0000000000${threadId.length.toString().padStart(2, '0')}`,
          parentId: null,
          ord: 0,
          tags: ['task'],
          title: who.task,
          body: '',
          fields: { status: 'in_work', holder: writer },
          createdAt: new Date(0),
          updatedAt: new Date(0),
        })
        .returning({ id: blockRow.id });
      const taskId = task[0]?.id;
      if (taskId === undefined) return yield* Effect.die('the checkout fixture inserted no task');
      named.blocks.push(taskId);
    });

    const reset = Effect.fnUntraced(function* () {
      for (const path of yield* files.readDirectory(root)) yield* files.remove(join(root, path), { recursive: true });
      yield* files.copy(seed, root, { overwrite: true });
      yield* store.db.delete(workspaceChange());
      for (const table of [checkoutSeen, changeLanding, changeLanded, changeDebt, commandUnattributed]) yield* store.db.delete(table);
      if (named.threads.length > 0) {
        yield* store.db.delete(threadRecord()).where(inArray(threadRecord().id, named.threads));
        yield* store.db.delete(thread()).where(inArray(thread().id, named.threads));
      }
      if (named.blocks.length > 0) yield* store.db.delete(blockRow).where(inArray(blockRow.id, named.blocks));
      if (named.sessions.length > 0) yield* store.db.delete(sessionRow).where(inArray(sessionRow.id, named.sessions));
      named.threads.length = 0;
      named.sessions.length = 0;
      named.blocks.length = 0;
    });

    return {
      reset,
      admission,
      root,
      file,
      projectId,
      originFor,
      namedAgent,
      run,
      context,
      store,
      units,
      git,
      record,
      wrote,
      written,
      based,
      head,
      submitAs,
      builtAs,
      submit: submitAs,
      thread: (threadId: string, values: { status?: 'idle' | 'running' | 'failed' }) =>
        store.db.update(threadRecord()).set(values).where(eq(threadRecord().id, threadId)),
      committed: () => Effect.map(run(['show', 'HEAD:src/a.ts']), (text) => text.split('\n')),
      rows: () =>
        store.db
          .select({ ...getTableColumns(workspaceChange()), oldText: workspaceChangeText.oldText, newText: workspaceChangeText.newText })
          .from(workspaceChange())
          .leftJoin(workspaceChangeText, eq(workspaceChangeText.row, workspaceChange().id)),
    };
  },
  (effect, _directory?: string) => Effect.provide(effect, BunFileSystem.layer),
);

export type CheckoutWorld = Effect.Success<ReturnType<typeof makeCheckout>>;

type CheckoutServices = CheckoutWorld['context'] extends Context.Context<infer Services> ? Services : never;

export class CheckoutFixture extends Context.Service<
  CheckoutFixture,
  {
    use<A, E, R>(
      body: (world: CheckoutWorld) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | Effect.Error<ReturnType<CheckoutWorld['reset']>>, Exclude<Exclude<R, CheckoutServices>, Scope.Scope>>;
  }
>()('testing/CheckoutFixture') {}

const checkoutWorld = kind(CheckoutFixture, (_params: {}, home) =>
  Effect.gen(function* () {
    const world = yield* makeCheckout(home);
    const uses = yield* Semaphore.make(1);
    return CheckoutFixture.of({
      use: (body) =>
        uses.withPermit(
          Effect.scoped(
            Effect.andThen(
              world.reset(),
              Effect.suspend(() => body(world)),
            ).pipe(Effect.provide(world.context)),
          ),
        ),
    });
  }),
);

export const checkoutFixture = Layer.effect(CheckoutFixture, shared(checkoutWorld, {}));

export const withCheckout = <A, E, R>(body: (world: CheckoutWorld) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(CheckoutFixture, (fixture) => fixture.use(body));
