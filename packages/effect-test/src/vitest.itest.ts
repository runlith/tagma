import { expect, test } from 'bun:test';

const vitest = async (files: readonly string[]) => {
  const child = Bun.spawn(
    [process.execPath, 'run', '--bun', 'vitest', 'run', ...files, '--maxWorkers=1', '--no-file-parallelism', '--no-color'],
    { cwd: import.meta.dir + '/..', stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { status, stdout, stderr };
};

test('Vitest runs the Effect testers with owned resources, controlled time and an isolated DOM per file', async () => {
  const { status, stdout, stderr } = await vitest(['--exclude', '**/vitestFailures.fixture.ts']);
  if (status !== 0) throw new Error(`Vitest fixtures exited ${status}:\n${stdout}\n${stderr}`);
});

test('Vitest reports effect and fixture failures and completes timeout finalizers', async () => {
  const { status, stdout, stderr } = await vitest(['src/testing/vitestFailures.fixture.ts']);
  expect(status).toBe(1);
  expect(stderr).toContain('Refused');
  expect(stderr).toContain('group release failed');
  expect(JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')) ?? '')).toEqual({ released: ['body', 'timeout', 'build'] });
});
