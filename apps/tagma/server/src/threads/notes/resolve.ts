import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import type { BuiltinNote, NoteReader, Standing } from '../contract/service/notes.js';
import { ALL_NOTES, NOTES_BUDGET, type Note, type NoteOrigin, type NoteScope } from '../contract/wire/notes.js';

export type NoteRow = {
  readonly scope: NoteScope;
  readonly key: string;
  readonly noteId: string;
  readonly text: string | null;
  readonly switch: 'on' | 'off' | null;
  readonly writtenAt: number;
};

export type ScopeRows = ReadonlyMap<string, NoteRow>;

export type Layers = { readonly [S in NoteScope]: ScopeRows | undefined };

const FRAME = 'Standing notes from the operator, attached to every message he sends:';

const FAR_TO_NEAR = ['user', 'project', 'thread'] as const satisfies readonly NoteScope[];

const NEAR_TO_FAR = ['thread', 'project', 'user'] as const satisfies readonly NoteScope[];

const RANK: Readonly<Record<NoteOrigin, number>> = { builtin: 0, user: 1, project: 2, thread: 3 };

export const scopeKey = (scope: NoteScope, reader: NoteReader): string | null =>
  scope === 'user' ? 'user' : scope === 'project' ? String(reader.projectId) : reader.threadId;

type Candidate = { id: string; text: string; definedIn: NoteOrigin; rank: number; at: number };

type Decision = { readonly on: boolean; readonly decidedIn: NoteScope | null; readonly decidedBy: string | null };

const decision = (layers: Layers, id: string): Decision => {
  for (const scope of NEAR_TO_FAR) {
    const layer = layers[scope];
    if (layer === undefined) continue;
    for (const by of [id, ALL_NOTES]) {
      const standing = layer.get(by)?.switch ?? null;
      if (standing !== null) return { on: standing === 'on', decidedIn: scope, decidedBy: by };
    }
  }
  return { on: true, decidedIn: null, decidedBy: null };
};

export const resolve = (builtins: readonly BuiltinNote[], layers: Layers, reader: NoteReader): Standing => {
  const candidates = new Map<string, Candidate>();
  builtins.forEach((note, index) =>
    candidates.set(note.id, { id: note.id, text: note.text, definedIn: 'builtin', rank: RANK.builtin, at: index }),
  );
  for (const scope of FAR_TO_NEAR) {
    for (const row of layers[scope]?.values() ?? []) {
      if (row.text === null) continue;
      candidates.set(row.noteId, { id: row.noteId, text: row.text, definedIn: scope, rank: RANK[scope], at: row.writtenAt });
    }
  }
  const notes: Note[] = [...candidates.values()]
    .sort((left, right) => left.rank - right.rank || left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map(({ id, text, definedIn }) => ({ id, text, definedIn, ...decision(layers, id) }));
  const on = notes.filter((note) => note.on);
  const text = on.length === 0 ? null : [FRAME, ...on.map((note) => note.text)].join('\n\n');
  return {
    set: {
      projectId: reader.projectId,
      threadId: reader.threadId,
      notes,
      chars: on.reduce((total, note) => total + note.text.length, 0),
      budget: NOTES_BUDGET,
      tokens: text === null ? 0 : estimateThreadTokens(text),
    },
    text,
  };
};
