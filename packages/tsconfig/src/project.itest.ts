import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const pkg = resolve(import.meta.dir, '..');
const cli = join(import.meta.dir, 'main.ts');

test('the CLI checks only the requested workspace project and refuses an outside project', async () => {
  const dir = await mkdtemp(join(pkg, '.project-test-'));
  try {
    const config = join(dir, 'tsconfig.json');
    const source = join(dir, 'selected.ts');
    await writeFile(config, JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, types: [], incremental: false }, files: ['selected.ts'] }));
    await writeFile(source, 'export const value: number = 1;');
    await writeFile(join(dir, 'excluded.ts'), 'export const value: number = "wrong";');
    const check = async (path: string) => {
      const process = Bun.spawn(['bun', cli, '--project', path], { cwd: pkg, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
      return { output: stdout + stderr, exit };
    };
    expect((await check(config)).exit).toBe(0);
    await writeFile(source, 'export const value: number = "wrong";');
    const failed = await check(config);
    expect(failed.exit).not.toBe(0);
    expect(failed.output).toContain('selected.ts');
    expect(failed.output).toContain('TS2322');
    expect((await check('/etc/hosts')).exit).not.toBe(0);

    const sveltePackage = resolve(pkg, '../chat-ui');
    const svelteDir = await mkdtemp(join(sveltePackage, '.project-test-'));
    try {
      const svelteConfig = join(svelteDir, 'tsconfig.json');
      await writeFile(svelteConfig, JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { composite: false, incremental: false }, include: ['./*.svelte'], exclude: ['./excluded.svelte'] }));
      await writeFile(join(svelteDir, 'excluded.svelte'), '<script lang="ts">const value: number = "wrong";</script>{value}');
      const selected = join(svelteDir, 'selected.svelte');
      await writeFile(selected, '<script lang="ts">const value: number = 1;</script>{value}');
      expect((await check(svelteConfig)).exit).toBe(0);
      await writeFile(selected, '<script lang="ts">const value: number = "wrong";</script>{value}');
      const result = await check(svelteConfig);
      expect(result.exit).not.toBe(0);
      expect(result.output).toContain('selected.svelte');
      expect(result.output).toContain('TS2322');
    } finally {
      await rm(svelteDir, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
