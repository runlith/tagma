import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { THEME_MODES } from './contract/wire/format.js';
import { meaningRefusal } from './contract/wire/meaning.js';
import { resolve } from './contract/wire/resolve.js';

test('Tagma’s own theme keeps the meaning of every state colour in both looks', () => {
  for (const mode of THEME_MODES) expect(meaningRefusal(resolve(undefined, mode).palette)).toBeNull();
});

test('the window’s generated stylesheet, its page’s status-bar colours and its manifest’s are Tagma’s theme as it stands', async () => {
  const checked = Bun.spawn([process.execPath, join(import.meta.dir, 'stylesheet.ts'), '--check'], { stderr: 'pipe' });
  expect({ code: await checked.exited, said: await new Response(checked.stderr).text() }).toEqual({ code: 0, said: '' });
});
