/// <reference types="bun" />

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { constants, rmSync, type Stats } from 'node:fs';
import * as path from 'node:path';
import type { WorkingStat } from '@runlith/files/working';

type Json = Record<string, unknown>;

const registerDir = (dir: string): Promise<unknown> => fs.mkdir(dir, { recursive: true, mode: 0o700 });

const runningFile = (dir: string, id: string): string => path.join(dir, `${id}.running`);
const killFile = (dir: string, id: string): string => path.join(dir, `${id}.kill`);

const handles = new Map<number, Awaited<ReturnType<typeof fs.open>>>();
let nextHandle = 0;

const statInfo = (info: Stats): Json => ({
  type: info.isFile()
    ? 'File'
    : info.isDirectory()
      ? 'Directory'
      : info.isSymbolicLink()
        ? 'SymbolicLink'
        : info.isBlockDevice()
          ? 'BlockDevice'
          : info.isCharacterDevice()
            ? 'CharacterDevice'
            : info.isFIFO()
              ? 'FIFO'
              : info.isSocket()
                ? 'Socket'
                : 'Unknown',
  mtime: info.mtimeMs,
  atime: info.atimeMs,
  birthtime: info.birthtimeMs,
  dev: info.dev,
  ino: info.ino,
  mode: info.mode,
  nlink: info.nlink,
  uid: info.uid,
  gid: info.gid,
  rdev: info.rdev,
  size: info.size,
  blksize: info.blksize,
  blocks: info.blocks,
});

type Answer = { readonly value?: Json; readonly payload?: Uint8Array };

const errno = (message: string, code: string, syscall: string): NodeJS.ErrnoException => {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  error.syscall = syscall;
  return error;
};

const held = (handle: unknown): Awaited<ReturnType<typeof fs.open>> => {
  const found = handles.get(Number(handle));
  if (found === undefined) throw errno('bad file handle', 'EBADF', 'read');
  return found;
};

const text = (value: unknown): string => String(value);

