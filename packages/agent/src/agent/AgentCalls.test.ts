import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Stream } from 'effect';
import { makeAgentCalls } from './AgentCalls';
import { type AgentCall, type Arrival, REPORT_ENDED_WAIT, RUN_STOPPED, WORDS_ENDED_WAIT } from './AgentCall';
import { LONGEST_ACT_MS } from './callProgress';
import { RunStop } from './RunStop';
import { ExecutionId, Incarnation, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
const origin = (toolCallId: string) => ({ runId: 'run', threadId: 'thread', toolCallId, name: 'search', input: { pattern: 'needle' } });
const command = (label: string) => ({
  execution: { installation: InstallationId.make('installation'), execution: ExecutionId.make(label), incarnation: Incarnation.make(1) },
  operation: { installation: InstallationId.make('installation'), operation: HostRequestKey.make(label) },
  kind: 'command' as const,
  label,
});
describe('invocation lifetime', () => {
  it.effect(
    'stopping one call waits for its cleanup and leaves its sibling running',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 2 });
      const one = calls.open(origin('one'));
      const two = calls.open(origin('two'));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<string>();
      let cleaned = false;
      const first = yield* Effect.forkScoped(
        one.run({
          work: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                cleaned = true;
              }),
            ),
          ),
          background: () => 'background',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      const second = yield* Effect.forkScoped(
        two.run({
          work: Deferred.await(release),
          background: () => 'background',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      expect((yield* calls.control(origin('one'), { action: 'stop' })).status).toBe('changed');
      expect(yield* Fiber.join(first)).toBe('stopped');
      expect(cleaned).toBe(true);
      expect(two.stopped).toBe(false);
      yield* Deferred.succeed(release, 'sibling completed');
      expect(yield* Fiber.join(second)).toBe('sibling completed');
      expect(one.record.phase).toBe('stopped');
      expect(two.record.phase).toBe('completed');
    }),
  );
  it.effect.each([false, true])(
    'a stopped outcome settles before releasing its invocation, including a failed read-back (%p)',
    Effect.fnUntraced(function* (fails) {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('settling'));
      const entered = yield* Deferred.make<void>();
      const settling = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      let held = true;
      const waiter = yield* Effect.forkScoped(
        Effect.exit(
          call.run({
            work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
            background: () => 'receipt',
            stopped: () =>
              Deferred.succeed(settling, undefined).pipe(
                Effect.andThen(Deferred.await(finish)),
                Effect.andThen(fails ? Effect.fail('read-back failed') : Effect.succeed('settled report')),
              ),
            completed: () => Effect.void,
            release: Effect.sync(() => {
              held = false;
            }),
          }),
        ),
      );
      yield* Deferred.await(entered);
      call.stop('Stopped by the operator.');
      yield* Deferred.await(settling);
      expect(held).toBe(true);
      yield* Deferred.succeed(finish, undefined);
      expect(yield* Fiber.join(waiter)).toEqual(fails ? Exit.fail('read-back failed') : Exit.succeed('settled report'));
      expect(held).toBe(false);
    }),
  );
  it.effect(
    'background conversion releases the waiter but retains work and delivers its later result once',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const stop = new RunStop();
      calls.bind('run', stop);
      const call = calls.open(origin('one'));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<string>();
      const delivered: string[] = [];
      let executions = 0;
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Effect.gen(function* () {
            executions++;
            yield* Deferred.succeed(entered, undefined);
            return yield* Deferred.await(release);
          }),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: (exit) =>
            Effect.sync(() => {
              delivered.push(Exit.isSuccess(exit) ? exit.value : 'failed');
            }),
        }),
      );
      yield* Deferred.await(entered);
      expect((yield* call.handOff()).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      stop.stop(undefined);
      expect(call.stopped).toBe(false);
      expect(call.record.endedAt).toBeNull();
      yield* Deferred.succeed(release, 'result');
      yield* call.settled;
      expect(delivered).toEqual(['result']);
      expect(executions).toBe(1);
      expect(call.record.phase).toBe('completed');
    }),
  );
  it.effect(
    'an invocation budget crosses to native resources in whole milliseconds',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('bounded'));
      const entered = yield* Deferred.make<void>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      call.progress.link(command('bounded'), {
        revise: (remaining) =>
          Effect.succeed(
            Number.isSafeInteger(remaining) && remaining > 0
              ? { status: 'changed' as const, detail: null }
              : { status: 'unavailable' as const, detail: 'The execution protocol requires whole milliseconds.' },
          ),
      });
      expect((yield* calls.control(origin('bounded'), { action: 'limit', milliseconds: 10_000 })).status).toBe('changed');
      expect(call.record.expiresAt).toBe(call.record.admittedAt! + 10_000);
      call.stop('End test work.');
      expect(yield* Fiber.join(waiter)).toBe('stopped');
    }),
  );
  it.effect(
    'a foreground limit past the longest act reaches no resource and moves no expiry; the background takes it',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('long'));
      const entered = yield* Deferred.make<void>();
      const revised: number[] = [];
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      call.progress.link(command('long'), {
        revise: (remaining) =>
          Effect.sync(() => {
            revised.push(remaining);
            return { status: 'changed' as const, detail: null };
          }),
      });
      const envelope = call.record.expiresAt;
      expect((yield* calls.control(origin('long'), { action: 'limit', milliseconds: LONGEST_ACT_MS + 1 })).status).toBe('unavailable');
      expect(revised).toEqual([]);
      expect(call.record.expiresAt).toBe(envelope);
      expect((yield* calls.control(origin('long'), { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      expect((yield* calls.control(origin('long'), { action: 'limit', milliseconds: LONGEST_ACT_MS + 1 })).status).toBe('changed');
      expect(revised).toEqual([expect.any(Number)]);
      call.stop('End test work.');
      yield* call.settled;
    }),
  );
  it.effect(
    'work that hands its own call to the background answers the receipt at once, runs on, and delivers its result once it ends',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('waited'));
      const finish = yield* Deferred.make<void>();
      const delivered: string[] = [];
      const answer = yield* call.run({
        work: Effect.gen(function* () {
          yield* call.progress.handOff();
          yield* Deferred.await(finish);
          return 'result';
        }),
        background: () => 'receipt',
        stopped: () => Effect.succeed('stopped'),
        completed: (exit) => Effect.sync(() => delivered.push(Exit.isSuccess(exit) ? exit.value : 'failed')),
      });
      expect(answer).toBe('receipt');
      expect(call.record.mode).toBe('background');
      expect(delivered).toEqual([]);
      yield* Deferred.succeed(finish, undefined);
      yield* call.settled;
      expect(delivered).toEqual(['result']);
    }),
  );
  it.effect(
    'background conversion during cleanup has one receipt and one later delivery',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('cleanup'));
      const cleaning = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const delivered: string[] = [];
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Effect.succeed('actual result'),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          release: Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
          completed: (exit) => Effect.sync(() => delivered.push(Exit.isSuccess(exit) ? exit.value : 'failed')),
        }),
      );
      yield* Deferred.await(cleaning);
      expect((yield* call.handOff()).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      yield* Deferred.succeed(release, undefined);
      yield* call.settled;
      expect(delivered).toEqual(['actual result']);
      expect((yield* calls.control(origin('cleanup'), { action: 'background' })).status).toBe('ended');
    }),
  );
  const linkedCommand = (call: AgentCall, moving: Effect.Effect<void>, said: boolean[], modes: string[]) =>
    call.progress.link(command('moved'), {
      revise: () => Effect.succeed({ status: 'changed', detail: null }),
      background: () =>
        Effect.sync(() => modes.push(call.record.mode)).pipe(Effect.andThen(moving), Effect.as({ status: 'carried' as const })),
      handed: (moved) => Effect.sync(() => said.push(moved)),
    });
  it.effect(
    'a hand-off moves each linked command before its call, tells it whether the call went, and owes nothing a command carries',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('linked'));
      const entered = yield* Deferred.make<void>();
      const said: boolean[] = [];
      const modes: string[] = [];
      let owed = 0;
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
          owe: () => Effect.sync(() => (owed += 1)),
        }),
      );
      yield* Deferred.await(entered);
      linkedCommand(call, Effect.void, said, modes);
      expect((yield* calls.control(origin('linked'), { action: 'background' })).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      expect(modes).toEqual(['foreground']);
      expect(said).toEqual([true]);
      expect(owed).toBe(0);
      call.stop('End test work.');
      yield* call.settled;
    }),
  );
  it.effect(
    'a command linked after its call went to the background is moved there too',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('late'));
      const entered = yield* Deferred.make<void>();
      const moved = yield* Deferred.make<boolean>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      expect((yield* call.handOff()).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      call.progress.link(command('late'), {
        revise: () => Effect.succeed({ status: 'changed', detail: null }),
        background: () => Effect.succeed({ status: 'carried' }),
        handed: (handed) => Deferred.succeed(moved, handed).pipe(Effect.asVoid),
      });
      expect(yield* Deferred.await(moved)).toBe(true);
      call.stop('End test work.');
      yield* call.settled;
    }),
  );
  it.effect(
    'a linked command moved while its body answers, or while its call is stopped, is told to take the move back',
    Effect.fnUntraced(function* () {
      const handedWhile = Effect.fnUntraced(function* (
        interrupt: (call: AgentCall, body: Deferred.Deferred<string>) => Effect.Effect<void>,
      ) {
        const calls = yield* makeAgentCalls({ history: 1 });
        const call = calls.open(origin('taken-back'));
        const entered = yield* Deferred.make<void>();
        const moving = yield* Deferred.make<void>();
        const moveOn = yield* Deferred.make<void>();
        const body = yield* Deferred.make<string>();
        const released = yield* Deferred.make<void>();
        const said: boolean[] = [];
        const delivered: string[] = [];
        const waiter = yield* Effect.forkScoped(
          call.run({
            work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(body))),
            release: Deferred.succeed(released, undefined).pipe(Effect.asVoid),
            background: () => 'receipt',
            stopped: () => Effect.succeed('stopped'),
            completed: (exit) => Effect.sync(() => delivered.push(Exit.isSuccess(exit) ? exit.value : 'failed')),
          }),
        );
        yield* Deferred.await(entered);
        linkedCommand(call, Deferred.succeed(moving, undefined).pipe(Effect.andThen(Deferred.await(moveOn))), said, []);
        const handing = yield* Effect.forkScoped(call.handOff());
        yield* Deferred.await(moving);
        yield* interrupt(call, body);
        yield* Deferred.await(released);
        yield* Deferred.succeed(moveOn, undefined);
        const status = (yield* Fiber.join(handing)).status;
        const answer = yield* Fiber.join(waiter);
        yield* call.settled;
        return { said, status, answer, delivered, mode: call.record.mode };
      });
      expect(yield* handedWhile((_, body) => Deferred.succeed(body, 'actual result').pipe(Effect.asVoid))).toEqual({
        said: [false],
        status: 'changed',
        answer: 'receipt',
        delivered: ['actual result'],
        mode: 'background',
      });
      expect(yield* handedWhile((call) => Effect.sync(() => call.stop('Stopped by the operator.')))).toEqual({
        said: [false],
        status: 'unavailable',
        answer: 'stopped',
        delivered: [],
        mode: 'foreground',
      });
    }),
  );
  it.effect(
    'interrupting a foreground waiter stops its call and releases the owned resource once',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('withdrawn'));
      const entered = yield* Deferred.make<void>();
      let releases = 0;
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
          release: Effect.sync(() => {
            releases++;
          }),
        }),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(waiter);
      yield* call.settled;
      expect(releases).toBe(1);
      expect(call.record.phase).toBe('stopped');
      expect(call.stoppedBy?.reason).toBe('run-abort');
    }),
  );
  it.effect(
    'stopping a run interrupts its foreground calls and stops a call it opens afterwards',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 2 });
      const stop = new RunStop();
      calls.bind('run', stop);
      const call = calls.open(origin('running'));
      const entered = yield* Deferred.make<void>();
      let cleaned = false;
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                cleaned = true;
              }),
            ),
          ),
          background: () => 'receipt',
          stopped: (reason) => Effect.succeed(reason),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      stop.stop(undefined);
      expect(yield* Fiber.join(waiter)).toBe(RUN_STOPPED);
      expect(cleaned).toBe(true);
      expect(call.record.phase).toBe('stopped');
      let ran = false;
      const late = calls.open(origin('late'));
      expect(
        yield* late.run({
          work: Effect.sync(() => {
            ran = true;
            return 'ran';
          }),
          background: () => 'receipt',
          stopped: (reason) => Effect.succeed(reason),
          completed: () => Effect.void,
        }),
      ).toBe(RUN_STOPPED);
      expect(ran).toBe(false);
    }),
  );
  it.effect(
    'an invocation identity cannot execute its side effect again through another holder',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const effects: string[] = [];
      const options = {
        work: Effect.sync(() => {
          effects.push('written');
          return 'result';
        }),
        background: () => 'receipt',
        stopped: () => Effect.succeed('stopped'),
        completed: () => Effect.void,
      };
      yield* calls.open(origin('once')).run(options);
      const repeated = yield* Effect.exit(calls.open(origin('once')).run(options));
      expect(Exit.isFailure(repeated) && Cause.hasDies(repeated.cause)).toBe(true);
      expect(effects).toEqual(['written']);
    }),
  );
  it.effect(
    'failed cleanup is visible as unavailable rather than a successful ending',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('cleanup-failed'));
      const result = yield* Effect.exit(
        call.run({
          work: Effect.succeed('result'),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          release: Effect.die(new Error('Resource release failed')),
          completed: () => Effect.void,
        }),
      );
      expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
      expect(call.record.phase).toBe('unavailable');
    }),
  );
  it.effect(
    'a stop that lands while the hand-off records its debt keeps the call in the foreground',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('stop-while-owing'));
      const entered = yield* Deferred.make<void>();
      const owing = yield* Deferred.make<void>();
      const recorded = yield* Deferred.make<void>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
          owe: () => Deferred.succeed(owing, undefined).pipe(Effect.andThen(Deferred.await(recorded))),
        }),
      );
      yield* Deferred.await(entered);
      const handing = yield* Effect.forkScoped(call.handOff('agent'));
      yield* Deferred.await(owing);
      call.stop('Stopped by the operator.');
      yield* Deferred.succeed(recorded, undefined);
      expect((yield* Fiber.join(handing)).status).toBe('unavailable');
      expect(call.record.mode).toBe('foreground');
      expect(yield* Fiber.join(waiter)).toBe('stopped');
      expect(call.record.phase).toBe('stopped');
    }),
  );
  it.effect(
    'a call queued inside its invocation offers the hand-off, and one not yet admitted does not',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('queued'));
      yield* call.prepare(Effect.void, (reason) => new Error(reason));
      expect(call.record).toMatchObject({ phase: 'waiting', detachable: false });
      expect((yield* call.handOff()).status).toBe('unavailable');
      const queued = yield* Deferred.make<void>();
      const ahead = yield* Deferred.make<void>();
      const delivered: string[] = [];
      let bodies = 0;
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Effect.gen(function* () {
            call.stage('waiting', 'Waiting for an earlier write.');
            yield* Deferred.succeed(queued, undefined);
            yield* Deferred.await(ahead);
            bodies++;
            return 'result';
          }),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: (exit) => Effect.sync(() => delivered.push(Exit.isSuccess(exit) ? exit.value : 'failed')),
        }),
      );
      yield* Deferred.await(queued);
      expect(call.record).toMatchObject({ phase: 'waiting', detachable: true });
      expect((yield* calls.control(origin('queued'), { action: 'background' })).status).toBe('changed');
      expect(call.record).toMatchObject({ mode: 'background', detachable: false });
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      expect(bodies).toBe(0);
      yield* Deferred.succeed(ahead, undefined);
      yield* call.settled;
      expect(delivered).toEqual(['result']);
      expect(bodies).toBe(1);
    }),
  );
  it.effect(
    'stopping a prepared call settles it without executing a body',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const call = calls.open(origin('waiting'));
      yield* call.prepare(Effect.void, (reason) => new Error(reason));
      call.stop('Stopped by the operator.');
      yield* call.settled;
      expect(call.record.phase).toBe('stopped');
      expect(call.record.endedAt).not.toBeNull();
    }),
  );
  it.effect(
    'the finished window follows completion order even when clock stamps tie',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      const older = calls.open(origin('older-start'));
      const newer = calls.open(origin('newer-start'));
      newer.finish('completed');
      older.finish('completed');
      expect(older.record.endedAt).toBe(newer.record.endedAt);
      expect(calls.snapshot().map((call) => call.toolCallId)).toEqual(['older-start']);
    }),
  );
  it.live(
    'an invocation that never answers is ended by the runtime envelope, which the record carries',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1, envelopeMs: 30 });
      const call = calls.open(origin('silent'));
      const entered = yield* Deferred.make<void>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      expect(call.record.expiresAt).toBe(call.record.admittedAt! + 30);
      expect(call.record.expiresBy).toBe('envelope');
      expect(yield* Fiber.join(waiter)).toBe('stopped');
      expect(call.stoppedBy?.reason).toBe('timeout');
      expect(call.record.phase).toBe('stopped');
      expect(call.record.endedAt).not.toBeNull();
    }),
  );
  it.live(
    "the envelope counts from admission, so the reader's answer is not the call's time",
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1, envelopeMs: 40 });
      const call = calls.open(origin('late'));
      yield* call.prepare(Effect.void, (reason) => new Error(reason));
      yield* Effect.sleep('50 millis');
      const answer = yield* call.run({
        work: Effect.sync(() => {
          expect(call.record.expiresAt).toBe(call.record.admittedAt! + 40);
        }).pipe(Effect.andThen(Effect.sleep('10 millis')), Effect.as('done')),
        background: () => 'receipt',
        stopped: () => Effect.succeed('stopped'),
        completed: () => Effect.void,
      });
      expect(answer).toBe('done');
      expect(call.record.phase).toBe('completed');
      expect(call.record.admittedAt! - call.record.startedAt).toBeGreaterThanOrEqual(50);
    }),
  );
  it.live(
    "a limit is refused until admission and then counts from it, excluding the reader's answer",
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1, envelopeMs: 5_000 });
      const call = calls.open(origin('asked'));
      yield* call.prepare(Effect.void, (reason) => new Error(reason));
      expect((yield* calls.control(origin('asked'), { action: 'limit', milliseconds: 40 })).status).toBe('unavailable');
      expect(call.record.admittedAt).toBeNull();
      yield* Effect.sleep('50 millis');
      const entered = yield* Deferred.make<number>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Clock.currentTimeMillis.pipe(
            Effect.flatMap((at) => Deferred.succeed(entered, at)),
            Effect.andThen(Effect.never),
          ),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      const began = yield* Deferred.await(entered);
      const admittedAt = call.record.admittedAt!;
      expect(admittedAt - call.record.startedAt).toBeGreaterThanOrEqual(50);
      expect((yield* calls.control(origin('asked'), { action: 'limit', milliseconds: 40 })).status).toBe('changed');
      expect(call.record.expiresAt).toBe(admittedAt + 40);
      expect(yield* Fiber.join(waiter)).toBe('stopped');
      expect((yield* Clock.currentTimeMillis) - began).toBeGreaterThanOrEqual(30);
      expect(call.stoppedBy?.reason).toBe('timeout');
      expect(call.record.phase).toBe('stopped');
    }),
  );
  it.live(
    'handing the wait to the background releases the envelope with it',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1, envelopeMs: 30 });
      const call = calls.open(origin('handed'));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<string>();
      const waiter = yield* Effect.forkScoped(
        call.run({
          work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
        }),
      );
      yield* Deferred.await(entered);
      expect((yield* call.handOff()).status).toBe('changed');
      expect(yield* Fiber.join(waiter)).toBe('receipt');
      yield* Effect.sleep('60 millis');
      expect(call.record.expiresAt).toBeNull();
      expect(call.record.endedAt).toBeNull();
      yield* Deferred.succeed(release, 'late answer');
      yield* call.settled;
      expect(call.record.phase).toBe('completed');
    }),
  );
  it.effect(
    'a reconnect snapshot includes short completed invocations and still-running work',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 1 });
      yield* calls.open(origin('short')).run({
        work: Effect.succeed('done'),
        background: () => 'receipt',
        stopped: () => Effect.succeed('stopped'),
        completed: () => Effect.void,
      });
      calls.open(origin('preparing'));
      const snapshot = yield* Stream.runHead(calls.events());
      expect(snapshot._tag).toBe('Some');
      if (snapshot._tag !== 'Some') return;
      expect(snapshot.value.type).toBe('snapshot');
      if (snapshot.value.type !== 'snapshot') return;
      expect(snapshot.value.calls.map((entry) => [entry.toolCallId, entry.phase]).sort()).toEqual([
        ['preparing', 'preparing'],
        ['short', 'completed'],
      ]);
    }),
  );
  it.live(
    'an ended invocation kept in the window holds its record, not the run that owed its outcome',
    Effect.fnUntraced(function* () {
      const lend = Effect.fnUntraced(function* () {
        const calls = yield* makeAgentCalls({ history: 1 });
        const run = { owed: ['the run'] };
        yield* calls.open(origin('ended')).run({
          work: Effect.succeed('done'),
          background: () => 'receipt',
          stopped: () => Effect.succeed('stopped'),
          completed: () => Effect.void,
          owe: () => Effect.sync(() => run.owed.length),
        });
        return { calls, run: new WeakRef(run) };
      });
      //! Bun's conservative stack scan pins a dead closure now and then; only a window holding every run is a leak.
      const lent = yield* Effect.forEach([1, 2, 3, 4, 5], () => lend());
      yield* Effect.promise(() => Bun.sleep(0));
      Bun.gc(true);
      expect(lent.map(({ calls }) => calls.get(origin('ended'))?.record.phase)).toEqual(Array(5).fill('completed'));
      expect(lent.some(({ run }) => run.deref() === undefined)).toBe(true);
    }),
  );
});
describe("the operator's words and a report making way", () => {
  for (const [arrival, reason] of [
    ['words', WORDS_ENDED_WAIT],
    ['report', REPORT_ENDED_WAIT],
  ] as const)
    it.effect(
      `${arrival} end a watching call, hand a call holding a command to the background, and leave any other call running`,
      Effect.fnUntraced(function* () {
        const calls = yield* makeAgentCalls({ history: 3 });
        const watch = calls.open(origin('watch'));
        const shell = calls.open(origin('shell'));
        const read = calls.open(origin('read'));
        const running = Effect.fnUntraced(function* (call: AgentCall, watches: boolean) {
          const entered = yield* Deferred.make<void>();
          const fiber = yield* Effect.forkScoped(
            call.run({
              work: Effect.sync(() => {
                if (watches) call.progress.watch();
              }).pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Effect.never)),
              background: () => 'receipt',
              stopped: (reason) => Effect.succeed(reason),
              completed: () => Effect.void,
            }),
          );
          yield* Deferred.await(entered);
          return fiber;
        });
        const watching = yield* running(watch, true);
        const commanding = yield* running(shell, false);
        const reading = yield* running(read, false);
        shell.progress.link(command('gate'));
        calls.giveWay('run', arrival);
        expect(yield* Fiber.join(watching)).toBe(reason);
        expect(yield* Fiber.join(commanding)).toBe('receipt');
        expect(shell.record.mode).toBe('background');
        expect(shell.stopped).toBe(false);
        expect(read.stopped).toBe(false);
        expect(read.record.mode).toBe('foreground');
        shell.stop('End test work.');
        read.stop('End test work.');
        yield* Fiber.join(reading);
        yield* shell.settled;
      }),
    );
  it.effect(
    'a watching call that starts while the words are still unread ends at once',
    Effect.fnUntraced(function* () {
      const calls = yield* makeAgentCalls({ history: 2 });
      let unread: Arrival | null = 'words';
      calls.listen('run', () => unread);
      const late = calls.open(origin('late'));
      expect(
        yield* late.run({
          work: Effect.sync(() => late.progress.watch()).pipe(Effect.andThen(Effect.never)),
          background: () => 'receipt',
          stopped: (reason) => Effect.succeed(reason),
          completed: () => Effect.void,
        }),
      ).toBe(WORDS_ENDED_WAIT);
      unread = null;
      const after = calls.open(origin('after'));
      expect(
        yield* after.run({
          work: Effect.sync(() => after.progress.watch()).pipe(Effect.as('read')),
          background: () => 'receipt',
          stopped: (reason) => Effect.succeed(reason),
          completed: () => Effect.void,
        }),
      ).toBe('read');
    }),
  );
});
