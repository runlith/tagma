import { EncodedPacket, EncodedVideoPacketSource, FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';
import type { MuxAsk, MuxReply } from './mux.js';

declare const self: Worker;

let output: Output | undefined;
let source: EncodedVideoPacketSource | undefined;
let fps = 30;
let described = false;

const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, 'base64'));

const handle = async (ask: MuxAsk): Promise<void> => {
  switch (ask.kind) {
    case 'open': {
      fps = ask.fps;
      output = new Output({
        format: new Mp4OutputFormat({ fastStart: ask.total === null ? false : 'reserve' }),
        target: new FilePathTarget(ask.file),
      });
      source = new EncodedVideoPacketSource('avc');
      output.addVideoTrack(source, ask.total === null ? { frameRate: ask.fps } : { frameRate: ask.fps, maximumPacketCount: ask.total });
      await output.start();
      return;
    }
    case 'add': {
      if (source === undefined) throw new Error('the muxer was given packets before it was opened');
      for (const chunk of ask.chunks) {
        const packet = new EncodedPacket(
          bytes(chunk.data),
          chunk.key ? 'key' : 'delta',
          chunk.timestamp / 1e6,
          (chunk.duration ?? 1e6 / fps) / 1e6,
        );
        const config = described || chunk.config === null ? undefined : chunk.config;
        described ||= config !== undefined;
        await source.add(
          packet,
          config === undefined
            ? undefined
            : {
                decoderConfig: {
                  codec: config.codec,
                  codedWidth: config.codedWidth,
                  codedHeight: config.codedHeight,
                  ...(config.description === null ? {} : { description: bytes(config.description) }),
                },
              },
        );
      }
      return;
    }
    case 'finish': {
      if (output === undefined) throw new Error('the muxer was finished before it was opened');
      await output.finalize();
      return;
    }
  }
};

let chain = Promise.resolve();

self.addEventListener('message', (event: MessageEvent<MuxAsk>) => {
  chain = chain.then(() =>
    handle(event.data).then(
      () => self.postMessage({ kind: 'done' } satisfies MuxReply),
      (failure: unknown) =>
        self.postMessage({
          kind: 'failed',
          reason: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
        } satisfies MuxReply),
    ),
  );
});
self.postMessage({ kind: 'ready' } satisfies MuxReply);
