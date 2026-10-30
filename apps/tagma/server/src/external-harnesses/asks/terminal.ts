import { Clock, Deferred, Effect, Fiber, Option, type Schema } from 'effect';
import type { ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { AskDelivery, TransportAsks } from '@runlith/agent/thread/transport/contract';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { questionEntryId } from '@runlith/agent/transcript/entryNames';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { ALLOW_ONCE, DENY, PERMISSION_OPTIONS } from '../../threads/contract/wire/harness/session.js';
import { sameScreenAsk } from '../adapter/screenAsk.js';
import type { HarnessCall, HarnessQuestionOption, HarnessWidgetKey, ScreenAsk } from '@runlith/tagma/adapter/harness';
import type { HarnessJudging } from '../contract/service/permissions.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import { PERMISSION_TIMEOUT_SECONDS, type HarnessDecision, type HarnessAnswer } from '../contract/wire/call.js';
import { AskRoutes, widgetAsksAbout, type AskRoute } from './routes.js';

export const TERMINAL_ROUTE = 'terminal';

const CLI_QUESTION = 'cli-question';

const SCREEN_ASKED = { screen: true, action: CLI_QUESTION, asked: [CLI_QUESTION], parent: true };

const ACK_MS = 2_000;

const PERMISSION_QUESTION_PREFIX = 'harness-permission:';

const OUTSIDE = 'The CLI resolved this question itself; Tagma did not answer it.';
const ENDED = 'The tool call finished without an answer from Tagma.';
const CONSUMED = 'The tool call finished after an answer was sent whose receipt was never confirmed.';

export type AskLedger = {
  current(threadId: string): Effect.Effect<ThreadRunRef | null, HarnessFailure>;
  asked(run: ThreadRunRef, entry: ThreadQuestionEntry, evidence: string): Effect.Effect<boolean, HarnessFailure>;
  resolved(
    run: ThreadRunRef,
    questionId: string,
    evidence: string,
    closing?: 'cleared' | 'answered',
    note?: string,
  ): Effect.Effect<void, HarnessFailure>;
  get(run: ThreadRunRef, questionId: string): Effect.Effect<ThreadQuestionEntry | null, HarnessFailure>;
  open(threadId: string, run: ThreadRunRef): Effect.Effect<readonly ThreadQuestionEntry[], HarnessFailure>;
  routed(threadId: string): Effect.Effect<void, HarnessFailure>;
};

export type Typed = 'admitted' | 'unwritten' | 'unknown';

export type AskFaces = {
  widget(threadId: string): Effect.Effect<ScreenAsk | null, HarnessFailure>;
  keys(
    threadId: string,
    widget: ScreenAsk,
    values: readonly string[],
    permission: boolean,
  ): Effect.Effect<readonly HarnessWidgetKey[] | null, HarnessFailure>;
  type(threadId: string, keys: readonly HarnessWidgetKey[], operation: string): Effect.Effect<Typed, HarnessFailure>;
  left(threadId: string, widget: ScreenAsk): Effect.Effect<'gone' | 'standing' | 'unreadable', HarnessFailure>;
};

export type Redelivery = (
  threadId: string,
  questionId: string,
  answers: readonly ThreadInteractionAnswer[],
) => Effect.Effect<void, HarnessFailure>;

const capped = (text: string, limit: number): string => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`);

export type AskData = {
  readonly ruleId: string | null;
  readonly callId: string | null;
  readonly tool: string;
  readonly subject: string;
  readonly action: string;
  readonly asked: readonly string[];
};

const NO_CALL_ID = 'The CLI named no call id for this request, so it is cleared only when the run moves on, not when its tool finishes.';

const callOf = (entry: ThreadQuestionEntry): (HarnessCall & { readonly id: string | null }) | null => {
  const data: Partial<Record<keyof AskData, unknown>> | null | undefined = entry.questions[0]?.data;
  if (typeof data !== 'object' || data === null) return null;
  const { callId, tool, subject } = data;
  return typeof tool === 'string' && typeof subject === 'string' && subject !== ''
    ? { id: typeof callId === 'string' ? callId : null, tool, subject }
    : null;
};

const askedByWidget = (data: unknown): boolean => {
  if (typeof data !== 'object' || data === null) return true;
  const { screen, ruleId } = data as { screen?: unknown; ruleId?: unknown };
  return screen === true || ruleId === undefined || ruleId === null;
};

const screenBorn = (entry: ThreadQuestionEntry): boolean => {
  const data: unknown = entry.questions[0]?.data;
  return typeof data === 'object' && data !== null && (data as { screen?: unknown }).screen === true;
};

export type AskTakes = { readonly freeform: boolean; readonly multiple: boolean };

const CHOICE_ONLY: AskTakes = { freeform: false, multiple: false };

export const askEntry = (
  run: string,
  questionId: string,
  prompt: string,
  header: string | null,
  options: readonly HarnessQuestionOption[],
  data: { readonly [key: string]: Schema.Json },
  at: string,
  approves: string | null = null,
  takes: AskTakes = CHOICE_ONLY,
): ThreadQuestionEntry => ({
  type: 'question',
  id: questionEntryId(run, [questionId]),
  runId: run,
  questionId,
  questions: [
    {
      id: questionId,
      kind: 'choice',
      toolCallId: questionId,
      prompt,
      header: header ?? undefined,
      options: [...options],
      allowFreeform: takes.freeform || undefined,
      allowMultiple: takes.multiple || undefined,
      approves: approves ?? undefined,
      data,
    },
  ],
  toolCalls: [],
  status: 'open',
  occurredAt: at,
  updatedAt: at,
});

export class TerminalAsks {
  private readonly routes = new AskRoutes();

  constructor(
    private readonly judging: HarnessJudging,
    private readonly named: (threadId: string) => Effect.Effect<HarnessName | null, HarnessFailure>,
    private readonly ledger: AskLedger,
    private readonly faces: AskFaces,
    private readonly redeliver: Redelivery,
  ) {}

  readonly asks: TransportAsks = {
    answer: (threadId, question, answers) => Effect.mapError(this.answer(threadId, question, answers), threadCallFailed),
  };

  private readonly current = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
  ): Effect.fn.Return<ThreadRunRef | null, HarnessFailure> {
    const run = yield* this.ledger.current(threadId);
    yield* this.routes.settle(threadId, run?.id ?? null);
    return run;
  });

  readonly judge = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    call: HarnessCall,
    mutating?: boolean,
  ): Effect.fn.Return<HarnessDecision, HarnessFailure> {
    const verdict = yield* this.judging.verdict(threadId, call, mutating);
    if (verdict._tag === 'Unspoken') return { _tag: 'Unspoken' } as const;
    if (verdict._tag === 'Denies') return { _tag: 'Denied', ruleId: verdict.ruleId, reason: verdict.reason } as const;
    const run = yield* this.current(threadId);
    if (run === null) return { _tag: 'Unspoken' } as const;
    const questionId = `${PERMISSION_QUESTION_PREFIX}${call.id ?? crypto.randomUUID()}`;
    const now = yield* Clock.currentTimeMillis;
    const until = now + PERMISSION_TIMEOUT_SECONDS * 1000;
    const standing = call.id === null ? null : yield* this.ledger.get(run, questionId);
    if (standing !== null) {
      if (standing.status !== 'open') return { _tag: 'Unspoken' } as const;
      this.routes.opened(threadId, run.id, questionId, until);
      return { _tag: 'Asked', requestId: questionId } as const;
    }
    const name = yield* this.named(threadId);
    if (name === null) return { _tag: 'Unspoken' } as const;
    const data: AskData = {
      ruleId: verdict.ruleId,
      callId: call.id,
      tool: call.tool,
      subject: call.subject,
      action: call.tool,
      asked: verdict.asked,
    };
    const reason = [verdict.reason, call.id === null ? NO_CALL_ID : null].filter((part) => part !== null).join(' ');
    const entry = askEntry(
      run.id,
      questionId,
      capped(this.judging.prompt(name, call), 1000),
      reason === '' ? null : capped(reason, 400),
      PERMISSION_OPTIONS,
      data,
      new Date(now).toISOString(),
      ALLOW_ONCE,
    );
    const route = this.routes.opened(threadId, run.id, questionId, until);
    const stands = yield* this.ledger.asked(run, entry, `ask:${questionId}`);
    if (!stands) {
      this.routes.hookEnded(route);
      yield* this.routes.close(threadId, questionId);
      return { _tag: 'Unspoken' } as const;
    }
    yield* this.ledger.routed(threadId);
    return { _tag: 'Asked', requestId: questionId } as const;
  });

  readonly outcome = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    requestId: string,
    withinMs: number,
  ): Effect.fn.Return<HarnessAnswer, HarnessFailure> {
    const run = yield* this.current(threadId);
    if (run === null || !requestId.startsWith(PERMISSION_QUESTION_PREFIX)) return { _tag: 'Unanswered' } as const;
    const standing = yield* this.ledger.get(run, requestId);
    const open = standing?.status === 'open' && standing.deliveryUnknown !== true ? standing : null;
    let route = this.routes.get(threadId, run.id, requestId);
    const askedAt = open === null ? Number.NaN : Date.parse(open.occurredAt ?? '');
    if (route === undefined && open !== null && Number.isFinite(askedAt)) {
      route = this.routes.opened(threadId, run.id, requestId, askedAt + PERMISSION_TIMEOUT_SECONDS * 1000);
    }
    if (route?.hook == null) return { _tag: 'Unanswered' } as const;
    const now = yield* Clock.currentTimeMillis;
    if (!this.routes.hookAlive(route, now)) return { _tag: 'Unanswered' } as const;
    const stored = open?.answers?.length === 1 ? open.answers[0]?.values : undefined;
    const resend =
      open?.answers !== undefined && stored?.length === 1 && (stored[0] === ALLOW_ONCE || stored[0] === DENY)
        ? yield* Effect.forkChild(this.redeliver(threadId, requestId, open.answers))
        : null;
    const decided = yield* this.awaited(route, withinMs, now);
    if (resend !== null) yield* Fiber.join(resend);
    return decided;
  });

  private readonly awaited = Effect.fnUntraced(function* (
    this: TerminalAsks,
    route: AskRoute,
    withinMs: number,
    now: number,
  ): Effect.fn.Return<HarnessAnswer> {
    const hook = route.hook!;
    const reply = yield* Effect.timeoutOption(Deferred.await(hook.reply), Math.min(withinMs, hook.until - now)).pipe(
      Effect.onInterrupt(() => Effect.sync(() => this.routes.hookEnded(route))),
    );
    if (Option.isNone(reply)) {
      if ((yield* Clock.currentTimeMillis) < hook.until) return { _tag: 'Waiting' } as const;
      this.routes.hookEnded(route);
      return { _tag: 'Unanswered' } as const;
    }
    yield* Deferred.succeed(hook.taken, undefined);
    if (reply.value === ALLOW_ONCE) return { _tag: 'Allowed', ruleId: 'operator', reason: 'Allowed once by the operator.' } as const;
    if (reply.value === DENY) return { _tag: 'Denied', ruleId: 'operator', reason: 'Denied by the operator.' } as const;
    return { _tag: 'Unanswered' } as const;
  });

  readonly answer = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    question: ThreadQuestionEntry,
    answers: readonly ThreadInteractionAnswer[],
  ): Effect.fn.Return<AskDelivery, HarnessFailure> {
    const values = answers.length === 1 ? (answers[0]?.values ?? []) : [];
    const multiple = question.questions[0]?.allowMultiple === true;
    if (values.length === 0 || (values.length > 1 && !multiple)) {
      return yield* new GateRefusal('answer-invalid', multiple ? 'Choose at least one value.' : 'Choose exactly one offered value.', [
        multiple ? 'answer the standing ask with the values it offers' : 'answer the standing ask with one offered value',
      ]);
    }
    if (question.deliveryUnknown === true) return 'unknown' as const;
    const route = this.routes.get(threadId, question.runId, question.questionId);
    const now = yield* Clock.currentTimeMillis;
    const value = values.length === 1 ? values[0] : undefined;
    if (route?.hook != null && this.routes.hookAlive(route, now) && (value === ALLOW_ONCE || value === DENY)) {
      const hook = route.hook;
      const taken = yield* Deferred.succeed(hook.reply, value).pipe(
        Effect.flatMap((first) => (first ? Effect.timeoutOption(Deferred.await(hook.taken), ACK_MS) : Effect.succeed(Option.none<void>()))),
      );
      if (Option.isSome(taken)) {
        yield* this.routes.close(threadId, question.questionId);
        return 'delivered' as const;
      }
      this.routes.hookEnded(route);
    }
    const keyed = yield* this.keyed(threadId, question, values);
    if (keyed === 'delivered') yield* this.routes.close(threadId, question.questionId);
    return keyed;
  });

  private about(widget: ScreenAsk, entry: ThreadQuestionEntry): boolean {
    const call = callOf(entry);
    if (call !== null) return widgetAsksAbout(widget, call);
    const prompt = entry.questions[0];
    return (
      prompt !== undefined &&
      askedByWidget(prompt.data) &&
      sameScreenAsk(
        {
          kind: 'choice',
          prompt: prompt.prompt,
          header: prompt.header ?? null,
          subject: null,
          options: prompt.options ?? [],
          selected: null,
        },
        widget,
      )
    );
  }

  private readonly aboutWidget = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    widget: ScreenAsk,
  ): Effect.fn.Return<readonly ThreadQuestionEntry[], HarnessFailure> {
    const run = yield* this.current(threadId);
    if (run === null) return [];
    return (yield* this.ledger.open(threadId, run)).filter((entry) => this.about(widget, entry));
  });

  private readonly prepared = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    question: ThreadQuestionEntry,
    values: readonly string[],
  ): Effect.fn.Return<'unshown' | 'ambiguous' | 'refused' | { live: ScreenAsk; keys: readonly HarnessWidgetKey[] }, HarnessFailure> {
    const live = yield* this.faces.widget(threadId);
    if (live === null || !this.about(live, question)) return 'unshown' as const;
    const matching = yield* this.aboutWidget(threadId, live);
    if (matching.length !== 1 || matching[0]?.questionId !== question.questionId) return 'ambiguous' as const;
    const keys = yield* this.faces.keys(threadId, live, values, question.questions[0]?.approves === ALLOW_ONCE);
    return keys === null ? ('refused' as const) : { live, keys };
  });

  private readonly keyed = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    question: ThreadQuestionEntry,
    values: readonly string[],
  ): Effect.fn.Return<AskDelivery, HarnessFailure> {
    const prepared = yield* Effect.result(this.prepared(threadId, question, values));
    if (prepared._tag === 'Failure') {
      yield* Effect.logWarning('terminal answer stopped before any key was typed', {
        threadId,
        questionId: question.questionId,
        failure: String(prepared.failure),
      });
      return 'unwritten' as const;
    }
    if (prepared.success === 'unshown' && screenBorn(question)) {
      yield* this.ledger.resolved({ id: question.runId, threadId }, question.questionId, `gone:${question.questionId}`, 'cleared', OUTSIDE);
      yield* this.routes.close(threadId, question.questionId);
      return 'gone' as const;
    }
    if (prepared.success === 'unshown' || prepared.success === 'ambiguous') return 'gone' as const;
    if (prepared.success === 'refused') return 'unwritten' as const;
    const { live, keys } = prepared.success;
    const typed = yield* this.faces.type(
      threadId,
      keys,
      `answer:${question.questionId}:${values.length === 1 ? values[0] : JSON.stringify(values)}`,
    );
    if (typed === 'unwritten') return 'unwritten' as const;
    if (typed === 'unknown') return 'unknown' as const;
    const left = yield* Effect.result(this.faces.left(threadId, live));
    if (left._tag === 'Failure') {
      yield* Effect.logWarning('a terminal answer was typed but its receipt could not be read', {
        threadId,
        questionId: question.questionId,
        failure: String(left.failure),
      });
    }
    return left._tag === 'Success' && left.success === 'gone' ? ('delivered' as const) : ('unknown' as const);
  });

  readonly widgetSeen = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    widget: ScreenAsk,
  ): Effect.fn.Return<boolean, HarnessFailure> {
    const run = yield* this.current(threadId);
    if (run === null) return false;
    const matching = yield* this.aboutWidget(threadId, widget);
    const now = yield* Clock.currentTimeMillis;
    for (const entry of matching) {
      const route = this.routes.get(threadId, run.id, entry.questionId) ?? this.routes.opened(threadId, run.id, entry.questionId, null);
      route.widget = widget;
      this.routes.hookEnded(route);
    }
    const only = matching[0];
    if (matching.length === 1 && only?.answers !== undefined && only.deliveryUnknown !== true) {
      yield* this.redeliver(threadId, only.questionId, only.answers);
    }
    if (widget.options.length === 0) return true;
    if (matching.length > 0) {
      yield* this.ledger.routed(threadId);
      return true;
    }
    const questionId = `harness-screen:${crypto.randomUUID()}`;
    const entry = askEntry(
      run.id,
      questionId,
      widget.prompt,
      widget.header,
      widget.options,
      SCREEN_ASKED,
      new Date(now).toISOString(),
      null,
      {
        freeform: widget.freeform !== undefined,
        multiple: widget.picks !== undefined,
      },
    );
    const route = this.routes.opened(threadId, run.id, questionId, null);
    route.widget = widget;
    const stands = yield* this.ledger.asked(run, entry, `screen:${questionId}`);
    if (!stands) yield* this.routes.close(threadId, questionId);
    else yield* this.ledger.routed(threadId);
    return stands;
  });

  shows(threadId: string, widget: ScreenAsk): boolean {
    return this.routes.showing(threadId, widget);
  }

  readonly widgetGone = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    standing?: ScreenAsk,
  ): Effect.fn.Return<boolean, HarnessFailure> {
    const run = yield* this.current(threadId);
    if (run === null) return true;
    const now = yield* Clock.currentTimeMillis;
    const open = yield* this.ledger.open(threadId, run);
    let swept = true;
    for (const entry of open) {
      const route = this.routes.get(threadId, run.id, entry.questionId);
      if (route?.widget == null && !screenBorn(entry)) continue;
      if (standing !== undefined && this.about(standing, entry)) continue;
      if (entry.deliveryUnknown === true || (route !== undefined && this.routes.hookAlive(route, now))) {
        swept = false;
        continue;
      }
      yield* this.ledger.resolved(run, entry.questionId, `gone:${entry.questionId}`, 'cleared', OUTSIDE);
      yield* this.routes.close(threadId, entry.questionId);
    }
    return swept;
  });

  readonly callEnded = Effect.fnUntraced(function* (
    this: TerminalAsks,
    threadId: string,
    callId: string,
  ): Effect.fn.Return<void, HarnessFailure> {
    const run = yield* this.current(threadId);
    if (run === null) return;
    const entry = yield* this.ledger.get(run, `${PERMISSION_QUESTION_PREFIX}${callId}`);
    if (entry === null || entry.status !== 'open' || callOf(entry)?.id !== callId) return;
    const consumed = entry.deliveryUnknown === true;
    yield* this.ledger.resolved(
      run,
      entry.questionId,
      `call:${entry.questionId}`,
      consumed ? 'answered' : 'cleared',
      consumed ? CONSUMED : ENDED,
    );
    yield* this.routes.close(threadId, entry.questionId);
  });
}
