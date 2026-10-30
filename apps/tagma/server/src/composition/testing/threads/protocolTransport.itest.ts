import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect, FileSystem, Layer, Queue, Schema, Stream } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import type { HarnessId } from '../../../platform/contract/wire/session.js';
import { HarnessRegistry } from '../../../threads/contract/service/harness.js';
import { birthsOf, listOf, thread, threadEntry, threadRun } from '../../../threads/testing/doubles.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import { EvidenceFeed } from '../../../threads/contract/service/evidence.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { sessionOfThread } from '../../../external-harnesses/testing/sessions.js';
import { EXECUTION_HOST_ROOT, SERVER_SRC } from '../repoRoot.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { nativeLeads } from '../claudeLogin.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { isTransportEntry } from '../../../threads/contract/wire/harness/transportEntry.js';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { BUILTIN_HARNESSES } from '../../../external-harnesses/vendors/builtin.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';

const LIBRARY = join(EXECUTION_HOST_ROOT, 'native', 'target', 'release', 'libexecution_platform.dylib');
const AGENT = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');
const frameSchema = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.optional(Schema.String),
    params: Schema.optional(Schema.Struct({ sessionId: Schema.optional(Schema.String) })),
  }),
);
const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const stage = yield* files.makeTempDirectoryScoped({ prefix: 'protocol-transport-' });
  const bin = join(stage, 'bin');
  yield* files.makeDirectory(bin);
  for (const binary of [WORLD_COMMAND, ...BUILTIN_HARNESSES.map(({ binary }) => binary).filter((binary) => !isAbsolute(binary))])
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
    models: (standing) => ({ ...standing, request: (input) => ({ ...standing.request(input), stream: () => Stream.never }) }),
  });
  const account = yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3600000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (account) => world.runtime.tokens.remove('subscription', account).pipe(Effect.orDie),
  );
  yield* nativeLeads(world, account);
  const projectId = yield* world.stealthProject(yield* world.directory('acp-project'));
  yield* projectLeaving(world, projectId);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  expect(
    (yield* world.op(
      'write_setting_layer',
      {
        scope: 'project',
        key: 'threads.harnessTransport',
        value: { devin: 'acp' },
      },
      `project=${projectId}`,
    )).status,
  ).toBe(200);
  return { world, projectId, account, stage, bin };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/ProtocolTransportWorld') {}
