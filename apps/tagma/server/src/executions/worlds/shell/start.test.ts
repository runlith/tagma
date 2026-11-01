import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, type Result, Scope, Stream } from 'effect';
import type { CommandRequest, CommandRun } from '@runlith/agent-tools/CommandWork';
import { WireLost, type ExecutionFeedItem } from '@runlith/executions/Executions';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import { CallCancellation } from '@runlith/executions/protocol/call';
import type { CancellationCause, CallDecisionAnswer, CallStopping } from '@runlith/executions/protocol/call';
import type { CommandSnapshot } from '@runlith/executions/protocol/command';
import {
  type Cleanup,
  type ExecutionPhase,
  type NativeExit,
  type HostRequestRef,
  HostRequestKey,
  type ExecutionRef,
} from '@runlith/executions/protocol/execution';
import type { StartAnswer, CancelAnswer } from '@runlith/executions/protocol/launch';
import type { ExecutionSummary, OperationAnswer } from '@runlith/executions/protocol/runtime';
import type { StopAction, StopReceipt } from '@runlith/executions/protocol/stop';
import type { CommandAccess } from '../../contract/service/access.js';
import type { WorldLease } from '../../contract/service/worlds.js';
import type { ManagedCommands } from '../../contract/service/commands.js';
import type { TerminalOperationKey } from '../../contract/wire/requestKeys.js';
import { TerminalUnavailable } from '../../contract/wire/refusals.js';
import { PreparedLaunches, makeShellCommands, type ShellCommandBinding } from './start.js';
import { bytes, commandPhase, commandResult } from './results.js';

const ref = { installation: 'install-test', execution: 'exec-1', incarnation: 1 } as ExecutionRef;

const live = (phase: ExecutionPhase): ExecutionSummary => ({ state: { phase } }) as ExecutionSummary;
const admitted = (phase: ExecutionPhase): CommandSnapshot => ({ state: { phase } }) as CommandSnapshot;
const cut = new WireLost({ reason: 'the test cut the wire', sent: true });

const port = (answers: {
  readonly state: ExecutionSummary | undefined | 'fail';
  readonly command: CommandSnapshot | undefined | 'fail';
  readonly asked?: (road: 'state' | 'command') => void;
}): Executions['Service'] & Commands['Service'] =>
  ({
    state: () => {
      answers.asked?.('state');
      return answers.state === 'fail' ? Effect.fail(cut) : Effect.succeed(answers.state);
    },
    command: () => {
      answers.asked?.('command');
      return answers.command === 'fail' ? Effect.fail(cut) : Effect.succeed(answers.command);
    },
  }) as unknown as Executions['Service'] & Commands['Service'];

const phaseOf = (service: Executions['Service'] & Commands['Service']) => commandPhase(service, ref);
const unreadable = (service: Executions['Service'] & Commands['Service']) => Effect.flip(commandPhase(service, ref));

it.effect('a live child answers its own phase, and the command road is never asked', () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const ask = (road: 'state' | 'command') => void asked.push(road);
    expect(yield* phaseOf(port({ state: live('running'), command: admitted('queued'), asked: ask }))).toBe('running');
    expect(yield* phaseOf(port({ state: live('ended'), command: undefined, asked: ask }))).toBe('ended');
    expect(asked).toEqual(['state', 'state']);
  }),
);

it.effect('a silent state is read again where admitted work stands, and queued answers queued', () =>
  Effect.gen(function* () {
    expect(yield* phaseOf(port({ state: undefined, command: admitted('queued') }))).toBe('queued');
    expect(yield* phaseOf(port({ state: undefined, command: admitted('reserved') }))).toBe('queued');
    expect(yield* phaseOf(port({ state: undefined, command: admitted('running') }))).toBe('running');
    expect(yield* phaseOf(port({ state: undefined, command: admitted('ended') }))).toBe('ended');
  }),
);

it.effect('both roads silent is a reference the host holds nothing under, never an ending', () =>
  Effect.gen(function* () {
    const failure = yield* unreadable(port({ state: undefined, command: undefined }));
    expect(failure._tag).toBe('CommandUnreadable');
    expect(failure.reason).toContain('holds nothing');
  }),
);

it.effect('a road that fails fails the read outright, without billing the other road', () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const ask = (road: 'state' | 'command') => void asked.push(road);
    const failure = yield* unreadable(port({ state: 'fail', command: admitted('queued'), asked: ask }));
    expect(failure._tag).toBe('CommandUnreadable');
    expect(failure.reason).toContain('could not be read');
    expect(asked).toEqual(['state']);
  }),
);

