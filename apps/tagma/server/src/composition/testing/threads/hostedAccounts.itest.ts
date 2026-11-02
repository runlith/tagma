import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { RunAdmission, makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { WorkSpells } from '../../../thread-record/contract/service/spells.js';
import { HarnessMoves } from '../../../threads/contract/service/harness.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import { ThreadRunning } from '../../../threads/contract/service/reads.js';
import { ThreadRebinding } from '../../../threads/contract/service/rebinding.js';
import { birthsOf, thread, harnessMoves } from '../../../threads/testing/doubles.js';
import { VendorTurns } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

layer(doorFixture(), { excludeTestServices: true })('hosted account world', (it) => {
  it.effect(
    'hosted account changes release the pinned process between turns, preserve its vendor session, and leave model-only changes pinned',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const projectId = yield* world.stealthProject();
        yield* projectLeaving(world, projectId);
        const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
        const selection = { provider: 'claude-code', model: 'claude-sonnet-5-5', reasoning: 'high' };
        yield* Context.get(world.runtime.owners, HarnessMoves).move(threadId, { ...selection, account: 'account-a' });
        const { db } = Context.get(world.runtime.graph, MachineStore);
        const units = Context.get(world.runtime.graph, MachineUnits);
        const read = () => units.read((unit) => unit.run(db.select().from(thread()).where(eq(thread().id, threadId)).get()));
        expect((yield* read())?.account).toBe('account-a');
        const sessions = yield* sessionStoreOver(
          db,
          units,
          Context.get(world.runtime.owners, WorkSpells),
          Context.get(world.runtime.owners, ThreadRecords),
          Context.get(world.runtime.owners, ModelChanges),
          () => Effect.void,
        );
        yield* sessions.open(threadId, '', 'fixture', () => Effect.succeed(null));
        yield* sessions.change(threadId, (facet) =>
          Effect.succeed({
            facet: {
              ...facet,
              sessionKey: 'vendor-session',
              session:
                facet.session === undefined
                  ? undefined
                  : {
                      ...facet.session,
                      state: 'running',
                      account: { provider: selection.provider, key: 'account-a' },
                    },
            },
            value: undefined,
          }),
        );
        const turns = new VendorTurns(db, units);
        yield* units.write(turns.writes, (unit) => turns.record(unit, threadId, [{ run: 'kept-turn', address: 'prompt-a', last: null }]));
        let process: string | null = 'process-a';
        let running = true;
        const currentRuns = Context.get(world.runtime.owners, ThreadRunning);
        const { models } = yield* Context.get(world.runtime.owners, ProviderRegistry).catalog;
        const moves = yield* harnessMoves({
          models: () => models,
          handed: () => Effect.void,
          releasing: Effect.fnUntraced(function* () {
            yield* sessions.change(threadId, (facet) =>
              Effect.succeed({
                facet: { ...facet, session: facet.session === undefined ? undefined : { ...facet.session, state: 'ended' } },
                value: undefined,
              }),
            );
            process = null;
            return 'stopped' as const;
          }),
        }).pipe(
          Effect.provideService(RunAdmission, makeLandingHolds()),
          Effect.provideService(
            ThreadRebinding,
            ThreadRebinding.of({
              writes: writes('testing.unusedRebinding', []),
              prepare: () => Effect.die('same-road move never rebinds'),
            }),
          ),
          Effect.provideService(
            ThreadRunning,
            ThreadRunning.of({ ...currentRuns, runningRunOf: () => Effect.succeed(running ? 'held-run' : null) }),
          ),
          Effect.provide(world.runtime.owners),
          Effect.provide(world.runtime.graph),
        );
        yield* moves.move(threadId, selection);
        expect((yield* read())?.account).toBe('account-a');
        expect(process).toBe('process-a');
        expect((yield* sessions.read(threadId))?.session?.account?.key).toBe('account-a');
        expect(yield* Effect.flip(moves.move(threadId, { ...selection, account: 'account-b' }))).toMatchObject({ code: 'thread-running' });
        expect((yield* read())?.account).toBe('account-a');
        running = false;
        yield* moves.move(threadId, { ...selection, account: 'account-b' });
        expect(process).toBeNull();
        expect((yield* read())?.account).toBe('account-b');
        expect(yield* sessions.read(threadId)).toMatchObject({ sessionKey: 'vendor-session', session: { state: 'ended' } });
        expect((yield* sessions.read(threadId))?.session?.account).toBeUndefined();
        expect(yield* turns.turn(threadId, 'kept-turn')).toMatchObject({ address: 'prompt-a' });
        yield* moves.move(threadId, { ...selection, account: null });
        expect((yield* read())?.account).toBeNull();
        yield* Context.get(world.runtime.owners, HarnessMoves).move(threadId, {
          provider: 'openai-oauth',
          model: 'gpt-6.1-sol',
          reasoning: 'high',
          account: 'native-account',
        });
        expect((yield* read())?.account).toBe('native-account');
      }),
  );
});
