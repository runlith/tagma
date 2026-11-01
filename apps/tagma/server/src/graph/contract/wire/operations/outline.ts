import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { startPriceSchema } from '../../../../platform/contract/wire/start.js';
import { graphArms as arms } from '../answers.js';
import { blockMention, blockRef } from '../fields.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';
import { pathExistsReportSchema } from '../pathExists.js';
import { blockSchema, edgeSchema, refSchema, treeBlockSchema, writtenBlockSchema } from '../rows.js';
import { vocabularySchema } from '../tags/table.js';
import { DELIVERIES } from '../tags/law.js';
import { titleReadingSchema } from '../titles.js';
import { SURFACE_ACT, SURFACE_READ, noSubjects, graphInput } from './shared.js';

const read = (summary: string, done: string) => ({
  confirmation: () => ({ summary }),
  confirmLabel: 'Read',
  presentation: { running: done, done },
  subjects: () => [],
});

export const OUTLINE_OPERATIONS = {
  read_tree: operation('read_tree', {
    ...SURFACE_READ,
    ...read('Read the project outline?', 'Read the outline'),
    meaning: 'Read every live block of the served project as an outline row: name, parent, order, tags and status.',
    input: graphInput({}),
    answer: arms({ ok: { blocks: Schema.Array(treeBlockSchema) } }),
    refusals: [],
  }),

  read_titles: operation('read_titles', {
    ...SURFACE_READ,
    ...read('Read the titles of these blocks?', 'Read block titles'),
    meaning:
      'Resolve block names in the current graph, then other copies of this project and registered projects, preserving each address. Unreadable copies are reported beside the titles with their place, attempted names and typed refusal; ambiguity is judged across readable copies. Names not found are left out.',
    input: graphInput({ names: Schema.Array(Schema.String) }),
    answer: arms({ ok: titleReadingSchema.fields }),
    refusals: [],
  }),

  list_trash: operation('list_trash', {
    ...SURFACE_READ,
    ...read('List the trashed subtrees?', 'Listed the trash'),
    meaning: 'List the roots of the trashed subtrees of the served project, or the root named by an address.',
    input: graphInput({ name: Schema.optional(blockMention) }),
    answer: arms({ ok: { blocks: Schema.Array(blockSchema) } }),
    refusals: ['bad-name', 'ambiguous-name', 'not-found', 'place-mismatch'],
  }),

  read_edges: operation('read_edges', {
    ...SURFACE_READ,
    ...read('Read every edge of the project?', 'Read the edges'),
    meaning: 'Read every typed edge between the blocks of the served project.',
    input: graphInput({}),
    answer: arms({ ok: { edges: Schema.Array(edgeSchema) } }),
    refusals: [],
  }),

  read_refs: operation('read_refs', {
    ...SURFACE_READ,
    ...read('Read every body reference of the project?', 'Read the references'),
    meaning: 'Read every block reference written in the bodies of the served project, as name pairs.',
    input: graphInput({}),
    answer: arms({ ok: { refs: Schema.Array(refSchema) } }),
    refusals: [],
  }),

  read_vocabulary: operation('read_vocabulary', {
    ...SURFACE_READ,
    ...read('Read the project vocabulary?', 'Read the vocabulary'),
    meaning:
      'Read the structured vocabulary of the served project: its catalogs, the installed releases, every tag declaration, the declarations that could not be read, and for each tag the operation that makes each status move and writes each operated field.',
    input: graphInput({}),
    answer: arms({ ok: vocabularySchema.fields }),
    refusals: ['not-found', 'deleted', 'field-target'],
  }),

  read_law: operation('read_law', {
    ...SURFACE_READ,
    ...read('Read the managed law section of this project?', 'Read the law section'),
    meaning: 'Read the managed Tagma section a project’s AGENTS.md carries: the law binding the served project, rendered as one text.',
    input: graphInput({}),
    answer: arms({ ok: { law: Schema.String } }),
    refusals: [],
  }),

  read_path_exists: operation('read_path_exists', {
    ...SURFACE_READ,
    ...read('Check whether this path exists in the served checkout?', 'Checked a path'),
    meaning:
      'Check whether a path exists inside the checkout the served graph is measured against; a path escaping it through a link refuses.',
    input: graphInput({ path: Schema.String.annotate(placeRole('path')) }),
    answer: arms({ ok: pathExistsReportSchema.fields }),
    refusals: ['graph-required', 'path-outside-tree', 'files'],
  }),

  set_rule_enabled: operation('set_rule_enabled', {
    ...SURFACE_ACT,
    meaning: 'Switch one rule on or off.',
    input: graphInput({ blockId: blockRef, enabled: Schema.Boolean }),
    answer: arms({ ok: { block: writtenBlockSchema, start: Schema.optional(startPriceSchema) } }),
    refusals: ['not-found', 'deleted', 'not-rule'],
    confirmation: (input) => ({ summary: `${input.enabled ? 'Enable' : 'Disable'} rule ${input.blockId}?` }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching a rule', done: 'Switched a rule' },
    subjects: noSubjects,
  }),

  set_rule_delivery: operation('set_rule_delivery', {
    ...SURFACE_ACT,
    meaning:
      "Set where one rule reaches agents: `prompt` in every thread's startup instructions, `code` when the code its sources name is read or written, `finding` only within the results of the rule's check; null leaves it to its sources. Delivery never changes what the check judges. A value the rule's tag does not declare refuses. A delivery that reaches no agent — `code` without sources, `finding` whose check runs at no trigger — succeeds with a warning.",
    input: graphInput({ blockId: blockRef, delivery: Schema.NullOr(Schema.Literals(DELIVERIES)) }),
    answer: arms({ ok: { block: writtenBlockSchema, start: Schema.optional(startPriceSchema), warning: Schema.optional(Schema.String) } }),
    refusals: ['not-found', 'deleted', 'not-rule', 'delivery-undeclared', 'field-invalid'],
    confirmation: (input) => ({
      summary: `Deliver rule ${input.blockId} ${input.delivery === null ? 'by its sources' : `by ${input.delivery}`}?`,
    }),
    confirmLabel: 'Set',
    presentation: { running: 'Setting a rule’s delivery', done: 'Set a rule’s delivery' },
    subjects: noSubjects,
  }),
};
