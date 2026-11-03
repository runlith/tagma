import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Deferred, Effect, FileSystem, Stream } from 'effect';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { harnessMoves, thread, threadRun, turnsOf } from '../../../threads/testing/doubles.js';
import { claudeLogin, nativeLeads } from '../claudeLogin.js';
import { heard, until } from './protocolRig.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';
import { windowChannel } from './windowChannel.js';

const CARRY = 'Carry ORBIT-9 across the move.';
const QUEUED = 'Then answer QUASAR-4.';
const HOSTED = { provider: 'claude-code', model: 'claude-opus-5-5', reasoning: null } as const;
const entered = Deferred.makeUnsafe<void>();
const released = Deferred.makeUnsafe<void>();
const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const answer = (id: string, text: string): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id },
  { type: 'text-delta', id, text },
  { type: 'text-end', id },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];
const read: readonly LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: 'call_orbit', name: 'read' },
  { type: 'tool-call', id: 'call_orbit', name: 'read', input: { path: 'orbit.txt' } },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];

describe('the operator’s model pick is the server’s to carry', () => {
  layer(
    protocolWorld({
      name: 'pick-carry',
      prepare: (world) => Effect.flatMap(claudeLogin(world), (account) => nativeLeads(world, account)),
      models: (standing) => ({
        ...standing,
        request: (selection) => ({
          ...standing.request(selection),
          text: () => Effect.die('the pick model only streams'),
          object: () => Effect.die('the pick model only streams'),
          stream: (input) =>
            Stream.suspend(() => {
              if (!JSON.stringify(input.messages).includes(CARRY)) return Stream.fromIterable(answer('other', 'Nothing to do.'));
              if (input.messages.at(-1)?.role === 'tool') return Stream.fromIterable(answer('native', 'Still native.'));
              return Stream.fromEffect(Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(released))).pipe(
                Stream.flatMap(() => Stream.fromIterable(read)),
              );
            }),
        }),
      }),
    }),
    { excludeTestServices: true },
  )('protocol world', (it) => {
    it.effect(
      'a pick to another road answers at once, and the running turn stops at its next step and continues there with the word sent after it',
      () =>
        Effect.gen(function* () {
          const { world, projectId, checkout, agent, birth } = yield* ProtocolWorld;
          yield* (yield* FileSystem.FileSystem).writeFileString(join(checkout, 'orbit.txt'), 'ORBIT-9');
          const report = yield* agent('pick');
          const threadId = yield* birth();
          const db = Context.get(world.runtime.graph, MachineStore).db;
          const units = Context.get(world.runtime.graph, MachineUnits);
          const runsOf = () =>
            units.read((unit) => unit.run(db.select().from(threadRun()).where(eq(threadRun().threadId, threadId)).all()));
          const turns = turnsOf(world.runtime.owners);
          const carried = (yield* turns.send(threadId, projectId, CARRY)).runId;
          yield* Deferred.await(entered);
          const window = yield* windowChannel(world);
          const picked = yield* window['thread.model']({ projectId, threadId, params: { ...HOSTED, switches: {} } });
          expect(picked).toMatchObject({ snapshot: { thread: HOSTED } });
          expect((yield* runsOf()).find((run) => run.id === carried)?.status).toBe('running');
          yield* turns.send(threadId, projectId, QUEUED);
          yield* Deferred.succeed(released, undefined);
          yield* until(
            Effect.map(runsOf(), (runs) => runs.find((run) => run.id !== carried && run.status === 'completed') ?? null),
            'the carried turn continued on Claude Code',
            report,
          );
          expect((yield* runsOf()).find((run) => run.id === carried)).toMatchObject({ status: 'aborted', settledBy: 'model' });
          const prompted = (yield* heard(report)).filter((line) => line.method === 'session/prompt');
          expect(JSON.stringify(prompted.map((line) => line.params))).toContain('QUASAR-4');
          expect(
            yield* db
              .select({ provider: thread().provider, model: thread().model, pending: thread().pendingModel })
              .from(thread())
              .where(eq(thread().id, threadId))
              .get(),
          ).toEqual({ provider: HOSTED.provider, model: HOSTED.model, pending: null });
        }),
    );

    it.effect('a pick still waiting when the server stopped lands once the next server starts', () =>
      Effect.gen(function* () {
        const { world, birth } = yield* ProtocolWorld;
        const threadId = yield* birth();
        const db = Context.get(world.runtime.graph, MachineStore).db;
        yield* db
          .update(thread())
          .set({ pendingModel: { id: 'waiting-pick', ...HOSTED, account: null, switches: {} } })
          .where(eq(thread().id, threadId));
        const kernel = Context.get(world.runtime.owners, ThreadHarness);
        const { models } = yield* Context.get(world.runtime.owners, ProviderRegistry).catalog;
        yield* harnessMoves({
          harness: Effect.succeed(kernel),
          releasing: (id) => kernel.threads.handle(id, 'operator').release(),
          handed: (id) => kernel.threads.publish(id),
          models: () => models,
        }).pipe(Effect.provide(world.runtime.owners), Effect.provide(world.runtime.graph));
        yield* world.runtime.openMaintenance;
        const landed = yield* until(
          Effect.map(
            db
              .select({ provider: thread().provider, pending: thread().pendingModel })
              .from(thread())
              .where(eq(thread().id, threadId))
              .get(),
            (row) => (row?.pending === null ? row : null),
          ),
          'the waiting pick landed',
        );
        expect(landed).toEqual({ provider: HOSTED.provider, pending: null });
      }),
    );
  });
});
