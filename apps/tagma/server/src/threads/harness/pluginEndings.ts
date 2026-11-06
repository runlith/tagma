import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { EndingInput } from '@runlith/tagma/plugin/protocol';
import { Effect } from 'effect';
import { ContributionPoint } from '../../platform/contract/service/contribution.js';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import type { PluginContribution, PluginRegister } from '../../plugins/contract/service/points.js';
import { ENDED_REASON, ON_FACE, PLUGIN_BINDING, type ThreadOn } from '../contract/wire/pluginEndings.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';

export const ON = new ContributionPoint<never, ThreadOn>('threads/endings', ON_FACE);

export type OnHook = { readonly tool: string; readonly contribution: PluginContribution<ThreadOn> };

const broke = (message: string) => new ThreadCallBroke({ cause: new Error(message) });

const pluginOf = (thread: ThreadSummary): string | undefined => thread.bindings[PLUGIN_BINDING];

export const makePluginOn = Effect.gen(function* () {
  const host = yield* PluginHost;
  const ended = new Map<string, OnHook>();
  const asked = new Map<string, OnHook>();
  const askingChanged = new Set<(plugin: string) => void>();

  const awaited = Effect.fnUntraced(function* (plugin: string, runId: string) {
    const pending = yield* Effect.mapError(host.pending(plugin), (cause) => new ThreadCallBroke({ cause }));
    const hook = ended.get(plugin);
    if (hook !== undefined || !pending) return hook;
    return yield* broke(`${plugin} has not published its contributions yet; the ending of ${runId} is delivered once it has`);
  });

  const deliver = Effect.fn('EndingDelivery.deliver')(function* (event: ThreadEvent): Effect.fn.Return<void, ThreadBorderFailed> {
    if (event.kind !== 'ended' || event.run.kind !== 'turn') return;
    const { thread, run } = event;
    const plugin = pluginOf(thread);
    if (plugin === undefined) return;
    const hook = ended.get(plugin) ?? (yield* awaited(plugin, run.runId));
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

  const held = (hooks: Map<string, OnHook>, plugin: string, hook: OnHook | undefined, changed: boolean): (() => void) => {
    if (hook === undefined) return () => undefined;
    hooks.set(plugin, hook);
    if (changed) for (const listener of askingChanged) listener(plugin);
    return () => {
      if (hooks.get(plugin) !== hook) return;
      hooks.delete(plugin);
      if (changed) for (const listener of askingChanged) listener(plugin);
    };
  };

  const register: PluginRegister<ThreadOn> = (contribution) =>
    Effect.sync(() => {
      const { plugin, value } = contribution;
      const onEnded = held(ended, plugin.id, value.ended === undefined ? undefined : { tool: value.ended, contribution }, false);
      const onAsked = held(asked, plugin.id, value.asked === undefined ? undefined : { tool: value.asked, contribution }, true);
      return () => {
        onEnded();
        onAsked();
      };
    });

  const recipient: ThreadEventRecipient = {
    name: 'plugin endings',
    takes: ['ended'],
    follows: (thread) => Effect.succeed(pluginOf(thread) !== undefined),
    handle: deliver,
  };

  return {
    register,
    recipient,
    asking: (plugin: string): OnHook | undefined => asked.get(plugin),
    followAsking: (listener: (plugin: string) => void): (() => void) => {
      askingChanged.add(listener);
      return () => askingChanged.delete(listener);
    },
  };
});
