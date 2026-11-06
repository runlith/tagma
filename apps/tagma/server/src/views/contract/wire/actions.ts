import { Schema } from 'effect';
import { PluginId } from '../../../plugins/contract/wire/names.js';
import { CommandEntry } from './points.js';

const PluginActionKey = Schema.Struct({
  keys: Schema.String.annotate({ description: 'The chord as the plugin wrote it, like Mod+Alt+G.' }),
  global: Schema.Boolean.annotate({ description: 'true: the plugin asks for the chord to work in every app. The person allows it.' }),
});

const keys = Schema.Array(PluginActionKey).annotate({ description: 'The chords the plugin proposes for it.' });

export const PluginActionRow = Schema.Union([
  Schema.Struct({
    id: Schema.String.annotate({ description: 'The plugin’s own action id.' }),
    kind: Schema.Literal('action'),
    title: Schema.String,
    keys,
  }),
  Schema.Struct({
    id: Schema.String.annotate({ description: 'section:<view> or pane:<view>, as the plugin’s shortcuts name the act.' }),
    kind: Schema.Literals(['section', 'pane']),
    view: Schema.String.annotate({ description: 'The view the act opens.' }),
    title: Schema.String,
    keys,
  }),
]);
export type PluginActionRow = typeof PluginActionRow.Type;

export const PluginActionSet = Schema.Struct({
  plugin: PluginId,
  title: Schema.String,
  rank: Schema.Int.annotate({ description: 'Its index in the machine’s installed list: the earlier plugin keeps a contested chord.' }),
  projects: Schema.Array(Schema.Int).annotate({ description: 'The projects that enable the plugin.' }),
  actions: Schema.Array(PluginActionRow),
  commands: Schema.Array(CommandEntry).annotate({ description: 'The commands the plugin offers a thread’s composer.' }),
});
export type PluginActionSet = typeof PluginActionSet.Type;

export const PluginActionState = Schema.Struct({ plugins: Schema.Array(PluginActionSet) });
export type PluginActionState = typeof PluginActionState.Type;

export const ACTION_REFUSALS = ['plugin-action-unknown', 'plugin-unavailable', 'plugin-call-failed', 'unknown-project'] as const;
export type ActionRefusalCode = (typeof ACTION_REFUSALS)[number];
