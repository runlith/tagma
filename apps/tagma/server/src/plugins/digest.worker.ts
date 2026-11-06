import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { filesHasher } from './contract/service/digest.js';
import type { DigestAnswer, DigestAsk } from './digests.js';

declare const self: Worker;

const MISSING = '-';

const measured = (path: string): Promise<string> =>
  stat(path).then(
    (info) => (info.isFile() ? `${info.size}:${info.mtimeMs}` : MISSING),
    () => MISSING,
  );

const answered = async (ask: DigestAsk): Promise<DigestAnswer> => {
  const measures = await Promise.all(ask.paths.map((path) => measured(join(ask.root, path))));
  const stamp = ask.paths.map((path, at) => `${path}\u0000${measures[at]}`).join('\n');
  if (ask.known !== null && ask.known.stamp === stamp) return { id: ask.id, stamp, digest: ask.known.digest };
  if (measures.includes(MISSING)) return { id: ask.id, stamp, digest: null };
  const hasher = filesHasher();
  for (const path of ask.paths) {
    const bytes = await readFile(join(ask.root, path)).catch(() => null);
    if (bytes === null) return { id: ask.id, stamp: '', digest: null };
    hasher.add(path, bytes);
  }
  return { id: ask.id, stamp, digest: hasher.digest() };
};

self.onmessage = (event: MessageEvent<DigestAsk>) => {
  const ask = event.data;
  answered(ask).then(
    (answer) => self.postMessage(answer),
    (error: unknown) => self.postMessage({ id: ask.id, failed: error instanceof Error ? error.message : String(error) }),
  );
};
