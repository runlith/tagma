import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Schema } from 'effect';
import { ProgramAnswer, type ProgramInvocation, type ProgramSide } from '@tagma/inspection/program';

const RUNNER = join(import.meta.dir, '../../../apps/tagma/server/src/enforcement/programs/runner.ts');
const PROGRAM = join(import.meta.dir, '../programs.ts');
const RELOCATED = /:(?:modules|share)-(?:increase|ceiling)$/;

test('a module card move leaves every standing coupling finding reported on its covered path, as a complete reading of the same state does', () => {
  const root = mkdtempSync(join(tmpdir(), 'architecture-coupling-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const card = (id: string, ...sources: readonly (readonly [kind: 'dir' | 'file', ref: string])[]) =>
    `---\ntags: ["module"]\nfields: {"id": "${id}"}\nsources:\n${sources.map(([kind, ref]) => `  - kind: ${kind}\n    ref: ${ref}\n`).join('')}---\n`;
  const baseline = ['a', 'b', 'c', 'd'].map((id) => ({ id, path: `packages/${id}/src/${id}1.ts`, modules: 0, outside: 0, total: 0 }));
  const key = { key: 'coupling', id: 'coupling', params: { baseline, aliases: [] }, reach: { places: [''], files: ['**/*.ts'] } };
  const listing = (revision: string) => git('ls-tree', '-r', '--name-only', revision).split('\n');
  const textOf = (revision: string, path: string) => {
    const shown = spawnSync('git', ['show', `${revision}:${path}`], { cwd: root });
    return shown.status === 0 ? shown.stdout.toString() : null;
  };
  const ask = (
    tree: string,
    base: string | null,
    asked: { readonly tree: readonly string[] | null; readonly base: readonly string[] | null },
  ) => {
    const side = (name: ProgramSide['side'], revision: string, paths: readonly string[] | null): ProgramSide => ({
      side: name,
      paths,
      files:
        paths === null
          ? null
          : paths.flatMap((path) => {
              const text = textOf(revision, path);
              return text === null ? [] : [{ path, text }];
            }),
    });
    const invocation: ProgramInvocation = {
      request: 'architecture',
      checker: PROGRAM,
      root,
      tree,
      base,
      keys: [key],
      sides: base === null ? [side('tree', tree, asked.tree)] : [side('tree', tree, asked.tree), side('base', base, asked.base)],
    };
    const ran = spawnSync(process.execPath, ['--no-install', RUNNER, PROGRAM], { cwd: root, input: JSON.stringify(invocation) });
    if (ran.status !== 0) throw new Error(ran.stderr.toString() || `inspection runner exited ${ran.status}`);
    const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(ran.stdout.toString()));
    expect(answer.failure).toBeUndefined();
    return (name: string) => answer.readings.find((one) => one.side === name)!;
  };
  const compare = (tree: string, base: string, changed: readonly string[]) => {
    const small = ask(tree, base, { tree: changed, base: changed });
    const smallTree = small('tree');
    const smallBase = small('base');
    const complete = ask(tree, base, { tree: listing(tree), base: listing(base) });
    for (const [name, reading] of [
      ['tree', smallTree],
      ['base', smallBase],
    ] as const) {
      const full = complete(name);
      const covered = reading.covered;
      if (!Array.isArray(covered)) throw new Error('a commit judgment answers explicit covered paths');
      const standing = new Map(reading.findings.map((one) => [one.fingerprint, one]));
      const whole = new Map(full.findings.map((one) => [one.fingerprint, one]));
      for (const [print, one] of standing) expect(whole.get(print)?.value).toBe(one.value);
      const modules = new Set<string>();
      for (const one of full.findings)
        if (!RELOCATED.test(one.fingerprint) && covered.includes(one.path)) {
          expect(standing.get(one.fingerprint)?.path).toBe(one.path);
          modules.add(one.fingerprint.split(':')[1]!);
        }
      for (const one of full.findings)
        if (modules.has(one.fingerprint.split(':')[1]!)) expect(standing.get(one.fingerprint)?.value).toBe(one.value);
    }
    return { tree: smallTree, base: smallBase, complete };
  };
  try {
    git('init', '-q');
    put('.tagma/a.md', card('a', ['dir', 'packages/a']));
    put('.tagma/b.md', card('b', ['dir', 'packages/b']));
    put('.tagma/c.md', card('c', ['dir', 'packages/c']));
    put('.tagma/d.md', card('d', ['dir', 'packages/d']));
    put('packages/a/src/a1.ts', "import { c } from '../../c/src/c1'; export const a1 = c;");
    put('packages/a/src/zmove.ts', "import { b } from '../../b/src/b1'; export const moved = b;");
    put('packages/b/src/b1.ts', "import { c } from '../../c/src/c1'; export const b = c;");
    put('packages/c/src/c1.ts', 'export const c = 1;');
    put('packages/d/src/d1.ts', "import { c } from '../../c/src/c1'; export const d = c;");
    git('add', '.');
    const first = git('write-tree');
    ask(first, null, { tree: null, base: null });

    put('.tagma/b.md', card('b', ['dir', 'packages/b'], ['file', 'packages/a/src/zmove.ts']));
    git('add', '.');
    const moved = git('write-tree');
    const step = compare(moved, first, ['.tagma/b.md']);
    expect(step.tree.findings.some((one) => one.fingerprint.startsWith('coupling:a:'))).toBe(true);

    put('packages/a/src/zmove.ts', "import { b } from '../../b/src/b1'; import { d } from '../../d/src/d1'; export const moved = [b, d];");
    git('add', '.');
    const edited = git('write-tree');
    const next = compare(edited, moved, ['packages/a/src/zmove.ts']);
    for (const reading of [next.tree, next.base]) {
      const standing = reading.findings.filter((one) => one.fingerprint.startsWith('coupling:a:') && !RELOCATED.test(one.fingerprint));
      expect(standing.map((one) => one.path)).toContain('packages/a/src/zmove.ts');
    }
    const unrelated = (list: readonly { readonly fingerprint: string }[]) =>
      list
        .filter((one) => one.fingerprint.startsWith('coupling:d:'))
        .map((one) => one.fingerprint)
        .sort();
    expect(unrelated(next.complete('base').findings).length).toBeGreaterThan(0);
    expect(unrelated(next.complete('tree').findings)).toEqual(unrelated(next.complete('base').findings));
    expect(unrelated(next.tree.findings)).toEqual(unrelated(next.base.findings));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
