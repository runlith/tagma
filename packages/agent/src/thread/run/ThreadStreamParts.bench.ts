import { WIRE_ENTRY_MAX_BYTES } from '../../transcript/cap';
import type { ThreadInterruptedInput } from '../../transcript/entries';
import { ThreadFactQueue } from './ThreadFactQueue';
import { ThreadStreamParts } from './ThreadStreamParts';

const deltaChars = 64;
const flushChars = 4 * 1024;
const sizes = [256 * 1024, 1024 * 1024];

function retainedOf(text: string): ThreadInterruptedInput {
  return text.length <= WIRE_ENTRY_MAX_BYTES
    ? { kind: 'text', text, complete: false }
    : { kind: 'retained', outputId: 'open', byteLength: text.length, complete: false };
}

type Sample = { readonly flushes: number; readonly partsMs: number; readonly tailJsonMs: number };

function stream(chars: number): Sample {
  const parts = new ThreadStreamParts('run-1', new ThreadFactQueue(), []);
  const input = `{"filePath":"/tmp/a.ts","content":"${'x\\n'.repeat(chars / 3)}`;
  const answer = 'Line of the answer.\r\n'.repeat(chars / 21);
  parts.startToolInput('call-1', 'write');
  parts.start('text', 'text-1');
  let flushes = 0;
  let partsNs = 0;
  let jsonNs = 0;
  let next = flushChars;
  for (let at = 0; at < input.length; at += deltaChars) {
    const started = Bun.nanoseconds();
    parts.appendToolInput('call-1', 'write', input.slice(at, at + deltaChars));
    parts.append('text', 'text-1', answer.slice(at, at + deltaChars));
    if (at + deltaChars < next) {
      partsNs += Bun.nanoseconds() - started;
      continue;
    }
    next += flushChars;
    const open = parts.openToolInputs()[0];
    const kept = open ? retainedOf(open.inputText) : null;
    if (open && kept) parts.holdToolInput(open.toolCallId, { input: kept, chars: open.inputText.length });
    const tail = parts.tail(() => undefined, new Map(open && kept ? [[open.toolCallId, kept]] : []));
    const built = Bun.nanoseconds();
    partsNs += built - started;
    JSON.stringify(tail);
    jsonNs += Bun.nanoseconds() - built;
    flushes += 1;
  }
  return { flushes, partsMs: partsNs / 1e6, tailJsonMs: jsonNs / 1e6 };
}

const median = (values: readonly number[]): number => Number(([...values].sort((a, b) => a - b)[2] ?? 0).toFixed(2));

const rows = sizes.map((chars) => {
  const samples = Array.from({ length: 5 }, () => stream(chars));
  return {
    inputChars: chars,
    deltaChars,
    flushChars,
    flushes: samples[0]?.flushes,
    partsMedianMs: median(samples.map((sample) => sample.partsMs)),
    tailJsonMedianMs: median(samples.map((sample) => sample.tailJsonMs)),
  };
});

console.log(JSON.stringify({ rows }, null, 2));
