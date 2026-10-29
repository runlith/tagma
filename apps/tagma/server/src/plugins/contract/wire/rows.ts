import { Schema } from 'effect';

export const PLUGIN_HOOK_POINTS = ['beforeTool', 'afterTool', 'beforeStep', 'beforeClose', 'threadStarted', 'threadEnded'] as const;
export type PluginHookPoint = (typeof PLUGIN_HOOK_POINTS)[number];

export const PLUGIN_OPTION_TYPES = ['string', 'number', 'boolean', 'directory', 'file'] as const;
export type PluginOptionType = (typeof PLUGIN_OPTION_TYPES)[number];

export const PLUGIN_COMPONENT_KINDS = ['skill', 'command', 'mcp-server', 'agent', 'hook'] as const;
export type PluginComponentKind = (typeof PLUGIN_COMPONENT_KINDS)[number];

const Named = Schema.String.check(Schema.isMinLength(1));

export const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export const PluginSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('folder'), path: Named }),
  Schema.Struct({
    kind: Schema.Literal('git'),
    url: Named,
    path: Schema.optional(Named).annotate({ description: 'The directory of the repository that holds the plugin; its root when absent.' }),
    ref: Schema.optional(Named).annotate({ description: 'The branch or tag cloned; the default branch when absent.' }),
    commit: Schema.optional(Schema.String.check(Schema.isPattern(COMMIT_PATTERN))).annotate({
      description: 'The full commit: the pin a source asks for, and on an install the commit installed.',
    }),
  }),
]);
export type PluginSource = typeof PluginSource.Type;

export const PluginOrigin = Schema.Struct({
  marketplace: Named.annotate({ description: 'The marketplace the plugin was installed from.' }),
  entry: Named.annotate({ description: 'The name of its entry in that marketplace.' }),
});
export type PluginOrigin = typeof PluginOrigin.Type;

export const PluginDeclared = Schema.Struct({
  format: Named.annotate({ description: 'The plugin format the declaration is written in.' }),
  fields: Schema.Record(Schema.String, Schema.Unknown).annotate({ description: 'The manifest fields the marketplace entry declares.' }),
});
export type PluginDeclared = typeof PluginDeclared.Type;

export const pluginComponentSchema = Schema.Struct({
  kind: Schema.Literals(PLUGIN_COMPONENT_KINDS),
  name: Schema.String.annotate({ description: 'The name Tagma offers it under, `<plugin>-<name>`; a hook names its event.' }),
  detail: Schema.optional(Schema.String).annotate({
    description: 'What it runs or reaches, or for an agent the tools it named that Tagma has no equivalent of.',
  }),
});
export type PluginComponent = typeof pluginComponentSchema.Type;

export const pluginIgnoredSchema = Schema.Struct({
  component: Schema.String,
  name: Schema.NullOr(Schema.String),
  reason: Schema.String,
});

export const pluginOptionSchema = Schema.Struct({
  key: Schema.String,
  type: Schema.Literals(PLUGIN_OPTION_TYPES),
  title: Schema.String,
  description: Schema.String,
  sensitive: Schema.Boolean.annotate({ description: 'Kept in the key store under the plugin, never in a setting.' }),
  required: Schema.Boolean,
  set: Schema.Boolean.annotate({ description: 'Whether a value or the declared default stands for it.' }),
  fallback: Schema.NullOr(Schema.String).annotate({
    description: 'The default the plugin declares, used while no value is given; null for none and for a secret option.',
  }),
});
export type PluginOptionRow = typeof pluginOptionSchema.Type;

export const pluginRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  format: Schema.NullOr(Schema.String).annotate({ description: 'The format its directory was read in; null when it could not be read.' }),
  source: PluginSource,
  origin: Schema.optional(PluginOrigin).annotate({ description: 'The marketplace entry it was installed from; update_plugin follows it.' }),
  root: Schema.String.annotate({
    description: 'The directory it is read from: a folder installed in place, or the copy taken from its git URL or marketplace entry.',
  }),
  enabled: Schema.Boolean.annotate({ description: 'Whether this project runs its components.' }),
  components: Schema.Array(pluginComponentSchema).annotate({ description: 'What Tagma took from it.' }),
  ignored: Schema.Array(pluginIgnoredSchema).annotate({ description: 'What Tagma does not take from it, each with the reason.' }),
  options: Schema.Array(pluginOptionSchema),
  refused: Schema.optional(Schema.String).annotate({
    description: 'Why its directory as it stands now cannot be read; a refused plugin contributes nothing.',
  }),
});
export type PluginRow = typeof pluginRowSchema.Type;
