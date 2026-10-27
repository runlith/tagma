import { callerInThread, unthreadedCaller } from './testing/caller';
import { makeAgentCalls } from '@runlith/agent/AgentCalls';
import { openToolDoor } from '@runlith/agent/door/openToolDoor';
import type { AgentToolOutputs } from '@runlith/agent/ToolOutput';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtemp, rm } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import type { Tool, ToolVerdict } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { CallExecutionControl } from '@runlith/agent/callProgress';
import { ToolAnswer, ToolFailed, toolExecute, toolPrepare, toolSettleEffect } from '@runlith/agent/tool';
import { Deferred, Duration, Effect, Exit, Fiber, FileSystem, Queue, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ChildProcess } from 'effect/process';
import type { CallDecisionAnswer } from '@runlith/executions/protocol/call';
import type { Cleanup, ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { type StoppableProgress, stoppableProgress } from './testing/progress';

import { createTools } from './index';
import { machineWorld } from './world/machine';
import {
  CommandRefused,
  CommandUnreadable,
  cleanupWords,
  type CommandAsk,
  type CommandLimit,
  type CommandTimes,
  type CommandAcceptance,
  type CommandPhase,
  type CommandRequest,
  type CommandRun,
  type CommandRunDeadline,
  type CommandWork,
  type KeptOutput,
  type RuledAnswer,
} from './CommandWork';
import { exists, host, options, recorder } from './testing/toolHarness';

const gitInit = (cwd: string) =>
  Effect.promise(() => new Promise<void>((resolve) => execFile('git', ['init', '-q'], { cwd }, () => resolve())));

const createTempDir = () =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp('/tmp/runlith-commandwork-')),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );

const fileHolds = Effect.fnUntraced(function* (path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  const moved = yield* Queue.unbounded<void>();
  yield* Effect.acquireRelease(
    Effect.try(() =>
      watch(dirname(path), () => {
        Queue.offerUnsafe(moved, undefined);
      }),
    ),
    (watcher) => Effect.sync(() => watcher.close()),
  );
  for (;;) {
    if ((yield* files.exists(path)) && (yield* files.readFileString(path)) === text) return;
    yield* Queue.take(moved);
  }
}, Effect.provide(BunFileSystem.layer));

const commandGate = Effect.fnUntraced(function* (root: string) {
  const path = join(root, `gate-${crypto.randomUUID()}`);
  yield* Effect.promise(
    () => new Promise<void>((resolve, reject) => execFile('mkfifo', [path], (error) => (error ? reject(error) : resolve()))),
  );
  return { wait: `read gate < ${JSON.stringify(path)}`, open: host.writeFile(path, 'go\n') };
});

const installation = 'install-1' as ExecutionRef['installation'];

const refOf = (n: number): ExecutionRef => ({ installation, execution: `exec-${n}`, incarnation: 1 }) as ExecutionRef;

type FakeOwner = {
  readonly work: CommandWork;
  readonly starts: () => number;
  readonly requests: () => readonly CommandRequest[];
  readonly entered: Deferred.Deferred<void>;
  readonly awaited: Deferred.Deferred<void>;
  readonly concluded: Deferred.Deferred<void>;
  readonly exited: Deferred.Deferred<void>;
  readonly admitted: Deferred.Deferred<void>;
  readonly stopped: Deferred.Deferred<void>;
  readonly stops: () => readonly ExecutionRef[];
  readonly backgrounded: () => readonly string[];
  readonly foregrounded: () => readonly string[];
  readonly measurements: () => readonly string[];
  readonly closeAll: () => Effect.Effect<void>;
};

type FakeOptions = {
  readonly refuses?: string;
  readonly uncertain?: boolean;
  readonly deadlineMs?: number;
  readonly standing?: CommandRunDeadline;
  readonly settleBeforeAccept?: boolean;
  readonly withdrawal?: 'withdrawn' | 'delivered';
  readonly phaseFails?: boolean;
  readonly decide?: (execution: ExecutionRef, operation: HostRequestRef) => CallDecisionAnswer | undefined;
  readonly startGate?: Deferred.Deferred<void>;
  readonly queueGate?: Deferred.Deferred<void>;
  readonly backgroundGate?: Deferred.Deferred<void>;
  readonly failStream?: 'stdout' | 'stderr';
  readonly stopOnSignal?: boolean;
  readonly stopGate?: Deferred.Deferred<void>;
  readonly kept?: KeptOutput;
};

