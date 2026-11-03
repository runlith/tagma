import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join(import.meta.dir, 'main.ts');

test('a svelte checker that reports an error and ends before COMPLETED fails as unreadable, not as found type errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typecheck-unfinished-'));
  try {
    const app = join(root, 'app');
    await mkdir(join(app, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, workspaces: ['app'] }));
    await writeFile(
      join(app, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { typecheck: 'runlith-typecheck' }, devDependencies: { 'svelte-check': '*' } }),
    );
    await writeFile(join(app, 'tsconfig.json'), '{}');
    await writeFile(join(app, 'index.ts'), 'export {};');
    const diagnostic = { type: 'ERROR', filename: 'App.svelte', start: { line: 0, character: 0 }, message: 'a found error', code: 2322 };
    await writeFile(
      join(app, 'node_modules', '.bin', 'svelte-check'),
      [
        `console.log(${JSON.stringify(`1 START "${app}"`)});`,
        `console.log(${JSON.stringify(`2 ${JSON.stringify(diagnostic)}`)});`,
        'process.exit(1);',
      ].join('\n'),
    );

    const process = Bun.spawn(['bun', cli, app], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exit).not.toBe(0);
    expect(stdout + stderr).toContain('OutputUnreadable');
    expect(stdout + stderr).not.toContain('ChecksFailed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