const serve = async (ask: Json, payload: Uint8Array): Promise<Answer> => {
  switch (ask.op) {
    case 'access': {
      let mode = constants.F_OK;
      if (ask.readable === true) mode |= constants.R_OK;
      if (ask.writable === true) mode |= constants.W_OK;
      await fs.access(text(ask.path), mode);
      return {};
    }
    case 'copy':
      await fs.cp(text(ask.from), text(ask.to), {
        force: ask.overwrite === true,
        preserveTimestamps: ask.preserveTimestamps === true,
        recursive: true,
      });
      return {};
    case 'copyFile':
      await fs.copyFile(text(ask.from), text(ask.to));
      return {};
    case 'chmod':
      await fs.chmod(text(ask.path), Number(ask.mode));
      return {};
    case 'chown':
      await fs.chown(text(ask.path), Number(ask.uid), Number(ask.gid));
      return {};
    case 'glob': {
      const names: string[] = [];
      const exclude = ask.exclude as string[] | undefined;
      for await (const name of fs.glob(text(ask.pattern), {
        cwd: ask.root === undefined ? undefined : text(ask.root),
        exclude,
      })) {
        names.push(name);
      }
      return { value: { names } };
    }
    case 'link':
      await fs.link(text(ask.from), text(ask.to));
      return {};
    case 'makeDirectory':
      await fs.mkdir(text(ask.path), {
        recursive: ask.recursive === true,
        mode: ask.mode === undefined ? undefined : Number(ask.mode),
      });
      return {};
    case 'makeTempDirectory': {
      const prefix = ask.prefix === undefined ? '' : text(ask.prefix);
      const directory = ask.directory === undefined ? '/tmp' : text(ask.directory);
      return { value: { path: await fs.mkdtemp(prefix ? path.join(directory, prefix) : `${directory}/`) } };
    }
    case 'open': {
      const file = await fs.open(text(ask.path), text(ask.flag), ask.mode === undefined ? undefined : Number(ask.mode));
      nextHandle += 1;
      handles.set(nextHandle, file);
      return { value: { handle: nextHandle } };
    }
    case 'close': {
      const handle = Number(ask.handle);
      const found = handles.get(handle);
      handles.delete(handle);
      if (found !== undefined) await found.close();
      return {};
    }
    case 'fstat':
      return { value: { info: statInfo(await held(ask.handle).stat()) } };
    case 'fread': {
      const length = Number(ask.length);
      const buffer = Buffer.allocUnsafe(length);
      const read = await held(ask.handle).read(buffer, 0, length, Number(ask.position));
      return { value: { read: read.bytesRead }, payload: buffer.subarray(0, read.bytesRead) };
    }
    case 'fwrite': {
      const position = ask.position === null ? null : Number(ask.position);
      const written = await held(ask.handle).write(payload, 0, payload.length, position);
      return { value: { written: written.bytesWritten } };
    }
    case 'ftruncate':
      await held(ask.handle).truncate(ask.length === undefined ? 0 : Number(ask.length));
      return {};
    case 'fsync':
      await held(ask.handle).sync();
      return {};
    case 'readDirectory':
      return { value: { entries: await fs.readdir(text(ask.path), { recursive: ask.recursive === true }) } };
    case 'readFile':
      return { payload: await fs.readFile(text(ask.path)) };
    case 'readLink':
      return { value: { target: await fs.readlink(text(ask.path)) } };
    case 'realPath':
      return { value: { path: await fs.realpath(text(ask.path)) } };
    case 'remove':
      await fs.rm(text(ask.path), { recursive: ask.recursive === true, force: ask.force === true });
      return {};
    case 'rename':
      await fs.rename(text(ask.from), text(ask.to));
      return {};
    case 'stat':
      return { value: { info: statInfo(await fs.stat(text(ask.path))) } };
    case 'working': {
      const info = await fs.lstat(text(ask.path), { bigint: true });
      const working: WorkingStat = {
        file: info.isFile(),
        link: info.isSymbolicLink(),
        size: Number(info.size),
        dev: String(info.dev),
        ino: String(info.ino),
        mode: String(info.mode),
        mtime: String(info.mtimeNs),
        ctime: String(info.ctimeNs),
        changedAt: Number(info.ctimeMs),
      };
      return { value: { working, now: Date.now() } };
    }
    case 'symlink':
      await fs.symlink(text(ask.from), text(ask.to));
      return {};
    case 'truncate':
      await fs.truncate(text(ask.path), ask.length === undefined ? 0 : Number(ask.length));
      return {};
    case 'utimes':
      await fs.utimes(text(ask.path), Number(ask.atime) / 1000, Number(ask.mtime) / 1000);
      return {};
    case 'writeFile': {
      const file = await fs.open(text(ask.path), text(ask.flag), ask.mode === undefined ? undefined : Number(ask.mode));
      try {
        await file.writeFile(payload);
      } finally {
        await file.close();
      }
      return {};
    }
    default:
      throw errno(`the guest helper does not serve ${text(ask.op)}`, 'ENOSYS', text(ask.op));
  }
};

const failure = (cause: unknown): Json => {
  const error = (cause ?? {}) as NodeJS.ErrnoException;
  return {
    code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
    message: typeof error.message === 'string' ? error.message : String(cause),
    syscall: typeof error.syscall === 'string' ? error.syscall : undefined,
    path: typeof error.path === 'string' ? error.path : undefined,
  };
};

const say = (frame: Json, payload: Uint8Array | undefined): void => {
  const bytes = payload?.length ?? 0;
  process.stdout.write(`${JSON.stringify(bytes > 0 ? { ...frame, bytes } : frame)}\n`);
  if (payload !== undefined && bytes > 0) process.stdout.write(payload);
};

const answer = (ask: Json, payload: Uint8Array): void => {
  serve(ask, payload).then(
    (answered) => say({ id: ask.id, ok: true, ...(answered.value ?? {}) }, answered.payload),
    (cause: unknown) => say({ id: ask.id, ok: false, error: failure(cause) }, undefined),
  );
};