const builtOwner = Effect.fnUntraced(function* (options: FakeOptions) {
  let started = 0;
  const requests: CommandRequest[] = [];
  const open: Array<Scope.Closeable> = [];
  const entered = yield* Deferred.make<void>();
  const awaited = yield* Deferred.make<void>();
  const concluded = yield* Deferred.make<void>();
  const exited = yield* Deferred.make<void>();
  const admitted = yield* Deferred.make<void>();
  const stopped = yield* Deferred.make<void>();
  const stops: ExecutionRef[] = [];
  const backgrounded: string[] = [];
  const foregrounded: string[] = [];
  const measurements: string[] = [];
  const work: CommandWork = {
    retainedBytes: 4096,
    start: Effect.fnUntraced(
      function* <A>(request: CommandRequest, observe: (run: CommandRun) => Effect.Effect<A>) {
        started += 1;
        requests.push(request);
        yield* Deferred.succeed(entered, undefined);
        if (options.startGate !== undefined) yield* Deferred.await(options.startGate);
        if (options.refuses !== undefined) {
          return yield* new CommandRefused({ reason: options.refuses, certainty: 'unsubmitted' });
        }
        if (options.uncertain === true) {
          return yield* new CommandRefused({
            reason: 'the reply to this launch was lost',
            certainty: 'uncertain',
            operation: { installation, operation: request.operation },
          });
        }
        const scope = yield* Scope.make();
        open.push(scope);
        const execution = refOf(started);
        let mode: 'foreground' | 'background' = request.waitMs === 0 ? 'background' : 'foreground';
        const operation = { installation, operation: request.operation };
        const handle = yield* ChildProcess.make(request.program, [...request.args], {
          cwd: request.cwd,
          env: request.env,
          extendEnv: true,
          stdin: 'ignore',
          detached: true,
        }).pipe(Scope.provide(scope));
        const ended = yield* Deferred.make<void>();
        const result: Effect.Effect<RuledAnswer, CommandUnreadable> = handle.exitCode.pipe(
          Effect.map(
            (code): RuledAnswer =>
              options.decide?.(execution, operation) ?? {
                _tag: 'Decided',
                decision: { _tag: 'Completed', operation, execution, sequence: 0 },
                nativeExit: { _tag: 'Code', code },
                sources: {
                  stdout: { completed: true, offset: 0n as never },
                  stderr: { completed: true, offset: 0n as never },
                },
                cleanup: 'complete',
                retention: 'retained',
                cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the fake owner measures nothing' },
                kept: options.kept,
              },
          ),
          Effect.catchCause(() =>
            Effect.succeed(
              options.decide?.(execution, operation) ?? {
                _tag: 'Unavailable' as const,
                operation,
                execution,
                reason: 'the child died by a signal this fake does not name',
              },
            ),
          ),
          Effect.tap(() => Deferred.succeed(ended, undefined)),
          Effect.tap(() => Deferred.succeed(exited, undefined)),
        );
        const phase: Effect.Effect<CommandPhase, CommandUnreadable> =
          options.phaseFails === true
            ? Effect.fail(new CommandUnreadable({ reason: 'the host could not be read' }))
            : options.queueGate === undefined
              ? Deferred.isDone(ended).pipe(Effect.map((done): CommandPhase => (done ? 'ended' : 'running')))
              : Deferred.isDone(options.queueGate).pipe(
                  Effect.flatMap((slotted) =>
                    !slotted
                      ? Effect.succeed('queued' as const)
                      : Deferred.isDone(ended).pipe(Effect.map((done): CommandPhase => (done ? 'ended' : 'running'))),
                  ),
                );
        const slotted = options.queueGate === undefined ? true : yield* Deferred.isDone(options.queueGate);
        const deadline: CommandRunDeadline =
          options.deadlineMs === undefined
            ? { state: 'none' }
            : !slotted
              ? { state: 'unarmed', timeoutMs: options.deadlineMs, origin: 'default' }
              : { state: 'armed', timeoutMs: options.deadlineMs, origin: 'default' };
        const run: CommandRun = {
          operation,
          execution,
          deadline,
          standing: Effect.succeed(options.standing ?? deadline),
          revise: () =>
            Effect.succeed({
              state: 'refused' as const,
              reason: 'this owner resolves no policy, so no deadline of its may be moved',
            }),
          background: Effect.andThen(
            options.backgroundGate === undefined ? Effect.void : Deferred.await(options.backgroundGate),
            Effect.sync(() => {
              if (mode === 'background') return 'already' as const;
              mode = 'background';
              backgrounded.push(execution.execution);
              return 'moved' as const;
            }),
          ),
          foreground: Effect.sync(() => {
            mode = 'foreground';
            foregrounded.push(execution.execution);
            return options.withdrawal ?? ('withdrawn' as const);
          }),
          measured: (words) => Effect.sync(() => measurements.push(words)),
          inspect: `tagma command read --execution ${execution.execution} --incarnation ${execution.incarnation} — and wait, stop or limit the same reference; a mutation carries an --id of its own`,
          phase,
          result,
          stdout:
            options.failStream === 'stdout'
              ? Stream.fail(new CommandUnreadable({ reason: 'the record evicted bytes this reader had not reached' }))
              : handle.stdout.pipe(Stream.mapError(() => new CommandUnreadable({ reason: 'stdout' }))),
          stderr:
            options.failStream === 'stderr'
              ? Stream.fail(new CommandUnreadable({ reason: 'the record evicted bytes this reader had not reached' }))
              : handle.stderr.pipe(Stream.mapError(() => new CommandUnreadable({ reason: 'stderr' }))),
        };
        const settled = yield* Deferred.make<A, CommandUnreadable>();
        yield* Effect.forkIn(
          observe(run).pipe(
            Effect.flatMap((value) => Deferred.succeed(settled, value)),
            Effect.andThen(Deferred.succeed(concluded, undefined)),
          ),
          scope,
        );
        yield* Scope.addFinalizer(
          scope,
          Effect.ignore(Deferred.fail(settled, new CommandUnreadable({ reason: 'the observation was released with its owner' }))),
        );
        if (options.settleBeforeAccept === true) yield* Deferred.await(settled).pipe(Effect.ignore);
        if (options.stopOnSignal === true && request.stop !== undefined) {
          const stop = request.stop;
          yield* Effect.forkIn(
            Effect.gen(function* () {
              yield* stop.stopping;
              stops.push(execution);
              yield* Deferred.succeed(stopped, undefined);
              if (options.stopGate !== undefined) yield* Deferred.await(options.stopGate);
              yield* handle.kill({ forceKillAfter: Duration.millis(100) }).pipe(Effect.catch(() => Effect.void));
            }),
            scope,
          );
        }
        yield* Deferred.succeed(admitted, undefined);
        return {
          run,
          observed: Effect.andThen(Deferred.succeed(awaited, undefined), Deferred.await(settled)),
        } satisfies CommandAcceptance<A>;
      },
      Effect.provide(machineWorld.exec),
      Effect.provide(BunFileSystem.layer),
      Effect.catchTag('PlatformError', (failure) =>
        Effect.fail(new CommandRefused({ reason: `the child could not be started: ${failure.message}`, certainty: 'unsubmitted' })),
      ),
    ),
  };
  return {
    work,
    starts: () => started,
    requests: () => requests,
    entered,
    awaited,
    concluded,
    exited,
    admitted,
    stopped,
    stops: () => stops,
    backgrounded: () => backgrounded,
    foregrounded: () => foregrounded,
    measurements: () => measurements,
    closeAll: () =>
      Effect.forEach(open.splice(0), (scope) => Effect.ignore(Scope.close(scope, Effect.void as never)), {
        discard: true,
      }),
  } satisfies FakeOwner;
});

