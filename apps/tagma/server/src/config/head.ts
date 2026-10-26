import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const text = (path: string): Promise<string | null> =>
  readFile(path, 'utf8').then(
    (read) => read,
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'EISDIR') return null;
      throw cause;
    },
  );

const gitDirOf = async (root: string): Promise<string | null> => {
  const dot = join(root, '.git');
  const pointer = await text(dot);
  if (pointer === null)
    return (await stat(dot).then(
      () => true,
      () => false,
    ))
      ? dot
      : null;
  const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
  return target === undefined ? null : resolve(root, target);
};

const refOf = async (common: string, ref: string): Promise<string | null> => {
  const loose = await text(join(common, ref));
  if (loose !== null) return loose.trim();
  const packed = await text(join(common, 'packed-refs'));
  const line = packed?.split('\n').find((one) => one.endsWith(` ${ref}`));
  return line === undefined ? null : (line.split(' ')[0] ?? null);
};

export const headOf = async (root: string): Promise<string | null> => {
  const gitDir = await gitDirOf(root);
  if (gitDir === null) return null;
  const head = (await text(join(gitDir, 'HEAD')))?.trim();
  if (head === undefined) return null;
  if (!head.startsWith('ref: ')) return head;
  const common = (await text(join(gitDir, 'commondir')))?.trim();
  return refOf(common === undefined ? gitDir : resolve(gitDir, common), head.slice(5));
};
