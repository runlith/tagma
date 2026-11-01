import { note } from '@runlith/activity/Activity';
import { toJson } from '@runlith/utils/json';
import type { StructuredValue } from '@runlith/utils/object';
import { Cause, Clock, Context, Effect, Exit, Option, Result, Stream } from 'effect';
import { CostLedger, CurrentCost, endCost } from '@runlith/performance/CostLedger';
import { permissionRefusal } from '../../modes/ApprovalMode';
import type { AgentNote } from '../activities';
import type { AgentCalls, CallHooks } from '../AgentCalls';
import { type AgentCall, type CallCost, type CallHandoff, type CallTaking, WAIT_UNTOUCHED } from '../AgentCall';
import { callEnded, type CallControlResult } from '../callProgress';
import { AgentToolFailed, type AgentToolFailure } from '../AgentFailure';
import {
  BACKGROUND_DETAIL,
  type Claim,
  DETACHED_DETAIL,
  Tool,
  ToolAnswer,
  type ToolEffectSettlement,
  type ToolFailed,
  type ToolVerdict,
  doorAsked,
  documentAsked,
  contributorAbsent,
  contributorRefusal,
  toolExecute,
  toolOutcomeFailed,
  toolSettleEffect,
} from '../tool';
import { type AgentToolModelOutput, initialToolDisplay } from '../ToolOutput';
import { pendingRuntimeGuides } from '../AgentGuidanceJournal';
import { DoorMisuse } from './failures';
import { outcomeOutput } from './outcomeText';
import { ToolSettlements, type ToolSettlement } from '../ToolSettlements';
import type { CallLedger } from './CallLedger';
import type { CallOrder } from './CallOrder';
import type { OutputProjection } from './OutputProjection';
import type { ToolRules } from './ToolRules';
import type { ToolRun } from './ToolRun';
import type {
  AgentCallAdoption,
  AgentPermissionQuestion,
  AgentToolAttended,
  AgentToolInvocation,
  AgentToolOpening,
  AgentToolOutcome,
  AgentToolPreflight,
  AgentToolStop,
} from './types';

type TrackedCall<TCtx> = {
  readonly call: AgentCall;
  readonly hooks: CallHooks | null;
  readonly name: string;
  readonly stepNumber: number;
  readonly ctx: TCtx;
  began: boolean;
  answered: boolean;
  hasReturned: boolean;
  receipt?: AgentToolOutcome;
  settlement?: ToolSettlement;
  readBack?: Result.Result<ToolEffectSettlement, ToolFailed>;
};

type Ready = {
  call: AgentToolInvocation;
  prepared: AgentToolPreflight | null;
};

type Life = {
  readonly before?: Effect.Effect<Option.Option<AgentToolOutcome>, AgentToolFailure>;
  readonly detached?: boolean;
  readonly handoff?: CallHandoff;
};

type Now = () => number;

const stays = (what: string, cause: Cause.Cause<unknown>): string =>
  `The invocation stays in the foreground: ${what} — ${Cause.pretty(cause).split('\n', 1)[0]}`;

export type ToolExecution<TCtx> = ReturnType<typeof makeToolExecution<TCtx>>;

