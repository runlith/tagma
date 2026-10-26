import { Schema } from 'effect';
import { CONCERNS } from '@tagma/inspection/rule';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { projectField } from '../../../platform/contract/wire/place.js';

export const ConfiguredInspection = Schema.Struct({
  key: Schema.String,
  inspection: Schema.String.annotate({
    description:
      'What judges the key: a builtin id, which read_inspections answers by name; `<program> <name>` for a defineInspection; `<tool> <rule>` for a linter rule, `command` for a command printing findings.',
  }),
  concern: Schema.NullOr(Schema.Literals(CONCERNS)).annotate({
    description: 'The concern it judges, the group of the Rules screen; null for a linter, which declares none.',
  }),
});
export type ConfiguredInspection = typeof ConfiguredInspection.Type;

export const ConfiguredFormat = Schema.Struct({
  key: Schema.String,
  run: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
});
export type ConfiguredFormat = typeof ConfiguredFormat.Type;

export const ConfigReading = Schema.Struct({
  inspections: Schema.Array(ConfiguredInspection),
  format: Schema.Array(ConfiguredFormat).annotate({ description: 'The format commands in the order they run on a commit.' }),
});
export type ConfigReading = typeof ConfigReading.Type;

export const CONFIG_OPERATIONS = {
  read_config: operation('read_config', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    waits: [],
    lifetimes: [],
    place: 'project',
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        config: Schema.NullOr(ConfigReading).annotate({
          description: 'null: HEAD of the main checkout holds no tagma.config.ts, or the branch has no commit yet.',
        }),
      },
    }),
    meaning:
      "Read what the tagma.config.ts at HEAD of the project's main checkout declares: its inspection keys with what judges each and its concern, and its format commands with their argv and globs.",
    grammar:
      'The config of HEAD is the one the next landing from a clean checkout meets: a landing is judged and formatted by the config of its own version, so an uncommitted edit of tagma.config.ts counts only once it lands. A config that does not build or evaluate refuses `config-invalid` with its file, line and reason. The rules naming a key are answered by read_inspections with that key.',
    input: Schema.Struct({ project: projectField }),
    refusals: ['unknown-project', 'config-invalid', 'config-unstored', 'config-unrunnable', 'git-refused', 'git-unreadable'],
    confirmation: () => ({ summary: "Read the project's tagma.config.ts?" }),
    confirmLabel: 'Read config',
    presentation: { running: "Reading the project's config", done: "Read the project's config" },
    subjects: () => [],
  }),
};

export type ConfigOperationId = keyof typeof CONFIG_OPERATIONS;
