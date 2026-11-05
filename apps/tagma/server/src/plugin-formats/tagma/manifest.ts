import { Schema } from 'effect';
import { PluginLabel } from '../../plugins/contract/wire/names.js';
import { PLUGIN_OPTION_TYPES } from '../../plugins/contract/wire/rows.js';

export const MANIFEST = 'tagma-plugin.json';

const STARTED_WITH = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR'] as const;

const Named = Schema.String.check(Schema.isMinLength(1));

const OptionKey = Schema.String.check(
  Schema.isPattern(/^(?!TAGMA_)[A-Z][A-Z0-9_]*$/u),
  Schema.isMaxLength(64),
  Schema.makeFilter((key: string) =>
    STARTED_WITH.some((taken) => taken === key) ? `${key} is a variable every process is started with` : true,
  ),
).annotate({
  description:
    'The option, named as the environment variable its process reads it from: capital letters, digits and underscores, not starting with TAGMA_ and not PATH, HOME, USER, LOGNAME, SHELL, TERM or TMPDIR.',
});

const Option = Schema.Struct({
  key: OptionKey,
  title: Named,
  description: Schema.String,
  type: Schema.optional(Schema.Literals(PLUGIN_OPTION_TYPES)),
  sensitive: Schema.optional(Schema.Boolean).annotate({
    description: 'A secret: kept in the key store, masked in what the process answers.',
  }),
  required: Schema.optional(Schema.Boolean),
  default: Schema.optional(Schema.String),
});

const Options = Schema.Array(Option).check(
  Schema.makeFilter((options: readonly (typeof Option.Type)[]) => {
    const seen = new Set<string>();
    for (const { key } of options) {
      if (seen.has(key)) return `the option ${key} is listed twice`;
      seen.add(key);
    }
    return true;
  }),
);

export const Envelope = Schema.Struct({
  id: PluginLabel,
  title: Named,
  version: Schema.optional(Named),
  description: Schema.optional(Schema.String),
  process: Schema.optional(
    Schema.Struct({
      command: Named.annotate({ description: 'The program that serves MCP over stdio, run from the plugin directory as the operator.' }),
      args: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  options: Schema.optional(Options),
  contributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: 'Contributions by point; every point is declared by the owner that registers it.',
  }),
});