const listen = (): void => {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let head: Json | null = null;
  let wanted = 0;
  process.stdin.on('data', (chunk: Buffer) => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    for (;;) {
      if (head === null) {
        const end = buffered.indexOf(0x0a);
        if (end < 0) return;
        head = JSON.parse(buffered.subarray(0, end).toString('utf8')) as Json;
        buffered = buffered.subarray(end + 1);
        wanted = typeof head.bytes === 'number' ? head.bytes : 0;
      }
      if (buffered.length < wanted) return;
      const payload = new Uint8Array(buffered.subarray(0, wanted));
      buffered = buffered.subarray(wanted);
      const ask = head;
      head = null;
      wanted = 0;
      answer(ask, payload);
    }
  });
  process.stdin.on('end', () => process.exit(0));
};

const runServe = async (spec: Json): Promise<void> => {
  const dir = text(spec.dir);
  const id = text(spec.id);
  await registerDir(dir);
  await fs.writeFile(runningFile(dir, id), JSON.stringify({ pid: process.pid }));
  process.on('exit', () => {
    try {
      rmSync(runningFile(dir, id), { force: true });
    } catch {}
  });
  listen();
};

const SIGNAL_NUMBERS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

const signalNumber = (signal: NodeJS.Signals | null): number => (signal === null ? 0 : (SIGNAL_NUMBERS[signal] ?? 15));

const runExec = async (spec: Json): Promise<void> => {
  const dir = text(spec.dir);
  const id = text(spec.id);
  await registerDir(dir);
  const argv = spec.argv as string[];
  const declared = (spec.env ?? {}) as Record<string, string | null>;
  const base: Record<string, string | undefined> = spec.extendEnv === true ? { ...process.env } : {};
  for (const [name, value] of Object.entries(declared)) {
    if (value === null) delete base[name];
    else base[name] = value;
  }
  const child = spawn(argv[0] as string, argv.slice(1), {
    cwd: spec.cwd === undefined ? undefined : text(spec.cwd),
    env: base,
    stdio: [spec.stdin === 'ignore' ? 'ignore' : 'inherit', 'inherit', 'inherit'],
    detached: true,
  });
  if (child.pid === undefined) {
    process.stderr.write(`the guest could not start ${text(argv[0])}\n`);
    process.exit(127);
  }
  const group = child.pid;
  const ending = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((settle) => {
    child.on('exit', (code, signal) => settle({ code, signal }));
    child.on('error', () => settle({ code: 127, signal: null }));
  });
  await fs.writeFile(runningFile(dir, id), JSON.stringify({ pgid: group }));
  const asked = await fs.readFile(killFile(dir, id), 'utf8').catch(() => null);
  if (asked !== null) {
    try {
      process.kill(-group, (JSON.parse(asked) as { signal?: NodeJS.Signals }).signal ?? 'SIGTERM');
    } catch {}
  }
  const ended = await ending;
  const killed = await fs.readFile(killFile(dir, id), 'utf8').then(
    () => true,
    () => false,
  );
  if (killed) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {}
  }
  await fs.rm(runningFile(dir, id), { force: true }).catch(() => undefined);
  await fs.rm(killFile(dir, id), { force: true }).catch(() => undefined);
  process.exit(ended.code ?? 128 + signalNumber(ended.signal));
};

const runKill = async (spec: Json): Promise<void> => {
  const dir = text(spec.dir);
  const id = text(spec.id);
  const signal = (spec.signal ?? 'SIGTERM') as NodeJS.Signals;
  await registerDir(dir);
  await fs.writeFile(killFile(dir, id), JSON.stringify({ signal }));
  const record = await fs.readFile(runningFile(dir, id), 'utf8').catch(() => null);
  if (record === null) {
    process.stdout.write(JSON.stringify({ signalled: false }));
    return;
  }
  const named = JSON.parse(record) as { pgid?: number; pid?: number };
  const target = named.pgid === undefined ? named.pid : -named.pgid;
  try {
    if (target !== undefined) process.kill(target, signal);
    process.stdout.write(JSON.stringify({ signalled: true }));
  } catch {
    process.stdout.write(JSON.stringify({ signalled: false }));
  }
};

const mode = process.argv[2];
const request = JSON.parse(process.argv[3] ?? '{}') as Json;

if (mode === 'serve') void runServe(request);
else if (mode === 'exec') void runExec(request);
else if (mode === 'kill') void runKill(request);
else {
  process.stderr.write(`the guest helper has no mode named ${String(mode)}\n`);
  process.exit(2);
}