const operation = { installation: 'install-test', operation: 'op-1' } as HostRequestRef;

const endedSummary = (
  exit: NativeExit | undefined,
  streams: { readonly stdout: 'open' | 'eof'; readonly stderr: 'open' | 'eof' },
): ExecutionSummary =>
  ({
    state: {
      ref,
      phase: 'ended',
      nativeExit: exit,
      streams: { ...streams, pty: 'open' },
      cleanup: 'complete',
      record: 'available',
    },
    streams: [],
  }) as unknown as ExecutionSummary;

const exitOf = (result: CallDecisionAnswer): NativeExit | undefined => ('nativeExit' in result ? result.nativeExit : undefined);

it('a leader that exited answers with its exit, even where the host has decided nothing', () => {
  const answer = commandResult(operation, ref, endedSummary({ _tag: 'Code', code: 0 }, { stdout: 'open', stderr: 'open' }));

  expect(exitOf(answer)).toEqual({ _tag: 'Code', code: 0 });
  expect('sources' in answer ? answer.sources.stdout.completed : true).toBe(false);
});

it('an ended execution the host reported no exit for is the one that is genuinely unavailable', () => {
  const answer = commandResult(operation, ref, endedSummary(undefined, { stdout: 'eof', stderr: 'eof' }));

  expect(exitOf(answer)).toBeUndefined();
  expect(answer._tag).toBe('Unavailable');
});

const completedSummary = (execution: ExecutionRef): ExecutionSummary =>
  ({
    state: {
      ref: execution,
      phase: 'ended',
      nativeExit: { _tag: 'Code', code: 0 },
      streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
      cleanup: 'complete',
      record: 'available',
    },
    streams: [],
    cost: { _tag: 'Measured', cpuMicros: 42_000, peakRssBytes: 8192 },
    decision: {
      _tag: 'Completed',
      operation: { installation, operation: execution.execution },
      execution,
      sequence: 0,
    },
  }) as unknown as ExecutionSummary;

const unacquiredSummary = (execution: ExecutionRef): ExecutionSummary =>
  ({
    state: {
      ref: execution,
      phase: 'ended',
      streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
      cleanup: 'complete',
      record: 'unavailable',
      unacquired: 'the attempt proved no child exists',
    },
    streams: [],
  }) as unknown as ExecutionSummary;

const settlementOf = (name: string, fill: (execution: ExecutionRef) => Stream.Stream<ExecutionFeedItem>) => {
  const execution = refOf(name);
  const host = hostOver({ executions: new Map([[`op-${name}`, execution]]), arriving: () => fill(execution) });
  const commands = commandsOver(host, controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true }).managed);
  return Effect.scoped(
    Effect.gen(function* () {
      const acceptance = yield* commands.start(requestFor(`op-${name}`, stopOf()), () => Effect.never);
      return yield* acceptance.run.result;
    }),
  );
};

it.live('an exit with no decision leaves the wait outstanding, and the host’s decision settles it', () =>
  Effect.gen(function* () {
    const one = refOf('exec-holding');
    const decided = yield* Deferred.make<void>();
    const deciding = yield* Deferred.make<void>();
    const settled = yield* Deferred.make<void>();
    const settlement = settlementOf('holding', () =>
      Stream.concat(
        Stream.make({
          _tag: 'State',
          summary: endedSummary({ _tag: 'Code', code: 0 }, { stdout: 'open', stderr: 'open' }),
        } as unknown as ExecutionFeedItem),
        Stream.fromEffect(
          Effect.andThen(
            Effect.andThen(Deferred.succeed(deciding, undefined), Deferred.await(decided)),
            Effect.succeed({ _tag: 'State', summary: completedSummary(one) } as unknown as ExecutionFeedItem),
          ),
        ),
      ),
    );
    const waiting = yield* Effect.forkChild(settlement.pipe(Effect.tap(() => Deferred.succeed(settled, undefined))));
    yield* Deferred.await(deciding);
    expect(yield* Deferred.isDone(settled)).toBe(false);
    yield* Deferred.succeed(decided, undefined);
    const answer = yield* Fiber.join(waiting);

    expect(answer._tag).toBe('Decided');
    expect(answer._tag === 'Decided' ? answer.decision._tag : '').toBe('Completed');
  }),
);

