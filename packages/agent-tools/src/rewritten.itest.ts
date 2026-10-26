import { landedOf } from './WorkspaceChanges';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createTools } from './index';
import { answer, createTempDir, host, options } from './testing/toolHarness';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

it.effect('an edit whose oldString is gone from a file the commit steps rewrote names that commit', () =>
  Effect.gen(function* () {
    const dir = yield* createTempDir();
    yield* host.writeFile(join(dir, 'alpha.ts'), 'const a = 1;\n');
    const changes = {
      land: <E, R>(_changes: readonly unknown[], write: Effect.Effect<boolean, E, R>) =>
        Effect.map(write, (written) => landedOf(written, written)),
      rewrittenBy: (path: string, text: string) =>
        Effect.succeed(path.endsWith('alpha.ts') && text === 'const a = 1;\n' ? { commit: COMMIT } : null),
    };
    const tools = createTools(options({ cwd: dir, changes }));

    const refused = yield* answer(tools.edit, { path: 'alpha.ts', oldString: 'const b = 1;', newString: 'const a = 2;' });

    expect(String(refused.value)).toContain(COMMIT.slice(0, 10));
  }),
);
