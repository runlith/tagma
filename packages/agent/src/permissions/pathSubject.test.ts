import { expect, test } from 'bun:test';
import { posix, win32 } from 'node:path';
import { pathSubject } from './pathSubject';

const cases: ReadonlyArray<readonly [string, string]> = [
  ['/work/repo', '/work/repo'],
  ['/work/repo', '/work/repo/src/a.ts'],
  ['/work/repo/', '/work/repo//src/./b.ts'],
  ['/work/repo', '/work/other/c.ts'],
  ['/work/repo/deep/er', '/work'],
  ['/work/repo', '/'],
  ['/', '/etc/hosts'],
  ['/work/./repo/../repo', '/work/repo/../repo/x/../y'],
];

test('an absolute target is named relative to the working directory the way POSIX path arithmetic names it', () => {
  for (const [cwd, target] of cases) {
    expect(pathSubject('read', cwd, target)).toEqual({
      kind: 'read',
      value: posix.relative(posix.resolve(cwd), posix.resolve(target)) || '.',
      file: true,
    });
  }
});

const windowsCases: ReadonlyArray<readonly [string, string]> = [
  ['C:\\work\\repo', 'C:\\work\\repo'],
  ['C:\\work\\repo', 'C:\\work\\repo\\src\\a.ts'],
  ['C:\\work\\repo', 'c:\\WORK\\repo\\src\\b.ts'],
  ['C:\\work\\repo', 'C:\\work\\secret'],
  ['C:\\work\\repo\\', 'C:/work/repo//lib/./c.ts'],
  ['C:\\work', 'C:\\..\\..\\d.ts'],
  ['C:\\work\\repo', 'D:\\other\\e.ts'],
];

test('a Windows host names an absolute target the way Windows path arithmetic names it', () => {
  for (const [cwd, target] of windowsCases) {
    expect(pathSubject('read', cwd, target)).toEqual({
      kind: 'read',
      value: win32.relative(win32.resolve(cwd), win32.resolve(target)) || '.',
      file: true,
    });
  }
});

test('a relative target is taken from the working directory', () => {
  expect(pathSubject('write', '/work/repo', 'src/../lib/z.ts')).toEqual({ kind: 'write', value: 'lib/z.ts', file: true });
});
