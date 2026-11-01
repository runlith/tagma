import { mapFilePatches } from '../tool/display';
import type { ThreadToolEntry } from './entries';
import type { ThreadOpenEntry } from './live';
import type { ThreadTranscriptEntry } from './rows';
import { coreEntry } from './kinds';

export const WIRE_ENTRY_MAX_BYTES = 64 * 1024;

export const WIRE_PAGE_MAX_ENTRIES = 200;
export const WIRE_PAGE_MAX_BYTES = 1024 * 1024;

export function capTranscriptEntry(entry: ThreadTranscriptEntry): ThreadTranscriptEntry {
  return coreEntry(entry) && entry.type === 'tool' ? cappedTool(entry, weigh(entry)) : entry;
}

export function wireWeight(entry: ThreadTranscriptEntry): number {
  const size = weigh(entry);
  if (!coreEntry(entry) || entry.type !== 'tool' || size <= WIRE_ENTRY_MAX_BYTES) return size;
  return weigh(cappedTool(entry, size));
}

function cappedTool(tool: ThreadToolEntry, weighed: number): ThreadToolEntry {
  let size = weighed;
  if (size <= WIRE_ENTRY_MAX_BYTES) return tool;

  let withheld = 0;
  let capped: ThreadToolEntry = tool;
  if (tool.toolOutput !== undefined) {
    const output = weigh(tool.toolOutput);
    withheld += output;
    size -= output;
    const { toolOutput: _output, ...rest } = capped;
    capped = rest;
  }
  if (size > WIRE_ENTRY_MAX_BYTES && capped.toolDisplay) {
    const display = emptyBody(capped.toolDisplay);
    const freed = weigh(capped.toolDisplay) - weigh(display);
    withheld += freed;
    size -= freed;
    capped = { ...capped, toolDisplay: display };
  }
  if (size > WIRE_ENTRY_MAX_BYTES && capped.toolInput !== undefined) {
    withheld += weigh(capped.toolInput);
    const { toolInput: _input, ...rest } = capped;
    capped = rest;
  }
  if (withheld === 0) return tool;
  const named = capped.toolDisplay ? { ...capped, toolDisplay: withFact(capped.toolDisplay, withheld) } : capped;
  return { ...named, truncated: withheld };
}

export function capTranscript(transcript: readonly ThreadTranscriptEntry[]): readonly ThreadTranscriptEntry[] {
  let capped: ThreadTranscriptEntry[] | null = null;
  for (let index = 0; index < transcript.length; index += 1) {
    const entry = transcript[index];
    if (entry === undefined) continue;
    const bounded = capTranscriptEntry(entry);
    if (bounded === entry) {
      capped?.push(entry);
      continue;
    }
    capped ??= transcript.slice(0, index);
    capped.push(bounded);
  }
  return capped ?? transcript;
}

export function capOpenEntries(open: readonly ThreadOpenEntry[]): readonly ThreadOpenEntry[] {
  return open.map((one) => {
    const entry = capTranscriptEntry(one.entry);
    return entry === one.entry ? one : { entry, from: one.from };
  });
}

function withFact(display: NonNullable<ThreadToolEntry['toolDisplay']>, withheld: number): NonNullable<ThreadToolEntry['toolDisplay']> {
  return { ...display, facts: [...(display.facts ?? []), { label: 'withheld', value: bytes(withheld) }] };
}

function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function emptyBody(display: NonNullable<ThreadToolEntry['toolDisplay']>): NonNullable<ThreadToolEntry['toolDisplay']> {
  switch (display.form) {
    case 'text':
    case 'markdown':
    case 'message':
      return { ...display, text: '' };
    case 'code':
      return { ...display, text: '' };
    case 'command':
      return display.output === undefined ? display : { ...display, output: '' };
    case 'diff':
      return { ...display, files: mapFilePatches(display.files, (file) => ({ ...file, patch: '' })) };
    case 'list':
      return { ...display, items: [] };
    default:
      return display;
  }
}

function weigh(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}
