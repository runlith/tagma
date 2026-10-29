import { family } from '@runlith/paging';
import { Schema } from 'effect';
import type { ProjectRef } from '../../../projects/contract/wire/project.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { TagmaAppId } from './manifest.js';
import { tagmaAppRowSchema } from './rows.js';
import { placedCursor, projectField } from '../../../platform/contract/wire/place.js';

const declared = {
  doors: { http: true },
  tool: { capability: 'apps' },
  callers: 'any',
  subject: 'none',
  place: 'project',
  waits: [],
  lifetimes: [],
} as const;

export const TAGMA_APP_ROWS = {
  ...family('apps', 1, 'json', { text: 2_100, json: 2_100 }, 20, () => ({
    id: 'x'.repeat(40),
    title: 'x'.repeat(80),
    root: 'x'.repeat(200),
    floor: 'project',
    installed: { source: 'x'.repeat(200), enabled: true },
    enabled: true,
    state: 'starting',
    tools: 100,
    restarts: 1000,
    failure: 'x'.repeat(1_000),
    refused: 'x'.repeat(300),
  })),
};

const answer = arms({ ok: { app: tagmaAppRowSchema } });

const acted = { ...declared, effect: 'write', identity: { key: 'call' } } as const;

const named = Schema.Struct({ id: TagmaAppId });

const LIST_REFUSALS = ['not-found', 'app-floor-unreadable', 'unknown-project'] as const;
const CHANGE_REFUSALS = [...LIST_REFUSALS, 'app-not-installed', 'setting-scope', 'setting-value'] as const;

export const TAGMA_APP_OPERATIONS = {
  read_apps: operation('read_apps', {
    approval: ASKS_NEVER,
    ...declared,
    answer: arms({
      ok: { apps: Schema.Array(tagmaAppRowSchema), shown: Schema.Int, total: Schema.Int, next: Schema.NullOr(Schema.String) },
    }),
    effect: 'read',
    identity: 'none',
    meaning:
      "Read the apps this project finds in its .tagma-apps directory and the operator's, with what is installed on this machine, what this project sees and each process's state.",
    grammar:
      'A page of rows by id with the total; `next` continues the walk, null on the last page. An app is a directory named as its id holding tagma-app.json. A refused row says why its directory as it stands now cannot run; a failed row carries the end of what its process wrote. Starts nothing.',
    input: Schema.Struct({ project: projectField, limit: limitOf(TAGMA_APP_ROWS), cursor: placedCursor }),
    refusals: [...LIST_REFUSALS, 'bad-cursor', 'cursor-stale'],
    page: TAGMA_APP_ROWS,
    confirmation: () => ({ summary: 'Read the apps and their state?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the apps', done: 'Read the apps', many: (count) => `Read the apps ${count} times` },
    subjects: () => [],
  }),
  read_app_schema: operation('read_app_schema', {
    approval: ASKS_NEVER,
    ...declared,
    place: 'machine',
    answer: arms({ ok: { schema: Schema.Unknown } }),
    effect: 'read',
    identity: 'none',
    meaning: 'Read the JSON Schema of tagma-app.json: the envelope and every contribution point this server declares.',
    input: Schema.Struct({}),
    refusals: [],
    confirmation: () => ({ summary: 'Read the schema of tagma-app.json?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the app schema', done: 'Read the app schema' },
    subjects: () => [],
  }),
  install_app: operation('install_app', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning:
      'Install an app this project finds, by its id: the machine records the directory it runs from, starts its process and this project sees it. `enabled: false` keeps it installed with its process stopped.',
    grammar: `The process starts once and serves every project; each restarts it when its files change, except ui/. It runs as the operator with no further permission asked.
An id standing in both floors, or installed from another directory, refuses with both paths. A tagma-app.json the server refuses refuses with its reason.`,
    input: Schema.Struct({
      project: projectField,
      id: TagmaAppId,
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: 'true (the default): its process runs. false: it stays installed, stopped.',
      }),
    }),
    refusals: [...LIST_REFUSALS, 'app-unknown', 'app-collision', 'app-source-taken', 'app-refused', 'setting-scope', 'setting-value'],
    confirmation: (input, project: ProjectRef) => ({
      summary:
        input.enabled === false
          ? `Install the app ${input.id} for project “${project.name}” with its process stopped?`
          : `Install and start the app ${input.id} for project “${project.name}”?`,
      consequence:
        input.enabled === false
          ? 'Its directory is recorded on this machine; its process stays stopped.'
          : `Its process runs as the operator on this machine, and project “${project.name}” sees its tools.`,
    }),
    confirmLabel: 'Install',
    presentation: { running: 'Installing an app', done: 'Installed an app' },
    subjects: () => [],
  }),
  uninstall_app: operation('uninstall_app', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    place: 'home',
    answer,
    meaning:
      'Uninstall an app from this machine: its process ends, its contributions are withdrawn everywhere and its secret values are dropped. Its data stays.',
    input: named,
    refusals: [...CHANGE_REFUSALS, 'secret-store-failed'],
    confirmation: (input) => ({
      summary: `Uninstall the app ${input.id}?`,
      consequence: 'Its process ends, every project stops seeing it and its secret values are dropped; its data and its directory stay.',
    }),
    confirmLabel: 'Uninstall',
    presentation: { running: 'Uninstalling an app', done: 'Uninstalled an app' },
    subjects: () => [],
  }),
  enable_app: operation('enable_app', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning: 'Show an installed app to this project or hide it: its tools and views reach this project only while it is enabled here.',
    grammar: 'Its process is the machine’s and keeps running either way.',
    input: Schema.Struct({
      project: projectField,
      id: TagmaAppId,
      enabled: Schema.optional(Schema.Boolean).annotate({ description: 'true (the default): this project sees it. false: hidden here.' }),
    }),
    refusals: CHANGE_REFUSALS,
    confirmation: (input, project: ProjectRef) => ({
      summary:
        input.enabled === false
          ? `Hide the app ${input.id} from project “${project.name}”?`
          : `Enable the app ${input.id} in project “${project.name}”?`,
    }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching an app', done: 'Switched an app' },
    subjects: () => [],
  }),
};

export type TagmaAppOperationId = keyof typeof TAGMA_APP_OPERATIONS;
