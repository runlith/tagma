import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join(import.meta.dir, 'main.ts');

const workspacePackage = async (root: string, name: string, source: string, dependencies: Record<string, string> = {}) => {
  const dir = join(root, name);
  await mkdir(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, scripts: { typecheck: 'runlith-typecheck' }, dependencies }));
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, types: [], incremental: false }, files: ['index.ts'] }),
  );
  await writeFile(join(dir, 'index.ts'), source);
  return dir;
};

const check = async (...args: string[]) => {
  const process = Bun.spawn(['bun', cli, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { output: stdout + stderr, exit };
};

test('--no-dependencies checks the scope and leaves its workspace dependencies unchecked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typecheck-scope-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, workspaces: ['consumer', 'dependency'] }));
    await workspacePackage(root, 'dependency', 'export const broken: number = "wrong";');
    const consumer = await workspacePackage(root, 'consumer', 'export const value: number = 1;', { dependency: 'workspace:*' });

    const closure = await check(consumer);
    expect(closure.exit).not.toBe(0);
    expect(closure.output).toContain('dependency/index.ts');

    expect((await check('--no-dependencies', consumer)).exit).toBe(0);

    await writeFile(join(consumer, 'index.ts'), 'export const value: number = "wrong";');
    const own = await check('--no-dependencies', consumer);
    expect(own.exit).not.toBe(0);
    expect(own.output).toContain('consumer/index.ts');
    expect(own.output).not.toContain('dependency/index.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
