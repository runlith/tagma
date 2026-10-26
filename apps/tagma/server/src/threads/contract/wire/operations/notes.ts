import { Schema } from 'effect';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal, threadIdOf, type Actor } from '../../../../platform/contract/wire/actor.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { ALL_NOTES, NOTE_SCOPES, NOTE_TEXT_LIMIT, NOTES_BUDGET, NoteId, noteSetSchema } from '../notes.js';
import { threadInput } from '../project.js';

const subject = (kind: 'read' | 'write', threadId: string | undefined, actor: Actor) =>
  actor.kind !== 'operator' ? [{ kind, value: threadAgentSubject(signerPrincipal(actor), threadId ?? threadIdOf(actor) ?? '*') }] : [];

const NOTES_TOOL = {
  doors: { http: true },
  tool: { capability: 'threads' },
  callers: 'any',
  place: 'project',
  graph: 'none',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;

const NOTES_GRAMMAR = `Operator notes are short texts the model receives right after every message the operator sends. A note stands in a scope: \`user\` (every thread of the operator), \`project\` (the threads of this project), \`thread\` (one thread); the product ships builtin notes beneath them. The same id in a nearer scope replaces the farther text. Whether a note is on is decided by switches walked from the nearest scope out: in each scope the note's own switch, else the \`*\` switch; the first found decides, none means on. The notes that are on hold at most ${NOTES_BUDGET} characters together. Every answer is the set that now stands for the thread: name it to the operator as it stands, without reading it again.`;

const reader = {
  threadId: Schema.optional(ThreadId).annotate({
    description:
      'The thread whose set answers, and the thread a `thread` scope names. Omitted: your own thread; a caller that is no thread reads a new thread of the project.',
  }),
};

const scope = Schema.Literals(NOTE_SCOPES).annotate({
  description: '`user` when the operator names no scope; `project` or `thread` only on his word.',
});

export const NOTE_OPERATIONS = {
  read_operator_notes: operation('read_operator_notes', {
    approval: ASKS_NEVER,
    ...NOTES_TOOL,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        ...noteSetSchema.fields,
        withheld: Schema.NullOr(Schema.String).annotate({
          description: "Why the notes do not reach this thread's model, or null when they do.",
        }),
      },
    }),
    meaning:
      'The operator notes standing for one thread: each with its text, the scope that defines it, whether it is on and the switch that decided, the size the set adds to each of his messages, and why they do not reach a thread whose CLI takes no notes.',
    grammar: NOTES_GRAMMAR,
    input: threadInput(reader),
    refusals: ['not-found', 'foreign-project'],
    subjects: (input, _prepared, actor) => subject('read', input.threadId, actor),
    confirmation: () => ({ summary: 'Read the operator notes?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the operator notes', done: 'Read the operator notes' },
  }),

  write_operator_note: operation('write_operator_note', {
    approval: ASKS_IN_REVIEW,
    ...NOTES_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ written: noteSetSchema.fields }),
    meaning:
      'Add or replace one operator note in a scope with `text`; without `text`, delete its definition there. Only on the operator’s word: a `user` note reaches every thread he has.',
    grammar: `${NOTES_GRAMMAR} "Add to my messages …" with no scope named is \`user\`. "Delete it", "forget it" removes the definition; "take it away" is a switch, not this. A builtin note is never deleted and refuses \`note-builtin\`; a text past ${NOTE_TEXT_LIMIT} characters refuses \`note-too-long\`; a write that would carry the set past the budget refuses \`notes-over-budget\` with its size.`,
    input: threadInput({
      ...reader,
      scope,
      id: NoteId,
      text: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: `The note, said in the operator's own sense and about him in the third person ("the operator", "he"), as the builtin notes are, up to ${NOTE_TEXT_LIMIT} characters. Omitted: delete the definition in this scope.`,
      }),
    }),
    refusals: ['not-found', 'foreign-project', 'thread-required', 'note-builtin', 'note-too-long', 'notes-over-budget'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary:
        input.text === undefined
          ? `Delete the operator note ${input.id} from the ${input.scope} scope?`
          : `Write the operator note ${input.id} into the ${input.scope} scope?`,
    }),
    confirmLabel: 'Write',
    presentation: { running: 'Writing an operator note', done: 'Wrote an operator note' },
  }),

  switch_operator_notes: operation('switch_operator_notes', {
    approval: ASKS_IN_REVIEW,
    ...NOTES_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ switched: noteSetSchema.fields }),
    meaning:
      'Switch one operator note, or all of them with `*`, on or off in a scope, or lift that switch so the scope inherits again. Only on the operator’s word.',
    grammar: `${NOTES_GRAMMAR} "Take it away" switches it off in the scope that now decides its state, reversibly. "Take all notes away" is \`*\` off in the scope he names, else \`user\`. "Bring everything back" lifts, with \`on: null\`, the switches that hold anything of this thread's set off. A switch that would carry the set past the budget refuses \`notes-over-budget\`.`,
    input: threadInput({
      ...reader,
      scope,
      id: Schema.Union([NoteId, Schema.Literal(ALL_NOTES)]).annotate({ description: 'A note id, or `*` for every note.' }),
      on: Schema.NullOr(Schema.Boolean).annotate({ description: 'true — on; false — off; null — lift this switch.' }),
    }),
    refusals: ['not-found', 'foreign-project', 'thread-required', 'notes-over-budget'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary:
        input.on === null
          ? `Lift the ${input.scope} switch of ${input.id === ALL_NOTES ? 'every operator note' : `the operator note ${input.id}`}?`
          : `Switch ${input.id === ALL_NOTES ? 'every operator note' : `the operator note ${input.id}`} ${input.on ? 'on' : 'off'} in the ${input.scope} scope?`,
    }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching operator notes', done: 'Switched operator notes' },
  }),
};

export type NoteOperationId = keyof typeof NOTE_OPERATIONS;
