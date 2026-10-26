import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { Effect } from 'effect';
import { stored } from '../../platform/store/crossing.js';
import { type PluginContribution, type PluginPoint, PluginPointRefused } from '../../plugins/contract/service/points.js';
import { Plugins } from '../../plugins/contract/service/supervision.js';
import { ENDED_REASON, EndingTools, PLUGIN_BINDING } from '../contract/wire/pluginEndings.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';

type Hook = { readonly tool: string; readonly contribution: PluginContribution<EndingTools> };

const refused = (reason: string) => new PluginPointRefused({ point: 'on', reason });

const broke = (message: string) => new ThreadCallBroke({ cause: new Error(message) });

const pluginOf = (thread: ThreadSummary): string | undefined => thread.bindings[PLUGIN_BINDING];

export const makeEndingDelivery = Effect.gen(function* () {
  const plugins = yield* Plugins;
  const hooks = new Map<string, Hook>();

  const awaited = Effect.fnUntraced(function* (plugin: string, runId: string) {
    const pending = yield* stored('pluginPending')(plugins.pending(plugin));
    const hook = hooks.get(plugin);
    if (hook !== undefined || !pending) return hook;
    return yield* broke(`${plugin} is not running; the ending of ${runId} is delivered once it runs again`);
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
        { threadId: run.threadId, runId: run.runId, status: run.status, failureReason: run.failureReason },
        { caller: { kind: 'tagma', projectId: thread.projectId, reason: ENDED_REASON } },
      )
      .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    if ('isError' in answer && answer.isError === true) return yield* broke(`${plugin} answered the ending of ${run.runId} with an error`);
  });

  const point: PluginPoint<EndingTools> = {
    name: 'on',
    owner: 'threads',
    schema: EndingTools,
    register: (contribution) =>
      Effect.suspend(() => {
        const { plugin, value, tools } = contribution;
        const tool = value.ended;
        if (tool === undefined) return Effect.succeed(() => undefined);
        if (tools === null) return Effect.fail(refused('endings are delivered to a process, and the plugin declares none'));
        if (!tools.some((descriptor) => descriptor.name === tool)) return Effect.fail(refused(`the process serves no tool ${tool}`));
        const hook: Hook = { tool, contribution };
        hooks.set(plugin.id, hook);
        return Effect.succeed(() => {
          if (hooks.get(plugin.id) === hook) hooks.delete(plugin.id);
        });
      }),
  };
  const recipient: ThreadEventRecipient = {
    name: 'plugin endings',
    takes: ['ended'],
    follows: (thread) => Effect.succeed(pluginOf(thread) !== undefined),
    handle: deliver,
  };
  return { point, recipient };
});
