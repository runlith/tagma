import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import type { Assembled } from '../../builtins';
import { lists } from './implementations';
import { judge, movesOf } from './judge';
import { ready } from '../../builtins.node';

await ready('modules');

const ordered = (base: string, exclude: readonly string[] = []): Assembled => ({
  builtin: 'modules',
  params: {
    base,
    cycles: 'refuse',
    coverage: 'allow',
    unresolved: 'unjudged',
    reads: 'every',
    conditions: [],
    files: { extensions: ['.ts'], exclude },
    map: {
      modules: [{ id: 'app', territory: [`${base}/`], order: [[`${base}/core/`], [`${base}/ui/`]] }],
      relations: [],
      region: [`${base}/`],
    },
  },
});

const order = ordered('app/src', ['**/*.test.ts']);

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: () => Object.keys(texts),
});

const upward = "import { panel } from '../ui/panel';\n";
const panel = { 'app/src/ui/panel.ts': 'export const panel = 1;\n' };

describe('judge: a module order', () => {
  it('answers a new upward crossing with its file, line and specifier', () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/model.ts': 'export const model = 1;\n' }),
        built: tree({ ...panel, 'app/src/core/model.ts': `export const model = 1;\n${upward}` }),
        paths: ['app/src/core/model.ts'],
      },
      [],
    );
    expect(verdict).toMatchObject({
      violations: [{ fingerprint: 'app order core/model.ts -> ui/', file: 'app/src/core/model.ts', line: 2, specifier: '../ui/panel' }],
      unjudged: [],
    });
  });

  it('counts a new file crossing along a floor pair whose debt names another file, and not another import of the indebted file', () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/view.ts': upward }),
        built: tree({ ...panel, 'app/src/core/view.ts': `${upward}import '../ui/panel';\n`, 'app/src/core/model.ts': upward }),
        paths: ['app/src/core/view.ts', 'app/src/core/model.ts'],
      },
      ['app order core/view.ts -> ui/'],
    );
    expect(verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual(['app order core/model.ts -> ui/']);
  });

  it('counts a crossing its base file no longer holds as new though a debt entry still names it, and lets it stand where the base file is not read', () => {
    const change = {
      base: tree({ ...panel, 'app/src/core/view.ts': 'export const view = 1;\n' }),
      built: tree({ ...panel, 'app/src/core/view.ts': upward }),
    };
    const debt = ['app order core/view.ts -> ui/'];
    expect(judge(order, { ...change, paths: ['app/src/core/view.ts'] }, debt).violations.map(({ fingerprint }) => fingerprint)).toEqual([
      'app order core/view.ts -> ui/',
    ]);
    const added = { base: tree(panel), built: tree({ ...panel, 'app/src/core/view.ts': upward }) };
    expect(judge(order, { ...added, paths: ['app/src/core/view.ts'] }, debt).violations).toEqual([]);
  });

  it("does not count a file keeping its base's crossing", () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/view.ts': upward }),
        built: tree({ ...panel, 'app/src/core/view.ts': `export const view = 1;\n${upward}${upward}` }),
        paths: ['app/src/core/view.ts'],
      },
      [],
    );
    expect(verdict.violations).toEqual([]);
  });

  it('follows a file moved with its body to its new path, carrying the crossing it stood on', () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/view.ts': upward }),
        built: tree({ ...panel, 'app/src/core/screen.ts': upward }),
        paths: ['app/src/core/view.ts', 'app/src/core/screen.ts'],
      },
      [],
    );
    expect([verdict.violations, verdict.followed]).toEqual([
      [],
      [{ from: 'app order core/view.ts -> ui/', to: 'app order core/screen.ts -> ui/' }],
    ]);
  });

  it('follows a selected source through a mixed relocation and still reports a new crossing', () => {
    if (order.builtin !== 'modules') throw new Error('modules');
    const inspection: Assembled = {
      builtin: 'modules',
      params: {
        ...order.params,
        map: {
          ...order.params.map,
          modules: order.params.map.modules.map((one) => ({ ...one, territory: ['app/src/core/', 'app/src/ui/'] })),
        },
      },
    };
    const before = {
      ...panel,
      'app/src/core/view.ts': upward,
      'app/static/icon.png': 'binary',
      'app/workflows/edit.js': 'binary',
      'app/src/core/model.test.ts': 'binary',
      'other/script.ts': 'binary',
      'app/src/unowned/old.ts': 'binary',
    };
    const after = {
      ...panel,
      'app/src/core/screen.ts': upward,
      'app/src/core/model.ts': `export const model = 2;\n${upward}`,
      'web/static/icon.png': 'binary',
      'web/workflows/edit.js': 'binary',
      'app/src/core/renamed.test.ts': 'binary',
      'outside/script.ts': 'binary',
      'app/src/unowned/new.ts': 'binary',
    };
    const side = (texts: Record<string, string>): Tree => ({
      ...tree(texts),
      read: (path) => {
        if (texts[path] === 'binary') throw new Error(`${path} is not UTF-8 text`);
        return tree(texts).read(path);
      },
      object: (path) => (Object.hasOwn(texts, path) ? Bun.hash(texts[path]!).toString() : undefined),
    });
    const verdict = judge(
      inspection,
      { base: side(before), built: side(after), paths: [...new Set([...Object.keys(before), ...Object.keys(after)])] },
      [],
    );
    expect(verdict.violations).toMatchObject([
      { fingerprint: 'app order core/model.ts -> ui/', file: 'app/src/core/model.ts', line: 2, specifier: '../ui/panel' },
    ]);
    expect(verdict.followed).toEqual([{ from: 'app order core/view.ts -> ui/', to: 'app order core/screen.ts -> ui/' }]);
    expect(verdict.unjudged).toEqual([]);
  });

  it('keeps unchanged-body pairing against clean removed sources instead of borrowing another source’s violation', () => {
    const body = 'export const model = 1;\n';
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/a.ts': body, 'app/src/core/b.ts': `${upward}${body}` }),
        built: tree({ ...panel, 'app/src/core/c.ts': `${upward}${body}` }),
        paths: ['app/src/core/a.ts', 'app/src/core/b.ts', 'app/src/core/c.ts'],
      },
      [],
    );
    expect(verdict.violations).toMatchObject([
      { fingerprint: 'app order core/c.ts -> ui/', file: 'app/src/core/c.ts', line: 1, specifier: '../ui/panel' },
    ]);
  });

  it('does not count a file whose import target was renamed in the same change', () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/view.ts': upward }),
        built: tree({
          'app/src/ui/pane.ts': 'export const panel = 1;\n',
          'app/src/core/view.ts': "import { panel } from '../ui/pane';\n",
        }),
        paths: ['app/src/core/view.ts', 'app/src/ui/panel.ts', 'app/src/ui/pane.ts'],
      },
      [],
    );
    expect(verdict.violations).toEqual([]);
  });

  it('reads no changed file outside the selected extensions or inside an excluded pattern', () => {
    const verdict = judge(
      order,
      {
        base: tree(panel),
        built: tree({
          ...panel,
          'app/src/core/catalog.json': '{ "floors": 2 }\n',
          'app/src/core/model.test.ts': upward,
        }),
        paths: ['app/src/core/catalog.json', 'app/src/core/model.test.ts'],
      },
      [],
    );
    expect(verdict).toEqual({ violations: [], unjudged: [] });
  });

  it('neither counts nor leaves unjudged an import that leaves the base', () => {
    const verdict = judge(
      order,
      {
        base: tree({ 'app/lib/ui/panel.ts': '' }),
        built: tree({
          'app/lib/ui/panel.ts': '',
          'app/src/core/model.ts': "import { panel } from '../../lib/ui/panel';\nimport { gone } from '../../gone';\n",
        }),
        paths: ['app/src/core/model.ts'],
      },
      [],
    );
    expect(verdict).toEqual({ violations: [], unjudged: [] });
  });

  it('does not name again as unjudged a specifier the base side already left unresolved', () => {
    const gone = "import { gone } from '../ui/gone';\n";
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/model.ts': gone }),
        built: tree({ ...panel, 'app/src/core/model.ts': `export const a = 1;\n${gone}` }),
        paths: ['app/src/core/model.ts'],
      },
      [],
    );
    expect(verdict.unjudged).toEqual([]);
  });

  it('judges a change that repairs a file its base cannot parse on the built side alone', () => {
    const verdict = judge(
      order,
      {
        base: tree({ ...panel, 'app/src/core/model.ts': `${upward}const = ;\n` }),
        built: tree({ ...panel, 'app/src/core/model.ts': upward }),
        paths: ['app/src/core/model.ts'],
      },
      [],
    );
    expect(verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual(['app order core/model.ts -> ui/']);
    expect(() =>
      judge(
        order,
        { base: tree(panel), built: tree({ ...panel, 'app/src/core/model.ts': 'const = ;\n' }), paths: ['app/src/core/model.ts'] },
        [],
      ),
    ).toThrow('app/src/core/model.ts');
  });

  it('names a relative specifier that resolves to no path as unjudged', () => {
    const verdict = judge(
      order,
      {
        base: tree(panel),
        built: tree({ ...panel, 'app/src/core/model.ts': "import { gone } from '../ui/gone';\n" }),
        paths: ['app/src/core/model.ts'],
      },
      [],
    );
    expect(verdict).toEqual({
      violations: [],
      unjudged: [{ file: 'app/src/core/model.ts', line: 1, specifier: '../ui/gone' }],
    });
  });

  it('judges a workspace package import by the file its exports name over the part of the tree it lists, names a door under the base the package does not export as unjudged, and leaves a package outside the base alone', () => {
    const packages = ordered('libs');
    const workspace = {
      'package.json': JSON.stringify({ workspaces: ['libs/*', 'apps/*'] }),
      'libs/core/package.json': JSON.stringify({
        name: '@acme/core',
        dependencies: { '@acme/ui': 'workspace:*', '@acme/web': 'workspace:*', lodash: '*' },
      }),
      'libs/ui/package.json': JSON.stringify({ name: '@acme/ui', exports: { './panel': './panel.ts' } }),
      'libs/ui/panel.ts': 'export const panel = 1;\n',
      'apps/web/package.json': JSON.stringify({ name: '@acme/web', exports: { '.': './main.ts' } }),
      'apps/web/main.ts': 'export const web = 1;\n',
    };
    const model = [
      "import { panel } from '@acme/ui/panel';",
      "import { gone } from '@acme/ui/gone';",
      "import { web } from '@acme/web';",
      "import { lost } from '@acme/web/lost';",
      "import { later } from 'lodash';",
      '',
    ].join('\n');
    const parts = lists(packages);
    const listed = (texts: Record<string, string>, only: boolean): Tree => {
      const kept = Object.fromEntries(
        Object.entries(texts).filter(
          ([path]) => !only || parts.some((part) => part === '' || path === part || path.startsWith(`${part}/`)),
        ),
      );
      return { ...tree(kept), paths: () => Object.keys(kept) };
    };
    const verdictOver = (only: boolean) =>
      judge(
        packages,
        {
          base: listed(workspace, only),
          built: listed({ ...workspace, 'libs/core/model.ts': model }, only),
          paths: ['libs/core/model.ts'],
        },
        [],
      );
    expect(parts).toEqual(['']);
    const inKit = ordered('libs/ui');
    const own = "import { gone } from '@acme/ui/gone';\n";
    expect(
      judge(
        inKit,
        {
          base: listed(workspace, false),
          built: listed({ ...workspace, 'libs/ui/core/own.ts': own }, false),
          paths: ['libs/ui/core/own.ts'],
        },
        [],
      ).unjudged,
    ).toEqual([{ file: 'libs/ui/core/own.ts', line: 1, specifier: '@acme/ui/gone' }]);
    expect([verdictOver(true), verdictOver(false)]).toMatchObject([
      {
        violations: [{ fingerprint: 'app order core/model.ts -> ui/', file: 'libs/core/model.ts', line: 1, specifier: '@acme/ui/panel' }],
        unjudged: [{ file: 'libs/core/model.ts', line: 2, specifier: '@acme/ui/gone' }],
      },
      {
        violations: [{ fingerprint: 'app order core/model.ts -> ui/', file: 'libs/core/model.ts', line: 1, specifier: '@acme/ui/panel' }],
        unjudged: [{ file: 'libs/core/model.ts', line: 2, specifier: '@acme/ui/gone' }],
      },
    ]);
  });
});

describe('movesOf', () => {
  it('pairs a moved file no parser reads by its blob, never reading it as text', () => {
    const binary = (path: string): Tree => ({
      has: (one) => one === path,
      read: () => {
        throw new Error(`${path} is not UTF-8 text`);
      },
      paths: () => [path],
      object: () => 'b1',
    });
    expect(movesOf({ base: binary('app/icon.png'), built: binary('web/icon.png'), paths: ['app/icon.png', 'web/icon.png'] })).toEqual([
      { from: 'app/icon.png', to: 'web/icon.png' },
    ]);
  });
});
