import { Schema } from 'effect';
import { placedCursor } from '../../../platform/contract/wire/place.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { graphArms as arms } from '../../../graph/contract/wire/answers.js';
import { blockMention, line, title } from '../../../graph/contract/wire/fields.js';
import { GRAPH_ACT, GRAPH_READ, graphInput, noSubjects } from '../../../graph/contract/wire/operations/shared.js';
import { REFLECTIONS, reflectionFiledFields, reflectionListFields } from './answers.js';

export const REFLECTION_FILING_OPERATIONS = {
  file_reflection: operation('file_reflection', {
    ...GRAPH_ACT,
    approval: ASKS_NEVER,
    place: 'fixed',
    tool: { capability: 'reflections', direct: true },
    meaning: 'Record friction with Tagma itself as command, expected result and actual result, in Tagma’s own graph.',
    confirmation: (input) => ({
      summary: `File a reflection: ${input.title}?`,
      facts: [
        { label: 'Expected', value: input.expected },
        { label: 'Actual', value: input.actual },
      ],
      consequence: 'It stands where Tagma lives until something answers it.',
    }),
    confirmLabel: 'File',
    presentation: { running: 'Filing a reflection', done: 'Filed a reflection' },
    subjects: () => [],
    grammar:
      'For a Tagma defect your own work ran into that nobody pointed you to. A defect the operator or another agent brought, or one under discussion with the operator, is filed only when asked. Defects or missing documentation in the product being worked on belong under its owner. The result lists similar entries; use `ontoId` for a new occurrence of an existing fault, not for investigating its original report. Filing targets the area covering the running Tagma server’s source.',
    input: Schema.Struct({
      title,
      command: line.annotate({
        description: 'What you ran or called, exactly — or the act you wanted and did not have.',
      }),
      expected: line.annotate({
        description: 'What ONE act should have done.',
      }),
      actual: line.annotate({
        description: 'What happened instead: the refusal text, the count of steps, the workaround.',
      }),
      ontoId: Schema.optional(blockMention).annotate({
        description: 'An already-filed reflection these facts add to, when the echo named one.',
      }),
      body: Schema.optional(Schema.String).annotate({
        description: 'Optional explanatory prose below the three required facts; not parsed.',
      }),
    }),
    refusals: [
      'no-home',
      'not-found',
      'deleted',
      'no-root',
      'not-a-reflection',
      'already-answered',
      'reflection-shape',
      'query-shape',
      'creation-default-missing',
      'creation-default-ambiguous',
      'creation-default-invalid',
      'creation-contract',
      'no-holder',
      'claimed-elsewhere',
      'no-status',
      'illegal-status',
      'illegal-transition',
      'carriers-invalid',
      'unknown-project',
      'ambiguous-project',
      'git-refused',
      'git-unreadable',
      'git-incomplete',
      'tag-undeclared',
      'tag-declared',
      'vocabulary-older',
      'tag-incoherent',
      'field-conflict',
      'role-conflict',
      'field-invalid',
      'field-required',
      'field-target',
      'operation-only',
      'edge-undeclared',
      'edge-shape',
      'wait-cycle',
      'cross-project',
      'cross-project-parent',
      'superseded',
      'leaf',
      'amends-missing',
      'amends-shape',
      'amends-an-amendment',
      'amendment-shape',
      'amendment-empty',
      'amendment-op',
      'amendment-ref',
      'amendment-outside',
      'tree-not-measured',
      'source-required',
      'source-outside',
      'duplicate-source',
      'not-measurable',
      'symbol-shape',
      'symbol-missing',
      'body-capped',
      'body-address',
    ],
    answer: arms({ ok: reflectionFiledFields }),
  }),
  read_reflections: operation('read_reflections', {
    ...GRAPH_READ,
    page: REFLECTIONS,
    meaning: 'Read unanswered Tagma reflections before filing, to add sightings to existing entries rather than duplicate them.',
    grammar:
      'Entries leave this list when their answering task ends, an answering doc/rule is written, answer_reflection names finished work, the landed commit of a direct fix or a check that found nothing to fix, or a keeper supersedes them. Search the reflection kind to include answered entries. The answer carries the standing total beside the page.',
    input: graphInput({ limit: limitOf(REFLECTIONS), cursor: placedCursor }),
    answer: arms({ ok: reflectionListFields }),
    refusals: ['no-home', 'not-found', 'no-root', 'bad-cursor', 'cursor-stale'],
    confirmation: () => ({ summary: 'Read standing Tagma reflections?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the standing friction', done: 'Read the standing friction' },
    subjects: noSubjects,
  }),
};
