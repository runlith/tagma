import { renameSync, writeFileSync } from 'node:fs';
import { readOutputFrame } from '@runlith/executions/protocol/lane';

const [url, token, first, result] = process.argv.slice(2) as [string, string, string, string];
const KEYS = '#abcdefghijklmnopqrs';
const SETTLE_MS = 20;

const now = () => performance.timeOrigin + performance.now();
const say = (line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`);
const typed = (line: unknown) => {
  writeFileSync(`${result}.staged`, JSON.stringify(line));
  renameSync(`${result}.staged`, result);
};

type Expected = { readonly pattern: string; readonly settled: (at: number) => void };

const decoder = new TextDecoder();
const receipts = new Map<number, number>();
const expected: Expected[] = [];
let text = '';
let cursor = 0;

const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';

const matched = (at: number) => {
  for (;;) {
    const head = expected[0];
    if (head === undefined) return;
    const found = text.indexOf(head.pattern, cursor);
    if (found < 0) return;
    cursor = found + head.pattern.length;
    expected.shift();
    head.settled(at);
  }
};

const expect = (pattern: string): Promise<number> => new Promise((settled) => expected.push({ pattern, settled }));

socket.onmessage = (event) => {
  const at = now();
  if (typeof event.data === 'string') {
    const reply = JSON.parse(event.data) as { readonly t: string; readonly sequence?: number; readonly head?: string };
    if (reply.t === 'ready') {
      socket.send(JSON.stringify({ t: 'follow', offset: reply.head }));
      say({ ready: reply.head });
    }
    if (reply.t === 'receipt' && reply.sequence !== undefined) receipts.set(reply.sequence, at);
    return;
  }
  const frame = readOutputFrame(new Uint8Array(event.data as ArrayBuffer));
  if (frame === undefined) return;
  text += decoder.decode(frame.bytes, { stream: true });
  matched(at);
};
socket.onopen = () => socket.send(JSON.stringify({ lane: token }));
socket.onclose = (event) => {
  if (event.code === 1000) return;
  say({ closed: event.code, reason: event.reason });
  typed({ closed: event.code, reason: event.reason });
};

let sequence = Number(first);
const type = (bytes: string): { readonly sequence: number; readonly at: number } => {
  const sent = { sequence: sequence++, at: now() };
  socket.send(
    JSON.stringify({
      t: 'act',
      sequence: sent.sequence,
      cause: 'typed',
      act: { _tag: 'Write', bytes: Buffer.from(bytes).toString('base64') },
    }),
  );
  return sent;
};

process.on('SIGUSR2', () => {
  setTimeout(async () => {
    const from = (cursor = text.length);
    const command = type('stty size; echo $((40+2))EP\n');
    const answered = await expect('42EP');
    const size = /(\d+ \d+)\r\n42EP/.exec(text.slice(from))?.[1];
    cursor = text.length;
    const echoes = [...KEYS].map((key) => expect(key));
    const keys = [...KEYS].map((key) => type(key));
    const seen = await Promise.all(echoes);
    typed({
      started: command.at,
      finished: seen.at(-1),
      command: answered - command.at,
      size,
      keys: keys.map((key, index) => seen[index]! - key.at),
      receipts: [command, ...keys].map((sent) => (receipts.get(sent.sequence) ?? Number.NaN) - sent.at),
    });
    socket.close(1000);
  }, SETTLE_MS);
});
