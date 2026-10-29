import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Layer, Stream, Tracer } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { applyMigration, chain } from '../../../platform/store/chain.js';
import { setting } from '../../../settings/store/table.js';
import { eq, sql } from 'drizzle-orm';
import { fixtureMigrations } from '../migrations.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { approves } from '../../../threads/contract/wire/settings.js';
import { thread as nativeThread } from '../../../threads/store/kernel.js';
import { catalogProfileOf } from '@runlith/agent/thread/agents/AgentProfile';
import { birthsOf, listOf, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';

type Answer = { readonly status?: string; readonly code?: string; readonly [field: string]: unknown };

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (selection) => ({
      ...standing.request(selection),
      stream: () =>
        Stream.fromIterable([
          { type: 'text-start', id: 'reply' },
          { type: 'text-delta', id: 'reply', text: 'Done.' },
          { type: 'text-end', id: 'reply' },
          { type: 'finish', reason: 'stop' },
        ]),
    }),
  }),
});
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'fixture-bearer',
      refreshToken: 'fixture-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.tokens.remove('subscription', key).pipe(Effect.orDie),
  );
  yield* nativeLeads(world, account);
  yield* holdThreads(world);
  return { world, projectId: yield* world.stealthProject() };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/Approver') {}

const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown) {
  const { world, projectId } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/${id}?project=${projectId}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' },
        body: JSON.stringify(input),
      }),
      world.routed,
    ),
  );
  return (yield* Effect.promise(() => response.json())) as Answer;
});

const operator = (id: string, input: unknown) =>
  Effect.flatMap(Place, ({ world, projectId }) => world.op(id, input, `project=${projectId}`));

const family = Effect.fnUntraced(function* (approvalMode: 'trust' | 'review' = 'trust') {
  const { world, projectId } = yield* Place;
  const births = birthsOf(world.runtime.owners);
  const parent = yield* births.create({
    projectId,
    createdBySessionId: null,
    title: 'parent',
    approvalMode,
  });
  const child = yield* births.create({ projectId, createdBySessionId: null, parent: parent.thread.id, task: '' });
  return { parent: parent.thread.id, child: child.thread.id };
});

const outsider = Effect.gen(function* () {
  const { world, projectId } = yield* Place;
  return (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, title: 'outsider' })).thread.id;
});

const approvingOf = (threadId: string) =>
  Effect.map(
    operator('read_thread_snapshot', { threadId }),
    (answer) =>
      (answer.body as { snapshot: { thread: { approving: { approver: string | null; why: string } } } }).snapshot.thread.approving,
  );

const standing = (threadId: string) =>
  Effect.flatMap(Place, ({ world }) =>
    Effect.map(Context.get(world.runtime.owners, ThreadHarness).runs.questions().open(threadId), (open) => open.at(-1)),
  );

