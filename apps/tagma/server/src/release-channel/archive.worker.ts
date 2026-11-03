import { Schema } from 'effect';
import { entryRefusal } from '../installation/contract/wire/archive.js';
import { walkTarball } from '../installation/archive/tarball.js';
import { ArchiveAsk, type ArchiveInspection } from './inspection.js';

declare const self: Worker;

const inspect = async ({ id, file }: ArchiveAsk): Promise<ArchiveInspection> => {
  try {
    let bytes = 0;
    let entries = 0;
    await walkTarball(file, (entry) => {
      const refusal = entryRefusal(entry);
      if (refusal !== null) throw new Error(refusal);
      if (entry.kind !== 'file' && entry.size !== 0) throw new Error(`${entry.name} is not a file but declares content`);
      bytes += entry.size;
      entries += 1;
      if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(entries)) throw new Error('the archive footprint is not a safe integer');
      return null;
    });
    return { id, footprint: { bytes, entries } };
  } catch (error) {
    return { id, refused: error instanceof Error ? error.message : String(error) };
  }
};

self.addEventListener('message', async (event: MessageEvent<unknown>) => {
  const ask = Schema.decodeUnknownSync(ArchiveAsk)(event.data);
  self.postMessage(await inspect(ask));
});
