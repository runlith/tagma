import { Schema } from 'effect';
import { threadModelSchema } from '@runlith/agent/protocol/realtime';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { threadWireSnapshotPayloadSchema } from '../../../../threads/contract/wire/snapshot.js';
import { favoriteModelsSchema, modelDefaultsSchema, modelDefaultsWriteSchema, rememberedSwitchesSchema } from '../modelSelection.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const operatorOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

export const MODEL_OPERATIONS = {
  read_model_defaults: operation('read_model_defaults', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning: 'Read the model, reasoning, switches and account a new thread is born on when its birth names none.',
    grammar:
      'Without a saved model, the default is the first provider in catalog order — subscriptions before keys — that a Tagma agent runs on and that holds an account or a signed-in CLI login; `unconnected` answers when none does, with `plans`: the subscription providers a Tagma agent runs on, in that order. A saved model that no installed adapter serves gives way to that default; the saved one stays stored and answers again once its adapter is back. `remembered` holds, by provider and model, the switches each served model keeps; a model that takes the operator defaults takes its own.',
    input: Schema.Struct({}),
    answer: arms({
      read: { ...modelDefaultsSchema.fields, remembered: rememberedSwitchesSchema },
      unconnected: { plans: Schema.Array(Schema.String) },
    }),
    refusals: ['no-provider', 'provider-not-installed'],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read the model defaults?' }),
    confirmLabel: 'Read defaults',
    presentation: { running: 'Reading the model defaults', done: 'Read the model defaults' },
  }),
  set_model_defaults: operation('set_model_defaults', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Set the model, reasoning, switches and account a new thread is born on when its birth names none.',
    grammar:
      'A null `account` keeps the provider’s default account; a named one becomes that default. Switches are kept for this model alone: each model of a provider holds its own.',
    input: modelDefaultsWriteSchema,
    answer: arms({ set: modelDefaultsSchema.fields }),
    refusals: ['provider-not-installed', 'unknown-model', 'unknown-account', 'stale-revision', 'model-switch-unsupported'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Make ${input.provider}/${input.model} the model new threads are born on?` }),
    confirmLabel: 'Set defaults',
    presentation: { running: 'Setting the model defaults', done: 'Set the model defaults' },
  }),
  read_model_favorites: operation('read_model_favorites', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    meaning: 'Read the text models the operator keeps as favourites in the model picker.',
    input: Schema.Struct({}),
    answer: arms({ read: favoriteModelsSchema.fields }),
    refusals: [],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read the favourite models?' }),
    confirmLabel: 'Read favourites',
    presentation: { running: 'Reading the favourite models', done: 'Read the favourite models' },
  }),
  set_model_favorites: operation('set_model_favorites', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    meaning: 'Replace the text models the operator keeps as favourites in the model picker.',
    input: favoriteModelsSchema,
    answer: arms({ set: favoriteModelsSchema.fields }),
    refusals: ['provider-not-installed', 'unknown-model'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Keep ${input.models.length} favourite models?` }),
    confirmLabel: 'Set favourites',
    presentation: { running: 'Setting the favourite models', done: 'Set the favourite models' },
  }),
  set_thread_model: operation('set_thread_model', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    doors: { http: 'perform', socket: true },
    meaning: "Move one thread's next runs onto another model, reasoning rung, switches or account.",
    grammar:
      'A run already going keeps the model it opened with. A model another harness serves — Claude over ACP — moves the thread onto that harness, and a native model moves it back; the thread keeps its history and its feed. A move a going turn holds back answers at once with the pick as the thread’s model: the server stops that turn at its next step, moves the thread and continues the turn there, and words sent meanwhile run on the new model. A later pick replaces one still waiting. A CLI agent of its own stays on its own provider row. An omitted `account` keeps the thread’s own where the provider still holds it.',
    place: 'project',
    input: Schema.Struct({ threadId: ThreadId, ...threadModelSchema.fields }),
    answer: arms({ loaded: { snapshot: threadWireSnapshotPayloadSchema.fields.snapshot } }),
    refusals: [
      'unknown-project',
      'not-found',
      'foreign-project',
      'thread-gone',
      'provider-not-installed',
      'unknown-model',
      'unknown-account',
      'model-switch-unsupported',
      'model-pinned',
      'model-provider',
      'model-unavailable',
      'harness-moved',
      'journal-moved',
      'harness-host',
      'thread-project-missing',
      'session-deleting',
      'session-uncertain',
    ],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Move ${input.threadId} onto ${input.provider}/${input.model}?` }),
    confirmLabel: 'Set model',
    presentation: { running: 'Setting a thread’s model', done: 'Set a thread’s model' },
  }),
};

export type ModelOperationId = keyof typeof MODEL_OPERATIONS;
