import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { type Relocation, RelocationFailed, relocatedText } from '../contract/service/relocation.js';

const rewritten = (path: string, places: Parameters<typeof relocatedText>[1]): void => {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const moved = relocatedText(text, places);
  if (moved !== text) writeFileSync(path, moved);
};

export const snapshotRelocation: Relocation = {
  id: 'platform/snapshots',
  relocate: (data, places) =>
    Effect.try({
      try: () => {
        for (const name of readdirSync(data.to)) {
          if (name.endsWith('.snapshot.json')) rewritten(join(data.to, name), places);
          if (!name.endsWith('.snapshots')) continue;
          for (const taken of readdirSync(join(data.to, name))) rewritten(join(data.to, name, taken, 'manifest.json'), places);
        }
        return [];
      },
      catch: (cause) => new RelocationFailed({ detail: String(cause) }),
    }),
};
