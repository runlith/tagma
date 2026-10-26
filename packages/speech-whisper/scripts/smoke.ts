#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = join(import.meta.dir, '..');
const engine = join(packageRoot, 'bin', 'whisper-engine');
const silero = join(packageRoot, 'bin', 'silero.bin');
const smokeRoot = join(packageRoot, 'native', '.build', 'smoke');
const model = join(smokeRoot, 'tiny.bin');
const speechWav = join(packageRoot, 'native', '.build', '_deps', 'whisper-src', 'samples', 'jfk.wav');
const modelSize = 77_691_713;
const modelSha256 = 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21';
const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin';

const fail = (reason: string): never => {
  console.error('[speech-whisper]', reason);
  process.exit(1);
};

if (!existsSync(engine) || !existsSync(silero)) fail('the smoke needs a built engine: bun run build');
if (!existsSync(speechWav)) fail(`the smoke needs the whisper.cpp sample audio at ${speechWav}`);

const pinned = (bytes: Uint8Array): boolean =>
  bytes.byteLength === modelSize && createHash('sha256').update(bytes).digest('hex') === modelSha256;

if (!existsSync(model) || !pinned(readFileSync(model))) {
  mkdirSync(smokeRoot, { recursive: true });
  const response = await fetch(modelUrl, { redirect: 'follow' });
  if (!response.ok) fail(`the smoke model download failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!pinned(bytes)) fail('the smoke model does not match its pinned size and SHA-256');
  const partial = `${model}.${process.pid}.partial`;
  rmSync(partial, { force: true });
  writeFileSync(partial, bytes);
  renameSync(partial, model);
}

const speech = (() => {
  const wav = readFileSync(speechWav);
  const data = wav.indexOf('data', 12, 'ascii');
  if (data < 0) fail('the sample audio carries no data chunk');
  return new Uint8Array(wav.subarray(data + 8));
})();
const silence = new Uint8Array(512 * 40 * 2);

const frame = (header: Record<string, unknown>, payload?: Uint8Array): Uint8Array => {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const whole = new Uint8Array(8 + head.byteLength + (payload?.byteLength ?? 0));
  const view = new DataView(whole.buffer);
  view.setUint32(0, head.byteLength);
  view.setUint32(4, payload?.byteLength ?? 0);
  whole.set(head, 8);
  if (payload) whole.set(payload, 8 + head.byteLength);
  return whole;
};

type Message = Record<string, unknown>;

const child = Bun.spawn([engine, '--silero', silero, '--threads', '3'], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
const incoming = (async function* () {
  let rest = '';
  for await (const chunk of child.stdout) {
    rest += new TextDecoder().decode(chunk);
    let newline = rest.indexOf('\n');
    while (newline >= 0) {
      yield JSON.parse(rest.slice(0, newline)) as Message;
      rest = rest.slice(newline + 1);
      newline = rest.indexOf('\n');
    }
  }
})();

const arrived: Message[] = [];
const waiting: { readonly type: string; readonly settle: (message: Message) => void }[] = [];
let arrivals = 0;
void (async () => {
  for await (const message of incoming) {
    arrivals += 1;
    message['arrival'] = arrivals;
    if (message['type'] === 'error') fail(`the engine answered an error: ${JSON.stringify(message)}`);
    const waiter = waiting.findIndex((entry) => entry.type === message['type']);
    if (waiter >= 0) waiting.splice(waiter, 1)[0]?.settle(message);
    else arrived.push(message);
  }
})();
const next = (type: string): Promise<Message> => {
  const found = arrived.findIndex((message) => message['type'] === type);
  if (found >= 0) return Promise.resolve(arrived.splice(found, 1)[0] as Message);
  return new Promise((settle) => waiting.push({ type, settle }));
};
const send = (header: Record<string, unknown>, payload?: Uint8Array) => {
  child.stdin.write(frame(header, payload));
  child.stdin.flush();
};

const checks: string[] = [];
const check = (what: string, held: boolean, saw: unknown) => {
  if (!held) fail(`${what}: ${JSON.stringify(saw)}`);
  checks.push(what);
};

const ready = await next('ready');
check('the engine is ready before a Whisper model is loaded', ready['window'] === 512 && ready['rate'] === 16_000, ready);

send({ type: 'vad.open', id: 'open-speech', stream: 'a' });
await next('vad.opened');
send({ type: 'vad.audio', stream: 'a' }, speech.subarray(0, 512 * 2 * 40));
const speechProbs = await next('vad.probs');
check(
  'speech gives high probabilities',
  Math.max(...(speechProbs['probs'] as number[])) > 0.8,
  Math.max(...(speechProbs['probs'] as number[])),
);

send({ type: 'vad.reset', stream: 'a' });
send({ type: 'vad.audio', stream: 'a' }, silence);
const afterReset = await next('vad.probs');
check(
  'vad.reset separates two stretches, so silence after speech reads as silence',
  Math.max(...(afterReset['probs'] as number[])) < 0.3 && afterReset['at'] === 512 * 40,
  afterReset,
);

send({ type: 'vad.audio', stream: 'a' }, speech.subarray(0, 300 * 2));
send({ type: 'vad.end', id: 'end-a', stream: 'a' });
const tail = await next('vad.probs');
check(
  'vad.end answers the partial window over its real samples alone',
  (tail['probs'] as number[]).length === 1 && tail['samples'] === 300,
  tail,
);
await next('vad.ended');
send({ type: 'vad.close', stream: 'a' });

send({ type: 'load', id: 'load', path: model });
const loadedWhileDetecting = next('loaded');
send({ type: 'vad.open', id: 'open-b', stream: 'b' });
await next('vad.opened');
send({ type: 'vad.audio', stream: 'b' }, speech.subarray(0, 512 * 2 * 4));
const duringLoad = await next('vad.probs');
const loaded = await loadedWhileDetecting;
check(
  'the detector answers while the Whisper model loads',
  duringLoad['stream'] === 'b' && (duringLoad['arrival'] as number) < (loaded['arrival'] as number),
  { duringLoad, loaded },
);

send({ type: 'transcribe', id: 'speech' }, speech);
send({ type: 'vad.audio', stream: 'b' }, speech.subarray(0, 512 * 2 * 4));
const duringInference = await next('vad.probs');
const transcribed = await next('result');
check('the detector answers while Whisper recognizes', (duringInference['arrival'] as number) < (transcribed['arrival'] as number), {
  duringInference,
  transcribed,
});
send({ type: 'vad.close', stream: 'b' });
const text = (transcribed['segments'] as { text: string }[]).map((segment) => segment.text).join('');
check(
  'speech without a named language gives text and the detected language',
  transcribed['language'] === 'en' && /ask not/i.test(text),
  transcribed,
);
check(
  'a segment carries its timestamps',
  (transcribed['segments'] as { from: number; to: number }[]).every((segment) => segment.to > segment.from),
  transcribed['segments'],
);

const loudest = (speechProbs['probs'] as number[]).indexOf(Math.max(...(speechProbs['probs'] as number[])));
const short = speech.subarray(loudest * 512 * 2, loudest * 512 * 2 + 3_200 * 2);
send({ type: 'transcribe', id: 'short' }, short);
const shortHeard = await next('result');
check('200 ms of speech passes the silence gate and reaches Whisper', shortHeard['language'] !== null, shortHeard);

send({ type: 'transcribe', id: 'silence', language: 'en' }, new Uint8Array(16_000 * 2));
const silent = await next('result');
check(
  'silence gives empty text',
  (silent['segments'] as { text: string }[])
    .map((segment) => segment.text)
    .join('')
    .trim() === '',
  silent,
);

send({ type: 'quit' });
const code = await child.exited;
check('the engine leaves on quit with a clean status', code === 0, code);

for (const passed of checks) console.log('[speech-whisper] ok —', passed);