it.effect('a command decision settles without resource accounting, preserving its exit or cancellation', () =>
  Effect.gen(function* () {
    for (const summary of [completedSummary, decidedSummary]) {
      const one = refOf('unmeasured');
      const { cost, ...decided } = summary(one);
      const answer = yield* settlementOf('unmeasured', () =>
        Stream.make({ _tag: 'State', summary: decided } as ExecutionFeedItem, { _tag: 'Ended', ending: 'completed' }),
      );
      expect(answer).toMatchObject({ _tag: 'Decided', decision: decided.decision, cost: { _tag: 'Unmeasured' } });
      expect(exitOf(answer)).toEqual(decided.state.nativeExit);
    }
  }),
);

it.effect('a state stream ending without a decision leaves the command unconfirmed', () =>
  Effect.gen(function* () {
    const answer = yield* settlementOf('unconfirmed', () => Stream.make({ _tag: 'Ended', ending: 'completed' }));
    expect(answer).toMatchObject({ _tag: 'Unavailable', operation: { operation: 'op-unconfirmed' } });
  }),
);

it.effect('a state stream that ends after an exit the host never decided answers that exit as undecided', () =>
  Effect.gen(function* () {
    const answer = yield* settlementOf('undecided', () =>
      Stream.make(
        {
          _tag: 'State',
          summary: endedSummary({ _tag: 'Code', code: 0 }, { stdout: 'open', stderr: 'eof' }),
        } as unknown as ExecutionFeedItem,
        { _tag: 'Ended', ending: 'completed' } as ExecutionFeedItem,
      ),
    );
    expect(answer).toMatchObject({ _tag: 'Undecided', nativeExit: { _tag: 'Code', code: 0 } });
  }),
);

it.effect('stdout that outran its record resumes where the record retains, so the tail still arrives', () =>
  Effect.gen(function* () {
    const text = new TextEncoder();
    const asked: string[] = [];
    const feed = {
      subscribe: (source: { readonly cursor?: { readonly offset: string } }) => {
        const offset = source.cursor?.offset ?? '';
        asked.push(offset);
        return offset === '0'
          ? Stream.make(
              { _tag: 'Bytes', bytes: text.encode('head ') } as ExecutionFeedItem,
              { _tag: 'Ended', ending: 'gap' } as ExecutionFeedItem,
            )
          : Stream.make(
              { _tag: 'Bytes', bytes: text.encode('tail') } as ExecutionFeedItem,
              { _tag: 'Ended', ending: 'completed' } as ExecutionFeedItem,
            );
      },
      state: () => Effect.succeed({ streams: [{ stream: 'stdout', retainedFrom: '900' }] } as unknown as ExecutionSummary),
    } as unknown as ExecutionFeed['Service'] & Executions['Service'];
    const read = yield* Stream.runCollect(bytes(feed, ref, 'stdout', 65_536));
    expect(new TextDecoder().decode(Buffer.concat(read))).toBe('head tail');
    expect(asked).toEqual(['0', '900']);
  }),
);

it.effect('a command decision carries the resource accounting the host supplied', () =>
  Effect.gen(function* () {
    for (const summary of [completedSummary, decidedSummary]) {
      const answer = yield* settlementOf('measured', (one) =>
        Stream.make({
          _tag: 'State',
          summary: { ...summary(one), cost: { _tag: 'Measured', cpuMicros: 42_000, peakRssBytes: 8192 } },
        } as ExecutionFeedItem),
      );
      expect(answer).toMatchObject({ _tag: 'Decided', cost: { _tag: 'Measured', cpuMicros: 42_000, peakRssBytes: 8192 } });
    }
  }),
);

it.effect('work given up with no child settles against the host’s own sentence, rather than waiting', () =>
  Effect.gen(function* () {
    const answer = yield* settlementOf('gone', (one) =>
      Stream.make({ _tag: 'State', summary: unacquiredSummary(one) } as unknown as ExecutionFeedItem),
    );

    expect(answer._tag).toBe('Unavailable');
    expect(answer._tag === 'Unavailable' ? answer.reason : '').toContain('never started');
  }),
);

const installation = 'install-test' as ExecutionRef['installation'];

const refOf = (name: string): ExecutionRef => ({ installation, execution: name, incarnation: 1 }) as ExecutionRef;

const admittedRun = (operation: HostRequestRef, execution: ExecutionRef): CommandRun =>
  ({
    operation,
    execution,
    deadline: { state: 'none' },
    inspect: 'the test reads nothing',
    phase: Effect.succeed('running'),
    result: Effect.never,
    revise: () => Effect.succeed({ state: 'refused' as const, reason: 'the test moves no deadline' }),
    stdout: Stream.empty,
    stderr: Stream.empty,
  }) as unknown as CommandRun;

