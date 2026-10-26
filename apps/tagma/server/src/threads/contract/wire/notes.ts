import { Schema } from 'effect';

export const NOTES_RULE = 'operator-notes';

export const NOTE_TEXT_LIMIT = 1_000;

export const NOTES_BUDGET = 2_000;

export const NOTE_SCOPES = ['user', 'project', 'thread'] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

export const NOTE_ORIGINS = ['builtin', ...NOTE_SCOPES] as const;
export type NoteOrigin = (typeof NOTE_ORIGINS)[number];

export const NoteId = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,40}$/u)).annotate({
  description: 'The note’s name: lowercase letters, digits and dashes, up to 40.',
});

export const ALL_NOTES = '*';

export const noteSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  definedIn: Schema.Literals(NOTE_ORIGINS),
  on: Schema.Boolean,
  decidedIn: Schema.NullOr(Schema.Literals(NOTE_SCOPES)).annotate({
    description: 'The scope whose switch decided `on`; null when no switch stands and the note is on by default.',
  }),
  decidedBy: Schema.NullOr(Schema.String).annotate({ description: 'The switch that decided: the note’s own id or `*`.' }),
});
export type Note = typeof noteSchema.Type;

export const noteSetSchema = Schema.Struct({
  projectId: Schema.Int,
  threadId: Schema.NullOr(Schema.String).annotate({ description: 'The thread whose set this is; null is a new thread of the project.' }),
  notes: Schema.Array(noteSchema),
  chars: Schema.Int.annotate({ description: 'Characters of the notes that are on, counted against the budget.' }),
  budget: Schema.Int,
  tokens: Schema.Int.annotate({ description: 'About how many tokens the set adds to each message of the operator.' }),
});
export type NoteSet = typeof noteSetSchema.Type;