const fakeOwner = (options: FakeOptions = {}) => Effect.acquireRelease(builtOwner(options), (owner) => owner.closeAll());

const worldWith = (work: CommandWork) => ({ ...machineWorld, commandWork: work });

const settleOf = Effect.fnUntraced(function* (tool: Tool, call: Parameters<typeof toolSettleEffect>[1]) {
  const settling = toolSettleEffect(tool, call);
  return settling === null ? null : yield* settling;
});

function shellOf(tools: Partial<Record<'bash', Tool>>): Tool {
  const bash = tools.bash;
  if (bash === undefined) throw new Error('This world binds a filesystem and a spawner, so it has a shell.');
  return bash;
}

function shellCall(tool: Tool, input: unknown, toolCallId: string): Effect.Effect<unknown, ToolFailed> {
  const execute = toolExecute(tool);
  if (!execute) throw new Error('The tool declares no execute.');
  const prepare = toolPrepare(tool);
  const prepared =
    prepare === null
      ? Effect.succeed(undefined)
      : Effect.map(prepare(input, { toolCallId, caller: unthreadedCaller }), (made) => made.prepared);
  return Effect.flatMap(prepared, (made) =>
    execute(input, { toolCallId, caller: unthreadedCaller, messages: [], prepared: made }),
  ) as Effect.Effect<unknown, ToolFailed>;
}

const run = Effect.fnUntraced(function* (
  tool: Tool,
  input: unknown,
  toolCallId = 'call-1',
): Effect.fn.Return<{ text: string; value: unknown; display: ToolDisplay | undefined; verdict: ToolVerdict | undefined }> {
  const settled = yield* shellCall(tool, input, toolCallId).pipe(Effect.catch((failure) => Effect.succeed(failure.reason)));
  return settled instanceof ToolAnswer
    ? {
        text: String(settled.value),
        value: settled.value,
        display: settled.display,
        verdict: settled.verdict,
      }
    : { text: String(settled), value: settled, display: undefined, verdict: undefined };
});

const said = (value: unknown): string => (value instanceof ToolAnswer ? String(value.value) : String(value));

const timesOf = (wait: CommandLimit, life: CommandLimit, asked: CommandAsk[] = []): CommandTimes => ({
  resolve: (ask) =>
    Effect.sync(() => {
      asked.push(ask);
      return { wait, life };
    }),
});

const ruled = (ms: number): CommandLimit => ({ ms, origin: 'rule', rule: 'r1 (wait for this thread, "words")' });

const unruledLimit = (ms: number): CommandLimit => ({ ms, origin: 'default', rule: null });

it.live('the local road kills a command at its wait, the first of its two limits, and resolves both on every call', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const asked: CommandAsk[] = [];
    let wait = ruled(300);
    const bash = shellOf(
      createTools(
        options({
          cwd: root,
          commandTimes: {
            resolve: (ask) =>
              Effect.sync(() => {
                asked.push(ask);
                return { wait, life: unruledLimit(60_000) };
              }),
          },
        }),
      ),
    );
    const gate = yield* commandGate(root);
    const cut = yield* run(bash, { command: gate.wait, description: 'Outlast the wait', lifeMs: 60_000 });
    wait = unruledLimit(20_000);
    const whole = yield* run(bash, { command: 'printf done', description: 'Finish within the wait' });

    expect(asked).toEqual([
      { waitMs: undefined, lifeMs: 60_000 },
      { waitMs: undefined, lifeMs: undefined },
    ]);
    expect(cut.verdict).toEqual({ kind: 'failed', error: 'Command wait passed.' });
    expect(whole.verdict).toEqual({ kind: 'answered' });
  }),
);

it.live('a world binding no command owner refuses a wait of 0 before it spawns', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const tools = createTools(options({ cwd: root }));

    yield* host.writeFile(join(root, 'source.txt'), 'x');
    const bash = shellOf(tools);
    const background = yield* run(bash, {
      command: `cp ${join(root, 'source.txt')} ${join(root, 'background.txt')}`,
      description: 'Write a marker',
      waitMs: 0,
    });
    expect(background.text).toContain('nothing can be left running');
    expect(yield* exists(join(root, 'background.txt'))).toBe(false);

    const ordinary = yield* run(bash, { command: 'printf hello', description: 'Print a word' });
    expect(ordinary.text).toContain('hello');
  }),
);

it.live('a command started with a wait of 0 answers its own identity and the life the owner armed, over one process', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner({ deadlineMs: 45_000 });
    const tools = createTools(options({ cwd: root, world: worldWith(owner.work) }));

    const gate = yield* commandGate(root);
    yield* host.writeFile(join(root, 'source.txt'), 'started');
    const answer = yield* run(shellOf(tools), {
      command: `${gate.wait}; cp ${join(root, 'source.txt')} ${join(root, 'mark.txt')}`,
      description: 'Start slow work',
      waitMs: 0,
    });
    expect(owner.starts()).toBe(1);
    const operation = owner.requests()[0]?.operation;
    if (!operation) return yield* Effect.die(new Error('the background start recorded no operation'));
    expect(answer.display?.reference).toEqual({ kind: 'command', execution: 'exec-1', incarnation: 1, operation, standing: true });
    expect(answer.display?.details).toContainEqual({ label: 'life', value: '45s' });

    yield* gate.open;
    yield* Deferred.await(owner.concluded);
    expect(yield* host.readFile(join(root, 'mark.txt'), 'utf8')).toBe('started');
  }),
);