const decidedSummary = (execution: ExecutionRef): ExecutionSummary =>
  ({
    state: { ref: execution, phase: 'ended', cleanup: 'pending', streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' } },
    cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this host cannot measure resource use' },
    streams: [],
    decision: {
      _tag: 'Cancelled',
      operation: { installation, operation: execution.execution },
      execution,
      sequence: 0,
      cause: 'run-abort',
      trigger: 'the call was stopped',
    },
  }) as unknown as ExecutionSummary;

type Host = {
  readonly service: Executions['Service'] & Commands['Service'] & ExecutionRequest['Service'] & ExecutionFeed['Service'];
  readonly cancellations: Array<{
    readonly operation: HostRequestRef;
    readonly cause: CancellationCause;
    readonly trigger: string;
  }>;
  readonly reads: HostRequestRef[];
};

const hostOver = (options: {
  readonly executions: ReadonlyMap<string, ExecutionRef>;
  readonly cancellation?: (operation: HostRequestRef) => CancelAnswer;
  readonly snapshot?: (execution: ExecutionRef) => CommandSnapshot | undefined;
  readonly asked?: Deferred.Deferred<void>;
  readonly arriving?: (source: { readonly execution?: ExecutionRef }) => Stream.Stream<ExecutionFeedItem>;
}): Host => {
  const cancellations: Host['cancellations'] = [];
  const reads: HostRequestRef[] = [];
  const service = {
    start: (operation: HostRequestRef) =>
      Effect.succeed({
        _tag: 'Accepted',
        operation,
        execution: options.executions.get(operation.operation),
      } as unknown as StartAnswer),
    command: (execution: ExecutionRef) => Effect.succeed(options.snapshot?.(execution)),
    state: () => Effect.succeed(undefined),
    operation: (operation: HostRequestRef) => {
      reads.push(operation);
      return Effect.succeed({
        _tag: 'Accepted',
        operation,
        execution: options.executions.get(operation.operation),
      } as unknown as OperationAnswer);
    },
    cancelStart: Effect.fnUntraced(function* (operation: HostRequestRef, cause: CancellationCause, trigger: string) {
      cancellations.push({ operation, cause, trigger });
      if (options.asked !== undefined) yield* Deferred.succeed(options.asked, undefined);
      return (options.cancellation?.(operation) ?? {
        _tag: 'Joined',
        operation,
        execution: options.executions.get(operation.operation),
      }) as unknown as CancelAnswer;
    }),
    subscribe: (source: { readonly execution?: ExecutionRef }) =>
      options.arriving?.(source) ??
      Stream.make({
        _tag: 'State',
        summary: decidedSummary(source.execution ?? refOf('exec-one')),
      } as unknown as ExecutionFeedItem),
  } as unknown as Executions['Service'] & Commands['Service'] & ExecutionRequest['Service'] & ExecutionFeed['Service'];
  return { service, cancellations, reads };
};

type Control = {
  readonly managed: ManagedCommands['Service'];
  readonly stops: Array<{
    readonly key: TerminalOperationKey;
    readonly execution: ExecutionRef;
    readonly cause: string;
    readonly action: string;
    readonly actor: string;
  }>;
  readonly revises: Array<{
    readonly key: TerminalOperationKey;
    readonly expected: number;
    readonly actor: string;
    readonly change: unknown;
  }>;
};

const controlOver = (
  cleanup: Cleanup,
  revision: { readonly executionMs: number; readonly ceilingMs: number; readonly armed: boolean },
  gate?: Deferred.Deferred<void>,
): Control => {
  const stops: Control['stops'] = [];
  const revises: Control['revises'] = [];
  return {
    stops,
    revises,
    managed: {
      stop: Effect.fnUntraced(function* (
        _projectId: number,
        key: TerminalOperationKey,
        execution: ExecutionRef,
        authority: { readonly prepared: { readonly request: { readonly actor: { readonly _tag: string } } } },
        cause: string,
        action: string,
      ) {
        stops.push({ key, execution, cause, action, actor: authority.prepared.request.actor._tag });
        if (gate !== undefined) yield* Deferred.await(gate);
        return {
          operation: { installation, operation: key.operationId },
          execution,
          requested: action,
          cause,
          steps: ['interrupt'],
          cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'the test measures nothing' },
          coverage: [],
          relation: 'leader',
          confirmed: [],
          residual: [],
          unverifiable: [],
          streams: [],
          cleanup,
          retention: 'retained',
          abandonedOutput: false,
        } as unknown as StopReceipt;
      }),
      revise: (
        key: TerminalOperationKey,
        execution: ExecutionRef,
        authority: {
          readonly prepared: {
            readonly request: { readonly actor: { readonly _tag: string }; readonly change: unknown };
          };
        },
        _cause: string,
        expected: number,
      ) =>
        Effect.sync(() => {
          revises.push({ key, expected, actor: authority.prepared.request.actor._tag, change: authority.prepared.request.change });
          return {
            _tag: 'Revised',
            operation: { installation, operation: key.operationId },
            deadline: {
              execution,
              revision: 5,
              executionMs: revision.executionMs,
              ceilingMs: revision.ceilingMs,
              armed: revision.armed ? ('native-acquired' as const) : undefined,
            },
          };
        }),
    } as unknown as ManagedCommands['Service'],
  };
};

