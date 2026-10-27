import { expect, test } from 'bun:test';
import type { CommandPart } from '@runlith/agent-tools/WorkspaceChanges';
import { covers, explains, roleOf } from './roles.js';

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

test('shell patterns name matching entries and their subtrees without crossing a slash or a leading dot', () => {
  const one = role(
    part({ named: [{ glob: '/repo/dist/*.js' }, { glob: '/repo/dist/*.map' }, { glob: '/repo/logs/[ab]?.log' }, { glob: '/repo/out/*' }] }),
  );
  for (const name of ['dist/a.js', 'dist/a.map', 'logs/a1.log', 'out/tree/.hidden']) {
    expect(covers(one, name)).toBe(true);
    expect(explains(one, name)).toBe(true);
  }
  for (const name of ['dist/a.ts', 'dist/.hidden.js', 'dist/deeper/a.js', 'logs/c1.log', 'logs/a12.log', 'logs/.a.log', 'elsewhere/a.js'])
    expect(explains(one, name)).toBe(false);
  const ordinaryStars = role(part({ named: [{ glob: '/repo/**/*.js' }] }));
  expect(explains(ordinaryStars, 'dist/a.js')).toBe(true);
  expect(explains(ordinaryStars, 'dist/deeper/a.js')).toBe(false);
  const dotClass = role(part({ named: [{ glob: '/repo/dist/[.]hidden.js' }] }));
  expect(explains(dotClass, 'dist/.hidden.js')).toBe(false);
  const literal = role(part({ named: ['/repo/dist/*.js'] }));
  expect(explains(literal, 'dist/a.js')).toBe(false);
  expect(explains(literal, 'dist/*.js')).toBe(true);
});

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
