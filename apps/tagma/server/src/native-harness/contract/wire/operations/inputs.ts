import { Schema } from 'effect';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { workspaceInventorySchema } from '../sourceSettings.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const operatorOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

export const INPUT_OPERATIONS = {
  read_workspace_sources: operation('read_workspace_sources', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning:
      "Read the project's workspace sources: the skills a thread would load, built-in ones included, its context files and the files that were rejected.",
    input: Schema.Struct({}),
    answer: arms({ read: workspaceInventorySchema.fields }),
    refusals: ['unknown-project', 'not-found', 'source-unreadable'],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read the workspace sources?' }),
    confirmLabel: 'Read sources',
    presentation: { running: 'Reading the workspace sources', done: 'Read the workspace sources' },
  }),
  reload_workspace_sources: operation('reload_workspace_sources', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: "Drop the project's cached workspace sources and read them again from disk.",
    input: Schema.Struct({}),
    answer: arms({ reloaded: workspaceInventorySchema.fields }),
    refusals: ['unknown-project', 'not-found', 'source-unreadable'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Reload the workspace sources?' }),
    confirmLabel: 'Reload sources',
    presentation: { running: 'Reloading the workspace sources', done: 'Reloaded the workspace sources' },
  }),
};

export type InputOperationId = keyof typeof INPUT_OPERATIONS;
