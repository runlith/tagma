import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a desktop page nobody shows, holds or drives rests as a hidden page, and a paint hold or an engine session wakes it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-rest-'));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL('./testing/resting.ts', import.meta.url))],
      target: 'node',
      format: 'esm',
      external: ['electron'],
    });
    expect(built.success, built.logs.join('\n')).toBe(true);
    const bundle = join(home, 'resting.mjs');
    await Bun.write(bundle, built.outputs[0]!);
    const data = join(home, 'data');
    await mkdir(data);
    const env: NodeJS.ProcessEnv = { ...process.env, BROWSER_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    const started = Bun.spawn([createRequire(import.meta.url)('electron') as string, bundle], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    child = started;
    const [code, stdout, stderr] = await Promise.all([
      started.exited,
      new Response(started.stdout).text(),
      new Response(started.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({
      unseen: 'hidden',
      held: 'visible',
      released: 'hidden',
      restarted: 'hidden',
      driven: 'visible',
      undriven: 'hidden',
    });
  } finally {
    if (child !== undefined && child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    await rm(home, { recursive: true, force: true });
  }
});
