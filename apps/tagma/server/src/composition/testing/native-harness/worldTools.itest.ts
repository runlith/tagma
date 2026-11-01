import { callerInThread } from '../callers';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import type { Tool } from '@runlith/agent/tool';
import { ToolAnswer, toolExecute, toolSettleEffect } from '@runlith/agent/tool';
import { unruledTimes, type CommandRun, type CommandWork } from '@runlith/agent-tools/CommandWork';
import type { CallDecisionAnswer } from '@runlith/executions/protocol/call';
import type { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { Deferred, Effect, Fiber, FileSystem, Stream } from 'effect';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { landedOf } from '@runlith/agent-tools/WorkspaceChanges';
import { GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { testGrantSigner, threadOfGrant } from '../../../platform/testing/grants.js';
import { SHIPPED_HARNESSES, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { checkoutWorld, makeMachineWorld } from '../../../executions/testing/doubles.js';
import type { ThreadWorld } from '../../../executions/contract/service/worlds.js';
import { asThreadContext, worldTools } from '../../../native-harness/testing/doubles.js';

const unrecorded = {
  changes: () => ({
    land: <E, R>(_changes: readonly unknown[], write: Effect.Effect<boolean, E, R>) =>
      Effect.map(write, (written) => landedOf(written, false)),
    landEach: <E, R>(_changes: readonly unknown[], write: Effect.Effect<readonly boolean[], E, R>) =>
      Effect.map(write, (written) => written.map((one) => landedOf(one, false))),
    command: () => Effect.succeed(null),
  }),
};

const context = (threadId: string, root: string) =>
  asThreadContext({
    thread: { id: threadId, model: null, authority: { mode: 'trust', bypassFrom: null } },
    world: checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: makeMachineWorld(() => null) }),
    projectId: 1,
    projectRoot: root,
    machine: null,
    origin: null,
    settings: { value: () => Effect.succeed('shared') },
    commandTimes: unruledTimes,
    identity: sessionIdentity,
    grants: testGrantSigner,
    changeRecord: unrecorded,
    checkoutFlights: new CheckoutFlights(),
  });

const answerOf = Effect.fnUntraced(function* (tool: Tool, thread: string, command: string, toolCallId = 'call-1', waitMs?: number) {
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('bash declares no execute');
  const answer = yield* execute(
    { command, description: 'Read command facts', waitMs },
    { toolCallId, caller: callerInThread(thread, 'run-1'), messages: [], prepared: null },
  );
  if (!(answer instanceof ToolAnswer)) return yield* Effect.die('bash returned no ToolAnswer');
  return answer;
});

const environment = (key: string, value: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env[key];
      process.env[key] = value;
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }),
  );

const cannedWork = (exit: number, started: Effect.Effect<void> = Effect.void, ending: 'ended' | 'running' = 'ended'): CommandWork => ({
  retainedBytes: 4096,
  startedBy: () => Effect.succeed(null),
  start: (request, observe) => {
    const execution = { installation: 'install-test', execution: 'exec-test', incarnation: 1 } as ExecutionRef;
    const run: CommandRun = {
      operation: { installation: 'install-test', operation: request.operation } as HostRequestRef,
      execution,
      deadline: { state: 'none' },
      standing: Effect.succeed({ state: 'none' }),
      revise: () => Effect.succeed({ state: 'refused' as const, reason: 'this stub answers one canned ending and moves no deadline' }),
      background: Effect.succeed('moved'),
      foreground: Effect.succeed('withdrawn'),
      measured: () => Effect.void,
      inspect: 'the test reads nothing',
      phase: Effect.succeed(ending),
      result: (ending === 'running' ? Effect.andThen(started, Effect.never) : Effect.void).pipe(
        Effect.as({
          _tag: 'Decided',
          decision: {
            _tag: 'Completed',
            operation: { installation: 'install-test', operation: request.operation } as HostRequestRef,
            execution,
            sequence: 0,
          },
          nativeExit: { _tag: 'Code', code: exit },
          sources: {
            stdout: { completed: true, offset: byteOffset(0n) },
            stderr: { completed: true, offset: byteOffset(0n) },
          },
          cleanup: 'complete',
          retention: 'retained',
          cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the test decides no cost' },
        } satisfies CallDecisionAnswer),
      ),
      stdout: Stream.empty,
      stderr: Stream.empty,
    };
    return Effect.succeed({ run, observed: observe(run) });
  },
});

