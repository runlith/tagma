import { describe, expect, it } from 'bun:test';
import type { Tree } from '../../tree';
import { membersDelta, membersOf, workspaceFrom, workspaceOf } from './workspace';

const texts: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'root', workspaces: { packages: ['libs/*', 'tools/**', '!tools/old', 'kits/one'] } }),
  'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { lodash: '*' } }),
  'apps/web/src/main.ts': '',
  'libs/client/package.json': JSON.stringify({
    name: '@acme/client',
    exports: {
      '.': { types: './src/index.d.ts', bun: './src/index.ts', default: './dist/index.js' },
      './parts/*': './src/parts/*.ts',
      './parts/internal/*': null,
      './gone': './src/gone.ts',
      './fallback': [null, './src/index.ts'],
      './blocks/*': './src/*/index-*.ts',
      './shared/*': './src/shared.ts',
    },
  }),
  'libs/client/src/a/index-a.ts': '',
  'libs/client/src/a/index-b.ts': '',
  'libs/client/src/shared.ts': '',
  'libs/client/src/index.ts': '',
  'libs/client/dist/index.js': '',
  'libs/client/src/parts/light.ts': '',
  'libs/client/src/parts/internal/secret.ts': '',
  'tools/nested/cli/package.json': JSON.stringify({ name: 'cli', main: 'main.ts' }),
  'tools/nested/cli/main.ts': '',
  'tools/nested/cli/bin/run.ts': '',
  'tools/old/package.json': JSON.stringify({ name: 'old', exports: './index.ts' }),
  'tools/old/index.ts': '',
  'kits/one/package.json': JSON.stringify({
    name: 'one',
    exports: './index.ts',
    peerDependencies: { '@acme/client': '*' },
    devDependencies: { cli: '*' },
  }),
  'kits/one/index.ts': '',
};

const tree: Tree = {
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => texts[path] ?? '',
  paths: () => Object.keys(texts),
};

describe('workspaceOf', () => {
  it('resolves a member through its exports under the conditions given, and names the path it aimed at, or the package, where it lands on no file', () => {
    const workspace = workspaceOf(tree, 'apps/web/src', ['bun']);
    expect(workspace?.manifest).toBe('package.json');
    expect(workspace?.resolve('@acme/client')).toEqual({ to: 'libs/client/src/index.ts' });
    expect(workspace?.resolve('@acme/client/parts/light')).toEqual({ to: 'libs/client/src/parts/light.ts' });
    expect(workspace?.resolve('cli')).toEqual({ to: 'tools/nested/cli/main.ts' });
    expect(workspace?.resolve('cli/bin/run')).toEqual({ to: 'tools/nested/cli/bin/run.ts' });
    expect(workspace?.resolve('one')).toEqual({ to: 'kits/one/index.ts' });
    const unresolved = [
      '@acme/client/parts/internal/secret',
      '@acme/client/gone',
      '@acme/client/other',
      '@acme/client/fallback',
      'cli/bin/gone',
    ];
    expect(unresolved.map((one) => workspace?.resolve(one))).toEqual([
      { unlisted: 'libs/client' },
      { unlisted: 'libs/client/src/gone.ts' },
      { unlisted: 'libs/client' },
      { unlisted: 'libs/client' },
      { unlisted: 'tools/nested/cli/bin/gone' },
    ]);
    expect(['web', 'old', 'lodash'].map((one) => workspace?.resolve(one))).toEqual([
      { unlisted: 'apps/web/src/web' },
      { unlisted: 'apps/web/src/old' },
      null,
    ]);
  });

  it('lists every named member with the dependencies its manifest declares and the paths its exports name under the conditions', () => {
    const packages = workspaceOf(tree, 'apps/web/src', ['bun'])?.manifests() ?? [];
    expect(packages.map(({ name, dir }) => [name, dir])).toEqual([
      ['one', 'kits/one'],
      ['@acme/client', 'libs/client'],
      ['cli', 'tools/nested/cli'],
    ]);
    const [one, client, cli] = packages;
    expect(['@acme/client', 'cli', 'lodash'].map((name) => one?.dependency(name))).toEqual(['runtime', 'development', undefined]);
    const paths = ['src/index.ts', 'dist/index.js', 'src/parts/light.ts', 'src/parts/internal/secret.ts', 'src/gone.ts', 'package.json'];
    expect(paths.map((path) => client?.entry(`libs/client/${path}`))).toEqual([true, false, true, false, true, false]);
    const workspace = workspaceOf(tree, 'apps/web/src', ['bun']);
    expect(['@acme/client/blocks/a', '@acme/client/shared/any'].map((one) => workspace?.resolve(one))).toEqual([
      { to: 'libs/client/src/a/index-a.ts' },
      { to: 'libs/client/src/shared.ts' },
    ]);
    expect(['src/a/index-a.ts', 'src/a/index-b.ts', 'src/shared.ts'].map((path) => client?.entry(`libs/client/${path}`))).toEqual([
      true,
      false,
      true,
    ]);
    expect(workspaceOf(tree, 'apps/web/src', [])?.manifests()[1]?.entry('libs/client/dist/index.js')).toBe(true);
    expect(['tools/nested/cli/bin/run.ts', 'kits/one/index.ts'].map((path) => cli?.entry(path))).toEqual([true, false]);
  });

  it('reads the default condition when no condition given matches', () => {
    expect(workspaceOf(tree, 'apps/web/src', [])?.resolve('@acme/client')).toEqual({ to: 'libs/client/dist/index.js' });
  });

  it('keeps its door probes on a cache hit', () => {
    let probes = 0;
    const counting: Tree = {
      ...tree,
      has: (path) => {
        probes++;
        return tree.has(path);
      },
    };
    const workspace = workspaceOf(counting, 'apps/web/src', ['bun']);
    const first = workspace?.traced('@acme/client');
    expect(first?.resolution).toEqual({ to: 'libs/client/src/index.ts' });
    const held = probes;
    expect(workspace?.traced('@acme/client')).toEqual(first);
    expect(probes).toBe(held);
    expect(workspace?.traced('lodash')).toMatchObject({ resolution: null, absent: [], packages: ['lodash'] });
  });
});

