import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Schema } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { COLLABORATION_OPERATIONS } from '../../../threads/contract/wire/operations/collaboration.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { heard, LIBRARY, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

const decodeSpawn = Schema.decodeUnknownEffect(knownAnswer(COLLABORATION_OPERATIONS.spawn_agent.answer));

const completed = Effect.fnUntraced(function* (report: string, runId: string) {
  const { world } = yield* ProtocolWorld;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  const units = Context.get(world.runtime.graph, MachineUnits);
  yield* until(
    Effect.map(
      units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().id, runId)).get())),
      (run) => (run?.status === 'completed' ? true : null),
    ),
    'the source turn ended',
    report,
  );
});

const OPENINGS = new Set(['session/new', 'session/load', '_tagma/fork']);

const framed = (report: string, method: string, count: number, what: string) =>
  until(
    Effect.map(heard(report), (lines) => (lines.filter((line) => line.method === method).length >= count ? lines : null)),
    what,
    report,
  );

describe.skipIf(!existsSync(LIBRARY))('a fork of a Claude Code thread on ACP', () => {
  layer(protocolWorld({ name: 'hosted-fork', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
    excludeTestServices: true,
  })('protocol world', (it) => {
    it.effect(
      'a spawn forks the source’s vendor session instead of opening a new one from the journal, and the source is named until a turn of the fork reaches the agent, then never again',
      () =>
        Effect.gen(function* () {
          const { world, projectId, agent, birth } = yield* ProtocolWorld;
          const report = yield* agent('fork');
          const source = yield* birth();
          const parent = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, approvalMode: 'bypass' }))
            .thread.id;
          yield* completed(report, (yield* turnsOf(world.runtime.owners).send(source, projectId, 'Read the module.')).runId);
          const spawn = (input: object) =>
            world.op('spawn_agent', input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(parent), [APPROVAL_WAIT_HEADER]: '0' });
          const ask = { agentId: 'tagma', task: 'HOLD UNSENT the turn and say what it does.', fork: 'all', forkFrom: source };
          const first = (yield* spawn(ask)).body;
          const answered = Schema.is(refusalSchema)(first) && first.code === 'instructions-unread' ? (yield* spawn(ask)).body : first;
          const started = yield* decodeSpawn(answered);
          if (started.status !== 'started') return yield* Effect.die(new Error(`the fork was ${started.status}`));
          const kernel = Context.get(world.runtime.owners, ThreadHarness);
          yield* Effect.addFinalizer(() => {
            const child = kernel.threads.handle(started.threadId, 'operator');
            return Effect.andThen(child.stop(), child.release()).pipe(Effect.orDie);
          });
          const prompts = yield* framed(report, 'session/prompt', 2, 'the fork reached the agent');
          expect(prompts.filter((line) => line.method === '_tagma/fork').map((line) => line.params)).toMatchObject([
            { sessionId: 'sess-1' },
          ]);
          expect(prompts.filter((line) => line.method === 'session/prompt').at(-1)?.params).toMatchObject({ sessionId: 'sess-fork' });
          const files = yield* FileSystem.FileSystem;
          const opened = () =>
            Effect.map(
              world.op('open_hosted_turn', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(started.threadId) }),
              (answer) => String((answer.body as { readonly context: string | null }).context ?? '').split(source).length - 1,
            );
          const turn = Effect.fnUntraced(function* (words: string, prompts: number) {
            yield* turnsOf(world.runtime.owners).send(started.threadId, projectId, words);
            yield* framed(report, 'session/prompt', prompts, 'the turn of the fork reached the agent');
          });
          const released = Effect.fnUntraced(function* () {
            const held = (yield* kernel.reads.snapshot(started.threadId)).latestRun?.id ?? '';
            yield* files.writeFileString(`${report}.release`, 'release');
            yield* completed(report, held);
            yield* files.remove(`${report}.release`);
          });
          expect(yield* opened()).toBe(1);
          yield* released();
          yield* turn('HOLD the turn and say it again.', 3);
          expect(yield* opened()).toBe(1);
          yield* released();
          yield* turn('HOLD the turn and say it once more.', 4);
          expect(yield* opened()).toBe(0);
        }),
    );

    it.effect(
      'a branch of a thread whose turn is going carries the conversation before that turn and opens its own session from it, leaving the turn with the source',
      () =>
        Effect.gen(function* () {
          const { world, projectId, agent, birth } = yield* ProtocolWorld;
          const report = yield* agent('branch-going');
          const source = yield* birth();
          const turns = turnsOf(world.runtime.owners);
          const first = (yield* turns.send(source, projectId, 'Read the module.')).runId;
          yield* completed(report, first);
          const going = (yield* turns.send(source, projectId, 'HOLD the turn')).runId;
          yield* framed(report, 'session/prompt', 2, 'the held turn reached the agent');
          const branched = yield* world.op('branch_thread', { threadId: source }, `project=${projectId}`);
          expect(branched.status).toBe(200);
          const child = String((branched.body as { readonly threadId: string }).threadId);
          const kernel = Context.get(world.runtime.owners, ThreadHarness);
          yield* Effect.addFinalizer(() => {
            const born = kernel.threads.handle(child, 'operator');
            return Effect.andThen(born.stop(), born.release()).pipe(Effect.orDie);
          });
          const runsIn = (threadId: string) =>
            Effect.map(kernel.reads.snapshot(threadId), (state) => state.transcript.map((entry) => entry.runId));
          expect(yield* runsIn(source)).toContain(going);
          const carried = yield* runsIn(child);
          expect(carried).toContain(first);
          expect(carried).not.toContain(going);
          yield* completed(report, (yield* turns.send(child, projectId, 'Say what it does.')).runId);
          const frames = yield* heard(report);
          const asked = frames.findIndex(
            (line) => line.method === 'session/prompt' && JSON.stringify(line.params).includes('Say what it does.'),
          );
          const opening = frames.slice(0, asked).findLast((line) => OPENINGS.has(line.method ?? ''));
          expect(opening?.method).toBe('session/new');
          expect((yield* kernel.reads.snapshot(source)).latestRun).toMatchObject({ id: going, status: 'running' });
        }),
    );

    it.effect(
      'a branch forks the vendor session under the account its source was launched under, and opens its own session from the journal once Tagma can no longer name that account',
      () =>
        Effect.gen(function* () {
          const { world, projectId, agent, birth } = yield* ProtocolWorld;
          const report = yield* agent('branch-account');
          const source = yield* birth();
          const turns = turnsOf(world.runtime.owners);
          const kernel = Context.get(world.runtime.owners, ThreadHarness);
          const db = Context.get(world.runtime.graph, MachineStore).db;
          yield* completed(report, (yield* turns.send(source, projectId, 'Read the module.')).runId);
          const launchedOn = yield* db.get<{ readonly account: string | null }>(
            sql`select json_extract(facet, '$.session.account.key') as account from external_session where id = ${source}`,
          );
          expect(launchedOn?.account).toBe('fixture-account');
          const branched = Effect.fnUntraced(function* (words: string) {
            const answer = yield* world.op('branch_thread', { threadId: source }, `project=${projectId}`);
            expect(answer.status).toBe(200);
            const child = String((answer.body as { readonly threadId: string }).threadId);
            yield* Effect.addFinalizer(() => {
              const born = kernel.threads.handle(child, 'operator');
              return Effect.andThen(born.stop(), born.release()).pipe(Effect.orDie);
            });
            yield* completed(report, (yield* turns.send(child, projectId, words)).runId);
            const frames = yield* heard(report);
            const asked = frames.findIndex((line) => line.method === 'session/prompt' && JSON.stringify(line.params).includes(words));
            return frames.slice(0, asked).findLast((line) => OPENINGS.has(line.method ?? ''));
          });
          expect((yield* branched('Say what it does.'))?.method).toBe('_tagma/fork');
          yield* db.run(
            sql`update external_session set facet = json_set(facet, '$.session.account.key', 'an-account-signed-out-since') where id = ${source}`,
          );
          expect((yield* branched('Say it again.'))?.method).toBe('session/new');
        }),
    );
  });
});
