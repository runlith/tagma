import { Schema } from 'effect';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { startPriceSchema } from '../../../../platform/contract/wire/start.js';
import { graphArms as arms } from '../answers.js';
import { overviewFields } from '../answers.js';
import { blockRef, line, place, projectPlace } from '../fields.js';
import { SOURCE_KINDS } from '../sources.js';
import { GRAPH_ACT, noSubjects, graphInput } from './shared.js';

const ANCHOR_GRAMMAR = `An untagged note accepts file, directory and symbol sources; a tagged block accepts the kinds its tags declare. Sources support ownership, navigation and search. To deliver a note to file readers and writers, use a type supporting \`core/explanation\`.
\`fromId\` atomically transfers the exact kind/ref/symbol from its current block; a mismatch refuses without changes.
A directory or file source draws an area's territory; a file or symbol source names the code a block is about. For a symbol, pass ref as a path and symbol separately, or put the same symbol after the first \`#\` in ref; different names refuse. A private member keeps its own \`#\`. The file must declare the symbol at its top level — a member or nested function is \`Owner.member\` — wherever its language is parsed.`;

const REANCHOR_GRAMMAR = `A file/directory path relocates every source at or below it, preserving kind and symbol. \`path#Symbol\` relocates or renames one symbol, which must already stand in its new file. A duplicate destination refuses the entire move.`;

export const SOURCE_OPERATIONS = {
  anchor_block: operation('anchor_block', {
    ...GRAPH_ACT,
    meaning: 'Bind a block to the code it is about — a file, a directory or a symbol.',
    grammar: ANCHOR_GRAMMAR,
    input: graphInput({
      blockId: blockRef,
      ref: place.annotate({
        description: 'A path relative to the project root.',
      }),
      kind: Schema.optional(Schema.Literals(SOURCE_KINDS)).annotate({
        description: 'file by default; symbol when a symbol is named.',
      }),
      symbol: Schema.optional(place),
      fromId: Schema.optional(blockRef).annotate({
        description: 'The block this source comes OFF: detach and attach in ONE act.',
      }),
    }),
    refusals: [
      'not-found',
      'illegal-kind',
      'source-outside',
      'not-measurable',
      'symbol-shape',
      'symbol-missing',
      'duplicate-source',
      'self-transfer',
      'no-source',
      'source-required',
      'deleted',
      'operation-only',
    ],
    answer: arms({
      ok: {
        source: Schema.Struct({
          id: Schema.Number,
          kind: Schema.Literals(SOURCE_KINDS),
          ref: Schema.String,
          symbol: Schema.NullOr(Schema.String),
        }),
        start: Schema.optional(startPriceSchema),
      },
    }),
    confirmation: (input) => ({
      summary: `Source ${input.blockId} to ${input.ref}${input.symbol === undefined ? '' : `#${input.symbol}`}?`,
    }),
    confirmLabel: 'Source',
    presentation: { running: 'Anchoring a block', done: 'Anchored a block' },
    subjects: noSubjects,
  }),

  unanchor_block: operation('unanchor_block', {
    ...GRAPH_ACT,
    meaning: 'Remove an exact kind/ref/symbol source from a block.',
    grammar:
      'Use for an incorrect source, e.g. a symbol imported rather than declared in that file. Use atomic transfer for an ownership change, or reanchor_path when code moved.',
    input: graphInput({
      blockId: blockRef,
      ref: place.annotate({ description: 'What the source points at, spelled as it was attached.' }),
      kind: Schema.optional(Schema.Literals(SOURCE_KINDS)).annotate({
        description: 'file by default; symbol when a symbol is named.',
      }),
      symbol: Schema.optional(place),
    }),
    refusals: ['not-found', 'deleted', 'illegal-kind', 'no-source', 'source-outside', 'symbol-shape', 'source-required', 'operation-only'],
    answer: arms({ ok: { start: Schema.optional(startPriceSchema) } }),
    confirmation: (input) => ({
      summary: `Take the source on ${input.ref}${input.symbol === undefined ? '' : `#${input.symbol}`} off ${input.blockId}?`,
    }),
    confirmLabel: 'Unanchor',
    presentation: { running: 'Taking an anchor off', done: 'Took an anchor off' },
    subjects: noSubjects,
  }),

  reanchor_path: operation('reanchor_path', {
    ...GRAPH_ACT,
    meaning: 'Relocate all sources after code moves.',
    grammar: REANCHOR_GRAMMAR,
    input: graphInput({
      from: projectPlace.annotate({ description: 'The old spelling: path, or path#Symbol.' }),
      to: projectPlace.annotate({ description: 'The new spelling, same shape.' }),
    }),
    refusals: [
      'relocation-shape',
      'relocation-noop',
      'symbol-missing',
      'no-source',
      'duplicate-source',
      'source-outside',
      'not-found',
      'unknown-project',
    ],
    answer: arms({ ok: overviewFields }),
    confirmation: (input) => ({
      summary: `Move every source from ${input.from} to ${input.to}?`,
      consequence: 'Every block keeps naming its code under the new spelling.',
    }),
    confirmLabel: 'Reanchor',
    presentation: { running: 'Moving sources with the code', done: 'Moved sources with the code' },
    subjects: noSubjects,
  }),
};
