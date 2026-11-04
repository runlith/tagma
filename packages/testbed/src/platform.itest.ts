import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'cli.ts');

test('platform files are selected before importing them in discovered and explicit Bun runs', async () => {
  const root = join(process.env['TMPDIR']!, `platform-${crypto.randomUUID()}`);
  mkdirSync(root);
  const other = process.platform === 'linux' ? 'darwin' : 'linux';
  const shared = `import { test } from 'bun:test'; test('runs', () => console.log('selected:shared'));`;
  const native = `import { test } from 'bun:test'; test('runs', () => console.log('selected:native'));`;
  writeFileSync(join(root, 'shared.test.ts'), shared);
  writeFileSync(join(root, 'shared.spec.ts'), shared);
  writeFileSync(join(root, 'shared.itest.ts'), shared);
  writeFileSync(join(root, `native.${process.platform}.test.ts`), native);
  writeFileSync(join(root, `native.${process.platform}.itest.ts`), native);
  writeFileSync(join(root, `foreign.${other}.test.ts`), 'throw new Error("a foreign platform file was imported");');
  writeFileSync(join(root, `foreign.${other}.spec.ts`), 'throw new Error("a foreign platform file was imported");');
  writeFileSync(join(root, `foreign.${other}.itest.ts`), 'throw new Error("a foreign platform file was imported");');
  const run = async (args: readonly string[]) => {
    const child = Bun.spawn([process.execPath, CLI, ...args], { cwd: root, env: process.env, stdout: 'pipe', stderr: 'pipe' });
    const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, out + error).toBe(0);
    return out
      .split('\n')
      .filter((line) => line.startsWith('selected:'))
      .map((line) => line.slice('selected:'.length))
      .sort();
  };
  expect(await run(['bun', 'test', '--no-isolate'])).toEqual(['native', 'shared', 'shared']);
  expect(await run(['itest', '--no-isolate'])).toEqual(['native', 'shared']);
  expect(await run(['bun', 'test', 'shared.test'])).toEqual(['shared']);
  expect(await run(['bun', 'test', './shared.itest.ts', `./foreign.${other}.itest.ts`])).toEqual(['shared']);
  expect(await run(['itest', `./foreign.${other}.itest.ts`])).toEqual([]);
});