it.live('a pending report preserves the command address when a background bash returns before its door finishes projecting', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* gitInit(root);
    const backgroundGate = yield* Deferred.make<void>();
    const owner = yield* fakeOwner({ backgroundGate });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const gate = yield* commandGate(root);
    const calls = yield* makeAgentCalls({ history: 1 });
    const projecting = yield* Deferred.make<void>();
    const projected = yield* Deferred.make<void>();
    const completed = yield* Deferred.make<unknown>();
    yield* Effect.addFinalizer(() => Deferred.succeed(projected, undefined));
    const caller = callerInThread('thread-1', 'run-1');
    calls.listen('run-1', () => 'report');
    const outputs: AgentToolOutputs = {
      project: (answer) =>
        Deferred.succeed(projecting, undefined).pipe(
          Effect.andThen(Deferred.await(projected)),
          Effect.as({ output: answer.output, modelOutput: answer.modelOutput }),
        ),
      projectMessages: (messages) => Effect.succeed(messages),
    };
    const door = openToolDoor(
      'run-1',
      caller,
      {},
      { verdict: () => ({ verdict: 'allow' }) },
      undefined,
      undefined,
      undefined,
      outputs,
      calls,
      () => ({
        retain: () => Effect.succeed({ release: Effect.void }),
        completed: (_call, exit) =>
          Deferred.succeed(completed, Exit.isSuccess(exit) ? exit.value.completion : exit.cause).pipe(Effect.asVoid),
      }),
    );
    const launched = yield* Effect.forkScoped(
      door.settle({
        name: 'bash',
        tool: bash,
        input: { command: `${gate.wait}; printf complete`, workdir: root, waitMs: 0, lifeMs: 600_000 },
        options: { toolCallId: 'call-1', messages: [] },
      }),
    );
    yield* Deferred.await(projecting);
    yield* Deferred.succeed(backgroundGate, undefined);
    const receipt = yield* Fiber.join(launched);
    expect(receipt.display.reference).toMatchObject({ kind: 'command', execution: 'exec-1', incarnation: 1 });
    expect(receipt.modelOutput).toMatchObject({ type: 'text', value: expect.stringContaining('exec-1:1') });
    yield* Deferred.succeed(projected, undefined);
    expect(yield* Deferred.await(completed)).toBe('command');
    yield* calls.get({ runId: 'run-1', toolCallId: 'call-1' })!.settled;
    bash.settled?.({ toolCallId: 'call-1', caller });
    yield* gate.open;
    yield* Deferred.await(owner.concluded);
  }),
);

it.effect('a command that outlasts its wait moves to the background with its call, which leaves its ending to the command', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner();
    const bash = shellOf(
      createTools(
        options({ cwd: root, world: worldWith(owner.work), commandTimes: timesOf(unruledLimit(60_000), unruledLimit(3_600_000)) }),
      ),
    );
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    let handOffs = 0;
    let control: CallExecutionControl | undefined;
    let receipt: ToolAnswer | undefined;
    const moved = yield* Deferred.make<void>();
    const gate = yield* commandGate(root);
    const linked = yield* Deferred.make<void>();
    const progress = {
      link: (_: unknown, given?: CallExecutionControl) => {
        control = given;
        Deferred.doneUnsafe(linked, Effect.void);
        return () => {};
      },
      stage: () => {},
      watch: () => {},
      stopped: () => null,
      stopping: Effect.never,
      handOff: Effect.fnUntraced(function* () {
        handOffs += 1;
        const answer = yield* control!.background!();
        receipt = bash.receipt?.({ toolCallId: 'call-wait', caller: unthreadedCaller });
        yield* control!.handed!(answer.status === 'carried');
        Deferred.doneUnsafe(moved, Effect.void);
        return { status: 'changed' as const, detail: null };
      }),
    };

    const waiter = yield* Effect.forkChild(
      execute({ command: `${gate.wait}; printf survived`, description: 'Outlast the wait' } as never, {
        toolCallId: 'call-wait',
        caller: unthreadedCaller,
        messages: [],
        progress,
      }),
    );
    yield* Deferred.await(linked);
    yield* Deferred.await(owner.awaited);
    yield* TestClock.adjust('60 seconds');
    yield* Deferred.await(moved);
    const answer = (yield* Fiber.join(waiter)) as ToolAnswer;
    yield* gate.open;
    yield* Deferred.await(owner.concluded);

    expect(handOffs).toBe(1);
    expect(owner.backgrounded()).toEqual(['exec-1']);
    expect(receipt?.display?.details).toContainEqual({ label: 'wait', value: '1m' });
    expect(answer.completion).toBe('command');
  }),
);

it.effect('a hand-off its call did not take moves the command back, and the call answers the command’s own ending', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* commandGate(root);
    const owner = yield* fakeOwner();
    const bash = shellOf(
      createTools(
        options({ cwd: root, world: worldWith(owner.work), commandTimes: timesOf(unruledLimit(60_000), unruledLimit(3_600_000)) }),
      ),
    );
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    let control: CallExecutionControl | undefined;
    const linked = yield* Deferred.make<void>();
    const progress = {
      link: (_: unknown, given?: CallExecutionControl) => {
        control = given;
        Deferred.doneUnsafe(linked, Effect.void);
        return () => {};
      },
      stage: () => {},
      watch: () => {},
      stopped: () => null,
      stopping: Effect.never,
      handOff: Effect.fnUntraced(function* () {
        yield* control!.background!();
        yield* control!.handed!(false);
        yield* gate.open;
        return { status: 'unavailable' as const, detail: 'the call was stopped while it was being handed to the background' };
      }),
    };

    const waiter = yield* Effect.forkChild(
      execute({ command: `${gate.wait}; printf kept`, description: 'Stay in its call' } as never, {
        toolCallId: 'call-kept',
        caller: unthreadedCaller,
        messages: [],
        progress,
      }),
    );
    yield* Deferred.await(linked);
    yield* Deferred.await(owner.awaited);
    yield* TestClock.adjust('60 seconds');
    const answer = (yield* Fiber.join(waiter)) as ToolAnswer;

    expect(owner.backgrounded()).toEqual(['exec-1']);
    expect(owner.foregrounded()).toEqual(['exec-1']);
    expect(answer.completion).toBeUndefined();
    expect(answer.display?.details?.[0]).toEqual({ label: 'exit', value: '0' });
  }),
);

