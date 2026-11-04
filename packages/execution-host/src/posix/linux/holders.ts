import { Effect, FileSystem, Option } from 'effect';
import type { FileHolders } from '../holders';

export const fileHolders = Effect.fn('LinuxHolders.of')(function* (
  file: string,
): Effect.fn.Return<FileHolders, never, FileSystem.FileSystem> {
  const files = yield* FileSystem.FileSystem;
  const info = yield* files.stat(file).pipe(Effect.result);
  if (info._tag === 'Failure') return { _tag: 'Unread', detail: `${file}: ${info.failure.message}` };
  const inode = Option.getOrUndefined(info.success.ino);
  if (inode === undefined || !Number.isSafeInteger(inode) || !Number.isSafeInteger(info.success.dev))
    return { _tag: 'Unread', detail: `${file} has no exactly representable device/inode witness` };
  const dev = BigInt(info.success.dev);
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  const table = yield* files.readFileString('/proc/locks').pipe(Effect.result);
  if (table._tag === 'Failure') return { _tag: 'Unread', detail: `/proc/locks: ${table.failure.message}` };
  const pids = new Set<number>();
  for (const line of table.success.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    if (fields[1] === '->') continue;
    const at = fields.findIndex((field) => /^[0-9a-f]+:[0-9a-f]+:\d+$/iu.test(field));
    if (at < 1) continue;
    const [deviceMajor, deviceMinor, number] = fields[at]!.split(':');
    if (BigInt(`0x${deviceMajor}`) !== major || BigInt(`0x${deviceMinor}`) !== minor || number !== String(inode)) continue;
    const pid = Number(fields[at - 1]);
    if (!Number.isSafeInteger(pid) || pid <= 0)
      return { _tag: 'Unread', detail: `${file} has an open-file-description lock without a visible process owner` };
    pids.add(pid);
  }
  return { _tag: 'Holders', pids: [...pids] };
});