layer(Layer.effect(Place, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('approver routing', (it) => {
  it.effect('approval follows the parent, takeover, review mode and narrowed grants while only the current approver can answer once', () =>
    Effect.gen(function* () {
      const { parent, child } = yield* family();
      const brother = yield* outsider;
      expect(yield* asThread(child, 'pin_thread', { threadId: brother })).toMatchObject({ code: 'approval-pending' });
      const asked = yield* standing(child);
      expect(asked?.approver).toBe(parent);
      const answer = (from: string, allow: boolean) =>
        asThread(from, 'answer_approval', {
          threadId: child,
          questionId: asked!.questionId,
          allow,
          note: allow ? undefined : 'not now',
        });
      expect(yield* answer(child, true)).toMatchObject({ code: 'not-the-approver' });
      expect(yield* answer(brother, true)).toMatchObject({ code: 'not-the-approver' });
      expect(yield* answer(parent, true)).toMatchObject({ status: 'answered' });
      const pinned = yield* asThread(child, 'pin_thread', { threadId: brother });
      expect(pinned.status).toBe('pinned');
      expect(yield* asThread(child, 'pin_thread', { threadId: brother, pinned: false })).toMatchObject({ code: 'approval-pending' });
      const second = yield* standing(child);
      expect(second?.approver).toBe(parent);
      expect(yield* approvingOf(child)).toMatchObject({ approver: parent, why: 'parent' });
      expect((yield* operator('set_thread_approver', { threadId: child, approver: 'you' })).status).toBe(200);
      expect(yield* approvingOf(child)).toMatchObject({ approver: null, why: 'taken-over' });
      expect((yield* standing(child))?.approver).toBeUndefined();
      expect(yield* asThread(parent, 'answer_approval', { threadId: child, questionId: second!.questionId, allow: true })).toMatchObject({
        code: 'not-the-approver',
      });
      expect((yield* operator('set_thread_approver', { threadId: child, approver: 'default' })).status).toBe(200);
      expect((yield* standing(child))?.approver).toBe(parent);
      const note = 'Keep the thread pinned until the shared change is ready.';
      expect(
        yield* asThread(parent, 'answer_approval', { threadId: child, questionId: second!.questionId, allow: false, note }),
      ).toMatchObject({ status: 'answered' });
      const declined = yield* asThread(child, 'pin_thread', { threadId: brother, pinned: false });
      expect(declined.code).toBe('declined');
      expect(declined.reason).toEqual(expect.stringContaining(note));
      expect(declined.reason).toEqual(expect.stringContaining(parent));
      const { world } = yield* Place;
      yield* Context.get(world.runtime.owners, ThreadHarness).threads.handle(parent, 'operator').setAuthorityMode('review');
      expect(yield* asThread(child, 'pin_thread', { threadId: brother, pinned: false })).toMatchObject({ code: 'approval-pending' });
      const review = yield* standing(child);
      expect(yield* asThread(parent, 'answer_approval', { threadId: child, questionId: review!.questionId, allow: true })).toMatchObject({
        status: 'answered',
      });
      expect((yield* asThread(child, 'pin_thread', { threadId: brother, pinned: false })).status).toBe('unpinned');
      expect((yield* operator('set_thread_approves', { threadId: parent, approves: ['bash'] })).status).toBe(200);
      expect(yield* asThread(child, 'pin_thread', { threadId: brother })).toMatchObject({ code: 'approval-pending' });
      expect((yield* standing(child))?.approver).toBeUndefined();
    }),
  );

  it.effect(
    'a child restored without its archived parent hands its parent’s approval to the operator’s Attention, and the parent’s return takes it back',
    () =>
      Effect.gen(function* () {
        const { world, projectId } = yield* Place;
        const { parent, child } = yield* family();
        const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
        const list = listOf(world.runtime.owners);
        let watched: { readonly approver: string | undefined; readonly reached: Deferred.Deferred<void> } | null = null;
        const routedTo = (approver: string | undefined) =>
          Effect.map(Deferred.make<void>(), (reached) => {
            watched = { approver, reached };
            return reached;
          });
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            list.subscribe(projectId, (event) => {
              if (event.kind !== 'row' || event.row.id !== child || (event.row.ask ?? null) === null) return;
              if (watched !== null && event.row.ask?.approver === watched.approver) Deferred.doneUnsafe(watched.reached, Effect.void);
            }),
          ),
          (stop) => Effect.sync(stop),
        );
        yield* list.openWindow(projectId);
        const asked = {
          threadId: child,
          key: 'pin',
          operation: 'pin_thread',
          summary: 'Pin the sister',
          asked: ['review'],
          withinMs: null,
          waitMs: 0,
        };
        expect((yield* questions.approve(asked)).kind).toBe('waiting');
        expect((yield* standing(child))?.approver).toBe(parent);
        const toOperator = yield* routedTo(undefined);
        expect((yield* operator('archive_thread', { threadId: parent })).status).toBe(200);
        expect((yield* operator('archive_thread', { threadId: child, archived: false })).status).toBe(200);
        yield* Deferred.await(toOperator);
        expect((yield* standing(child))?.approver).toBeUndefined();
        const attention = yield* operator('read_attention', { limit: 21 });
        expect(
          (attention.body as { rows: readonly { readonly threadId: string }[] }).rows.find((row) => row.threadId === child),
        ).toMatchObject({ kind: 'awaiting', ask: { text: 'Pin the sister' } });
        yield* Effect.addFinalizer(() => turnsOf(world.runtime.owners).stop(parent, projectId).pipe(Effect.orDie));
        const toParent = yield* routedTo(parent);
        expect((yield* operator('start_turn', { threadId: parent, text: 'Carry on.', key: 'parent-back' })).status).toBe(200);
        yield* Deferred.await(toParent);
        expect((yield* standing(child))?.approver).toBe(parent);
      }),
  );

  it.effect('a stored operation grant still routes approval and permits its renamed graph operation after migration', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const { parent, child } = yield* family('review');
      const { db } = Context.get(world.runtime.owners, MachineStore);
      const mandate = Context.get(world.runtime.owners, ThreadMandate);
      const settings = Context.get(world.runtime.owners, Settings);
      const previous = (yield* settings.read(approves, projectId)).layers.project;
      yield* Effect.addFinalizer(() =>
        settings
          .write({ scope: 'project', projectId, key: approves.id, value: previous?.value, declined: previous?.declined })
          .pipe(Effect.orDie),
      );
      const at = new Date(yield* Clock.currentTimeMillis);
      yield* mandate.setApproves(parent, ['claim_task', 'held-elsewhere', 'finish_block', 'enforce_law', 'set_law_delivery', 'claim_task']);
      const saved = yield* db
        .insert(setting)
        .values({
          scope: 'project',
          projectId,
          key: 'agent.approves',
          value: JSON.stringify(['release_task', 'held-elsewhere', 'check_law']),
          updatedAt: at,
        })
        .returning();
      const disabled = yield* db
        .insert(setting)
        .values({
          scope: 'project',
          projectId,
          key: 'skills.disabled',
          value: JSON.stringify(['commit-steps', 'artifacts']),
          updatedAt: at,
        })
        .returning();
      const unrelated = yield* db
        .insert(setting)
        .values({ scope: 'project', projectId, key: 'unrelated', value: JSON.stringify(['claim_task']), updatedAt: at })
        .returning();
      const profile = {
        id: 'named-tools',
        overlay: {
          id: 'named-tools',
          baseAgentId: 'tagma',
          description: 'Work',
          tools: ['claim_task', 'ready_tasks', 'enforce_law', 'plugin.own'],
          prompt: 'claim_task is text in a frozen prompt',
        },
      };
      yield* db.update(nativeThread).set({ profile }).where(eq(nativeThread.id, parent));
      const renames = ['20261013021000_graph_operation_names', '20261020030000_rule_operation_names'];
      const migrations = chain(fixtureMigrations).filter((row) => row.name !== undefined && renames.includes(row.name));
      if (migrations.length !== renames.length) return yield* Effect.die(new Error('an operation name migration is not shipped'));
      const [ledger] = yield* db.all<{ readonly last: number | null }>(sql`select max(rowid) as last from "__drizzle_migrations"`);
      yield* Effect.addFinalizer(() =>
        db.run(sql`delete from "__drizzle_migrations" where rowid > ${ledger?.last ?? 0}`).pipe(Effect.orDie),
      );
      for (const migration of migrations) yield* applyMigration(db, migration);
      expect((yield* mandate.approvesLineage(parent)).own).toEqual([
        'claim_block',
        'held-elsewhere',
        'finish_block',
        'enforce_rule',
        'set_rule_delivery',
        'claim_block',
      ]);
      const savedProfile = yield* db.select({ profile: nativeThread.profile }).from(nativeThread).where(eq(nativeThread.id, parent)).get();
      expect(catalogProfileOf(savedProfile!.profile).tools).toEqual(['claim_block', 'ready_work', 'enforce_rule', 'plugin.own']);
      expect(savedProfile!.profile?.overlay.prompt).toBe(profile.overlay.prompt);
      const values = yield* db.select().from(setting);
      expect(JSON.parse(values.find((row) => row.id === saved[0]!.id)!.value!)).toEqual(['release_block', 'held-elsewhere', 'check_rules']);
      expect(JSON.parse(values.find((row) => row.id === disabled[0]!.id)!.value!)).toEqual(['format', 'artifacts']);
      expect(values.find((row) => row.id === unrelated[0]!.id)?.value).toBe(unrelated[0]!.value);
      const parentId = ((yield* operator('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const born = yield* operator('create_block', { title: 'granted work', tags: ['task'], parentId });
      const name = (born.body as { block: { name: string } }).block.name;
      expect(yield* asThread(child, 'claim_block', { blockId: name })).toMatchObject({ code: 'approval-pending' });
      const question = yield* standing(child);
      expect(question?.approver).toBe(parent);
      expect(yield* asThread(parent, 'answer_approval', { threadId: child, questionId: question!.questionId, allow: true })).toMatchObject({
        status: 'answered',
      });
      expect(yield* asThread(child, 'claim_block', { blockId: name })).toMatchObject({ block: { fields: { status: 'in_work' } } });
    }),
  );

  it.effect('setting layers and detachment reroute an open review approval before the former parent can answer', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const settings = Context.get(world.runtime.owners, Settings);
      const previous = (yield* settings.read(approves, projectId)).layers;
      yield* Effect.addFinalizer(() =>
        Effect.all([
          settings.write({ scope: 'user', key: approves.id, value: previous.user?.value, declined: previous.user?.declined }),
          settings.write({
            scope: 'project',
            projectId,
            key: approves.id,
            value: previous.project?.value,
            declined: previous.project?.declined,
          }),
        ]).pipe(Effect.orDie),
      );
      const questions = Context.get(world.runtime.owners, ThreadHarness).runs.questions();
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const births = birthsOf(world.runtime.owners);
      const parent = (yield* births.create({
        projectId,
        createdBySessionId: null,
        approvalMode: 'review',
      })).thread.id;
      const childProject = yield* world.stealthProject();
      const child = (yield* births.create({ projectId: childProject, createdBySessionId: null, parent, task: '' })).thread.id;
      const set = (scope: 'user' | 'project', value: readonly string[]) =>
        settings.write({ key: 'agent.approves', scope, projectId, value });
      const ask = (key: string) =>
        questions.approve({
          threadId: child,
          key,
          operation: 'bash',
          summary: 'Run a command',
          asked: ['review'],
          withinMs: null,
          waitMs: 0,
        });
      for (const scope of ['user', 'project'] as const) {
        yield* set(scope, ['bash']);
        expect((yield* ask(`${scope}:first`)).kind).toBe('waiting');
        const first = yield* standing(child);
        expect((yield* ask(scope)).kind).toBe('waiting');
        const question = yield* standing(child);
        expect(question?.approver).toBe(parent);
        yield* questions.answer(child, first!.questionId, []);
        yield* set(scope, []).pipe(Effect.withTracer(tracer));
        expect((yield* standing(child))?.approver).toBeUndefined();
        expect(
          yield* asThread(parent, 'answer_approval', { threadId: child, questionId: question!.questionId, allow: true }),
        ).toMatchObject({
          code: 'not-the-approver',
        });
        yield* questions.answer(child, question!.questionId, []);
      }
      const queries = [
        ...new Set(
          spans.flatMap((span) => {
            const text = span.attributes.get('db.query.text');
            return typeof text === 'string' && text.includes('open_questions') ? [text] : [];
          }),
        ),
      ];
      expect(queries.length).toBeGreaterThan(0);
      const { db } = Context.get(world.runtime.owners, MachineStore);
      for (const query of queries) {
        const plan = yield* Context.get(world.runtime.owners, MachineUnits).read((unit) =>
          unit.run(db.all<{ detail: string }>(sql.raw(`explain query plan ${query.replaceAll('?', String(projectId))}`))),
        );
        const detail = plan.map((step) => step.detail).join('\n');
        expect(detail).toContain('USING INDEX thread_entry_open_question_idx');
        expect(detail).toContain('USING INDEX native_thread_open_question_idx');
      }
      yield* set('project', ['bash']);
      expect((yield* ask('detach')).kind).toBe('waiting');
      const question = yield* standing(child);
      expect(question?.approver).toBe(parent);
      expect((yield* world.op('detach_thread', { threadId: child }, `project=${childProject}`)).status).toBe(200);
      expect((yield* standing(child))?.approver).toBeUndefined();
      expect(yield* asThread(parent, 'answer_approval', { threadId: child, questionId: question!.questionId, allow: true })).toMatchObject({
        code: 'not-the-approver',
      });
      expect((yield* world.op('detach_thread', { threadId: child, detached: false }, `project=${childProject}`)).status).toBe(200);
      expect((yield* standing(child))?.approver).toBe(parent);
      expect(yield* asThread(parent, 'answer_approval', { threadId: child, questionId: question!.questionId, allow: true })).toMatchObject({
        status: 'answered',
      });
    }),
  );
});