const controlled = Effect.fnUntraced(function* () {
  let control: CallExecutionControl | undefined;
  const linked = yield* Deferred.make<void>();
  const progress = {
    link: (_: unknown, given?: CallExecutionControl) => {
      control = given;
      Deferred.doneUnsafe(linked, Effect.void);
      return () => {};
    },
    stage: () => {},
    watch: () => {},
    stopped: () => null,
    stopping: Effect.never,
    handOff: () => Effect.succeed({ status: 'unavailable' as const, detail: null }),
  };
  return { progress, linked, control: () => control! };
});

it.live('a foreground hand-off reports an ended process while its output observation is still held', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* commandGate(root);
    const owner = yield* fakeOwner();
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    const { progress, linked, control } = yield* controlled();
    const waiter = yield* Effect.forkChild(
      execute(
        {
          command: `(${gate.wait}) & printf native-ended`,
          description: 'Hold the output after exit',
        } as never,
        {
          toolCallId: 'call-exited',
          caller: unthreadedCaller,
          messages: [],
          progress,
        },
      ),
    );
    yield* Deferred.await(linked);
    yield* Deferred.await(owner.exited);
    yield* control().background!();
    const receipt = bash.receipt?.({ toolCallId: 'call-exited', caller: unthreadedCaller });
    expect(receipt?.display?.reference).toMatchObject({ kind: 'command', standing: false });
    expect(receipt?.display?.details).toContainEqual({ label: 'phase', value: 'ended' });
    yield* control().handed!(true);
    const answer = (yield* Fiber.join(waiter)) as ToolAnswer;
    expect(answer.display?.reference).toMatchObject({ kind: 'command', standing: false });
    yield* gate.open;
    yield* Deferred.await(owner.concluded);
  }),
);

it.live('a command ending once it was moved is told by its notice alone, whether or not its call then goes', () =>
  Effect.gen(function* () {
    const raced = Effect.fnUntraced(function* (went: boolean) {
      const root = yield* createTempDir();
      const gate = yield* commandGate(root);
      const owner = yield* fakeOwner();
      const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
      const execute = toolExecute(bash);
      if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
      const { progress, linked, control } = yield* controlled();
      const waiter = yield* Effect.forkChild(
        execute({ command: `${gate.wait}; printf raced`, description: 'End after the move' } as never, {
          toolCallId: 'call-raced',
          caller: unthreadedCaller,
          messages: [],
          progress,
        }),
      );
      yield* Deferred.await(linked);
      expect((yield* control().background!()).status).toBe('carried');
      yield* gate.open;
      const answer = (yield* Fiber.join(waiter)) as ToolAnswer;
      yield* control().handed!(went);
      return { answer, foregrounded: owner.foregrounded() };
    });

    for (const went of [true, false]) {
      const { answer, foregrounded } = yield* Effect.scoped(raced(went));
      expect(foregrounded).toEqual([]);
      expect(answer.completion).toBe('command');
    }
  }),
);

it.live('a command whose ending was already told when its move is taken back answers that, not the ending again', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* commandGate(root);
    const owner = yield* fakeOwner({ withdrawal: 'delivered' });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    const { progress, linked, control } = yield* controlled();

    const waiter = yield* Effect.forkChild(
      execute({ command: `${gate.wait}; printf told`, description: 'Told before the take-back' } as never, {
        toolCallId: 'call-told',
        caller: unthreadedCaller,
        messages: [],
        progress,
      }),
    );
    yield* Deferred.await(linked);
    yield* control().background!();
    yield* control().handed!(false);
    yield* gate.open;
    const answer = (yield* Fiber.join(waiter)) as ToolAnswer;

    expect(owner.foregrounded()).toEqual(['exec-1']);
    expect(answer.completion).toBe('command');
    expect(answer.display?.reference).toMatchObject({ kind: 'command', execution: 'exec-1', standing: false });
  }),
);

it.live('a hand-off taken back never withdraws the notice a command started in the background owed from its start', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner();
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    const { progress, control } = yield* controlled();
    const gate = yield* commandGate(root);

    yield* execute({ command: gate.wait, description: 'Start in the background', waitMs: 0 } as never, {
      toolCallId: 'call-started-away',
      caller: unthreadedCaller,
      messages: [],
      progress,
    });
    yield* control().background!();
    yield* control().handed!(false);

    expect(owner.backgrounded()).toEqual([]);
    expect(owner.foregrounded()).toEqual([]);
    yield* gate.open;
    yield* Deferred.await(owner.concluded);
  }),
);

it.live('a shell reports the measurement its answer carries to the command’s owner, for a notice to carry it too', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner();
    yield* gitInit(root);
    yield* host.writeFile(join(root, 'tracked.txt'), 'one\n');
    const sink = recorder();
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work), changes: sink.port })));

    const answer = yield* run(bash, { command: `printf two > ${join(root, 'after.txt')}`, description: 'Write a file' });

    expect(sink.moves.map((move) => move.name)).toEqual(['after.txt']);
    expect(owner.measurements()).toHaveLength(1);
    expect(owner.measurements()[0]).toContain('1 file moved while this ran');
    expect(answer.text).toContain(owner.measurements()[0]!);
  }),
);

