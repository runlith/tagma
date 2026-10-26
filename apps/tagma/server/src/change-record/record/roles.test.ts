import { expect, test } from 'bun:test';
import type { CommandPart } from '@runlith/agent-tools/WorkspaceChanges';
import { roleOf } from './roles.js';

const TREE = '/repo';
const part = (over: Partial<CommandPart>): CommandPart => ({
  readsOnly: false,
  named: [],
  signature: null,
  listed: false,
  implicit: [],
  ...over,
});
const role = (...parts: CommandPart[]) => roleOf({ readsOnly: false, parts }, TREE, () => null);

test('a check is a reader whose output outside the checkout makes it no writer, and one inside names that path', () => {
  expect(role(part({ listed: true, named: ['/tmp/log.txt'], implicit: ['*.snap'] }))).toEqual({ kind: 'reader', implicit: ['*.snap'] });
  expect(role(part({ listed: true, named: ['/repo/out/report.xml'] }))).toEqual({ kind: 'named', paths: ['out/report.xml'], implicit: [] });
});

test('a check whose output cannot be named is a writer, as is any part that changes what it does not name', () => {
  expect(role(part({ listed: true, named: null }))).toEqual({ kind: 'writer' });
  expect(role(part({ named: ['/repo/src/a.ts'] }), part({ named: null }))).toEqual({ kind: 'writer' });
});

test('an editor beside a check names its files relative to the checkout, and an editor writing only outside names nothing', () => {
  expect(role(part({ named: ['/repo/src/a.ts'] }), part({ listed: true, implicit: ['*.tsbuildinfo'] }))).toEqual({
    kind: 'named',
    paths: ['src/a.ts'],
    implicit: ['*.tsbuildinfo'],
  });
  expect(role(part({ named: ['/elsewhere/a.ts'] }))).toEqual({ kind: 'named', paths: [], implicit: [] });
});