export const makeToolExecution = <TCtx>({
  run,
  ledger,
  order,
  rules,
  outputs,
  calls,
  callHooks,
}: {
  readonly run: ToolRun<TCtx>;
  readonly ledger: CallLedger;
  readonly order: CallOrder;
  readonly rules: ToolRules<TCtx>;
  readonly outputs: OutputProjection;
  readonly calls: AgentCalls | undefined;
  readonly callHooks: (() => CallHooks) | undefined;
}) => {
  const owned = new Map<string, TrackedCall<TCtx>>();
  const costs = new Map<string, CallCost>();
  ledger.onEnded(() => {
    for (const toolCallId of costs.keys()) finishCost(toolCallId);
    costs.clear();
    owned.clear();
    order.clear();
  });

  const callOf = (toolCallId: string): AgentCall | undefined => owned.get(toolCallId)?.call ?? calls?.get({ runId: run.runId, toolCallId });

  const finishCost = (toolCallId: string): void => {
    const cost = costs.get(toolCallId);
    if (cost?.owned === true && callOf(toolCallId) === undefined) endCost(cost.cause);
  };

  const costing = <A, E, R>(toolCallId: string, name: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.withFiber((fiber) => {
      const call = callOf(toolCallId);
      if (call !== undefined) return call.withCost(work);
      let cost = costs.get(toolCallId);
      const inherited = run.mode === 'hosted' ? Context.get(fiber.context, CurrentCost) : null;
      if (inherited !== null && cost?.cause !== inherited) cost = { cause: inherited, owned: false };
      if (cost === undefined) {
        const ledger = Context.getOrUndefined(fiber.context, CostLedger);
        if (ledger === undefined) return work;
        cost = { cause: ledger.open(name, JSON.stringify([run.runId, toolCallId])), owned: true };
      }
      costs.set(toolCallId, cost);
      return Effect.provideService(work, CurrentCost, cost.cause).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit)) finishCost(toolCallId);
          }),
        ),
      );
    });

  const track = (call: AgentPermissionQuestion): TrackedCall<TCtx> | null => {
    const held = owned.get(call.toolCallId);
    if (held !== undefined) return held;
    if (calls === undefined) return null;
    const hooks = callHooks?.() ?? null;
    const threadId = run.threadId ?? null;
    const opened = calls.open({
      runId: run.runId,
      toolCallId: call.toolCallId,
      threadId: threadId ?? undefined,
      name: call.name,
      input: call.input,
      cost: costs.get(call.toolCallId),
    });
    const tracked = {
      call: opened,
      hooks,
      name: call.name,
      stepNumber: run.runState.stepNumber,
      ctx: run.ctx,
      began: false,
      answered: false,
      hasReturned: false,
    };
    owned.set(call.toolCallId, tracked);
    return tracked;
  };

  const tracking = (call: AgentPermissionQuestion): Effect.Effect<TrackedCall<TCtx> | null> =>
    Effect.withFiber((fiber) => {
      const tracked = track(call);
      if (tracked?.settlement !== undefined) return Effect.succeed(tracked);
      const settlements = run.settlements ?? Context.get(fiber.context, ToolSettlements);
      const settlement = settlements?.retain(
        { toolCallId: call.toolCallId, caller: run.caller },
        () => {
          finishCost(call.toolCallId);
          owned.delete(call.toolCallId);
          costs.delete(call.toolCallId);
          if (run.mode === 'hosted') {
            ledger.forget(call.toolCallId);
            run.runState.confirmed(call.toolCallId);
          }
        },
        () => tracked?.call.record.mode === 'background',
        'call',
      );
      if (tracked !== null) tracked.settlement = settlement;
      return Effect.succeed(tracked);
    });

  const ended = (toolCallId: string): void => {
    const tracked = owned.get(toolCallId);
    if (tracked !== undefined && tracked.call.record.mode !== 'background') tracked.settlement?.ended();
  };

  //! Before execution only a thread that owes the outcome and can ask the call's reader may take it.
  const handable = (tracked: TrackedCall<TCtx>): boolean =>
    tracked.call.record.threadId !== null && tracked.hooks?.detaching !== undefined && tracked.hooks.asking !== undefined;

  const answer = (tracked: TrackedCall<TCtx>): void => {
    tracked.answered = true;
    if (tracked.began || callEnded(tracked.call.record)) order.answered(tracked.call.record.toolCallId);
  };

  const opening = (call: AgentToolInvocation, tracked: TrackedCall<TCtx>): AgentToolOpening => ({
    input: call.input,
    rawInput: call.input,
    display: undefined,
    openedAt: tracked.call.record.startedAt,
    resultRetention: call.resultRetention,
  });

  const callStops = (toolCallIds: readonly string[]): Stream.Stream<AgentToolStop> =>
    Stream.mergeAll(
      toolCallIds.flatMap((toolCallId) => {
        const call = callOf(toolCallId);
        const contributor = ledger.preparedOf(toolCallId)?.contributor;
        const stops: Stream.Stream<AgentToolStop>[] = [];
        if (call !== undefined) {
          stops.push(
            Stream.fromEffect(
              call.stops.pipe(Effect.map(() => ({ toolCallId, reason: call.record.detail ?? 'The invocation was stopped.' }))),
            ),
          );
        }
        if (contributor?.removed !== undefined) {
          const refusal = contributorRefusal(contributor.id);
          stops.push(Stream.fromEffect(Effect.as(contributor.removed, { toolCallId, reason: refusal.reason, refusal })));
        }
        return stops;
      }),
      { concurrency: 'unbounded' },
    );

  const stopOf = (toolCallId: string): Effect.Effect<AgentToolStop> =>
    Effect.flatMap(Stream.runHead(callStops([toolCallId])), (stop) => (Option.isSome(stop) ? Effect.succeed(stop.value) : Effect.never));

  const acquiring = (tracked: TrackedCall<TCtx>): Effect.Effect<{ readonly release: Effect.Effect<void> } | null, AgentToolFailed> => {
    const hooks = tracked.hooks;
    if (hooks === null) return Effect.succeed(null);
    return hooks
      .retain()
      .pipe(
        Effect.mapError(
          (failure) => new AgentToolFailed({ toolName: tracked.name, toolCallId: tracked.call.record.toolCallId, cause: failure }),
        ),
      );
  };

  const unexecuted = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    prepared: AgentToolPreflight,
    output: StructuredValue,
    verdict: ToolVerdict,
    took: Effect.Effect<number>,
  ): Effect.fn.Return<AgentToolOutcome, AgentToolFailure> {
    const { name, tool } = call;
    const refusal = yield* outputs.project(
      {
        name,
        tool,
        input: prepared.input,
        output,
        modelOutput: outcomeOutput(tool, prepared.rawInput, output),
        toolCallId: call.options.toolCallId,
      },
      false,
    );
    const durationMs = yield* took;
    return {
      ...refusal,
      executed: false,
      verdict,
      durationMs,
      display: outputs.display({
        tool,
        published: prepared.display,
        answered: undefined,
        modelOutput: refusal.modelOutput,
        durationMs,
      }),
    };
  });

  const executing = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    prepared: AgentToolPreflight,
    tracked?: TrackedCall<TCtx>,
  ): Effect.fn.Return<AgentToolOutcome, AgentToolFailure> {
    const { name, tool, options: declaredOptions } = call;
    const { input, display: declaredDisplay, permission } = prepared;
    const runState = run.runState;
    const step = tracked?.stepNumber;
    const options: Tool.ToolCallDispatchOptions = {
      ...declaredOptions,
      caller: run.caller,
      step: step ?? runState.stepNumber,
      prepared: prepared.prepared,
      progress: tracked === undefined ? undefined : tracked.call.progress,
      json: documentAsked(tool, prepared.rawInput),
    };
    const execute = toolExecute(tool);
    if (!execute) {
      return yield* Effect.die(new DoorMisuse(`Tool ${name} entered the execution door with no execute function.`));
    }
    const took = Effect.map(Clock.currentTimeMillis, (at) => at - prepared.openedAt);
    if (declaredDisplay && call.onDisplay && (tracked === undefined || tracked.call.record.mode === 'foreground')) {
      yield* call.onDisplay(
        initialToolDisplay({
          declared: declaredDisplay,
          mutates: tool.mutates === true,
          keep: tool.keepsTail ? 'tail' : 'head',
        }),
      );
    }
    const denied = permission.verdict === 'deny';
    const unanswered = denied || (permission.verdict === 'ask' && !call.confirmed);
    if (unanswered && !denied && !run.unattended) {
      return yield* Effect.die(new DoorMisuse(`Tool ${name} needs the reader's word and entered the door without it.`));
    }
    if (unanswered) {
      const refused = permissionRefusal(permission, name);
      return yield* unexecuted(call, prepared, toJson(refused), { kind: 'denied' }, took);
    }
    const waited = order.waited(options.toolCallId);
    if (tracked !== undefined) {
      tracked.began = true;
      order.began(options.toolCallId);
      if (tracked.answered) order.answered(options.toolCallId);
    } else if (call.onExecution)
      yield* call.onExecution({
        state: 'started',
        at: yield* Clock.currentTimeMillis,
        mutates: tool.mutates === true,
        after: waited?.after,
        waitedMs: waited?.waitedMs,
      });
    if (waited !== undefined) yield* note<AgentNote>({ type: 'tool-ordered', after: waited.after, waitedMs: waited.waitedMs });
    yield* note<AgentNote>({ type: 'tool-executing' });
    const settlements = run.settlements ?? (yield* ToolSettlements);
    const settled = tool.settled;
    const identity = { toolCallId: options.toolCallId, caller: options.caller };
    const owner = tracked?.call;
    const settlement =
      settled === undefined
        ? undefined
        : settlements?.retain(
            identity,
            () => settled(identity),
            () => owner?.record.mode === 'background',
          );
    const answered = yield* Effect.uninterruptibleMask((restore) =>
      restore(execute(input, options)).pipe(
        Effect.tap((output) =>
          Effect.sync(() => {
            if (tracked === undefined) return;
            tracked.readBack = Result.succeed({ status: 'completed', output });
            tracked.hasReturned = true;
          }),
        ),
        Effect.onInterrupt(() => {
          if (tracked === undefined) return Effect.void;
          const reading = toolSettleEffect(tool, { ...identity, toolInput: input, json: options.json });
          return reading === null
            ? Effect.void
            : Effect.map(Effect.result(reading), (readBack) => {
                tracked.readBack = readBack;
              });
        }),
        Effect.onExit(() => Effect.sync(() => settlement?.ended())),
        Effect.mapError((cause) => new AgentToolFailed({ toolName: name, toolCallId: options.toolCallId, cause })),
      ),
    );
    const answer = answered instanceof ToolAnswer ? answered.value : answered;
    const output = answer === undefined ? undefined : toJson(answer);
    const pictures = answered instanceof ToolAnswer && answered.media.length > 0 ? yield* outputs.pictures(answered.media) : undefined;
    const text = answered instanceof ToolAnswer ? answered.text : undefined;
    const projection = yield* outputs.project(
      {
        name,
        tool,
        input,
        output,
        toolCallId: options.toolCallId,
        pictures: pictures,
        source: answered instanceof ToolAnswer ? answered.source : undefined,
        modelOutput: text === undefined ? undefined : { type: 'text', value: text },
      },
      true,
      tool.keepsTail ? 'tail' : 'head',
      prepared.resultRetention,
    );
    const after = yield* rules.evaluate(
      {
        hook: 'afterTool',
        modelMessages: options.messages,
        tool: {
          name,
          input,
          output: projection.output,
          toolCallId: options.toolCallId,
          shown: answered instanceof ToolAnswer && answered.shown.length > 0 ? answered.shown : undefined,
        },
        invocationKey: options.toolCallId,
        ordinal: runState.count(name),
      },
      tracked?.ctx,
    );
    const live = tracked === undefined || tracked.call.record.mode === 'foreground';
    const at = { hook: 'afterTool', toolName: name, toolCallId: options.toolCallId } as const;
    if (live) rules.guide(after, at);
    const durationMs = yield* took;
    return {
      ...projection,
      guides: live ? undefined : pendingRuntimeGuides(at.hook, after, at),
      executed: true,
      verdict: answered instanceof ToolAnswer ? answered.verdict : { kind: 'answered' },
      durationMs,
      display: outputs.display({
        tool,
        published: declaredDisplay,
        answered: answered instanceof ToolAnswer ? answered.display : undefined,
        modelOutput: projection.modelOutput,
        durationMs,
        images: pictures?.shown,
      }),
      completion: answered instanceof ToolAnswer && answered.completion !== undefined ? answered.completion : undefined,
    };
  });

  const stoppedAnswer = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    prepared: AgentToolOpening,
    reason: string,
    tracked: TrackedCall<TCtx>,
    now: Now,
  ): Effect.fn.Return<AgentToolOutcome, AgentToolFailure> {
    const { name, tool } = call;
    const performed = tracked.began;
    const completed = tracked.hasReturned && !tracked.call.watching;
    const readBack = tracked.readBack;
    const recovered = readBack?._tag === 'Success' && readBack.success.status === 'completed' ? readBack.success.output : undefined;
    const answered = recovered instanceof ToolAnswer ? recovered.value : recovered;
    const output =
      readBack?._tag === 'Failure'
        ? { status: 'unreadable', reason: readBack.failure.reason }
        : answered === undefined
          ? null
          : toJson(answered);
    const said = performed ? reason : `${reason} The call had not started.`;
    const ending = { status: 'cancelled', reason: said, executions: tracked.call.record.executions };
    const cancelled: StructuredValue = tracked.call.watching
      ? { status: 'wait-ended', reason, untouched: WAIT_UNTOUCHED }
      : tool.keepsTail
        ? { output, ...ending }
        : { ...ending, output };
    const pictures =
      completed && recovered instanceof ToolAnswer && recovered.media.length > 0 ? yield* outputs.pictures(recovered.media) : undefined;
    const text = recovered instanceof ToolAnswer ? recovered.text : undefined;
    const projection = yield* outputs.project(
      {
        name,
        tool,
        input: prepared.input,
        output: completed ? (answered === undefined ? undefined : output) : cancelled,
        source: recovered instanceof ToolAnswer ? recovered.source : undefined,
        pictures,
        modelOutput: completed
          ? text === undefined
            ? undefined
            : { type: 'text', value: text }
          : outcomeOutput(tool, prepared.rawInput, cancelled, text),
        toolCallId: call.options.toolCallId,
      },
      performed,
      tool.keepsTail ? 'tail' : 'head',
      prepared.resultRetention,
    );
    const durationMs = now() - prepared.openedAt;
    const display = outputs.display({
      tool,
      published: prepared.display,
      answered: recovered instanceof ToolAnswer ? recovered.display : undefined,
      modelOutput: projection.modelOutput,
      durationMs,
      images: pictures?.shown,
    });
    return {
      ...projection,
      executed: performed,
      verdict: completed
        ? recovered instanceof ToolAnswer
          ? recovered.verdict
          : { kind: 'answered' }
        : tracked.call.watching
          ? { kind: 'answered' }
          : performed && tool.mutates === true && !(recovered instanceof ToolAnswer && recovered.verdict.kind === 'cancelled')
            ? { kind: 'unknown' }
            : { kind: 'cancelled' },
      durationMs,
      display,
      completion: completed && recovered instanceof ToolAnswer ? recovered.completion : undefined,
    };
  });

  const backgroundReceipt = (
    call: AgentToolInvocation,
    prepared: AgentToolOpening,
    tracked: TrackedCall<TCtx>,
    now: Now,
  ): AgentToolOutcome => {
    const { name, tool } = call;
    const began = tracked.began;
    const own = began ? tool.receipt?.({ toolCallId: call.options.toolCallId, caller: run.caller }) : undefined;
    const output =
      own === undefined
        ? {
            status: began ? 'running' : 'background',
            runId: run.runId,
            toolCallId: call.options.toolCallId,
            tool: name,
            detail: began ? DETACHED_DETAIL : BACKGROUND_DETAIL,
          }
        : toJson(own.value);
    const modelOutput: AgentToolModelOutput =
      typeof output === 'string'
        ? { type: 'text', value: output }
        : own?.text !== undefined
          ? { type: 'text', value: own.text }
          : outcomeOutput(tool, prepared.rawInput, output);
    const durationMs = now() - prepared.openedAt;
    return {
      output,
      modelOutput,
      executed: true,
      verdict: { kind: 'answered' },
      durationMs,
      display: outputs.display({
        tool,
        published: prepared.display,
        answered: own?.display,
        modelOutput,
        durationMs,
      }),
    };
  };

  const permitted = Effect.fnUntraced(function* (
    ready: Ready,
    prepared: AgentToolPreflight,
    tracked: TrackedCall<TCtx>,
  ): Effect.fn.Return<Option.Option<AgentToolOutcome>, AgentToolFailure> {
    const call = ready.call;
    const toolCallId = call.options.toolCallId;
    const took = Effect.map(Clock.currentTimeMillis, (at) => at - prepared.openedAt);
    const asking = tracked.hooks?.asking;
    if (asking === undefined) {
      const refused = permissionRefusal(prepared.permission, call.name);
      return Option.some(yield* unexecuted(call, prepared, toJson(refused), { kind: 'denied' }, took));
    }
    const verdict = yield* asking(tracked.call.record, {
      prepared,
      stopped: stopOf(toolCallId),
      moved: tracked.call.moved,
      background: () => tracked.call.record.mode === 'background',
    }).pipe(Effect.mapError((cause) => new AgentToolFailed({ toolName: call.name, toolCallId, cause })));
    if (verdict.allowed) {
      order.proceeding(toolCallId);
      ready.call = { ...call, confirmed: true };
      return Option.none();
    }
    const kind: ToolVerdict =
      verdict.refusal !== undefined
        ? { kind: 'refused', refusal: verdict.refusal }
        : verdict.stopped === true
          ? { kind: 'cancelled' }
          : { kind: 'denied' };
    return Option.some(yield* unexecuted(call, prepared, toJson(verdict.output), kind, took));
  });

  const decided = Effect.fnUntraced(function* (
    ready: Ready,
    admitted: AgentToolPreflight,
    tracked: TrackedCall<TCtx>,
  ): Effect.fn.Return<Option.Option<AgentToolOutcome>, AgentToolFailure> {
    const absent = contributorAbsent(admitted.contributor);
    const prepared = absent === null ? admitted : { ...admitted, permission: absent };
    ready.prepared = prepared;
    const call = ready.call;
    const permission = prepared.permission;
    const unanswered = permission.verdict === 'ask' && call.confirmed !== true;
    if (permission.verdict === 'deny' || (unanswered && run.unattended)) {
      const refused = permissionRefusal(permission, call.name);
      const took = Effect.map(Clock.currentTimeMillis, (at) => at - prepared.openedAt);
      return Option.some(yield* unexecuted(call, prepared, toJson(refused), { kind: 'denied' }, took));
    }
    return unanswered ? yield* permitted(ready, prepared, tracked) : Option.none();
  });

  const living = Effect.fnUntraced(function* (
    tracked: TrackedCall<TCtx>,
    ready: Ready,
    lifetime: { readonly release: Effect.Effect<void> } | null,
    life: Life,
  ): Effect.fn.Return<AgentToolOutcome, AgentToolFailure> {
    const toolCallId = tracked.call.record.toolCallId;
    const clock = yield* Clock.Clock;
    const now: Now = () => clock.currentTimeMillisUnsafe();
    const known = (): AgentToolOpening => ready.prepared ?? opening(ready.call, tracked);
    let released = false;
    let retained = false;
    const release = Effect.suspend(() => {
      if (released) return Effect.void;
      released = true;
      order.release(toolCallId);
      const held = lifetime === null ? Effect.void : lifetime.release;
      return retained ? Effect.ensuring(held, ledger.release()) : held;
    });
    const mutates = ready.call.tool.mutates === true;
    return yield* tracked.call
      .run({
        before: life.before,
        entered: () => {
          retained = true;
          ledger.retain();
        },
        started: (at) => {
          if (tracked.call.record.mode === 'background') {
            const began = tracked.hooks?.began?.(tracked.call.record) ?? Effect.void;
            return Effect.mapError(began, (cause) => new AgentToolFailed({ toolName: tracked.name, toolCallId, cause }));
          }
          const waited = order.waited(toolCallId);
          return (
            ready.call.onExecution?.({ state: 'started', at, mutates, after: waited?.after, waitedMs: waited?.waitedMs }) ?? Effect.void
          );
        },
        work: Effect.suspend(() => {
          const prepared = ready.prepared;
          return prepared === null
            ? Effect.die(new DoorMisuse(`Tool ${tracked.name} reached execution before its preparation.`))
            : executing(ready.call, prepared, tracked);
        }),
        background: () => backgroundReceipt(ready.call, known(), tracked, now),
        stopped: (reason) => stoppedAnswer(ready.call, known(), reason, tracked, now),
        outcome: (value) => (value.verdict.kind === 'denied' ? 'stopped' : toolOutcomeFailed(value.verdict.kind) ? 'failed' : 'completed'),
        release,
        owe: () =>
          (tracked.hooks?.detaching?.(tracked.call.record) ?? Effect.void).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                order.proceeding(toolCallId);
                if (!tracked.began) order.stand(toolCallId);
              }),
            ),
          ),
        detached: life.detached,
        early: handable(tracked),
        handoff: life.handoff,
        completed: (exit) =>
          (tracked.hooks?.completed(tracked.call.record, exit) ?? Effect.void).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                tracked.settlement?.ended();
                tracked.settlement?.delivered();
              }),
            ),
          ),
      })
      .pipe(
        Effect.onInterrupt(() => release),
        Effect.ensuring(Effect.sync(() => answer(tracked))),
      );
  });

  const owning = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    prepared: AgentToolPreflight,
    tracked: TrackedCall<TCtx>,
  ): Effect.fn.Return<AgentToolOutcome, AgentToolFailure> {
    const denied = prepared.permission.verdict === 'deny';
    const unanswered = denied || (prepared.permission.verdict === 'ask' && call.confirmed !== true);
    const toolCallId = call.options.toolCallId;
    if (unanswered && (denied || run.unattended)) {
      const refused = permissionRefusal(prepared.permission, call.name);
      const outcome = yield* executing(call, prepared, tracked);
      order.release(toolCallId);
      tracked.call.finish('stopped', refused.reason);
      return outcome;
    }
    const confirming = unanswered && call.confirming === true && tracked.hooks?.asking !== undefined;
    const clock = yield* Clock.Clock;
    const now: Now = () => clock.currentTimeMillisUnsafe();
    if (tracked.call.stopped) {
      order.release(toolCallId);
      const reason = tracked.call.record.detail ?? 'Stopped.';
      tracked.call.finish('stopped', reason);
      return yield* stoppedAnswer(call, prepared, reason, tracked, now);
    }
    const acquired = yield* Effect.exit(acquiring(tracked));
    if (Exit.isFailure(acquired)) {
      order.release(toolCallId);
      tracked.call.finish('failed', 'The invocation could not take its own resources.');
      return yield* Effect.failCause(acquired.cause);
    }
    const ready: Ready = { call, prepared };
    return yield* living(tracked, ready, acquired.value, {
      before: confirming ? permitted(ready, prepared, tracked) : undefined,
      detached:
        call.tool.doorFields?.includes('background') === true &&
        tracked.call.record.threadId !== null &&
        tracked.hooks?.detaching !== undefined &&
        doorAsked(prepared.rawInput, 'background') === true,
    });
  });

  const takeOver = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    tracked: TrackedCall<TCtx>,
    preparing: Effect.Effect<AgentToolPreflight, AgentToolFailure>,
  ): Effect.fn.Return<CallTaking<AgentToolOutcome>> {
    const acquired = yield* Effect.exit(acquiring(tracked));
    if (Exit.isFailure(acquired)) return { refused: stays('it could not take its own resources', acquired.cause) };
    const lifetime = acquired.value;
    const owed = yield* Effect.exit(tracked.hooks?.detaching?.(tracked.call.record) ?? Effect.void);
    if (Exit.isFailure(owed)) {
      yield* lifetime === null ? Effect.void : lifetime.release;
      return { refused: stays('its outcome could not be recorded as owed to its thread', owed.cause) };
    }
    order.proceeding(call.options.toolCallId);
    order.stand(call.options.toolCallId);
    const ready: Ready = { call, prepared: null };
    const handed = yield* Effect.exit(
      living(tracked, ready, lifetime, {
        before: Effect.flatMap(preparing, (admitted) => decided(ready, admitted, tracked)),
        handoff: 'taken',
      }),
    );
    if (Exit.isFailure(handed)) return { refused: stays('it could not be handed over', handed.cause) };
    tracked.receipt = handed.value;
    return { receipt: handed.value };
  });

  const adopt = Effect.fnUntraced(function* (
    call: AgentToolInvocation,
    prepared: AgentToolPreflight,
    claims: readonly Claim[],
  ): Effect.fn.Return<AgentCallAdoption> {
    const toolCallId = call.options.toolCallId;
    const tracked = yield* tracking({
      name: call.name,
      tool: call.tool,
      input: call.input,
      toolCallId,
      resultRetention: call.resultRetention,
    });
    if (tracked === null || !handable(tracked)) return { refused: 'No thread can own this call’s outcome in the background.' };
    const acquired = yield* Effect.exit(acquiring(tracked));
    if (Exit.isFailure(acquired)) return { refused: stays('it could not take its own resources', acquired.cause) };
    const lifetime = acquired.value;
    const restore = tracked.settlement?.defer();
    const clock = yield* Clock.Clock;
    const receipt = backgroundReceipt(call, prepared, tracked, () => clock.currentTimeMillisUnsafe());
    const ready: Ready = { call, prepared };
    return {
      call: tracked.call.record,
      receipt,
      abandon: (lifetime === null ? Effect.void : lifetime.release).pipe(Effect.ensuring(Effect.sync(() => restore?.()))),
      settled: tracked.call.settled,
      live: Effect.suspend(() => {
        order.place([{ toolCallId, name: call.name, claims }]);
        order.stand(toolCallId);
        tracked.receipt = receipt;
        return Effect.asVoid(
          Effect.orDie(living(tracked, ready, lifetime, { before: decided(ready, prepared, tracked), handoff: 'adopted' })),
        );
      }),
    };
  });

  const kept = (tracked: TrackedCall<TCtx>): Effect.Effect<AgentToolOutcome | null> =>
    Effect.flatMap(tracked.call.keep(), (held) =>
      held
        ? Effect.succeed(null)
        : tracked.receipt === undefined
          ? Effect.die(new DoorMisuse(`Tool ${tracked.name} went to the background without a receipt.`))
          : Effect.succeed(tracked.receipt),
    );

  return {
    costing,
    finishCost,
    ended,

    preparing: <A, E>(call: AgentPermissionQuestion, reading: Effect.Effect<A, E>, stopped: (reason: string) => E): Effect.Effect<A, E> =>
      Effect.flatMap(tracking(call), (tracked) =>
        (tracked === null ? reading : tracked.call.prepare(reading, stopped)).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              order.release(call.toolCallId);
              ended(call.toolCallId);
            }),
          ),
        ),
      ),

    attend: Effect.fn('ToolExecution.attend')(function* (
      call: AgentToolInvocation,
      preparing: Effect.Effect<AgentToolPreflight, AgentToolFailure>,
    ): Effect.fn.Return<AgentToolAttended, AgentToolFailure> {
      const prepared = (value: AgentToolPreflight): AgentToolAttended => ({ kind: 'prepared', prepared: value });
      const tracked = yield* tracking({
        name: call.name,
        tool: call.tool,
        input: call.input,
        toolCallId: call.options.toolCallId,
        resultRetention: call.resultRetention,
      });
      if (tracked === null || !handable(tracked)) return yield* Effect.map(preparing, prepared);
      const attended = Effect.map(
        tracked.call.attend(preparing, (held) => takeOver(call, tracked, held)),
        (taken): AgentToolAttended => (taken.handed ? { kind: 'answered', outcome: taken.receipt } : prepared(taken.value)),
      );
      if (call.tool.doorFields?.includes('background') !== true || doorAsked(call.input, 'background') !== true) return yield* attended;
      return yield* Effect.flatMap(takeOver(call, tracked, preparing), (taken) =>
        'receipt' in taken ? Effect.succeed<AgentToolAttended>({ kind: 'answered', outcome: taken.receipt }) : attended,
      );
    }),

    queued: (toolCallId: string, reason: string): void => {
      owned.get(toolCallId)?.call.stage('waiting', reason);
    },

    parked: (toolCallId: string, take: Effect.Effect<CallControlResult>): (() => void) => {
      const tracked = owned.get(toolCallId);
      return tracked === undefined || !handable(tracked) ? () => {} : tracked.call.offer(take);
    },

    adopt,

    callStops,

    decline: (toolCallId: string, reason: string, phase: 'failed' | 'stopped' = 'failed'): void => {
      order.release(toolCallId);
      callOf(toolCallId)?.finish(phase, reason);
      ended(toolCallId);
    },

    prepared: (call: AgentPermissionQuestion, prepared: AgentToolPreflight): void => {
      if (prepared.permission.verdict !== 'ask' || run.unattended) return;
      if (owned.get(call.toolCallId)?.call.record.mode === 'background') return;
      order.asking(call.toolCallId);
    },

    perform: (call: AgentToolInvocation, admitted: AgentToolPreflight): Effect.Effect<AgentToolOutcome, AgentToolFailure> => {
      const absent = contributorAbsent(admitted.contributor);
      const prepared = absent === null ? admitted : { ...admitted, permission: absent };
      const toolCallId = call.options.toolCallId;
      const asking = prepared.permission.verdict === 'ask' && call.confirmed !== true && call.confirming === true && !run.unattended;
      if (!asking) order.proceeding(toolCallId);
      const tracked = owned.get(toolCallId);
      if (tracked === undefined) return executing(call, prepared).pipe(Effect.ensuring(Effect.sync(() => order.release(toolCallId))));
      return Effect.flatMap(kept(tracked), (receipt) => (receipt === null ? owning(call, prepared, tracked) : Effect.succeed(receipt)));
    },

    keep: (toolCallId: string): Effect.Effect<AgentToolOutcome | null> => {
      const tracked = owned.get(toolCallId);
      return tracked === undefined ? Effect.succeed(null) : kept(tracked);
    },
  };
};
