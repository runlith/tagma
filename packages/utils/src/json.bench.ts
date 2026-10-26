import { partialJsonReader, readPartialJsonState } from './json.js';

const deltaBytes = 2 * 1024;
const sizes = [64, 128, 256].map((kilobytes) => kilobytes * 1024);
const roundsArgument = Bun.argv.find((argument) => argument.startsWith('--rounds='));
const rounds = roundsArgument ? Number.parseInt(roundsArgument.slice('--rounds='.length), 10) : 7;
if (!Number.isSafeInteger(rounds) || rounds <= 0) throw new Error('--rounds must be a positive integer');

function documentOf(bytes: number): string {
  const head = '{"name":"critic","task":"';
  const tail = '"}';
  return head + 'x'.repeat(bytes - head.length - tail.length) + tail;
}

function prefixesOf(document: string): readonly string[] {
  const prefixes: string[] = [];
  for (let end = deltaBytes; end < document.length; end += deltaBytes) prefixes.push(document.slice(0, end));
  prefixes.push(document);
  return prefixes;
}

function chunksOf(document: string): readonly string[] {
  const chunks: string[] = [];
  for (let start = 0; start < document.length; start += deltaBytes) {
    chunks.push(document.slice(start, start + deltaBytes));
  }
  return chunks;
}

function time(read: () => number): { readonly ms: number; readonly checksum: number } {
  const started = Bun.nanoseconds();
  const checksum = read();
  return { ms: (Bun.nanoseconds() - started) / 1e6, checksum };
}

const inputs = sizes.map((bytes) => {
  const document = documentOf(bytes);
  return { bytes, prefixes: prefixesOf(document), chunks: chunksOf(document) };
});

function wholePrefixes(prefixes: readonly string[]): number {
  let observed = 0;
  for (const prefix of prefixes) observed += readPartialJsonState(prefix)?.completedFields.length ?? 0;
  return observed;
}

function resumed(chunks: readonly string[]): number {
  const reader = partialJsonReader();
  let fields: readonly string[] | null = null;
  let complete = false;
  let observed = 0;
  for (const chunk of chunks) {
    const state = reader.push(chunk);
    if (state === undefined || (state.completedFields === fields && state.complete === complete)) continue;
    fields = state.completedFields;
    complete = state.complete;
    if (fields.length > 0 || complete) observed += Object.keys(state.value as object).length;
  }
  return observed + reader.examined;
}

function wholeValues(prefixes: readonly string[]): number {
  let observed = 0;
  for (const prefix of prefixes) observed += Object.keys((readPartialJsonState(prefix)?.value ?? {}) as object).length;
  return observed;
}

function resumedValues(chunks: readonly string[]): number {
  const reader = partialJsonReader();
  let observed = 0;
  for (const chunk of chunks) observed += Object.keys((reader.push(chunk)?.value ?? {}) as object).length;
  return observed + reader.examined;
}

let checksum = 0;
for (const input of inputs) {
  checksum += wholePrefixes(input.prefixes);
  checksum += resumed(input.chunks);
  checksum += wholeValues(input.prefixes);
  checksum += resumedValues(input.chunks);
}

const rows = inputs.flatMap(({ bytes, prefixes, chunks }) =>
  (
    [
      ['whole-prefix', () => wholePrefixes(prefixes)],
      ['resumable', () => resumed(chunks)],
      ['whole-prefix-value', () => wholeValues(prefixes)],
      ['resumable-value', () => resumedValues(chunks)],
    ] as const
  ).map(([mode, read]) => {
    const samples = Array.from({ length: rounds }, () => time(read));
    checksum += samples.reduce((total, sample) => total + sample.checksum, 0);
    const ordered = samples.map((sample) => sample.ms).sort((left, right) => left - right);
    return {
      mode,
      inputBytes: bytes,
      deltaBytes,
      deltas: prefixes.length,
      medianMs: ordered[Math.floor(ordered.length / 2)],
    };
  }),
);

console.log(JSON.stringify({ rounds, checksum, rows }, null, 2));
