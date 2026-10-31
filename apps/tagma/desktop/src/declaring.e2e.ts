import { beforeAll, expect } from 'bun:test';
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WindowDeclaration } from '@tagma/server/executions/contract/wire/load';
import { e2e } from '@runlith/e2e/browser';

type Declaring = {
  readonly profile: string;
  readonly call: (call: object) => Promise<unknown>;
  readonly next: (seen: number) => Promise<readonly WindowDeclaration[]>;
};

const PROC_PIDTBSDINFO = 3;
const BSDINFO_SIZE = 136;
const START_SECONDS = 120;
const START_MICROS = 128;

const kernelStartMs = (pid: number): number | null => {
  const libc = dlopen('/usr/lib/libSystem.B.dylib', {
    proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  });
  const info = new Uint8Array(BSDINFO_SIZE);
  if (libc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0n, ptr(info), BSDINFO_SIZE) !== BSDINFO_SIZE) return null;
  const view = new DataView(info.buffer);
  return Number(view.getBigUint64(START_SECONDS, true)) * 1000 + Number(view.getBigUint64(START_MICROS, true)) / 1000;
};

let entry = '';

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./browser/testing/declaring.ts', import.meta.url))],
    target: 'node',
    format: 'esm',
    external: ['electron'],
  });
  if (!built.success) throw new AggregateError(built.logs, 'the declaring host did not build');
  entry = join(await mkdtemp(join(tmpdir(), 'desktop-declaring-')), 'declaring.mjs');
  await Bun.write(entry, built.outputs[0]!);
});

const hosts = (declaration: WindowDeclaration, test: (document: WindowDeclaration['processes'][number]['documents'][number]) => boolean) =>
  declaration.processes.filter((process) => process.kind === 'renderer' && process.documents.some(test));

e2e(
  'the window declares the renderer of a busy built-in page, the process of its foreign frame, the graphics process, and follows the page closing',
  async ({ electron, artifacts }) => {
    const main = electron!;
    const call = (body: object) =>
      main.evaluate((_electron, sent) => (globalThis as unknown as { declaring: Declaring }).declaring.call(sent), body);
    const next = (seen: number) =>
      main.evaluate((_electron, count) => (globalThis as unknown as { declaring: Declaring }).declaring.next(count), seen);
    const profile = await main.evaluate(() => (globalThis as unknown as { declaring: Declaring }).declaring.profile);
    const standing = (declaration: WindowDeclaration) =>
      hosts(declaration, (document) => document._tag === 'Page' && document.page === 'page-1').length > 0 &&
      hosts(declaration, (document) => document._tag === 'Origin' && document.origin === 'https://elsewhere.invalid').length > 0 &&
      declaration.processes.some((process) => process.kind === 'graphics');

    await call({ kind: 'open', page: 'page-1', profile, context: null, url: 'https://fixture.invalid/', history: null, policy: null });
    let all = await next(0);
    while (!standing(all.at(-1)!)) all = await next(all.length);
    const opened = all.at(-1)!;

    const pageRenderer = hosts(opened, (document) => document._tag === 'Page')[0]!;
    const frameRenderer = hosts(opened, (document) => document._tag === 'Origin' && document.origin === 'https://elsewhere.invalid')[0]!;
    expect(frameRenderer.pid).not.toBe(pageRenderer.pid);
    expect(hosts(opened, (document) => document._tag === 'Interface').length).toBe(1);
    expect(opened.processes.some((process) => process.kind === 'main')).toBe(true);

    if (process.platform === 'darwin') {
      const deltas = opened.processes.map((process) => ({
        pid: process.pid,
        kind: process.kind,
        deltaMs: process.createdMs - (kernelStartMs(process.pid) ?? Number.NaN),
      }));
      await Bun.write(join(artifacts, 'creation-time-delta.json'), JSON.stringify(deltas, null, 2));
      console.log(`creation-time deltas (Electron minus kernel, ms): ${JSON.stringify(deltas)}`);
      for (const { deltaMs } of deltas) expect(Math.abs(deltaMs)).toBeLessThanOrEqual(opened.precisionMs);
    }

    await call({ kind: 'close', page: 'page-1', ask: false });
    let after = await next(all.length);
    while (hosts(after.at(-1)!, (document) => document._tag === 'Page').length > 0) after = await next(after.length);
    expect(hosts(after.at(-1)!, (document) => document._tag === 'Origin' && document.origin === 'https://elsewhere.invalid')).toEqual([]);
  },
  {
    lanes: ['electron'],
    electron: () => ({ executablePath: createRequire(import.meta.url)('electron') as string, args: [entry] }),
  },
);
