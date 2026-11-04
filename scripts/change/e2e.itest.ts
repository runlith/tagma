import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileRow, Row } from '@runlith/testbed/ledger';

test('the e2e lane shards its files once without joining ordinary or iOS suites', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2e-suites-'));
  try {
    expect(Bun.spawnSync(['git', 'init', '-q', root]).exitCode).toBe(0);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'bun test ./unit.test.ts',
          'test:e2e': 'testbed e2e --no-isolate ./a.e2e.ts ./b.e2e.ts ./c.e2e.ts',
          'test:e2e:ios': 'testbed e2e ./native.e2e.ts',
        },
      }),
    );
    for (const name of ['a', 'b', 'c'])
      writeFileSync(
        join(root, `${name}.e2e.ts`),
        `import { expect, test } from 'bun:test'; test('${name}', () => { console.log('file:${name}'); expect(2 + 2).toBe(4); });`,
      );
    const invoke = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'all.ts'), '--root', root, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code, stdout + stderr).toBe(0);
      return stdout;
    };
    const ordinary = JSON.parse(await invoke('--plan'));
    expect(ordinary.map((suite: { script: string }) => suite.script)).toEqual(['test']);
    const files: string[] = [];
    for (const shard of ['1/2', '2/2']) {
      const report = join(root, `${shard.replace('/', '-of-')}.json`);
      const output = await invoke('--script', 'test:e2e', '--shard', shard, '--report', report, '--stream');
      const reading = JSON.parse(readFileSync(report, 'utf8'));
      expect(reading.suites.map((suite: { script: string }) => suite.script)).toEqual(['test:e2e']);
      const rows = readFileSync(join(`${report}.d`, '.%3Atest%3Ae2e.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row);
      const ran = rows.filter((row): row is FileRow => row.type === 'file').map((row) => row.file.split('/').pop()!);
      files.push(...ran);
      for (const file of ran) expect(output).toContain(`file:${file.replace('.e2e.ts', '')}`);
      expect(existsSync(join(root, `.bun-test-timings.${shard.replace('/', '-of-')}.json`))).toBe(true);
    }
    expect(files.sort()).toEqual(['a.e2e.ts', 'b.e2e.ts', 'c.e2e.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