const bindingFor = (): ShellCommandBinding =>
  ({
    installation,
    projectId: 7,
    actor: { _tag: 'Thread', threadId: 'thread-1', projectId: 7 },
    owner: { _tag: 'Thread', thread: 'thread-1' },
    creator: { _tag: 'Thread', thread: 'thread-1', run: 'run-1' },
    target: { binding: { environmentId: 'env-1', namespaceId: 'ns-1' } },
    environment: () => [],
    credits: 8,
    inspect: () => 'the test reads nothing',
  }) as unknown as ShellCommandBinding;

const stopOf = () => {
  const said = Deferred.makeUnsafe<CallCancellation>();
  const settled = Deferred.makeUnsafe<void>();
  let cancellation: CallCancellation | null = null;
  return {
    stopped: () => cancellation,
    stopping: Deferred.await(said).pipe(Effect.ensuring(Deferred.succeed(settled, undefined))),
    settled: Deferred.await(settled),
    stop: (given: CallCancellation) => {
      cancellation = given;
      Deferred.doneUnsafe(said, Effect.succeed(given));
    },
  };
};

const requestFor = (operation: string, stop: CallStopping, background = false): CommandRequest => ({
  program: '/bin/echo',
  args: ['hi'],
  cwd: '/tmp',
  env: {},
  label: 'Print a word',
  correlation: 'call-1',
  operation: HostRequestKey.make(operation),
  waitMs: background ? 0 : 180_000,
  stop,
});

const CALLER_RECEIPT = {
  limits: { executionMs: 120_000, executionCeilingMs: 300_000, origin: 'caller' },
  policyIdentity: 'policy-1',
  time: { tool: 'bash', requested: 120_000, rules: [] },
} as const;

const accessFor = (receipt: unknown = CALLER_RECEIPT): CommandAccess['Service'] =>
  ({
    prepare: (request: {
      readonly _tag?: string;
      readonly actor?: unknown;
      readonly execution?: ExecutionRef;
      readonly change?: unknown;
    }) =>
      Effect.succeed(
        request._tag === 'Revise'
          ? {
              request: {
                _tag: 'Revise',
                actor: request.actor,
                scope: 7,
                execution: request.execution,
                current: { executionMs: 120_000, ceilingMs: 300_000, revision: 4 },
                change: request.change,
                ceilings: {},
              },
              subjects: [],
              targetKey: 'key-1',
              origin: null,
              owner: null,
              ownerStanding: null,
              ownerFence: null,
              lineage: null,
              policyIdentity: null,
              revision: 4,
            }
          : request._tag === 'Stop'
            ? {
                request: { _tag: 'Stop', actor: request.actor, scope: 7, execution: request.execution },
                subjects: [],
                targetKey: 'key-1',
                origin: null,
                owner: null,
                ownerStanding: null,
                ownerFence: null,
                lineage: null,
                policyIdentity: null,
              }
            : {
                request: {
                  _tag: 'Launch',
                  actor: { _tag: 'Thread', threadId: 'thread-1', projectId: 7 },
                  scope: 7,
                  target: { binding: { environmentId: 'env-1', namespaceId: 'ns-1' } },
                  program: '/bin/echo',
                  args: [],
                  tool: 'bash',
                  requested: 120_000,
                  owner: { _tag: 'Thread', thread: 'thread-1' },
                  creator: { _tag: 'Thread', thread: 'thread-1', run: 'run-1' },
                  operation: (request as { operation: HostRequestKey }).operation,
                },
                subjects: [],
                targetKey: 'key-1',
                receipt,
                origin: null,
                owner: { _tag: 'Thread', thread: 'thread-1' },
                ownerStanding: null,
                ownerFence: null,
                lineage: null,
                policyIdentity: 'policy-1',
              },
      ),
    recheck: () => Effect.void,
  }) as unknown as CommandAccess['Service'];

