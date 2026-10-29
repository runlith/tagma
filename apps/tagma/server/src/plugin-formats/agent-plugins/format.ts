import { Effect } from 'effect';
import { type PluginFormat, PluginRefused } from '../../plugins/contract/service/format.js';
import { readPortable, rootManifest } from './portable.js';

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  return (yield* rootManifest(root)) === null ? null : 'manifest';
});

const read: PluginFormat['read'] = Effect.fn('agentPlugins.read')(function* (root, _claim, declared) {
  if (declared !== null) {
    return yield* new PluginRefused({ reason: 'an Agent Plugins package is its own manifest: a marketplace entry declares none for it' });
  }
  return (yield* readPortable(root, [])).package;
});

export const agentPluginsFormat: PluginFormat = { id: 'agent-plugins', claim, read };
