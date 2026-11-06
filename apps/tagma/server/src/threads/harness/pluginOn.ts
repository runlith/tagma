import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { EndingInput } from '@runlith/tagma/plugin/protocol';
import { Effect } from 'effect';
import { ContributionPoint } from '../../platform/contract/service/contribution.js';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import { type PluginContribution, PluginPoints } from '../../plugins/contract/service/points.js';
import { ENDED_REASON, ON_FACE, PLUGIN_BINDING, type ThreadOn } from '../contract/wire/pluginEndings.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';

const ON = new ContributionPoint<never, ThreadOn>('threads/on', ON_FACE);

type OnHook = { readonly tool: string; readonly contribution: PluginContribution<ThreadOn> };

export type PluginOn = {
  readonly recipient: ThreadEventRecipient;
  readonly asking: (plugin: string) => OnHook | undefined;
  readonly changed: (listener: (plugin: string) => void) => () => void;
};

const broke = (message: string) => new ThreadCallBroke({ cause: new Error(message) });

const pluginOf = (thread: ThreadSummary): string | undefined => thread.bindings[PLUGIN_BINDING];

export const makePluginOn = Effect.gen(function* () {
  const host = yield* PluginHost;
  const held = yield* (yield* PluginPoints).hold(ON);

  const hookOf = (plugin: string, tool: (on: ThreadOn) => string | undefined): OnHook | undefined => {
    const contribution = held.of(plugin);
    const named = contribution === undefined ? undefined : tool(contribution.value);
    return contribution === undefined || named === undefined ? undefined : { tool: named, contribution };
  };

  const awaited = Effect.fnUntraced(function* (plugin: string, runId: string) {
    const pending = yield* Effect.mapError(host.pending(plugin), (cause) => new ThreadCallBroke({ cause }));
    const hook = hookOf(plugin, (on) => on.ended);
    if (hook !== undefined || !pending) return hook;
    return yield* broke(`${plugin} has not published its contributions yet; the ending of ${runId} is delivered once it has`);
  });

  const deliver = Effect.fn('EndingDelivery.deliver')(function* (event: ThreadEvent): Effect.fn.Return<void, ThreadBorderFailed> {
    if (event.kind !== 'ended' || event.run.kind !== 'turn') return;
    const { thread, run } = event;
    const plugin = pluginOf(thread);
    if (plugin === undefined) return;
    const hook = hookOf(plugin, (on) => on.ended) ?? (yield* awaited(plugin, run.runId));
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

  return {
    recipient: {
      name: 'plugin endings',
      takes: ['ended'],
      follows: (thread) => Effect.succeed(pluginOf(thread) !== undefined),
      handle: deliver,
    },
    asking: (plugin) => hookOf(plugin, (on) => on.asked),
    changed: held.changed,
  } satisfies PluginOn;
});
