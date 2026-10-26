import { afterAll, beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macUserShell } from './shell.js';

let root: string;
let bin: string;
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'login-path-')));
  bin = join(root, 'homebrew', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const command of ['claude', 'git']) writeFileSync(join(bin, command), `#!/bin/sh\nprintf '${command} ready'\n`, { mode: 0o755 });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SYSTEM = '/usr/bin:/bin:/usr/sbin:/sbin';
const ask = (shell: string | null, home = root, deadlineMs = 5_000) => macUserShell.read({ shell, launchPath: SYSTEM, home, deadlineMs });

test('the interactive login profile names the user directories despite startup output', async () => {
  writeFileSync(
    join(root, '.zprofile'),
    `printf 'PATH=/incorrect\\000profile output\\n'\nexport PATH='${bin}:/usr/bin:/bin:/usr/sbin:/sbin'\n`,
  );
  const answer = await ask('/bin/zsh');
  expect(answer.outcome).toBe('read');
  for (const command of ['claude', 'git']) {
    expect(execFileSync(command, [], { env: { PATH: answer.entries.join(':') }, encoding: 'utf8' })).toBe(`${command} ready`);
  }
});

test('a failed profile reports its condition and does not retain startup output', async () => {
  const failed = join(root, 'failed-shell');
  writeFileSync(failed, '#!/bin/sh\nprintf "secret startup output" >&2\nexit 12\n', { mode: 0o755 });
  expect(await ask(failed)).toEqual({ outcome: 'exit', entries: [], detail: `${failed}: exit 12` });
});

test('an unexpanded or relative entry is dropped alone, and a home-relative entry is expanded', async () => {
  const shell = join(root, 'mixed-shell');
  writeFileSync(shell, `#!/bin/sh\nprintf '\\000PATH=$literal:${bin}:~/.dotnet/tools:relative:/usr/bin\\000'\n`, { mode: 0o755 });
  expect(await ask(shell)).toEqual({ outcome: 'read', entries: [bin, join(root, '.dotnet/tools'), '/usr/bin'], detail: null });
});

test('a profile that does not answer in its deadline is a timeout and ends its rc-spawned child too', async () => {
  const home = join(root, 'slow');
  mkdirSync(home);
  const pidFile = join(home, 'child');
  writeFileSync(join(home, '.zshrc'), `/bin/sleep 30 >/dev/null 2>&1 &\nprintf '%s' $! > '${pidFile}'\nwait\n`);
  const answer = await ask('/bin/zsh', home, 2_000);
  expect(answer.outcome).toBe('timeout');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
});

test('the nvm default alias leads the version-manager directories, and every installed version is a runtime newest first', () => {
  const home = join(root, 'nvm-home');
  for (const version of ['v24.11.1', 'v26.8.1']) mkdirSync(join(home, '.nvm/versions/node', version, 'bin'), { recursive: true });
  mkdirSync(join(home, '.nvm/alias'), { recursive: true });
  writeFileSync(join(home, '.nvm/alias/default'), '24\n');
  expect(macUserShell.managers(home)[0]).toBe(join(home, '.nvm/versions/node/v24.11.1/bin'));
  expect(macUserShell.runtimes(home)).toEqual([
    join(home, '.nvm/versions/node/v26.8.1/bin'),
    join(home, '.nvm/versions/node/v24.11.1/bin'),
  ]);
});
