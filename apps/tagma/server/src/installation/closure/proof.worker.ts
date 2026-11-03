import { createHash, type Hash } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { Digest } from '@runlith/executions/protocol/artifact';
import { decodeInstallation } from './read.js';
import type { ProofAsk, ProofAnswer } from '../contract/wire/proof.js';

declare const self: Worker;

const hashes = new Map<number, { readonly hash: Hash; bytes: number }>();
const digest = Schema.decodeUnknownSync(Digest);

self.onmessage = (event: MessageEvent<ProofAsk>) => {
  const ask = event.data;
  const answer = (reply: ProofAnswer) => self.postMessage(reply);
  if (ask._tag === 'Decode') {
    Effect.runPromise(
      Effect.match(decodeInstallation(ask.root, ask.text), {
        onFailure: (failure): ProofAnswer => ({ id: ask.id, _tag: 'Rejected', detail: failure.detail ?? '' }),
        onSuccess: (manifest): ProofAnswer => ({ id: ask.id, _tag: 'Decoded', manifest }),
      }),
    ).then(answer);
    return;
  }
  if (ask._tag === 'Begin') {
    hashes.set(ask.id, { hash: createHash('sha256'), bytes: 0 });
    answer({ id: ask.id, _tag: 'Begun', session: ask.id });
    return;
  }
  if (ask._tag === 'Drop') {
    hashes.delete(ask.session);
    return;
  }
  const running = hashes.get(ask.session);
  if (running === undefined) throw new Error('The installation hash is not open');
  if (ask._tag === 'Chunk') {
    running.bytes += ask.bytes.byteLength;
    running.hash.update(ask.bytes);
    answer({ id: ask.id, _tag: 'Updated' });
    return;
  }
  hashes.delete(ask.session);
  answer({ id: ask.id, _tag: 'Hashed', bytes: running.bytes, digest: digest(`sha256:${running.hash.digest('hex')}`) });
};