describe('membersOf and membersDelta', () => {
  const mutable = (): Map<string, string> => new Map(Object.entries(texts));
  const deltaTree = (files: Map<string, string>, counters: { listed: number; reads: string[] }): Tree => ({
    has: (path) => files.has(path),
    read: (path) => {
      counters.reads.push(path);
      return files.get(path) ?? '';
    },
    paths: () => {
      counters.listed++;
      return files.keys();
    },
  });

  it('membersOf names the same members workspaceOf resolves', () => {
    const counters = { listed: 0, reads: [] as string[] };
    const files = mutable();
    const set = membersOf(deltaTree(files, counters), 'apps/web/src');
    expect(set.manifest).toBe('package.json');
    expect(new Map(set.members.filter(([, name]) => name !== null).map(([dir, name]) => [name, dir]))).toEqual(
      new Map([
        ['@acme/client', 'libs/client'],
        ['cli', 'tools/nested/cli'],
        ['one', 'kits/one'],
      ]),
    );
    const workspace = workspaceOf(tree, 'apps/web/src', ['bun']);
    const fromSet = workspaceFrom(set, tree, ['bun'], 'apps/web/src');
    for (const specifier of ['@acme/client', '@acme/client/parts/light', 'cli', 'cli/bin/run', 'one', 'lodash']) {
      expect(fromSet?.resolve(specifier)).toEqual(workspace?.resolve(specifier));
    }
  });

  it('a version-only manifest edit names no package and lists nothing', () => {
    const files = mutable();
    const counters = { listed: 0, reads: [] as string[] };
    const held = membersOf(deltaTree(files, counters), 'apps/web/src');
    files.set('tools/nested/cli/package.json', JSON.stringify({ name: 'cli', version: '2', main: 'main.ts' }));
    counters.listed = 0;
    counters.reads = [];
    const next = membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['tools/nested/cli/package.json']);
    expect(next.names).toEqual([]);
    expect(counters.listed).toBe(0);
    expect(next.set.members.find(([dir]) => dir === 'tools/nested/cli')?.[1]).toBe('cli');
  });

  it('an exports edit names its package, a rename names both, an add and a delete name theirs', () => {
    const files = mutable();
    const counters = { listed: 0, reads: [] as string[] };
    const held = membersOf(deltaTree(files, counters), 'apps/web/src');
    files.set(
      'libs/client/package.json',
      JSON.stringify({ name: '@acme/client', exports: { '.': './src/index.ts', './other': './src/other.ts' } }),
    );
    expect(membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['libs/client/package.json']).names).toEqual(['@acme/client']);
    files.set('tools/nested/cli/package.json', JSON.stringify({ name: 'cli2', main: 'main.ts' }));
    const renamed = membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['tools/nested/cli/package.json']);
    expect(renamed.names).toEqual(['cli', 'cli2']);
    files.set('libs/fresh/package.json', JSON.stringify({ name: '@acme/fresh' }));
    expect(membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['libs/fresh/package.json']).names).toEqual(['@acme/fresh']);
    files.delete('kits/one/package.json');
    expect(membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['kits/one/package.json']).names).toEqual(['one']);
  });

  it('a root pattern change rescans the matching manifests', () => {
    const files = mutable();
    const counters = { listed: 0, reads: [] as string[] };
    const held = membersOf(deltaTree(files, counters), 'apps/web/src');
    files.set(
      'package.json',
      JSON.stringify({ name: 'root', workspaces: { packages: ['libs/*', 'tools/**', '!tools/old', 'kits/one', 'extra/*'] } }),
    );
    files.set('extra/fresh/package.json', JSON.stringify({ name: 'fresh' }));
    const next = membersDelta(held, deltaTree(files, counters), 'apps/web/src', ['package.json']);
    expect(next.names).toEqual(['fresh']);
    expect(next.set.members.find(([dir]) => dir === 'extra/fresh')?.[1]).toBe('fresh');
  });

  it('a tree whose manifest texts have not arrived names every ancestor, then every member, in one pass each', () => {
    const arrived = new Set<string>();
    const rounds: string[][] = [];
    for (;;) {
      const missing: string[] = [];
      const waiting: Tree = {
        ...tree,
        read: (path) => {
          if (arrived.has(path)) return texts[path] ?? '';
          missing.push(path);
          return '';
        },
      };
      try {
        membersOf(waiting, 'apps/web/src');
        break;
      } catch {
        rounds.push(missing.sort());
        for (const path of missing) arrived.add(path);
      }
    }
    expect(rounds).toEqual([
      ['apps/web/package.json', 'package.json'],
      ['kits/one/package.json', 'libs/client/package.json', 'tools/nested/cli/package.json'],
    ]);
  });

  it('a nearer workspace stands although an outer manifest cannot be read', () => {
    const files = new Map([
      ['package.json', ''],
      ['apps/web/package.json', JSON.stringify({ name: 'web', workspaces: ['pkg/*'] })],
      ['apps/web/pkg/x/package.json', JSON.stringify({ name: 'x' })],
    ]);
    const nested: Tree = {
      has: (path) => files.has(path),
      read: (path) => {
        if (path === 'package.json') throw new Error('unreadable');
        return files.get(path) ?? '';
      },
      paths: () => files.keys(),
    };
    expect(membersOf(nested, 'apps/web/src').members.map(([dir, name]) => [dir, name])).toEqual([['apps/web/pkg/x', 'x']]);
  });

  it('workspaceFrom reads a member manifest only when its name is asked', () => {
    const files = mutable();
    const counters = { listed: 0, reads: [] as string[] };
    const held = membersOf(deltaTree(files, counters), 'apps/web/src');
    counters.reads = [];
    const workspace = workspaceFrom(held, deltaTree(files, counters), ['bun']);
    expect(counters.reads).toEqual([]);
    expect(workspace?.resolve('@acme/client')).toEqual({ to: 'libs/client/src/index.ts' });
    expect(counters.reads).toEqual(['libs/client/package.json']);
  });

  it('a duplicate name resolves to the first sorted dir, and delta promotes the next after rename or delete', () => {
    const files = mutable();
    const counters = { listed: 0, reads: [] as string[] };
    const leaf = deltaTree(files, counters);
    const held = membersOf(leaf, 'apps/web/src');
    files.set('libs/dup/package.json', JSON.stringify({ name: '@acme/dup', exports: { '.': './src/index.ts' } }));
    files.set('libs/dup/src/index.ts', '');
    files.set('libs/dup2/package.json', JSON.stringify({ name: '@acme/dup', exports: { '.': './src/index.ts' } }));
    files.set('libs/dup2/src/index.ts', '');
    const added = membersDelta(held, leaf, 'apps/web/src', ['libs/dup/package.json', 'libs/dup2/package.json']);
    expect(added.names).toEqual(['@acme/dup']);
    expect(added.set.members.filter(([, name]) => name === '@acme/dup').map(([dir]) => dir)).toEqual(['libs/dup', 'libs/dup2']);
    expect(workspaceFrom(added.set, leaf, [])?.resolve('@acme/dup')).toEqual({ to: 'libs/dup/src/index.ts' });
    files.set('libs/dup/package.json', JSON.stringify({ name: '@acme/moved', exports: { '.': './src/index.ts' } }));
    const renamed = membersDelta(added.set, leaf, 'apps/web/src', ['libs/dup/package.json']);
    expect(renamed.names).toEqual(['@acme/dup', '@acme/moved']);
    expect(workspaceFrom(renamed.set, leaf, [])?.resolve('@acme/dup')).toEqual({ to: 'libs/dup2/src/index.ts' });
    files.delete('libs/dup2/package.json');
    const deleted = membersDelta(renamed.set, leaf, 'apps/web/src', ['libs/dup2/package.json']);
    expect(deleted.names).toEqual(['@acme/dup']);
    expect(workspaceFrom(deleted.set, leaf, [])?.resolve('@acme/dup')).toEqual({ unlisted: '@acme/dup' });
  });
});
