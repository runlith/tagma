import { expect, test } from 'bun:test';
import type { Side } from '@runlith/tagma/rules';
import program from './load-os';

const side = (files: Record<string, string>): Side => ({
  commit: 'fixture',
  paths: Object.keys(files),
  whole: true,
  read: async (path) => files[path] ?? null,
  facts: null,
});

test('Load OS inspection compares both sides and names each platform marker in core', async () => {
  const path = 'core.ts';
  const tree = side({
    [path]: "'darwin'; 'win32'; 'linux'; '.app/'; '/bin/ps'; '/proc/self'; 'Mac'\n'Mac'",
    'core.test.ts': "'darwin'",
    'testing/example.ts': "'linux'",
    'clean.ts': "import './processTree'; const machine = 'machine';",
  });
  const base = side({ [path]: "'darwin'" });
  const answer = await program['load-os']({ params: {}, tree, base });
  expect(answer.tree.findings.map((finding) => finding.fingerprint)).toEqual([
    'load-os:darwin:core.ts',
    'load-os:win32:core.ts',
    'load-os:linux:core.ts',
    'load-os:.app/:core.ts',
    'load-os:/bin/ps:core.ts',
    'load-os:/proc:core.ts',
    'load-os:Mac:core.ts',
  ]);
  expect(answer.tree.findings.at(-1)?.sites).toEqual([{ line: 1 }, { line: 2 }]);
  expect(answer.base?.findings.map((finding) => finding.fingerprint)).toEqual(['load-os:darwin:core.ts']);
});
