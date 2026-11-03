import { expect, test } from 'bun:test';
import { absoluteSources } from './maps';

const map = JSON.stringify({ version: 3, sources: ['src/a.ts', '../outside/b.ts', 'src/a.ts.bak'], mappings: '' });

test('a source map names the original checkout for sources under the build snapshot, and leaves other absolute sources as they are', () => {
  const named = JSON.parse(absoluteSources(map, '/snapshot/app', { from: '/snapshot/app', to: '/work/tagma' })) as { sources: string[] };
  const plain = JSON.parse(absoluteSources(map, '/snapshot/app')) as { sources: string[] };

  expect(named.sources).toEqual(['/work/tagma/src/a.ts', '/snapshot/outside/b.ts', '/work/tagma/src/a.ts.bak']);
  expect(plain.sources).toEqual(['/snapshot/app/src/a.ts', '/snapshot/outside/b.ts', '/snapshot/app/src/a.ts.bak']);
});

test('a snapshot path that only shares a prefix with the origin is not renamed', () => {
  const named = JSON.parse(
    absoluteSources(JSON.stringify({ sources: ['x.ts'] }), '/snapshot/app-other', { from: '/snapshot/app', to: '/work/tagma' }),
  ) as {
    sources: string[];
  };

  expect(named.sources).toEqual(['/snapshot/app-other/x.ts']);
});