it.live('a background call whose command already ended answers the ending, not a running identity', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner({ settleBeforeAccept: true });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));

    const answer = yield* run(bash, {
      command: 'printf done-early',
      description: 'Finish before acceptance',
      waitMs: 0,
    });
    expect(answer.text).toContain('done-early');
    expect(answer.display?.details?.[0]).toEqual({ label: 'exit', value: '0' });
    expect(answer.display?.reference).toMatchObject({ kind: 'command', execution: 'exec-1', incarnation: 1, standing: false });
  }),
);

it.live('a background call with an unreadable phase keeps its identity without claiming the process is running', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* commandGate(root);
    const owner = yield* fakeOwner({ phaseFails: true });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));

    const answer = yield* run(bash, { command: `${gate.wait}; printf hello`, description: 'Await release', waitMs: 0 });
    expect(answer.display?.reference).toMatchObject({ kind: 'command', execution: 'exec-1', incarnation: 1, standing: false });
    expect(answer.display?.details).toContainEqual({ label: 'phase', value: 'unavailable' });
    yield* gate.open;
    yield* Deferred.await(owner.concluded);
  }),
);

it.live('a call interrupted while its command is admitted keeps its key as uncertain, never nothing', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* Deferred.make<void>();
    const owner = yield* fakeOwner({ startGate: gate });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));

    const input = { command: 'printf hello', description: 'Print a word' };
    const waiter = yield* Effect.forkChild(shellCall(bash, input, 'call-1'));
    yield* Deferred.await(owner.entered);
    expect(owner.starts()).toBe(1);
    yield* Fiber.interrupt(waiter);

    const minted = owner.requests()[0]?.operation;
    expect(minted).toBeDefined();
    const settlement = yield* settleOf(bash, { toolCallId: 'call-1', caller: unthreadedCaller, toolInput: input });
    expect(settlement?.status).toBe('completed');
    const settled = settlement?.status === 'completed' ? (settlement.output as ToolAnswer) : null;
    expect(String(settled?.value)).toContain(String(minted));
    expect(owner.starts()).toBe(1);
  }),
);

it.live('a command accepted before its process starts answers so, with its clock not started, then starts as the same command', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const slot = yield* Deferred.make<void>();
    const gate = yield* commandGate(root);
    const owner = yield* fakeOwner({ deadlineMs: 45_000, queueGate: slot });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));

    yield* host.writeFile(join(root, 'source.txt'), 'queued');
    const input = {
      command: `${gate.wait}; cp ${join(root, 'source.txt')} ${join(root, 'started.txt')}; echo started-after-queue`,
      description: 'Start after its slot',
      waitMs: 0,
    };
    const answer = yield* run(bash, input);
    expect(answer.display?.verb).toBe('Not yet started');
    expect(answer.display?.reference).toMatchObject({ kind: 'command', execution: 'exec-1', incarnation: 1, standing: true });

    yield* Deferred.succeed(slot, undefined);
    yield* gate.open;
    yield* Deferred.await(owner.concluded);
    expect(yield* host.readFile(join(root, 'started.txt'), 'utf8')).toBe('queued');
    expect(owner.starts()).toBe(1);
  }),
);

it.live('a failed output stream discloses that the printed output may be incomplete', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner({ failStream: 'stdout' });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));

    const answer = yield* run(bash, { command: 'printf hello', description: 'Print a word' });
    expect(answer.text).toContain('may not be everything the command wrote');
    expect(answer.text).toContain('the record evicted bytes');
  }),
);

it.live('a kept file that lost the start of the output is named with the bytes gone, and output that could not be kept says why', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const file = { path: join(root, 'record', 'output.log'), from: byteOffset(4096n), through: byteOffset(40_000n) };
    const lost = yield* fakeOwner({ kept: { _tag: 'Kept', file } });
    const reason = 'a process it started outlived it and still holds its output open';
    const unkept = yield* fakeOwner({ kept: { _tag: 'Unkept', reason } });

    const gone = yield* run(shellOf(createTools(options({ cwd: root, world: worldWith(lost.work) }))), {
      command: 'printf hello',
      description: 'Print a word',
    });
    const held = yield* run(shellOf(createTools(options({ cwd: root, world: worldWith(unkept.work) }))), {
      command: 'seq 1 9000',
      description: 'Print many lines',
    });
    expect(gone.text).toContain(file.path);
    expect(gone.text).toContain('4096');
    expect(held.text).toContain(reason);
  }),
);

it.live('withdrawing the waiter leaves the command running, and its observation settles for a later reader', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner();
    const tools = createTools(options({ cwd: root, world: worldWith(owner.work) }));
    const bash = shellOf(tools);

    const gate = yield* commandGate(root);
    yield* host.writeFile(join(root, 'source.txt'), 'finished');
    const input = {
      command: `${gate.wait}; cp ${join(root, 'source.txt')} ${join(root, 'late.txt')}; echo done-after-waiter`,
      description: 'Finish after the waiter leaves',
    };
    const waiter = yield* Effect.forkChild(shellCall(bash, input, 'call-1'));
    yield* Deferred.await(owner.awaited);
    yield* Fiber.interrupt(waiter);
    expect(owner.starts()).toBe(1);

    yield* gate.open;
    yield* Deferred.await(owner.concluded);
    expect(yield* host.readFile(join(root, 'late.txt'), 'utf8')).toBe('finished');

    const settlement = yield* settleOf(bash, { toolCallId: 'call-1', caller: unthreadedCaller, toolInput: input });
    expect(settlement?.status).toBe('completed');
    expect(owner.starts()).toBe(1);
    const settled = settlement?.status === 'completed' ? (settlement.output as ToolAnswer) : null;
    expect(String(settled?.value)).toContain('done-after-waiter');
    expect(settled?.display?.details?.[0]).toEqual({ label: 'exit', value: '0' });
  }),
);