const commandsOver = (
  host: Host,
  managed: ManagedCommands['Service'] = {} as unknown as ManagedCommands['Service'],
  lease: Scope.Closeable = Scope.makeUnsafe(),
  receipt?: unknown,
) =>
  makeShellCommands({
    executions: host.service,
    access: accessFor(receipt),
    launches: new PreparedLaunches(),
    binding: bindingFor(),
    lease: (): Effect.Effect<WorldLease> => Effect.succeed({ scope: lease, release: Effect.void }),
    managed,
  });

it.live('stopping one call ends its own command through the product’s road and answers the measured ending', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const two = refOf('exec-two');
    const asked = yield* Deferred.make<void>();
    const measuring = yield* Deferred.make<void>();
    const host = hostOver({
      executions: new Map([
        ['op-one', one],
        ['op-two', two],
      ]),
      asked,
    });
    const control = controlOver('residual', { executionMs: 120_000, ceilingMs: 300_000, armed: true }, measuring);
    const commands = commandsOver(host, control.managed);
    const stopping = stopOf();
    const siblingStop = stopOf();

    const accepted = yield* commands.start(requestFor('op-one', stopping), () => Effect.never);
    const sibling = yield* commands.start(requestFor('op-two', siblingStop), () => Effect.never);
    const siblingAnswer = yield* Effect.result(sibling.run.result);
    stopping.stop(new CallCancellation('explicit-stop', 'Stopped by the operator.'));
    yield* Deferred.await(asked);
    const landed = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(
      Effect.result(accepted.run.result).pipe(Effect.flatMap((answer) => Deferred.succeed(landed, undefined).pipe(Effect.as(answer)))),
    );
    yield* Effect.yieldNow;
    const early = yield* Deferred.isDone(landed);
    yield* Deferred.succeed(measuring, undefined);
    const settled = yield* Fiber.join(waiting);

    expect(early).toBe(false);
    expect(settled._tag === 'Success' && settled.success._tag !== 'Unavailable' ? settled.success.cleanup : undefined).toBe('residual');

    expect(host.cancellations).toHaveLength(1);
    expect(host.cancellations[0]?.operation.operation).toBe(HostRequestKey.make('op-one'));
    expect(host.cancellations[0]?.cause).toBe('explicit-stop');
    expect(host.cancellations[0]?.trigger).toBe('Stopped by the operator.');
    expect(control.stops).toHaveLength(1);
    expect(control.stops[0]?.execution.execution).toBe(one.execution);
    expect(control.stops[0]?.execution.incarnation).toBe(one.incarnation);
    expect([control.stops[0]?.cause, control.stops[0]?.action]).toEqual(['explicit-stop', 'signal']);
    expect(control.stops[0]?.actor).toBe('Thread');
    expect(control.stops[0]?.key.operationId).toBe(HostRequestKey.make('op-one:stop'));
    expect(control.stops[0]?.key.mutation).toBe('stop');
    expect(siblingStop.stopped()).toBeNull();
    expect(
      siblingAnswer._tag === 'Success' && siblingAnswer.success._tag !== 'Unavailable' ? siblingAnswer.success.cleanup : undefined,
    ).toBe('pending');
  }),
);

it.live('a run’s own stop with no words of its own is declared run-abort and names the call it stopped', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const host = hostOver({ executions: new Map([['op-one', one]]) });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const commands = commandsOver(host, control.managed);
    const stopping = stopOf();

    const accepted = yield* commands.start(requestFor('op-one', stopping), () => Effect.never);
    stopping.stop(new CallCancellation('run-abort', ''));
    yield* Effect.result(accepted.run.result);

    expect(host.cancellations[0]?.cause).toBe('run-abort');
    expect(host.cancellations[0]?.trigger).toBe('the call this command belonged to was stopped');
    expect(control.stops[0]?.cause).toBe('run-abort');
  }),
);

const cleanupOf = (settled: Result.Result<CallDecisionAnswer, unknown>) =>
  settled._tag === 'Success' && settled.success._tag !== 'Unavailable' ? settled.success.cleanup : undefined;