layer(BunFileSystem.layer, { excludeTestServices: true })('world tools', (it) => {
  it.effect('a command of a thread on the checkout carries that thread and no other harness', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-world-tools-' });
      const thread = '01a07000-0000-7000-8000-0000000000c1';
      const inherited = SHIPPED_HARNESSES.find((entry) => entry.variable !== undefined)?.variable;
      if (inherited === undefined) return yield* Effect.die('the harness catalog declares no environment variable');
      yield* environment(inherited, 'a-transcript-of-the-server');
      const bash = worldTools(context(thread, root), { web: false }).bash as Tool;
      const answer = yield* answerOf(bash, thread, `printf '%s|%s' "$${GRANT_VARIABLE}" "$${inherited}"`);
      const [carried, foreign] = String(answer.value).trim().split('|');
      expect(threadOfGrant(String(carried))).toBe(thread);
      expect(foreign).toBe('');
    }),
  );

  it.effect('a bash answer names the substrate its world was built with, and none where none was named', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-world-tools-substrate-' });
      const thread = '01a07000-0000-7000-8000-0000000000c3';
      const factsOf = Effect.fnUntraced(function* (world: ThreadWorld) {
        const catalog = worldTools(asThreadContext({ ...context(thread, root), world }), { web: false });
        return (yield* answerOf(catalog.bash as Tool, thread, 'true')).display?.details ?? [];
      });
      const platform = yield* factsOf(
        checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: makeMachineWorld(() => null) }),
      );
      expect(platform.find((fact) => fact.label === 'world')?.value).toBe('platform');
      const { substrate: _dropped, ...unnamed } = checkoutWorld({
        projectRoot: root,
        scratch: join(root, 'scratch'),
        world: makeMachineWorld(() => null),
      });
      expect((yield* factsOf(unnamed)).some((fact) => fact.label === 'world')).toBe(false);
    }),
  );

  it.effect('an answer settled after an interrupted call, and a receipt answered for it, carry the substrate too', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-world-tools-settled-' });
      const thread = '01a07000-0000-7000-8000-0000000000c4';
      const caller = callerInThread(thread, 'run-1');
      const base = checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: makeMachineWorld(() => null) });
      const bashOf = (work: CommandWork) =>
        worldTools(asThreadContext({ ...context(thread, root), world: { ...base, world: { ...base.world, commandWork: work } } }), {
          web: false,
        }).bash as Tool;

      const admitted = yield* Deferred.make<void>();
      const hanging = bashOf(cannedWork(0, Deferred.succeed(admitted, undefined), 'running'));
      const input = { command: 'sleep 60', description: 'Run past its call' };
      const fiber = yield* Effect.forkScoped(answerOf(hanging, thread, input.command, 'call-late'));
      yield* Deferred.await(admitted);
      yield* Fiber.interrupt(fiber);
      const settling = toolSettleEffect(hanging, { toolCallId: 'call-late', caller, toolInput: input });
      const settlement = settling === null ? null : yield* settling;
      expect(settlement?.status).toBe('completed');
      const output = settlement?.status === 'completed' ? (settlement.output as ToolAnswer) : null;
      expect(output?.display?.details?.find((fact) => fact.label === 'world')?.value).toBe('platform');
      const receipt = hanging.receipt?.({ toolCallId: 'call-late', caller });
      expect(receipt?.display?.details?.find((fact) => fact.label === 'world')?.value).toBe('platform');

      const background = yield* answerOf(bashOf(cannedWork(0)), thread, 'true', 'call-background', 0);
      expect(background.completion).toBe('command');
    }),
  );

  it.effect('a command of a world nobody else writes carries no grant at all', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-world-tools-unmeasured-' });
      const thread = '01a07000-0000-7000-8000-0000000000c2';
      const unmeasured = {
        ...(context(thread, root) as unknown as Record<string, unknown>),
        world: {
          ...checkoutWorld({ projectRoot: root, scratch: join(root, 'scratch'), world: makeMachineWorld(() => null) }),
          kind: 'sandbox',
          facts: { shared: false, history: false, network: false },
        },
      } as unknown as ReturnType<typeof asThreadContext>;
      yield* environment(GRANT_VARIABLE, 'a-grant-of-the-shell-this-server-was-started-from');
      const bash = worldTools(unmeasured, { web: false }).bash as Tool;
      const answer = yield* answerOf(bash, thread, `printf '%s|%s' "$${GRANT_VARIABLE}" ran`);
      const [carried, ran] = String(answer.value).trim().split('|');
      expect(carried).toBe('');
      expect(ran).toBe('ran');
    }),
  );
});
