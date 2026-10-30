import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { Schema } from 'effect';
import { ProgramAnswer, type ProgramInvocation } from '@tagma/inspection/program';

const RUNNER = join(import.meta.dir, '../../apps/tagma/server/src/enforcement/programs/runner.ts');

test('alternating checker versions retain both prepared declaration indexes for subsequent gated changes', () => {
  const outer = mkdtempSync(join(tmpdir(), 'law-reader-versions-'));
  const root = join(outer, 'project');
  mkdirSync(join(root, 'src'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const readers = ['first', 'second'].map((name) => {
    const target = join(outer, name);
    cpSync(import.meta.dir, target, {
      recursive: true,
      filter: (path) => {
        const name = relative(import.meta.dir, path);
        if (name === '' || name === 'declarations' || name === 'architecture') return true;
        if (/\.(?:test|itest|bench)\.|^\.bun-test/.test(basename(path))) return false;
        return (
          name.startsWith('declarations/') ||
          [
            'store.ts',
            'git.ts',
            'maps.ts',
            'directories.ts',
            'trees.ts',
            'architecture/snapshot.ts',
            'architecture/boundaries.ts',
          ].includes(name)
        );
      },
    });
    symlinkSync(resolve(import.meta.dir, 'node_modules'), join(target, 'node_modules'));
    return target;
  });
  appendFileSync(join(readers[1]!, 'declarations/read.ts'), '\n');
  const ask = (reader: string, tree: string, base: string | null) => {
    const whole = base === null;
    const side = (name: 'tree' | 'base') => ({ side: name, paths: whole ? null : ['src/value.ts'], files: null });
    const input: ProgramInvocation = {
      request: 'reader-versions',
      checker: join(reader, 'declarations/program.ts'),
      root,
      tree,
      base,
      keys: [
        {
          key: 'dead',
          id: 'dead-code',
          params: { region: ['src/'], tests: [], entries: [], kinds: ['const'], published: [], aliases: [] },
          reach: { places: ['src'], files: ['**/*.ts'] },
        },
      ],
      sides: base === null ? [side('tree')] : [side('tree'), side('base')],
    };
    const run = spawnSync(process.execPath, ['--no-install', RUNNER, input.checker], { cwd: root, input: JSON.stringify(input) });
    if (run.status !== 0) throw new Error(run.stderr.toString());
    const answer = Schema.decodeUnknownSync(ProgramAnswer)(JSON.parse(run.stdout.toString()));
    expect(answer.failure).toBeUndefined();
    return answer.readings;
  };
  try {
    git('init', '-q');
    writeFileSync(join(root, 'src/value.ts'), 'export const before = 1;\n');
    mkdirSync(join(root, 'checks/law'), { recursive: true });
    writeFileSync(join(root, 'checks/law/store.ts'), readFileSync(join(import.meta.dir, 'store.ts')));
    git('add', 'src', 'checks');
    const base = git('write-tree');
    ask(readers[0]!, base, null);
    ask(readers[1]!, base, null);
    writeFileSync(join(root, 'src/value.ts'), 'export const after = 2;\n');
    appendFileSync(join(root, 'checks/law/store.ts'), '\n');
    git('add', 'src', 'checks');
    const tree = git('write-tree');
    for (const reader of readers) {
      const readings = ask(reader, tree, base);
      expect(readings.find((one) => one.side === 'base')?.findings.map((one) => one.fingerprint)).toEqual(['dead src/value.ts#before']);
      expect(readings.find((one) => one.side === 'tree')?.findings.map((one) => one.fingerprint)).toEqual(['dead src/value.ts#after']);
    }
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});
