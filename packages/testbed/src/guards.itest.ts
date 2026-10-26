import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PRELOAD = join(import.meta.dir, 'bun.ts');

const CALLS: Readonly<Record<string, { readonly kind: string; readonly imports: string; readonly call: string }>> = {
  spawnSync: { kind: 'process', imports: "import { spawnSync } from 'node:child_process';", call: "spawnSync('true')" },
  spawn: {
    kind: 'process',
    imports: "import { spawn } from 'node:child_process';",
    call: "await new Promise((done) => spawn('true').on('spawn', done))",
  },
  bunSpawn: { kind: 'process', imports: '', call: "await Bun.spawn(['true']).exited" },
  shell: { kind: 'process', imports: "import { $ } from 'bun';", call: 'await $`true`.quiet()' },
  database: { kind: 'sqlite', imports: "import { Database } from 'bun:sqlite';", call: "new Database(':memory:').close()" },
  databaseOpen: { kind: 'sqlite', imports: "import { Database } from 'bun:sqlite';", call: "Database.open(':memory:').close()" },
  server: { kind: 'socket', imports: "import { createServer } from 'node:net';", call: 'createServer().close()' },
  serve: { kind: 'socket', imports: '', call: "Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') }).stop(true)" },
  listen: { kind: 'socket', imports: '', call: "Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } }).stop(true)" },
  fetch: { kind: 'socket', imports: '', call: "await fetch('http://127.0.0.1:9/').catch(() => undefined)" },
  writeFile: { kind: 'write', imports: "import { writeFileSync } from 'node:fs';", call: "writeFileSync(process.env.TMPDIR + '/w', 'x')" },
  mkdtemp: { kind: 'write', imports: "import { mkdtemp } from 'node:fs/promises';", call: "await mkdtemp(process.env.TMPDIR + '/m')" },
  bunWrite: { kind: 'write', imports: '', call: "await Bun.write(process.env.TMPDIR + '/b', 'x')" },
};

const planted = (suffix: (name: string) => string): { readonly root: string; readonly files: string[] } => {
  const root = join(process.env['TMPDIR']!, `guard-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  const files = Object.entries(CALLS).map(([name, { imports, call }]) => {
    const file = `${name}.${suffix(name)}.ts`;
    writeFileSync(join(root, file), `import { test } from 'bun:test';\n${imports}\ntest('${name}', async () => { ${call}; });\n`);
    return `./${file}`;
  });
  return { root, files };
};

const bunTest = async (cwd: string, files: readonly string[]) => {
  const child = Bun.spawn(['bun', 'test', '--parallel=1', ...files], {
    cwd,
    env: { ...process.env, RUNLITH_TEST_REPORT: join(cwd, 'report.jsonl') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { output: stdout + stderr, code };
};

test('every guarded call fails a unit file at the call, naming the file and the kind', async () => {
  const { root, files } = planted(() => 'test');
  const { output, code } = await bunTest(root, files);
  expect(code).toBe(1);
  const missing = Object.entries(CALLS).filter(([name, { kind }]) => !output.includes(`${name}.test.ts × ${kind}`));
  expect(
    missing.map(([name]) => name),
    output,
  ).toEqual([]);
});

test('the same calls run in .itest.ts files', async () => {
  const { root, files } = planted(() => 'itest');
  const { output, code } = await bunTest(root, files);
  expect(output).not.toMatch(/\.itest\.ts × /);
  expect(code, output).toBe(0);
});

const OUTBOUND: Readonly<Record<string, { readonly imports: string; readonly call: string; readonly reached: string }>> = {
  fetch: { imports: '', call: "await fetch('https://example.com/')", reached: 'fetch https://example.com/' },
  http: { imports: "import { get } from 'node:http';", call: "get('http://example.com/')", reached: 'http request to example.com' },
  net: { imports: "import { connect } from 'node:net';", call: "connect(443, 'example.com')", reached: 'connection to example.com' },
  tls: {
    imports: "import { connect } from 'node:tls';",
    call: "connect({ host: 'example.com', port: 443 })",
    reached: 'connection to example.com',
  },
  websocket: { imports: '', call: "new WebSocket('wss://example.com/')", reached: 'websocket to example.com' },
  bunConnect: {
    imports: '',
    call: "await Bun.connect({ hostname: 'example.com', port: 443, socket: { data() {} } })",
    reached: 'connection to example.com',
  },
};

test('a resource file reaching a host beyond loopback fails at the call, whatever the transport', async () => {
  const root = join(process.env['TMPDIR']!, `network-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bunfig.toml'), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  const files = Object.entries(OUTBOUND).map(([name, { imports, call }]) => {
    writeFileSync(
      join(root, `${name}.itest.ts`),
      `import { test } from 'bun:test';\n${imports}\ntest('${name}', async () => { ${call}; });\n`,
    );
    return `./${name}.itest.ts`;
  });
  const { output, code } = await bunTest(root, files);
  expect(code).toBe(1);
  const missing = Object.entries(OUTBOUND).filter(([, { reached }]) => !output.includes(`A test reached the network: ${reached}`));
  expect(
    missing.map(([name]) => name),
    output,
  ).toEqual([]);
});
