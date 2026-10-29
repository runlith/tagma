import { Effect } from 'effect';
import { type PluginFormat, PluginRefused } from '../../plugins/contract/service/format.js';
import { readPortable, rootManifest } from './portable.js';

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  return (yield* rootManifest(root)) === null ? null : 'manifest';
});

const read: PluginFormat['read'] = Effect.fn('agentPlugins.read')(function* (root, _claim, entry) {
  if (entry?.fields != null) {
    return yield* new PluginRefused({ reason: 'an Agent Plugins package is its own manifest: a marketplace entry declares none for it' });
  }
  const found = (yield* readPortable(root, [])).package;
  return { ...found, name: entry?.name ?? found.name };
});

export const agentPluginsFormat: PluginFormat = { id: 'agent-plugins', claim, read };
