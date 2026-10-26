import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { type Relocation, RelocationFailed, relocatedText } from '../platform/contract/service/relocation.js';
import { EXECUTIONS_HOME } from './contract/wire/home.js';

const entries = (directory: string): readonly string[] => (existsSync(directory) ? readdirSync(directory) : []);

export const executionRelocation: Relocation = {
  id: 'executions/state',
  relocate: (data, places) =>
    Effect.try({
      try: () => {
        const home = join(data.to, EXECUTIONS_HOME);
        for (const state of entries(home)) {
          for (const file of entries(join(home, state))) {
            if (!file.endsWith('.json')) continue;
            const path = join(home, state, file);
            const text = readFileSync(path, 'utf8');
            const moved = relocatedText(text, places);
            if (moved !== text) writeFileSync(path, moved);
          }
        }
        return [];
      },
      catch: (cause) => new RelocationFailed({ detail: String(cause) }),
    }),
};
