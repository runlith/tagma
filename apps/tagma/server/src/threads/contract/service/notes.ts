import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { NoteScope, NoteSet } from '../wire/notes.js';

export type BuiltinNote = { readonly id: string; readonly text: string };

export const BUILTIN_NOTES = new ContributionPoint<BuiltinNote>('threads/notes');

export class BuiltinNotes extends Context.Service<BuiltinNotes, { readonly notes: readonly BuiltinNote[] }>()('threads/BuiltinNotes') {}

export type NoteReader = { readonly projectId: number; readonly threadId: string | null };

export type NotePlace = { readonly scope: NoteScope; readonly reader: NoteReader };

export type Standing = { readonly set: NoteSet; readonly text: string | null };

export type SwitchRefusal = 'notes-over-budget' | 'thread-required';

export type NoteRefusal = SwitchRefusal | 'note-builtin' | 'note-too-long';

export class NotesReach extends Context.Service<NotesReach, { withheld(threadId: string): Effect.Effect<string | null, StoreFailure> }>()(
  'threads/NotesReach',
) {}

export class OperatorNotes extends Context.Service<
  OperatorNotes,
  {
    standing(reader: NoteReader): Effect.Effect<Standing>;
    write(place: NotePlace, id: string, text: string | null): Effect.Effect<NoteSet, StoreFailure | GateRefusal<NoteRefusal>>;
    switch(place: NotePlace, id: string, on: boolean | null): Effect.Effect<NoteSet, StoreFailure | GateRefusal<SwitchRefusal>>;
    forked(from: string, to: string, unit: WriteUnit<'machine'>): Effect.Effect<void, StoreFailure>;
  }
>()('threads/OperatorNotes') {}