it.live('a command answer stays readable until its owner acknowledges it, then releases its read-back', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner();
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const input = { command: 'echo answered', description: 'Answer at once' };
    const call = { toolCallId: 'call-answered', caller: unthreadedCaller, toolInput: input };

    yield* shellCall(bash, input, call.toolCallId);
    const settlement = yield* settleOf(bash, call);
    expect(settlement?.status).toBe('completed');
    expect(settlement?.status === 'completed' ? said(settlement.output) : null).toContain('answered');
    bash.settled?.(call);
    expect(yield* settleOf(bash, call)).toEqual({ status: 'unknown' });
  }),
);

it.live('a foreground receipt has no identity before admission and leaves an unread process phase unavailable', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const gate = yield* Deferred.make<void>();
    const owner = yield* fakeOwner({ startGate: gate });
    const processGate = yield* commandGate(root);
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const execute = toolExecute(bash);
    if (!execute) return yield* Effect.die(new Error('The tool declares no execute.'));
    const linked = yield* Deferred.make<void>();
    const activity = {
      link: () => {
        Deferred.doneUnsafe(linked, Effect.void);
        return () => {};
      },
      stage: () => {},
      watch: () => {},
      stopped: () => null,
      stopping: Effect.never,
      handOff: () => Effect.succeed({ status: 'changed' as const, detail: null }),
    };

    const waiter = yield* Effect.forkChild(
      execute({ command: processGate.wait, description: 'Await release' } as never, {
        toolCallId: 'call-1',
        caller: unthreadedCaller,
        messages: [],
        progress: activity,
      }),
    );
    yield* Deferred.await(owner.entered);
    const before = bash.receipt?.({ toolCallId: 'call-1', caller: unthreadedCaller });
    yield* Deferred.succeed(gate, undefined);
    yield* Deferred.await(linked);
    const after = bash.receipt?.({ toolCallId: 'call-1', caller: unthreadedCaller });
    yield* Fiber.interrupt(waiter);
    yield* processGate.open;
    yield* Deferred.await(owner.concluded);

    expect(owner.starts()).toBe(1);
    expect(before).toBeUndefined();
    expect(after?.display?.reference).toMatchObject({ kind: 'command', execution: 'exec-1', incarnation: 1, standing: false });
    expect(after?.display?.details).toContainEqual({ label: 'phase', value: 'unavailable' });
  }),
);

it.live('a lost observation reports the measurement unavailable rather than an unchanged tree', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* gitInit(root);
    yield* host.writeFile(join(root, 'tracked.txt'), 'one\n');
    yield* host.writeFile(join(root, 'source.txt'), 'two\n');
    const owner = yield* fakeOwner();
    const tools = createTools(options({ cwd: root, world: worldWith(owner.work), changes: recorder().port }));

    const gate = yield* commandGate(root);
    const waiter = yield* Effect.forkChild(
      shellCall(
        shellOf(tools),
        {
          command: `cp ${join(root, 'source.txt')} ${join(root, 'tracked.txt')}; ${gate.wait}`,
          description: 'Write and linger',
        },
        'call-lost',
      ).pipe(Effect.catch((failure) => Effect.succeed(failure.reason))),
    );
    yield* Deferred.await(owner.admitted);
    yield* owner.closeAll();
    const answer = yield* Fiber.join(waiter);
    const text = said(answer);
    expect(text).toContain('NOT measured');
    expect(text).toContain('observation of this command was lost');
    expect(text).not.toContain('moved while this ran');
    expect(text).toContain('output of this command is unavailable');
    expect(text.startsWith('(no output)')).toBe(false);
  }),
);

it.live('a command overlapping one still running leaves no stale baseline for the next to inherit', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* gitInit(root);
    const owner = yield* fakeOwner();
    const sink = recorder();
    const tools = createTools(options({ cwd: root, world: worldWith(owner.work), changes: sink.port }));
    const bash = shellOf(tools);
    const shell = (command: string, id: string) => shellCall(bash, { command, description: 'Write a file' }, id);

    yield* host.writeFile(join(root, 'source.txt'), 'x\n');
    const copy = (name: string) => `cp ${join(root, 'source.txt')} ${join(root, name)}`;

    const gate = yield* commandGate(root);
    const held = yield* commandGate(root);
    yield* shellCall(
      bash,
      {
        command: `${gate.wait}; ${copy('background.txt')}; ${held.wait}`,
        description: 'Work on',
        waitMs: 0,
      },
      'call-bg',
    );
    yield* shell(copy('quick.txt'), 'call-quick');
    yield* gate.open;
    yield* fileHolds(join(root, 'background.txt'), 'x\n');

    const after = yield* shell(copy('last.txt'), 'call-last');
    expect(said(after)).toContain('1 file moved while this ran');
    expect(sink.moves.map((move) => move.name)).toEqual(['quick.txt', 'last.txt']);
    yield* held.open;
    yield* Deferred.await(owner.concluded);
  }),
);

const endedByPolicy = (deadlineMs: number, standing?: CommandRunDeadline, cleanup: Cleanup = 'complete') =>
  fakeOwner({
    deadlineMs,
    standing,
    decide: (execution, operation) => ({
      _tag: 'Decided',
      decision: {
        _tag: 'Cancelled',
        operation,
        execution,
        sequence: 0,
        cause: 'timeout',
        trigger: 'the execution bound',
      },
      sources: {
        stdout: { completed: false, offset: 0n as never },
        stderr: { completed: false, offset: 0n as never },
      },
      cleanup,
      retention: 'retained',
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'decided before the stop measured it' },
    }),
  });

