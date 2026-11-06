import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { EndingInput } from '@runlith/tagma/plugin/protocol';
import { Effect } from 'effect';
import { ContributionPoint } from '../../platform/contract/service/contribution.js';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import type { PluginContribution, PluginRegister } from '../../plugins/contract/service/points.js';
import { ENDED_REASON, ENDINGS_FACE, type EndingTools, PLUGIN_BINDING } from '../contract/wire/pluginEndings.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';

export const ENDINGS = new ContributionPoint<never, EndingTools>('threads/endings', ENDINGS_FACE);

type Hook = { readonly tool: string; readonly contribution: PluginContribution<EndingTools> };

const broke = (message: string) => new ThreadCallBroke({ cause: new Error(message) });

const pluginOf = (thread: ThreadSummary): string | undefined => thread.bindings[PLUGIN_BINDING];

export const makeEndingDelivery = Effect.gen(function* () {
  const host = yield* PluginHost;
  const hooks = new Map<string, Hook>();

  const awaited = Effect.fnUntraced(function* (plugin: string, runId: string) {
    const pending = yield* Effect.mapError(host.pending(plugin), (cause) => new ThreadCallBroke({ cause }));
    const hook = hooks.get(plugin);
    if (hook !== undefined || !pending) return hook;
    return yield* broke(`${plugin} has not published its contributions yet; the ending of ${runId} is delivered once it has`);
  });

  const deliver = Effect.fn('EndingDelivery.deliver')(function* (event: ThreadEvent): Effect.fn.Return<void, ThreadBorderFailed> {
    if (event.kind !== 'ended' || event.run.kind !== 'turn') return;
    const { thread, run } = event;
    const plugin = pluginOf(thread);
    if (plugin === undefined) return;
    const hook = hooks.get(plugin) ?? (yield* awaited(plugin, run.runId));
    if (hook === undefined) return;
    const answer = yield* hook.contribution.caller
      .call(
        plugin,
        hook.tool,
        { threadId: run.threadId, runId: run.runId, status: run.status, failureReason: run.failureReason } satisfies EndingInput,
        { caller: { kind: 'tagma', projectId: thread.projectId, reason: ENDED_REASON } },
      )
      .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    if ('isError' in answer && answer.isError === true) return yield* broke(`${plugin} answered the ending of ${run.runId} with an error`);
  });

  const register: PluginRegister<EndingTools> = (contribution) =>
    Effect.sync(() => {
      const { plugin, value } = contribution;
      const tool = value.ended;
      if (tool === undefined) return () => undefined;
      const hook: Hook = { tool, contribution };
      hooks.set(plugin.id, hook);
      return () => {
        if (hooks.get(plugin.id) === hook) hooks.delete(plugin.id);
      };
    });
  const recipient: ThreadEventRecipient = {
    name: 'plugin endings',
    takes: ['ended'],
    follows: (thread) => Effect.succeed(pluginOf(thread) !== undefined),
    handle: deliver,
  };
  return { register, recipient };
});
