import { expect, test } from 'bun:test';

test('Vitest reports effect and fixture failures and completes timeout finalizers', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      'run',
      '--bun',
      'vitest',
      'run',
      'src/testing/vitestFailures.fixture.ts',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--no-color',
    ],
    { cwd: import.meta.dir + '/..', stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(status).toBe(1);
  expect(stderr).toContain('Refused');
  expect(stderr).toContain('group release failed');
  expect(JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')) ?? '')).toEqual({ released: ['body', 'timeout', 'build'] });
});
