import { delimiter } from 'node:path';
import { Effect } from 'effect';
import { type Command, EditorHost, type Sighting } from '../editors/contract/service/host.js';
import type { EditorEntry } from '../editors/contract/wire/catalog.js';

export type PathPlaces = {
  readonly path: string;
  readonly beside: readonly string[];
  readonly opener: Command;
};

const sightingOf = (entry: EditorEntry, search: string): Sighting => {
  try {
    for (const command of entry.commands ?? []) {
      const program = Bun.which(command, { PATH: search });
      if (program !== null) return { id: entry.id, found: 'installed', launcher: { program, prefix: [] }, icon: null };
    }
    return { id: entry.id, found: 'absent' };
  } catch (error) {
    return { id: entry.id, found: 'failed', reason: String(error) };
  }
};

export const makePathEditors = (places: PathPlaces) => {
  const search = [places.path, ...places.beside].filter((part) => part !== '').join(delimiter);
  return EditorHost.of({
    find: (entries) => Effect.sync(() => entries.map((entry) => sightingOf(entry, search))).pipe(Effect.withSpan('EditorHost.path')),
    opener: (url) => ({ program: places.opener.program, args: [...places.opener.args, url] }),
  });
};
