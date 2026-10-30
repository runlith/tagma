import { expect, test } from 'bun:test';
import { entryLine } from '../../installation/contract/wire/junction.js';
import { eventsIn, ownedEntry, ownPlaces, portableEntry } from './targets.js';

test('the event holder is found at the codec path, and only own handlers are places', () => {
  const own = { hooks: [{ type: 'command', command: entryLine('hook stop --harness codex') }] };
  const foreign = { hooks: [{ type: 'command', command: 'printf other' }] };
  const doc = { signals: { stop: [foreign, own] }, hooks: { stop: [foreign] } };
  expect(eventsIn(doc, ['signals'])).toBe(doc.signals);
  expect(eventsIn(doc, [])).toBe(doc);
  expect(eventsIn(doc, ['signals', 'stop'])).toBeNull();
  expect(eventsIn(doc, ['missing'])).toBeNull();
  expect(ownPlaces(doc, ['signals'])).toEqual([{ event: 'stop', group: 1, handler: 0 }]);
  expect(ownPlaces(doc, ['missing'])).toEqual([]);
});

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
  const installed = entryLine('hook stop --harness quill-2');
  expect(ownedEntry({ command: installed })).toBe(installed);
  expect(ownedEntry({ command: 'npx prettier --write .' })).toBeNull();
});
