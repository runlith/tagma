import { type Context, Effect, Option } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { Operation } from '../../platform/contract/wire/operation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CallPlace } from '../../platform/contract/service/place.js';
import { EnabledPlugins } from '../../plugins/contract/service/plugins.js';
import { PluginHost } from '../../plugin-host/contract/service/supervision.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { PLUGIN_BINDING } from '../../threads/contract/wire/on.js';
import type { OperationCatalog } from '../contract/service/catalog.js';
import { addressedThread } from './place.js';

const unread = (failure: { readonly message: string }) =>
  new GateRefusal('graph-pool', `this server could not read what the plugin may reach: ${failure.message}`, ['make the call again']);

const composed = <I, S>(tag: Context.Key<I, S>) =>
  Effect.flatMap(Effect.serviceOption(tag), (found) =>
    Option.isSome(found) ? Effect.succeed(found.value) : Effect.die(new Error(`A plugin's call reached a context without ${tag.key}.`)),
  );

const notEnabled = (plugin: string, where: string) =>
  new GateRefusal('plugin-not-enabled', `The plugin ${plugin} does not run ${where}.`, [
    `enable ${plugin} there with enable_plugin, or call a project where it runs`,
  ]);

export const admitPlugin = Effect.fnUntraced(function* (
  id: string,
  entry: Operation,
  input: unknown,
  caller: Caller,
): Effect.fn.Return<void, GateRefusal, OperationCatalog> {
  const actor = caller.actor;
  if (actor.kind !== 'external') return;
  const plugin = actor.plugin;
  if (plugin === null) {
    if (entry.external !== 'own') return;
    return yield* new GateRefusal('external-refused', `${id} acts for a plugin only on a thread it owns.`, [
      'call as plugin:<id> on a thread whose bindings.plugin names it, or ask the operator',
    ]);
  }
  const place = yield* CallPlace;
  if (place === null) {
    if (!(yield* composed(PluginHost)).hosts(plugin)) return yield* notEnabled(plugin, 'in any project');
  } else {
    const running = yield* Effect.mapError((yield* composed(EnabledPlugins)).held(place.projectId), unread);
    if (!running().includes(plugin)) return yield* notEnabled(plugin, `in project ${place.projectId}`);
  }
  if (entry.external !== 'own') return;
  const threadId = yield* Effect.mapError(addressedThread(entry, input, caller), (failure) =>
    failure instanceof GateRefusal ? failure : unread(failure),
  );
  if (threadId === null) return;
  const thread = yield* Effect.mapError((yield* composed(ThreadLookup)).summary(threadId), unread);
  if (thread === undefined || thread.bindings[PLUGIN_BINDING] === plugin) return;
  return yield* new GateRefusal('plugin-thread-mismatch', `Thread ${threadId} is not bound to plugin ${plugin}.`, [
    `act on a thread whose bindings.plugin names ${plugin}, or ask the operator`,
  ]);
});
