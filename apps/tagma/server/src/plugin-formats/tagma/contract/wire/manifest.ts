import { Schema } from 'effect';
import { PluginLabel } from '../../../../plugins/contract/wire/names.js';
import { PLUGIN_OPTION_TYPES } from '../../../../plugins/contract/wire/rows.js';

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

const Inside = Schema.String.check(
  Schema.makeFilter((path: string) =>
    path !== '' && !path.includes('\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
      ? true
      : `${path} is not a path inside the plugin directory`,
  ),
);

const Sources = Schema.Array(Inside).check(
  Schema.makeFilter((sources: readonly string[]) =>
    sources.every((path, at) => at === 0 || sources[at - 1]! < path) ? true : 'the sources are listed sorted, each once',
  ),
);

export const Envelope = Schema.Struct({
  id: PluginLabel,
  title: Named,
  version: Named,
  description: Schema.optional(Schema.String),
  process: Schema.optional(
    Schema.Struct({
      entry: Inside.annotate({
        description: 'The bundled module Tagma runs on its own runtime, from the plugin directory as the operator.',
      }),
      resident: Schema.optional(Schema.Boolean).annotate({
        description: 'Kept running while the plugin is enabled, rather than started on demand and stopped when idle.',
      }),
    }),
  ),
  options: Schema.optional(Options),
  build: Schema.Struct({
    hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)).annotate({
      description: 'SHA-256 over each source as its path, a NUL, its byte length, a NUL and its bytes, in the order listed.',
    }),
    sources: Sources.annotate({ description: 'Every file the build read outside node_modules.' }),
  }),
  contributes: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: 'Contributions by point; every point is declared by the owner that registers it.',
  }),
});
