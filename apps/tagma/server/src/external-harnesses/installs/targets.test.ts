import { expect, test } from 'bun:test';
import { entryLine } from '../../installation/contract/wire/junction.js';
import { ownedEntry, portableEntry } from './targets.js';

test('every form a Tagma hook was written in is owned and rewrites to the entry point line', () => {
  const current = entryLine('hook stop --harness codex');
  for (const command of [
    current,
    't=$(command -v tagma || command -v tagma-dev) || exit 0; exec "$t" hook stop --harness codex',
    'command -v tagma >/dev/null 2>&1 || exit 0; exec tagma hook stop --harness codex',
    'tagma hook stop --harness codex',
    '"/Users/x/.tagma/install/current/bun" "/Users/x/.tagma/install/current/bin/cli/main.js" hook stop --harness codex',
  ]) {
    expect(ownedEntry({ command })).toBe(command);
    expect(portableEntry({ command })).toBe(current);
  }
  expect(ownedEntry({ command: 'npx prettier --write .' })).toBeNull();
});
