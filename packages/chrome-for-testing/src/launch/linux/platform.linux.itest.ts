import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePlatform } from './platform.js';

test('Linux launch refuses a missing display and an unusable explicitly configured helper', async () => {
  const absent = await makePlatform({}).prepare(true);
  expect(absent._tag === 'LaunchRefused' ? absent.problem : null).toBe('display-unavailable');
  const home = await mkdtemp(join(tmpdir(), 'browser-sandbox-'));
  try {
    const helper = join(home, 'helper');
    await writeFile(helper, '', { mode: 0o700 });
    const invalid = await makePlatform({ CHROME_DEVEL_SANDBOX: helper }).prepare(false);
    expect(invalid._tag === 'LaunchRefused' ? invalid.problem : null).toBe('sandbox-unavailable');
    const missing = await makePlatform({ CHROME_DEVEL_SANDBOX: join(home, 'missing') }).prepare(false);
    expect(missing._tag === 'LaunchRefused' ? missing.problem : null).toBe('sandbox-unavailable');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Linux native startup failures retain their capability condition', () => {
  const platform = makePlatform({});
  expect(platform.failed('FATAL: No usable sandbox!').problem).toBe('sandbox-unavailable');
  expect(platform.failed('FATAL: The SUID sandbox helper binary was found, but is not configured correctly.').problem).toBe(
    'sandbox-unavailable',
  );
  expect(platform.failed('Missing X server or $DISPLAY').problem).toBe('display-unavailable');
  expect(platform.failed('chrome: error while loading shared libraries: libnss3.so: cannot open shared object file').problem).toBe(
    'libraries-unavailable',
  );
});
