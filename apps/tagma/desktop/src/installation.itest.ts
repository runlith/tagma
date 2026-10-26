import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { activeElsewhere } from './installation.js';
import { startServer } from './server.js';
import { ACTIVE_FILE, holderName, junctionDirectory } from '@tagma/server/installation/contract/wire/junction';
import { CHANNEL } from '@tagma/server/composition/channel';

const base = join('/tmp', `tagma-desktop-installation-${process.pid}`);
const root = join(base, 'install', '0.1.0');
const home = join(base, 'home');
const log = join(home, CHANNEL.data, 'serve.log');
const env = { HOME: home } as NodeJS.ProcessEnv;

function stood(at: string, relative: string, text: string, mode = 0o644): void {
  const path = join(at, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode });
}

const RECORDING_RUNTIME = '#!/bin/sh\necho "argv: $*"\necho "pgid: $(ps -o pgid= -p $$ | tr -d \' \')"\n';

beforeEach(() => {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  stood(root, 'bun', RECORDING_RUNTIME, 0o755);
  stood(root, 'bin/cli/main.js', 'console.log("the cli");\n');
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test('the switch screen names the channel running elsewhere with its agents and terminals, and a channel that died names none', async () => {
  const holder = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/api/op/read_machine_state'
        ? Response.json({ status: 'read', machine: { server: { agents: 2 }, host: { holds: { terminals: 3 } } } })
        : new Response('', { status: 404 }),
  });
  try {
    const other = CHANNEL.id === 'dev' ? 'stable' : 'dev';
    const url = `http://127.0.0.1:${holder.port}`;
    const junction = junctionDirectory(env)!;
    const record = (pid: number) => stood(junction, ACTIVE_FILE, `${JSON.stringify({ channel: other, cli: '/nowhere', url, pid })}\n`);

    record(process.pid);
    expect(await activeElsewhere(env)).toEqual({
      name: holderName({ channel: other, cli: '/nowhere', url, pid: process.pid }),
      pid: process.pid,
      url,
      agents: 2,
      terminals: 3,
    });

    record(2 ** 22 + 1);
    expect(await activeElsewhere(env)).toBeNull();
  } finally {
    await holder.stop(true);
  }
});

test('the spawned server is the closure own CLI on the serve verb, in its own process group, appended to the log', async () => {
  const closure = { root, runtime: join(root, 'bun'), entry: join(root, 'bin/cli/main.js') };

  stood(home, join(CHANNEL.data, 'serve.log'), 'earlier\n');
  const started = await startServer(closure, log, env);
  await started.exited;
  const written = readFileSync(log, 'utf8').split('\n').filter(Boolean);

  expect(written[0]).toBe('earlier');
  expect(written.filter((line) => line === `argv: --no-install ${closure.entry} serve`)).toHaveLength(1);
  const listed = Bun.spawn(['ps', '-o', 'pgid=', '-p', String(process.pid)], { stdout: 'pipe', stderr: 'pipe' });
  const [said] = await Promise.all([new Response(listed.stdout).text(), listed.exited]);
  const groups = written.filter((line) => line.startsWith('pgid: ')).map((line) => line.slice('pgid: '.length));
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatch(/^\d+$/);
  expect(groups[0]).not.toBe(said.trim());
});
