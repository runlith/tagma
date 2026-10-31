import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { CostLedger, CurrentCost, costLedgerLayer, rootCost, type CostCause } from '@runlith/performance/CostLedger';
import { Context, Deferred, Effect, Exit, Layer, Schema } from 'effect';
import { makeAgentCalls } from '../AgentCalls';
import { callerInThread } from '../testing/caller';
import { builtinMode } from '../testing/modes';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { Tool } from '../tool';
import { openToolDoor, ToolJudge } from './openToolDoor';

it.effect('native calls own distinct roots across separate preparation and settlement, rather than inheriting the enclosing act', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(costLedgerLayer({ capacity: 8 }));
    const ledger = Context.get(context, CostLedger);
    yield* Effect.provide(
      rootCost(
        'enclosing-act',
        Effect.gen(function* () {
          const calls = yield* makeAgentCalls({ history: 2 });
          const door = openToolDoor(
            'run',
            callerInThread('thread', 'run'),
            {},
            new ToolJudge(builtinMode('trust')),
            undefined,
            undefined,
            undefined,
            undefined,
            calls,
          );
          yield* Effect.addFinalizer(() => door.close());
          for (const toolCallId of ['first', 'second']) {
            let claimed: CostCause | null = null;
            let prepared: CostCause | null = null;
            const tool = Tool.make({
              display: () => ({ form: 'none' }),
              approval: ASKS_NEVER,
              description: 'Observe the call cause.',
              parameters: Schema.Struct({}),
              claims: () =>
                Effect.map(CurrentCost, (cause) => {
                  claimed = cause;
                  return [];
                }),
              prepare: () =>
                Effect.map(CurrentCost, (cause) => {
                  prepared = cause;
                  return { subjects: [] };
                }),
              execute: () => Effect.map(CurrentCost, (cause) => ({ same: cause !== null && cause === prepared && cause === claimed })),
            });
            const call = { name: 'native-meter', tool, input: {}, options: { toolCallId, messages: [] } };
            yield* door.claims({ name: call.name, tool, input: {}, toolCallId });
            const attended = yield* door.attend(call);
            if (attended.kind !== 'prepared') return yield* Effect.die('the native call must finish preparation before settlement');
            const result = yield* door.settle(call, attended.prepared);
            expect(result.output).toEqual({ same: true });
          }
          const hosting = openToolDoor(
            'hosted-run',
            callerInThread('thread', 'hosted-run'),
            {},
            new ToolJudge(builtinMode('trust')),
            undefined,
            undefined,
            undefined,
            undefined,
            calls,
            undefined,
            undefined,
            undefined,
            0,
            false,
            [],
            undefined,
            'hosted',
          );
          yield* Effect.addFinalizer(() => hosting.close());
          const enclosing = yield* CurrentCost;
          let hostedClaim: CostCause | null = null;
          let hostedPreparation: CostCause | null = null;
          const hosted = Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Observe the hosted cause.',
            parameters: Schema.Struct({}),
            claims: () =>
              Effect.map(CurrentCost, (cause) => {
                hostedClaim = cause;
                return [];
              }),
            prepare: () =>
              Effect.map(CurrentCost, (cause) => {
                hostedPreparation = cause;
                return { subjects: [] };
              }),
            execute: () =>
              Effect.map(CurrentCost, (cause) => ({ same: cause === enclosing && cause !== hostedClaim && cause === hostedPreparation })),
          });
          const call = { name: 'hosted-meter', tool: hosted, input: {}, options: { toolCallId: 'hosted', messages: [] } };
          yield* rootCost('earlier-request', hosting.claims({ name: call.name, tool: hosted, input: {}, toolCallId: 'hosted' })).pipe(
            Effect.provideService(CurrentCost, null),
          );
          const attended = yield* hosting.attend(call);
          if (attended.kind !== 'prepared') return yield* Effect.die('the hosted call must finish preparation before settlement');
          expect((yield* hosting.settle(call, attended.prepared)).output).toEqual({ same: true });
        }),
      ),
      context,
    );
    expect(ledger.read({ limit: 8 }).total).toBe(4);
    const roots = ledger.read({ limit: 8 }).rows.filter((row) => row.name === 'native-meter');
    expect(roots).toHaveLength(2);
    expect(new Set(roots.map((row) => row.id)).size).toBe(2);
    expect(roots.every((row) => row.endedAt !== null)).toBe(true);
  }),
);

it.effect('a native root stays open after its background receipt and carries preparation, resource release and late delivery', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(costLedgerLayer({ capacity: 8 }));
    const ledger = Context.get(context, CostLedger);
    yield* Effect.provide(
      Effect.gen(function* () {
        const calls = yield* makeAgentCalls({ history: 1 });
        const preparing = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const delivered = yield* Deferred.make<{ readonly same: boolean; readonly output: unknown }>();
        let claimed: CostCause | null = null;
        let prepared: CostCause | null = null;
        let retained: CostCause | null = null;
        let released: CostCause | null = null;
        const tool = Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: 'Prepare in the background.',
          parameters: Schema.Struct({}),
          mutates: true,
          claims: () =>
            Effect.map(CurrentCost, (cause) => {
              claimed = cause;
              return [];
            }),
          prepare: () =>
            Effect.flatMap(CurrentCost, (cause) => {
              prepared = cause;
              return Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ subjects: [] }));
            }),
          execute: () =>
            Effect.map(CurrentCost, (cause) => ({ same: cause !== null && cause === claimed && cause === prepared && cause === retained })),
        });
        const door = openToolDoor(
          'run',
          callerInThread('thread', 'run'),
          {},
          new ToolJudge(builtinMode('trust')),
          undefined,
          undefined,
          undefined,
          undefined,
          calls,
          () => ({
            retain: () =>
              Effect.map(CurrentCost, (cause) => {
                retained = cause;
                return {
                  release: Effect.map(CurrentCost, (cause) => {
                    released = cause;
                  }),
                };
              }),
            detaching: () => Effect.void,
            asking: () => Effect.succeed({ allowed: true }),
            completed: (_call, exit) =>
              Effect.flatMap(CurrentCost, (cause) =>
                Deferred.succeed(delivered, {
                  same: cause !== null && cause === prepared && cause === released,
                  output: Exit.isSuccess(exit) ? exit.value.output : null,
                }),
              ),
          }),
        );
        yield* Effect.addFinalizer(() => door.close());
        const call = { name: 'native-background', tool, input: { background: true }, options: { toolCallId: 'background', messages: [] } };
        yield* rootCost(
          'enclosing-act',
          Effect.gen(function* () {
            yield* door.claims({ name: call.name, tool, input: call.input, toolCallId: 'background' });
            expect(yield* door.attend(call)).toMatchObject({ kind: 'answered', outcome: { output: { status: 'background' } } });
          }),
        );
        yield* Deferred.await(preparing);
        expect(ledger.read({ limit: 8 }).rows.find((row) => row.name === call.name)?.endedAt).toBeNull();
        yield* Deferred.succeed(release, undefined);
        expect(yield* Deferred.await(delivered)).toEqual({ same: true, output: { same: true } });
        yield* calls.get({ runId: 'run', toolCallId: 'background' })!.settled;
        expect(ledger.read({ limit: 8 }).rows.find((row) => row.name === call.name)?.endedAt).not.toBeNull();
      }),
      context,
    );
  }),
);