it.live('a command its owner ends at its deadline answers the life that stood when it ran out, and a stop not verified as such', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* endedByPolicy(3_600_000, { state: 'armed', timeoutMs: 300_000, origin: 'caller' }, 'unverifiable');
    const answer = yield* run(shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) }))), {
      command: 'printf quick',
      description: 'Be ended at its life',
    });
    expect(answer.verdict).toEqual({ kind: 'failed', error: 'Command life ran out.' });
    expect(answer.display?.facts?.[0]).toEqual({ label: 'ended', value: 'life ran out' });
    expect(answer.text).toContain('life 5m');
    expect(answer.text).toContain(cleanupWords('unverifiable')!);
  }),
);

it.live('a refused admission answers as unsubmitted, and an unknown start is never sent twice', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const refusing = yield* fakeOwner({ refuses: 'the host admits no durable work' });
    yield* host.writeFile(join(root, 'source.txt'), 'x');
    const refused = yield* run(shellOf(createTools(options({ cwd: root, world: worldWith(refusing.work) }))), {
      command: `cp ${join(root, 'source.txt')} ${join(root, 'heavy.txt')}`,
      description: 'Ask a host that admits nothing',
    });
    expect(refused.value).toMatchObject({ status: 'refused' });
    expect(String((refused.value as { readonly reason: string }).reason)).toContain('not admitted, and nothing ran');
    expect(refused.display?.facts?.[0]).toEqual({ label: 'refused', value: 'not admitted' });
    expect(yield* exists(join(root, 'heavy.txt'))).toBe(false);

    const unsure = yield* fakeOwner({ uncertain: true });
    const tools = createTools(options({ cwd: root, world: worldWith(unsure.work) }));
    const answer = yield* run(shellOf(tools), { command: 'printf x', description: 'Lose the reply' });
    expect(answer.text).toContain(String(unsure.requests()[0]?.operation));
    expect(unsure.starts()).toBe(1);

    const settlement = yield* settleOf(shellOf(tools), {
      toolCallId: 'call-1',
      caller: unthreadedCaller,
      toolInput: { command: 'printf x', description: 'Lose the reply' },
    });
    expect(settlement?.status).toBe('unknown');
  }),
);

const stoppedResult = (execution: ExecutionRef, operation: HostRequestRef): CallDecisionAnswer => ({
  _tag: 'Decided',
  decision: {
    _tag: 'Cancelled',
    operation,
    execution,
    sequence: 0,
    cause: 'run-abort',
    trigger: 'The invocation was stopped.',
  },
  sources: {
    stdout: { completed: false, offset: 0n as never },
    stderr: { completed: false, offset: 0n as never },
  },
  cleanup: 'complete',
  retention: 'retained',
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the fake owner measures nothing' },
});

function stoppingCall(tool: Tool, input: unknown, toolCallId: string, progress: StoppableProgress): Effect.Effect<unknown, ToolFailed> {
  const execute = toolExecute(tool);
  if (!execute) throw new Error('The tool declares no execute.');
  return execute(input, { toolCallId, caller: unthreadedCaller, messages: [], progress }) as Effect.Effect<unknown, ToolFailed>;
}

it.live('a stopped call does not settle before the command it started has been ended', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const ending = yield* Deferred.make<void>();
    const owner = yield* fakeOwner({ stopOnSignal: true, stopGate: ending, decide: stoppedResult });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const stopping = stoppableProgress();
    const gate = yield* commandGate(root);
    const input = { command: gate.wait, description: 'Wait until somebody ends it' };
    const landed = yield* Deferred.make<void>();

    const call = yield* Effect.forkChild(
      stoppingCall(bash, input, 'call-stopped', stopping).pipe(Effect.ensuring(Deferred.succeed(landed, undefined))),
    );
    yield* Deferred.await(owner.admitted);
    stopping.stop('The invocation was stopped.');
    yield* Deferred.await(owner.stopped);
    const cutting = yield* Effect.forkChild(Fiber.interrupt(call));
    yield* Effect.yieldNow;
    const settled = yield* Deferred.isDone(landed);
    yield* Deferred.succeed(ending, undefined);
    yield* Fiber.join(cutting);

    expect(settled).toBe(false);
    expect(owner.stops()).toHaveLength(1);
    expect(owner.stops()[0]).toEqual(refOf(1));
    const identity = { toolCallId: 'call-stopped', caller: unthreadedCaller };
    const readBack = { ...identity, toolInput: input };
    const outcome = yield* settleOf(bash, readBack);
    expect(outcome?.status).toBe('completed');
    const answer = outcome?.status === 'completed' ? (outcome.output as ToolAnswer) : undefined;
    expect(answer?.verdict).toEqual({ kind: 'cancelled' });
    expect(bash.receipt?.(identity)?.display?.reference).toMatchObject({ execution: 'exec-1' });
    expect((yield* settleOf(bash, readBack))?.status).toBe('completed');
    bash.settled?.(identity);
    expect(yield* settleOf(bash, readBack)).toEqual({ status: 'unknown' });
    expect(bash.receipt?.(identity)).toBeUndefined();
  }),
);

it.live('stopping one call ends only its own command, and the call beside it answers its own work', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const owner = yield* fakeOwner({
      stopOnSignal: true,
      decide: (execution, operation) => (execution.execution === refOf(1).execution ? stoppedResult(execution, operation) : undefined),
    });
    const bash = shellOf(createTools(options({ cwd: root, world: worldWith(owner.work) })));
    const stopping = stoppableProgress();
    const gate = yield* commandGate(root);

    const running = yield* Effect.forkChild(
      stoppingCall(bash, { command: gate.wait, description: 'Wait until somebody ends it' }, 'call-stopped', stopping),
    );
    yield* Deferred.await(owner.admitted);
    const sibling = yield* shellCall(bash, { command: 'printf sibling', description: 'Print a word' }, 'call-beside');
    stopping.stop('The invocation was stopped.');
    yield* Deferred.await(owner.stopped);
    yield* Fiber.interrupt(running);

    expect(owner.stops()).toHaveLength(1);
    expect(owner.stops()[0]).toEqual(refOf(1));
    expect(said(sibling)).toContain('sibling');
  }),
);
