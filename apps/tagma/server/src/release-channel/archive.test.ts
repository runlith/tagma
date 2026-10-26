import { expect, test } from 'bun:test';
import { listingRefusal } from './archive.js';

const entry = (kind: string, name: string, link = '') =>
  [name, `${kind}rw-r--r--  0 user staff  2 Oct 13 02:52 ${name}${link === '' ? '' : ` -> ${link}`}`] as const;

const refusal = (...entries: ReadonlyArray<readonly [string, string]>) =>
  listingRefusal(
    entries.map(([name]) => name),
    entries.map(([, line]) => line),
  );

test('a release archive of files, directories and links inside it lists clean', () => {
  expect(
    refusal(entry('d', './'), entry('-', './bun'), entry('l', './desktop/Current', 'A'), entry('l', './bin/x', '../lib/x')),
  ).toBeNull();
});

test('an archive is refused before it unpacks for a name outside it, an AppleDouble file, a hard link, a link out of it or a name split by a line break', () => {
  expect(refusal(entry('-', '/etc/passwd'))).toContain('root of the machine');
  expect(refusal(entry('-', './../escaped'))).toContain('climbs out');
  expect(refusal(entry('-', './desktop/._Tagma.app'))).toContain('AppleDouble');
  expect(refusal(entry('h', './bun'))).toContain('hard link');
  expect(refusal(entry('l', './l', '/Users/someone'))).toContain('outside the archive');
  expect(refusal(entry('l', './desktop/out', '../../outside'))).toContain('outside the archive');
  expect(refusal(entry('l', './desktop/round', 'Current/../../../outside'))).toContain('outside the archive');
  expect(listingRefusal(['./a', 'b'], ['-rw-r--r--  0 u s 2 Oct 13 02:52 ./a\nb'])).toContain('line break');
});
