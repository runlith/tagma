import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TextAt } from './entries.js';
import { normalizedAt, workingTextsAt } from './working.js';
import { git, onGit, release, tempRepo } from './testing/fixture.js';

afterAll(release);

const shown = (texts: readonly TextAt[]) => texts.map((one) => (one._tag === 'Success' ? one.success : one.failure._tag));

test('files of a commit answer in the form git checks them out, an export rewrite or omission by its filters, and the rest absent or too large', async () => {
  const root = await tempRepo('git-working-');
  await git(root, ['config', 'core.autocrlf', 'true']);
  const deep = `${'nested/'.repeat(16)}deep.txt`;
  mkdirSync(join(root, deep, '..'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, '.gitattributes'), 'stamped.txt export-subst\nhidden.txt export-ignore\n/tests export-ignore\n');
  writeFileSync(join(root, 'lines.txt'), 'one\ntwo\n');
  writeFileSync(join(root, 'marked.txt'), '\uFEFFmarked\n');
  writeFileSync(join(root, 'stamped.txt'), '$Format:%H$\n');
  writeFileSync(join(root, 'hidden.txt'), 'hidden\n');
  writeFileSync(join(root, 'tests', 'inner.txt'), 'inner\n');
  writeFileSync(join(root, 'wide.txt'), 'x'.repeat(64));
  writeFileSync(join(root, deep), 'deep\n');
  writeFileSync(join(root, 'big.txt'), 'é\n'.repeat(100_000));
  symlinkSync('lines.txt', join(root, 'pointer'));
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  const paths = [
    'lines.txt',
    'marked.txt',
    'stamped.txt',
    'hidden.txt',
    'tests/inner.txt',
    deep,
    'pointer',
    'never.txt',
    'nested',
    'wide.txt',
  ];

  const texts = await onGit((service) => workingTextsAt(service, root, 'HEAD', paths, { capture: 32 }));
  const large = await onGit((service) => workingTextsAt(service, root, 'HEAD', ['big.txt', 'lines.txt', 'marked.txt']));
  writeFileSync(join(root, 'lines.txt'), 'one\nthree\n');
  await git(root, ['add', 'lines.txt']);
  const alone = await onGit((service) => workingTextsAt(service, root, 'HEAD', ['lines.txt', 'never.txt']));
  const staged = await onGit((service) => workingTextsAt(service, root, '', ['lines.txt', 'never.txt', 'pointer']));

  expect(shown(texts)).toEqual([
    'one\r\ntwo\r\n',
    '\uFEFFmarked\r\n',
    '$Format:%H$\r\n',
    'hidden\r\n',
    'inner\r\n',
    'deep\r\n',
    'lines.txt',
    null,
    null,
    'GitAnswerInvalid',
  ]);
  expect(shown(large)).toEqual(['é\r\n'.repeat(100_000), 'one\r\ntwo\r\n', '\uFEFFmarked\r\n']);
  expect(shown(alone)).toEqual(['one\r\ntwo\r\n', null]);
  expect(shown(staged)).toEqual(['one\r\nthree\r\n', null, 'lines.txt']);
});

test('git normalizes line endings where text or eol says so, and otherwise where core.autocrlf asks', async () => {
  const root = await tempRepo('git-normalized-');
  writeFileSync(join(root, '.gitattributes'), '*.bin -text\n*.lf eol=lf\n*.txt text\n');
  const paths = ['plain.ts', 'data.bin', 'unix.lf', 'note.txt'];

  const kept = await onGit((service) => normalizedAt(service, root, paths));
  await git(root, ['config', 'core.autocrlf', 'true']);
  const converted = await onGit((service) => normalizedAt(service, root, paths));

  expect([...kept].sort()).toEqual(['note.txt', 'unix.lf']);
  expect([...converted].sort()).toEqual(['note.txt', 'plain.ts', 'unix.lf']);
});