const stoppedRun = Effect.fnUntraced(function* (host: Host, control: Control, cause: CallCancellation, background = false) {
  const stopping = stopOf();
  const accepted = yield* commandsOver(host, control.managed).start(requestFor('op-one', stopping, background), () => Effect.never);
  stopping.stop(cause);
  return yield* Effect.result(accepted.run.result);
});

it.live('a command nobody waits for survives the run’s own stop', () =>
  Effect.gen(function* () {
    const host = hostOver({ executions: new Map([['op-one', refOf('exec-one')]]) });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const settled = yield* stoppedRun(host, control, new CallCancellation('run-abort', 'Thread run stopped by user.'), true);

    expect(host.cancellations).toEqual([]);
    expect(control.stops).toEqual([]);
    expect(cleanupOf(settled)).toBe('pending');
  }),
);

it.live('a command nobody waits for is still ended when THIS invocation is stopped', () =>
  Effect.gen(function* () {
    const host = hostOver({ executions: new Map([['op-one', refOf('exec-one')]]) });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const settled = yield* stoppedRun(host, control, new CallCancellation('explicit-stop', 'Stopped by the operator.'), true);

    expect(host.cancellations[0]?.cause).toBe('explicit-stop');
    expect(control.stops).toHaveLength(1);
    expect(control.stops[0]?.cause).toBe('explicit-stop');
    expect(cleanupOf(settled)).toBe('complete');
  }),
);

it.live('a command whose ending was observed leaves nothing watching its call, so a later stop of that call reaches no host', () =>
  Effect.gen(function* () {
    const host = hostOver({ executions: new Map([['op-one', refOf('exec-one')]]) });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const stopping = stopOf();

    const accepted = yield* commandsOver(host, control.managed).start(requestFor('op-one', stopping), (run) => Effect.result(run.result));
    yield* accepted.observed;
    yield* stopping.settled;
    stopping.stop(new CallCancellation('explicit-stop', 'Stopped by the operator.'));

    expect(host.cancellations).toEqual([]);
    expect(control.stops).toEqual([]);
  }),
);

it.live('a cancellation that caught the launch in flight is measured once the acceptance names it', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const host = hostOver({
      executions: new Map([['op-one', one]]),
      cancellation: (operation) => ({ _tag: 'Attached', operation }) as unknown as CancelAnswer,
    });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const settled = yield* stoppedRun(host, control, new CallCancellation('explicit-stop', 'Stopped by the operator.'));

    expect(control.stops).toHaveLength(1);
    expect(control.stops[0]?.execution.execution).toBe(one.execution);
    expect(control.stops[0]?.cause).toBe('explicit-stop');
    expect(cleanupOf(settled)).toBe('complete');
  }),
);

it.live('a cancellation of a key nothing ever took prevents the launch and ends nothing', () =>
  Effect.gen(function* () {
    const host = hostOver({
      executions: new Map([['op-one', refOf('exec-one')]]),
      cancellation: (operation) => ({ _tag: 'Prevented', operation }) as unknown as CancelAnswer,
    });
    const control = controlOver('complete', { executionMs: 120_000, ceilingMs: 300_000, armed: true });
    const settled = yield* stoppedRun(host, control, new CallCancellation('explicit-stop', 'Stopped by the operator.'));

    expect(host.cancellations).toHaveLength(1);
    expect(control.stops).toEqual([]);
    expect(host.reads).toEqual([]);
    expect(cleanupOf(settled)).toBe('pending');
  }),
);

it.live('a limit raise rides the product’s own revision road and answers what the host made of it', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const spent = { executionMs: 120_000, ceilingMs: 300_000, armed: true };
    const expiresAt = (yield* Clock.currentTimeMillis) + 60_000;
    const host = hostOver({
      executions: new Map([['op-one', one]]),
      snapshot: (execution) =>
        ({
          admission: {},
          state: { ref: execution },
          deadline: {
            execution: execution,
            revision: 4,
            executionMs: spent.executionMs,
            ceilingMs: spent.ceilingMs,
            armed: 'native-acquired',
            expiresAt,
          },
        }) as unknown as CommandSnapshot,
    });
    const control = controlOver('complete', spent);
    const commands = commandsOver(host, control.managed);

    const accepted = yield* commands.start(requestFor('op-one', stopOf()), () => Effect.never);
    const revised = yield* accepted.run.revise(120_000, 'operator');

    expect(control.revises).toHaveLength(1);
    expect(control.revises[0]?.expected).toBe(4);
    expect(control.revises[0]?.actor).toBe('Operator');
    expect(control.revises[0]?.key.mutation).toBe('limit');
    expect(String(control.revises[0]?.key.operationId).startsWith('exec-one:limit:')).toBe(true);
    expect(control.revises[0]?.change).toEqual({ _tag: 'Remaining', remainingMs: 120_000 });
    expect(revised).toMatchObject({ state: 'revised', deadline: { state: 'armed', timeoutMs: 120_000 } });
  }),
);

