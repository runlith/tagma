import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureHome } from '../../../platform/testing/roots.js';

const digest = `sha256:${'d'.repeat(64)}`;
const image = { reference: 'guest:prepared', digest, revision: 'b0759ca46b90f766' };
const limits = { pids: 128, memory: '512m', cpus: '1' };
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(fixtureHome(), 'docker-admission-'));
  const entry = join(root, 'entry.ts');
  await writeFile(
    entry,
    `
import { Effect } from ${JSON.stringify(new URL(import.meta.resolve('effect')).pathname)};
import { makeDockerGuests } from ${JSON.stringify(new URL('./backend.ts', import.meta.url).pathname)};
const request = JSON.parse(process.argv[2]);
const runtime = makeDockerGuests({ installation: 'fixture', closure: undefined });
const receipt = runtime.receipt('prepared');
const operation = request.action === 'reader'
  ? Effect.scoped(runtime.sealedWorld(receipt, request.image).pipe(Effect.map((world) => ({ root: world.root, alive: world.alive() }))))
  : request.action === 'stop' ? runtime.stop(receipt)
  : request.action === 'export' ? runtime.export(receipt, request.into)
  : runtime.inspect(receipt, { limits: request.limits, image: request.image });
const result = await Effect.runPromise(Effect.result(operation));
console.log(JSON.stringify(result._tag === 'Success' ? { _tag: 'Success', success: result.success } : { _tag: 'Failure', failure: result.failure }));
`,
  );
  const built = await Bun.build({ entrypoints: [entry], target: 'bun', outdir: root, naming: 'installed.js' });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  await rm(entry);
  await writeFile(
    join(root, 'docker'),
    `#!${process.execPath}
const request = JSON.parse(process.env.DOCKER_FIXTURE);
const args = process.argv.slice(2);
if (args[0] === 'container' && args[1] === 'inspect') {
  console.log(JSON.stringify({ Image: request.actualDigest, State: { Status: 'stopped' }, Config: { User: '65534:65534', Labels: { 'tagma.kind': 'workload' } }, HostConfig: { NetworkMode: request.network, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], PidsLimit: 128, Memory: 536870912, NanoCpus: 1000000000, Tmpfs: { '/tmp': '', '/home/guest': '' } }, Mounts: [{ Type: 'volume', Name: args.at(-1), Destination: '/work' }] }));
} else if (args[0] === 'image' && args[1] === 'inspect') {
  console.log(JSON.stringify({ Id: request.actualDigest, Os: 'linux', Architecture: 'arm64', Config: { Labels: { 'tagma.guest.revision': request.revision, 'tagma.guest.protocol': request.protocol === '<no value>' ? undefined : request.protocol } } }));
} else if (args[0] === 'stop') {
  process.stderr.write('engine refused to stop the guest');
  process.exit(23);
} else if (args[0] === 'run') {
  console.log('reader');
} else if (args[0] === 'exec' && args.includes('serve')) {
  let input = '';
  process.stdin.on('data', (bytes) => {
    input += bytes.toString();
    const newline = input.indexOf('\\n');
    if (newline < 0) return;
    const ask = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    process.stdout.write(JSON.stringify({ id: ask.id, ok: true, path: '/' }) + '\\n');
  });
  process.stdin.on('end', () => process.exit(0));
} else if (args[0] === 'cp') {
  if (request.cpExit !== 0) {
    process.stderr.write(request.cpRefused);
    process.exit(request.cpExit);
  }
  process.stdout.write(Buffer.from(request.tarBase64, 'base64'));
} else if (args[0] === 'rm' || (args[0] === 'exec' && args.includes('kill'))) {
  process.exit(0);
} else {
  console.error('unexpected Docker operation in installed admission');
  process.exit(77);
}
`,
  );
  await chmod(join(root, 'docker'), 0o755);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function run(request: Record<string, unknown>) {
  const child = Bun.spawn([process.execPath, join(root, 'installed.js'), JSON.stringify(request)], {
    cwd: root,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, DOCKER_FIXTURE: JSON.stringify(request) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`installed fixture exited ${code}: ${error}`);
  return JSON.parse(output);
}

async function inspect(options: { action?: string; actualDigest?: string; revision?: string; protocol?: string; network?: string } = {}) {
  const request = {
    action: 'inspect',
    actualDigest: digest,
    revision: image.revision,
    protocol: '<no value>',
    network: 'none',
    ...options,
    image,
    limits,
  };
  return run(request);
}

async function exportTree(options: { into: string; tarBase64?: string; cpExit?: number; cpRefused?: string }) {
  return run({ action: 'export', tarBase64: '', cpExit: 0, cpRefused: '', ...options });
}

test('an installed runtime admits the recorded legacy image without a build context', async () => {
  const result = await inspect();
  expect(result._tag).toBe('Success');
  expect(result.success.status).toBe('stopped');
  expect(result.success.image).toBe(digest);
  expect(result.success.mismatch).toBeNull();
});

test('an installed runtime refuses changed image identity and incompatible guest protocols', async () => {
  for (const changed of [
    { actualDigest: `sha256:${'e'.repeat(64)}` },
    { revision: 'unknown' },
    { protocol: '2' },
    { revision: `${image.revision}|1`, protocol: '2' },
  ]) {
    const result = await inspect(changed);
    expect(result._tag).toBe('Failure');
    expect(result.failure._tag).toBe('SandboxUnavailable');
  }
  const isolated = await inspect({ network: 'host' });
  expect(isolated._tag).toBe('Success');
  expect(isolated.success.mismatch).not.toBeNull();
});

test('a failed Docker stop refuses rather than claiming that the guest is sealed', async () => {
  const result = await inspect({ action: 'stop' });
  expect(result._tag).toBe('Failure');
  expect(result.failure._tag).toBe('SandboxUnavailable');
});

test('an installed reader opens the prepared image without rebuilding it', async () => {
  const result = await inspect({ action: 'reader' });
  expect(result._tag).toBe('Success');
  expect(result.success).toEqual({ root: '/work', alive: true });
});

test('an export seals a tree whose members differ only in case, byte-complete', async () => {
  const tar = archiveOf([
    file('apps/tagma/server/src/http/SchemaRefusal.ts', 'upper\n'),
    file('apps/tagma/server/src/http/schemaRefusal.ts', 'lower\n'),
  ]);
  const into = join(root, 'case-only.tar');

  const result = await exportTree({ into, tarBase64: Buffer.from(tar).toString('base64') });

  expect(result._tag).toBe('Success');
  expect(Buffer.from(await readFile(into)).equals(Buffer.from(tar))).toBe(true);
});

test('an export refuses with the engine’s words when the copy fails', async () => {
  const into = join(root, 'refused.tar');

  const result = await exportTree({ into, cpExit: 1, cpRefused: 'Error: no such container' });

  expect(result._tag).toBe('Failure');
  expect(result.failure._tag).toBe('SandboxUnavailable');
  expect(result.failure.reason).toBe('its tree could not be exported: Error: no such container');
});

const BLOCK = 512;

function archiveOf(members: readonly Uint8Array[]): Uint8Array {
  const end = new Uint8Array(BLOCK * 2);
  const parts = [...members, end];
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return joined;
}

function header(member: { name: string; size?: number }): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, at: number, length: number) => {
    block.set(new TextEncoder().encode(text.slice(0, length - 1)), at);
  };
  put(member.name, 0, 100);
  put((0o644).toString(8).padStart(7, '0'), 100, 8);
  put('0000000', 108, 8);
  put('0000000', 116, 8);
  put((member.size ?? 0).toString(8).padStart(11, '0'), 124, 12);
  put('00000000000', 136, 12);
  block.set(new TextEncoder().encode('        '), 148);
  block[156] = '0'.charCodeAt(0);
  put('ustar', 257, 6);
  put('00', 263, 3);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

function body(content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / BLOCK) * BLOCK);
  padded.set(bytes, 0);
  return padded;
}

function file(name: string, content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  return concat(header({ name, size: bytes.byteLength }), body(content));
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}
