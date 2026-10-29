import { expect, test } from 'bun:test';
import { claudeCodeList } from './list.js';

test('a Claude Code list resolves each source kind, keeps refused kinds listed and faults only the invalid entries', () => {
  const read = claudeCodeList.read(
    JSON.stringify({
      name: 'acme',
      owner: { name: 'Acme' },
      metadata: { pluginRoot: './plugins' },
      plugins: [
        { name: 'bare', source: 'bare' },
        { name: 'hub', source: { source: 'github', repo: 'acme/hub', ref: 'v1', sha: 'a'.repeat(40) } },
        { name: 'mono', source: { source: 'git-subdir', url: 'acme/mono', path: 'tools/mono' } },
        { name: 'packaged', source: { source: 'npm', package: '@acme/packaged', version: '^2' } },
        { name: 'up', source: './../up' },
        { name: 'short', source: { source: 'url', url: 'https://example.invalid/short.git', sha: 'abc' } },
        { source: './nameless' },
        { name: 'bare', source: './again' },
      ],
    }),
  );
  if ('refused' in read) throw new Error(read.refused);
  expect(Object.fromEntries(read.entries.map((entry) => [entry.name, entry.source]))).toEqual({
    bare: { kind: 'path', path: './plugins/bare' },
    hub: { kind: 'git', url: 'https://github.com/acme/hub.git', path: undefined, ref: 'v1', commit: 'a'.repeat(40) },
    mono: { kind: 'git', url: 'https://github.com/acme/mono.git', path: 'tools/mono', ref: undefined, commit: undefined },
    packaged: expect.objectContaining({ kind: 'refused', shown: 'npm @acme/packaged@^2' }),
  });
  expect(read.faults.map((fault) => fault.name)).toEqual(['up', 'short', 'plugins[6]', 'plugins[7]']);
});
