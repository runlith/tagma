import { Deferred, Effect } from 'effect';
import type { HarnessCall, ScreenAsk } from '@runlith/tagma/adapter/harness';
import { sameScreenAsk } from '../adapter/screenAsk.js';

export type HookReply = 'allow-once' | 'deny' | 'unanswered';

export type AskRoute = {
  readonly questionId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly hook: {
    readonly reply: Deferred.Deferred<HookReply>;
    readonly taken: Deferred.Deferred<void>;
    readonly until: number;
    alive: boolean;
  } | null;
  widget: ScreenAsk | null;
};

export const widgetAsksAbout = (widget: ScreenAsk, call: HarnessCall): boolean =>
  widget.subject !== null && widget.subject !== '' && widget.subject === call.subject.trim();

export class AskRoutes {
  private readonly threads = new Map<string, Map<string, AskRoute>>();

  opened(threadId: string, runId: string, questionId: string, until: number | null): AskRoute {
    const route: AskRoute = {
      questionId,
      threadId,
      runId,
      hook: until === null ? null : { reply: Deferred.makeUnsafe<HookReply>(), taken: Deferred.makeUnsafe<void>(), until, alive: true },
      widget: null,
    };
    const routes = this.threads.get(threadId) ?? new Map<string, AskRoute>();
    routes.set(questionId, route);
    this.threads.set(threadId, routes);
    return route;
  }

  get(threadId: string, runId: string, questionId: string): AskRoute | undefined {
    const route = this.threads.get(threadId)?.get(questionId);
    return route?.runId === runId ? route : undefined;
  }

  showing(threadId: string, widget: ScreenAsk): boolean {
    for (const route of this.threads.get(threadId)?.values() ?? []) {
      if (route.widget !== null && sameScreenAsk(route.widget, widget)) return true;
    }
    return false;
  }

  hookAlive(route: AskRoute, now: number): boolean {
    return route.hook !== null && route.hook.alive && now < route.hook.until;
  }

  hookEnded(route: AskRoute): void {
    if (route.hook !== null) route.hook.alive = false;
  }

  close(threadId: string, questionId: string): Effect.Effect<void> {
    const routes = this.threads.get(threadId);
    const route = routes?.get(questionId);
    if (routes === undefined || route === undefined) return Effect.void;
    routes.delete(questionId);
    if (routes.size === 0) this.threads.delete(threadId);
    return route.hook === null ? Effect.void : Effect.asVoid(Deferred.succeed(route.hook.reply, 'unanswered'));
  }

  readonly settle = Effect.fnUntraced(function* (this: AskRoutes, threadId: string, runId: string | null) {
    for (const route of [...(this.threads.get(threadId)?.values() ?? [])]) {
      if (route.runId !== runId) yield* this.close(threadId, route.questionId);
    }
  });
}
