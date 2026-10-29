import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { Effect } from 'effect';
import { stored } from '../../platform/store/crossing.js';
import { type TagmaAppContribution, type TagmaAppPoint, TagmaAppPointRefused } from '../../tagma-apps/contract/service/points.js';
import { TagmaApps } from '../../tagma-apps/contract/service/supervision.js';
import { ENDED_REASON, EndingTools, TAGMA_APP_BINDING } from '../contract/wire/tagmaAppEndings.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';

type Hook = { readonly tool: string; readonly contribution: TagmaAppContribution<EndingTools> };

const refused = (reason: string) => new TagmaAppPointRefused({ point: 'on', reason });

const broke = (message: string) => new ThreadCallBroke({ cause: new Error(message) });

const appOf = (thread: ThreadSummary): string | undefined => thread.bindings[TAGMA_APP_BINDING];

export const makeEndingDelivery = Effect.gen(function* () {
  const apps = yield* TagmaApps;
  const hooks = new Map<string, Hook>();

  const awaited = Effect.fnUntraced(function* (app: string, runId: string) {
    const pending = yield* stored('appPending')(apps.pending(app));
    const hook = hooks.get(app);
    if (hook !== undefined || !pending) return hook;
    return yield* broke(`${app} is not running; the ending of ${runId} is delivered once it runs again`);
  });

  const deliver = Effect.fn('EndingDelivery.deliver')(function* (event: ThreadEvent): Effect.fn.Return<void, ThreadBorderFailed> {
    if (event.kind !== 'ended' || event.run.kind !== 'turn') return;
    const { thread, run } = event;
    const app = appOf(thread);
    if (app === undefined) return;
    const hook = hooks.get(app) ?? (yield* awaited(app, run.runId));
    if (hook === undefined) return;
    const answer = yield* hook.contribution.caller
      .call(
        app,
        hook.tool,
        { threadId: run.threadId, runId: run.runId, status: run.status, failureReason: run.failureReason },
        { caller: { kind: 'tagma', projectId: thread.projectId, reason: ENDED_REASON } },
      )
      .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    if ('isError' in answer && answer.isError === true) return yield* broke(`${app} answered the ending of ${run.runId} with an error`);
  });

  const point: TagmaAppPoint<EndingTools> = {
    name: 'on',
    owner: 'threads',
    schema: EndingTools,
    register: (contribution) =>
      Effect.suspend(() => {
        const { app, value, tools } = contribution;
        const tool = value.ended;
        if (tool === undefined) return Effect.succeed(() => undefined);
        if (tools === null) return Effect.fail(refused('endings are delivered to a process, and the app declares none'));
        if (!tools.some((descriptor) => descriptor.name === tool)) return Effect.fail(refused(`the process serves no tool ${tool}`));
        const hook: Hook = { tool, contribution };
        hooks.set(app.id, hook);
        return Effect.succeed(() => {
          if (hooks.get(app.id) === hook) hooks.delete(app.id);
        });
      }),
  };
  const recipient: ThreadEventRecipient = {
    name: 'plugin endings',
    takes: ['ended'],
    follows: (thread) => Effect.succeed(appOf(thread) !== undefined),
    handle: deliver,
  };
  return { point, recipient };
});
