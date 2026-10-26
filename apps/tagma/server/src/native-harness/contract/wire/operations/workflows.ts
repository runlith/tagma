import { Schema } from 'effect';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { workflowCatalogSchema, workflowRunSchema, workflowStartedSchema } from '../workflows.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const workflowDoors = {
  doors: { http: 'perform' },
  tool: { capability: 'peers' },
  callers: 'any',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

export const WORKFLOW_OPERATIONS = {
  list_workflows: operation('list_workflows', {
    approval: ASKS_NEVER,
    ...workflowDoors,
    meaning: 'List the workflows this project can run by name, and the definition files that could not become one.',
    input: Schema.Struct({}),
    answer: arms({ ok: workflowCatalogSchema.fields }),
    refusals: ['unknown-project', 'not-found'],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'List the workflows?' }),
    confirmLabel: 'List workflows',
    presentation: { running: 'Listing the workflows', done: 'Listed the workflows' },
  }),
  list_workflow_runs: operation('list_workflow_runs', {
    approval: ASKS_NEVER,
    ...workflowDoors,
    meaning: "List this project's workflow runs, freshest first, each with the steps it walked.",
    input: Schema.Struct({}),
    answer: arms({ ok: { runs: Schema.Array(workflowRunSchema) } }),
    refusals: ['unknown-project'],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'List the workflow runs?' }),
    confirmLabel: 'List runs',
    presentation: { running: 'Listing the workflow runs', done: 'Listed the workflow runs' },
  }),
  start_workflow: operation('start_workflow', {
    approval: ASKS_IN_REVIEW,
    ...workflowDoors,
    meaning: 'Start a saved workflow: its members work under a thread of its own, which the server keeps driving.',
    grammar:
      '`input` is one object of the fields the workflow declares; `scopeName` names the block whose subtree the run’s thread is opened inside.',
    input: Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1)),
      input: Schema.Record(Schema.String, Schema.Unknown),
      scopeName: Schema.optional(Schema.String),
    }),
    answer: arms({ started: workflowStartedSchema.fields }),
    refusals: [
      'unknown-project',
      'not-found',
      'bad-name',
      'ambiguous-name',
      'workflow-unknown',
      'workflow-arguments',
      'delegation-off',
      'unknown-type',
      'type-withheld',
      'mode-unknown',
      'thread-project-missing',
    ],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: (input) => ({ summary: `Start the workflow ${input.name}?` }),
    confirmLabel: 'Start workflow',
    presentation: { running: 'Starting a workflow', done: 'Started a workflow' },
  }),
};

export type WorkflowOperationId = keyof typeof WORKFLOW_OPERATIONS;
