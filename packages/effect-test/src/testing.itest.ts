import { expect, test } from 'bun:test';

const run = async (files: readonly string[], flags: readonly string[] = []) => {
  const child = Bun.spawn([process.execPath, 'test', ...files, '--parallel=1', ...flags], {
    cwd: import.meta.dir + '/..',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { status, stderr, record: JSON.parse(stdout.split('\n').find((line) => line.startsWith('{')) ?? '') };
};

test('Bun selection and expected-failure modes apply to both Effect testers', async () => {
  const all = await run(['./src/testing/modifiers.fixture.ts']);
  expect(all.status).toBe(0);
  expect(all.record).toEqual({ ran: ['effect', 'live', 'failed-effect', 'failed-live'] });
  const only = await run(['./src/testing/selectors.fixture.ts'], ['--only']);
  expect(only.status).toBe(0);
  expect(only.record).toEqual({ ran: ['effect', 'live'] });
});

test('a layer applies its own acquisition and release deadlines rather than the runner default', async () => {
  const answer = await run(['./src/testing/timeouts.fixture.ts']);
  expect(answer.status).toBe(1);
  expect(answer.record).toEqual({ buildRan: false, buildReleased: true, teardownRan: true, teardownReleased: false });
});

test('timeout cleanup follows the executing test when files share the module registry', async () => {
  const answer = await run(['./src/testing/sharedFirst.fixture.ts', './src/testing/sharedLast.fixture.ts'], ['--no-isolate']);
  expect(answer.status).toBe(1);
  expect(answer.record).toEqual({ released: ['effect', 'live'] });
});

test('failed effects fail Bun tests and release test and group resources, including on timeout', async () => {
  const { status, record, stderr } = await run(['./src/testing/failures.fixture.ts']);
  expect(status).toBe(1);
  expect(stderr).toContain('Refused');
  expect(stderr).toContain('closed');
  expect(stderr).toContain('broken resource');
  expect(stderr).toContain('body threw');
  expect(stderr).toContain('release failed');
  expect(stderr).toContain('build refused');
  expect(stderr).toMatch(/^(?:error: )?(?:Error: )?first group release$/m);
  expect(stderr).toMatch(/^(?:error: )?(?:Error: )?second group release$/m);
  expect(stderr.match(/\n (\d+) error/)?.[1] ?? '0').toBe('0');
  expect(record).toEqual({
    released: 3,
    shared: false,
    buildReleased: 2,
  });
});