it.live('a run whose limit a rule decided names that rule, and one on its own time names none', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const copy = {
      id: 'r1',
      thread: 'thread-1',
      through: 'bash',
      limitMs: 300_000,
      writer: 'tagma:thread-1',
      at: '2026-09-23T00:00:00.000Z',
      words: 'five minutes',
    };
    const runOf = (origin: 'rule' | 'caller') => {
      const host = hostOver({ executions: new Map([['op-one', one]]) });
      const control = controlOver('complete', { executionMs: 300_000, ceilingMs: 300_000, armed: false });
      const commands = commandsOver(host, control.managed, Scope.makeUnsafe(), {
        limits: { executionMs: 300_000, executionCeilingMs: 300_000, origin },
        policyIdentity: 'policy-1',
        time: { tool: 'bash', requested: 600_000, rules: [copy] },
      });
      return Effect.map(
        commands.start(requestFor('op-one', stopOf()), () => Effect.never),
        (accepted) => accepted.run.rule,
      );
    };
    expect(yield* runOf('rule')).toBeDefined();
    expect(yield* runOf('caller')).toBeUndefined();
  }),
);

it.live('an agent’s limit ask is the total it comes to, which is the shape a thread is allowed', () =>
  Effect.gen(function* () {
    const one = refOf('exec-one');
    const spent = { executionMs: 120_000, ceilingMs: 300_000, armed: true };
    const host = hostOver({
      executions: new Map([['op-one', one]]),
      snapshot: (execution) =>
        ({
          admission: {},
          state: { ref: execution },
          deadline: {
            execution,
            revision: 4,
            executionMs: spent.executionMs,
            ceilingMs: spent.ceilingMs,
            armed: 'native-acquired',
            elapsedMs: 60_000,
            expiresAt: -1,
          },
        }) as unknown as CommandSnapshot,
    });
    const control = controlOver('complete', spent);
    const commands = commandsOver(host, control.managed);

    const accepted = yield* commands.start(requestFor('op-one', stopOf()), () => Effect.never);
    yield* accepted.run.revise(30_000, 'agent');

    expect(control.revises[0]?.actor).toBe('Thread');
    expect(control.revises[0]?.change).toEqual({ _tag: 'Total', executionMs: 90_000 });
  }),
);

it.effect('a command is found again by the call that started it, read through its owner, and a call that started none finds none', () =>
  Effect.gen(function* () {
    const asked: Array<{ readonly projectId: number; readonly call: unknown }> = [];
    const found = refOf('exec-found');
    const rule = { id: 'r1', limitMs: 5_000, writer: 'operator', at: 'now', words: 'keep it short' };
    const managed = {
      startedBy: (projectId: number, call: { readonly toolCall: string }) =>
        Effect.suspend(() => {
          asked.push({ projectId, call });
          if (call.toolCall === 'call-unread') return Effect.fail(new TerminalUnavailable({ owner: 'store', message: 'the store is closed' }));
          return Effect.succeed(
            call.toolCall === 'call-1'
              ? {
                  record: { execution: found, time: { tool: 'bash', rules: [rule], life: { ms: 5_000, origin: 'rule' } } },
                  operation: HostRequestKey.make('call-1:minted'),
                }
              : null,
          );
        }),
    } as unknown as ManagedCommands['Service'];
    const commands = commandsOver(hostOver({ executions: new Map() }), managed);

    const run = yield* commands.startedBy('call-1');
    expect(asked[0]).toEqual({ projectId: 7, call: { thread: 'thread-1', run: 'run-1', toolCall: 'call-1' } });
    expect(run?.execution).toEqual(found);
    expect(run?.operation).toEqual({ installation, operation: HostRequestKey.make('call-1:minted') });
    expect(run?.rule).toContain('r1 (life');
    expect(yield* commands.startedBy('call-2')).toBeNull();
    const unread = yield* Effect.flip(commands.startedBy('call-unread'));
    expect(unread._tag).toBe('CommandUnreadable');
    expect(unread.reason).toContain('the store is closed');
  }),
);