const runsOf = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* World;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  return yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(db.select().from(threadRun()).where(eq(threadRun().threadId, threadId)).all()),
  );
});
const entriesOf = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* World;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  return yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(db.select().from(threadEntry()).where(eq(threadEntry().threadId, threadId)).orderBy(threadEntry().ord).all()),
  );
});
const facet = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* World;
  return yield* sessionOfThread(Context.get(world.runtime.graph, MachineStore).db, threadId);
});
const road = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* World;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  return yield* Context.get(world.runtime.graph, MachineUnits).read((unit) =>
    unit.run(
      db
        .select({ transport: thread().transport, capabilities: thread().capabilities, model: thread().model })
        .from(thread())
        .where(eq(thread().id, threadId))
        .get(),
    ),
  );
});
const completed = Effect.fnUntraced(function* (threadId: string, count: number) {
  const { world } = yield* World;
  const changes = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
  yield* Effect.acquireRelease(
    Effect.sync(() => Context.get(world.runtime.owners, EvidenceFeed).subscribe(threadId, () => Queue.offerUnsafe(changes, undefined))),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  for (;;) {
    const runs = yield* runsOf(threadId);
    if (runs.filter((row) => row.status === 'completed').length >= count) return runs;
    yield* Queue.take(changes);
  }
}, Effect.scoped);
const heard = Effect.fn('testing.transportFrames')(function* (report: string) {
  const files = yield* FileSystem.FileSystem;
  if (!(yield* files.exists(report))) return [];
  return yield* Effect.forEach(
    (yield* files.readFileString(report)).split('\n').filter((line) => line !== ''),
    (line) => Schema.decodeUnknownEffect(frameSchema)(line),
  );
});
const transport = Effect.fnUntraced(function* (threadId: string, to: 'terminal' | 'acp') {
  const { world, projectId } = yield* World;
  return yield* world.op('set_thread_transport', { threadId, transport: to }, `project=${projectId}`);
});
const agent = Effect.fn('testing.transportAgent')(function* (name: string) {
  const { stage, bin } = yield* World;
  const files = yield* FileSystem.FileSystem;
  const report = join(stage, `${name}.report`);
  yield* files.writeFileString(
    join(bin, 'devin'),
    ['#!/bin/sh', `exec '${process.execPath}' '${AGENT}' --report '${report}' --mode plain "$@"`].join('\n'),
    { mode: 0o755 },
  );
  return report;
});
const born = Effect.fn('testing.transportChild')(function* (task: string) {
  const { world, projectId, account } = yield* World;
  const report = yield* agent(`plain-${crypto.randomUUID()}`);
  const births = birthsOf(world.runtime.owners);
  const lead = yield* births.create({ projectId, createdBySessionId: null, title: 'lead', approvalMode: 'review', account });
  const cli = (yield* births.create({ projectId, createdBySessionId: null, type: 'harness:devin', parent: lead.thread.id, task })).thread
    .id;
  return { cli, report, lead: lead.thread.id };
});

describe.skipIf(!existsSync(LIBRARY))('an acp thread behaves like a native one', () => {
  layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
    'ACP transport world',
    (it) => {
      it.effect(
        'an idle thread moves to terminal in one call, ending its resting process, and back; the same vendor session continues, whose journal thread.subscribe serves',
        () =>
          Effect.gen(function* () {
            const { world, projectId } = yield* World;
            const { cli, report, lead } = yield* born('Answer the floor.');
            yield* completed(cli, 1);
            expect((yield* facet(cli))?.session?.state).toBe('running');
            const devin = yield* Context.get(world.runtime.owners, HarnessRegistry).resolve('devin' as HarnessId);
            const spent = devin.spent(lead, 'operator');
            expect(yield* spent).toEqual({ tokens: 3, unmeasured: [] });
            const resting = (yield* facet(cli))!.session!.id;
            expect((yield* transport(cli, 'terminal')).body).toMatchObject({ status: 'switched', transport: 'terminal' });
            const raised = (yield* facet(cli))!;
            expect(raised.sessionKey).toBe('sess-1');
            expect(raised.session?.id).not.toBe(resting);
            expect(raised.session).toMatchObject({ origin: 'launched', prompt: '' });
            expect(raised.session?.argv?.slice(-2)).toEqual(['--resume', 'sess-1']);
            expect((yield* road(cli))?.transport).toEqual({ adapter: 'terminal', profile: 'devin', agent: null });
            expect((yield* runsOf(cli)).length).toBe(1);
            expect(yield* spent).toEqual({ tokens: 3, unmeasured: [] });
            expect((yield* transport(cli, 'acp')).body).toMatchObject({ status: 'switched', transport: 'acp' });
            expect(yield* road(cli)).toMatchObject({
              transport: { adapter: 'acp', profile: 'devin', agent: null },
              capabilities: { law: 'asked-calls' },
            });
            expect(
              (yield* entriesOf(cli))
                .map((row) => row.entry)
                .filter(isTransportEntry)
                .map((entry) => [entry.from, entry.to]),
            ).toEqual([
              ['acp', 'terminal'],
              ['terminal', 'acp'],
            ]);
            const firstRun = (yield* runsOf(cli))[0]!.id;
            const idle = yield* Deferred.make<string>();
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    Context.get(world.runtime.owners, EvidenceFeed).subscribe(cli, (event) => {
                      if (
                        event.type === 'state' &&
                        event.frame.state.status.life === 'idle' &&
                        event.frame.state.latestRun?.status === 'completed' &&
                        event.frame.state.latestRun.id !== firstRun
                      )
                        Deferred.doneUnsafe(idle, Effect.succeed(event.frame.state.latestRun.id));
                    }),
                  ),
                  (unsubscribe) => Effect.sync(unsubscribe),
                );
                yield* Context.get(world.runtime.owners, ThreadHarness).threads.handle(cli, 'operator').send('Answer again.');
                const runs = yield* completed(cli, 2);
                expect(yield* Deferred.await(idle)).toBe(runs.at(-1)!.id);
              }),
            );
            expect(
              (yield* heard(report))
                .filter((line) => line.method === 'session/new' || line.method === 'session/load')
                .map((line) => [line.method, line.params?.sessionId ?? null]),
            ).toEqual([
              ['session/new', null],
              ['session/load', 'sess-1'],
            ]);
            const [frame] = yield* Stream.runCollect(
              Stream.take(Context.get(world.runtime.owners, ThreadFeeds)['thread.subscribe']({ projectId, threadId: cli }), 1),
            );
            const said =
              frame?.type === 'snapshot'
                ? frame.payload.snapshot.transcript.flatMap((entry) =>
                    coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' ? [entry.text] : [],
                  )
                : [];
            expect(said).toEqual(['echo: heard', 'echo: heard']);
            expect(frame?.type === 'snapshot' ? frame.payload.snapshot : null).toMatchObject({ status: { life: 'idle' }, activeRun: null });
            expect((yield* facet(cli))?.session?.state).toBe('running');
            expect((yield* listOf(world.runtime.owners).setArchived(cli, projectId, true)).archivedAt).not.toBeNull();
            expect((yield* facet(cli))?.session?.state).toBe('ended');
          }),
      );
    },
  );
});
