import { writeFileSync } from 'node:fs';

type Header = Record<string, unknown> & { readonly type: string };
type Clip = { readonly id: string; readonly language: string | undefined; readonly pcm: Int16Array };

const windowSize = 512;
const crashSample = -1;
const endlessSample = -2;
const loadMs = 300;
const clipMs = 60;

const say = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);

const streams = new Map<string, { at: number; pending: number }>();
const clips: Clip[] = [];
let loading = false;
let active: { readonly clip: Clip; readonly timer: ReturnType<typeof setTimeout> | undefined } | undefined;

const finish = (clip: Clip) => {
  active = undefined;
  const ms = (clip.pcm.length * 1000) / 16_000;
  say({ type: 'result', id: clip.id, language: clip.language ?? 'en', segments: [{ from: 0, to: ms, text: `clip ${clip.pcm[0]}` }] });
  next();
};

const next = () => {
  if (active !== undefined || loading) return;
  const clip = clips.shift();
  if (clip === undefined) return;
  if (clip.pcm[0] === crashSample) process.exit(3);
  const timer = clip.pcm[0] === endlessSample ? undefined : setTimeout(() => finish(clip), clipMs);
  active = { clip, timer };
  if (process.env.WHISPER_TEST_STARTED !== undefined) writeFileSync(process.env.WHISPER_TEST_STARTED, String(clip.pcm[0]));
};

const probs = (stream: string, count: number) => {
  const state = streams.get(stream);
  if (state === undefined) return;
  say({ type: 'vad.probs', stream, at: state.at, samples: count, probs: Array.from({ length: Math.ceil(count / windowSize) }, () => 0.5) });
  state.at += count;
};

const handle = (header: Header, payload: Uint8Array) => {
  const id = String(header['id'] ?? '');
  const stream = String(header['stream'] ?? '');
  switch (header.type) {
    case 'load':
      loading = true;
      setTimeout(() => {
        loading = false;
        say({ type: 'loaded', id });
        next();
      }, loadMs);
      return;
    case 'unload':
      say({ type: 'unloaded', id });
      return;
    case 'transcribe': {
      const pcm = new Int16Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
      clips.push({ id, language: typeof header['language'] === 'string' ? header['language'] : undefined, pcm });
      next();
      return;
    }
    case 'cancel': {
      if (active?.clip.id === id) {
        if (active.timer !== undefined) clearTimeout(active.timer);
        active = undefined;
        say({ type: 'cancelled', id });
        next();
      }
      return;
    }
    case 'vad.open':
      streams.set(stream, { at: 0, pending: 0 });
      say({ type: 'vad.opened', id, stream });
      return;
    case 'vad.audio': {
      const state = streams.get(stream);
      if (state === undefined) return;
      state.pending += payload.byteLength / 2;
      const whole = Math.floor(state.pending / windowSize) * windowSize;
      state.pending -= whole;
      if (whole > 0) probs(stream, whole);
      return;
    }
    case 'vad.reset': {
      const state = streams.get(stream);
      if (state !== undefined) {
        state.at += state.pending;
        state.pending = 0;
      }
      return;
    }
    case 'vad.end': {
      const state = streams.get(stream);
      if (state !== undefined && state.pending > 0) {
        const tail = state.pending;
        state.pending = 0;
        probs(stream, tail);
      }
      say({ type: 'vad.ended', id, stream });
      return;
    }
    case 'vad.close':
      streams.delete(stream);
      return;
    case 'quit':
      process.exit(0);
  }
};

let input = new Uint8Array(0);
process.stdin.on('data', (chunk: Uint8Array) => {
  const joined = new Uint8Array(input.byteLength + chunk.byteLength);
  joined.set(input);
  joined.set(chunk, input.byteLength);
  input = joined;
  while (input.byteLength >= 8) {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const headerBytes = view.getUint32(0);
    const payloadBytes = view.getUint32(4);
    if (input.byteLength < 8 + headerBytes + payloadBytes) return;
    const header = JSON.parse(new TextDecoder().decode(input.subarray(8, 8 + headerBytes))) as Header;
    const payload = input.slice(8 + headerBytes, 8 + headerBytes + payloadBytes);
    input = input.slice(8 + headerBytes + payloadBytes);
    handle(header, payload);
  }
});
process.stdin.on('end', () => process.exit(0));

say({ type: 'ready', pid: process.pid, rate: 16_000, window: windowSize });
