import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapter } from './create.js';

test('a generated adapter passes the author contract through the public SDK doors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tagma-adapter-'));
  try {
    const author = join(root, 'example');
    await createAdapter(author);
    await mkdir(join(author, 'node_modules/@runlith'), { recursive: true });
    await symlink(join(import.meta.dir, '..'), join(author, 'node_modules/@runlith/tagma'));
    const child = Bun.spawn([process.execPath, '--no-install', 'contract.mjs'], { cwd: author, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`generated adapter contract exited ${code}:\n${stdout}\n${stderr}`);
    expect(JSON.parse(stdout.trim())).toEqual({
      provider: 'example',
      model: 'example-1',
      text: 'hello',
      failure: 'LLM.Error',
      image: 'image/png',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
