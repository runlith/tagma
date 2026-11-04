import { Schema } from 'effect';
import { entryRefusal } from '../installation/contract/wire/archive.js';
import { walkTarball } from '../installation/archive/tarball.js';
import { unpackTarball } from '../installation/archive/materialize.js';
import { type ArchiveAsk, ArchiveMessage, type ArchiveAnswer } from './protocol.js';

declare const self: Worker;

const active = new Map<number, AbortController>();

const answer = async (ask: ArchiveAsk, signal: AbortSignal): Promise<ArchiveAnswer> => {
  const { id, file } = ask;
  try {
    if (ask._tag === 'Unpack') {
      await unpackTarball(file, ask.into, signal);
      return { id, unpacked: true };
    }
    let bytes = 0;
    let entries = 0;
    await walkTarball(
      file,
      (entry) => {
        const refusal = entryRefusal(entry);
        if (refusal !== null) throw new Error(refusal);
        if (entry.kind !== 'file' && entry.size !== 0) throw new Error(`${entry.name} is not a file but declares content`);
        bytes += entry.size;
        entries += 1;
        if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(entries)) throw new Error('the archive footprint is not a safe integer');
        return null;
      },
      signal,
    );
    return { id, footprint: { bytes, entries } };
  } catch (error) {
    return { id, refused: error instanceof Error ? error.message : String(error) };
  }
};

self.addEventListener('message', async (event: MessageEvent<unknown>) => {
  const ask = Schema.decodeUnknownSync(ArchiveMessage)(event.data);
  if (ask._tag === 'Cancel') {
    for (const controller of active.values()) controller.abort();
    return;
  }
  const controller = new AbortController();
  active.set(ask.id, controller);
  const result = await answer(ask, controller.signal);
  active.delete(ask.id);
  self.postMessage(result);
});
