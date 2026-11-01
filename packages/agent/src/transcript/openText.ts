import { WIRE_PAGE_MAX_BYTES } from './cap';
import { coreEntry } from './kinds';
import type { ThreadOpenEntry, ThreadOpenText } from './live';
import type { ThreadTranscriptEntry } from './rows';

export const OPEN_WINDOW = 64 * 1024;

//! A UTF-16 unit is at most six JSON bytes (\uXXXX); an eighth of the page keeps a quarter of it for the frame around the text.
export const OPEN_TEXT_MAX = Math.floor(WIRE_PAGE_MAX_BYTES / 8);

export function openText(entry: ThreadTranscriptEntry): string | null {
  if (!coreEntry(entry)) return null;
  if (entry.type === 'tool') {
    const raw = entry.toolInputRaw;
    return raw?.kind === 'text' ? raw.text : null;
  }
  return entry.type === 'message' || entry.type === 'reasoning' ? entry.text : null;
}

export function withOpenText(entry: ThreadTranscriptEntry, text: string): ThreadTranscriptEntry {
  if (!coreEntry(entry)) return entry;
  if (entry.type === 'tool') {
    const raw = entry.toolInputRaw;
    return raw?.kind === 'text' ? { ...entry, toolInputRaw: { ...raw, text } } : entry;
  }
  return entry.type === 'message' || entry.type === 'reasoning' ? { ...entry, text } : entry;
}

export function appendedEntry(entry: ThreadTranscriptEntry, text: string): ThreadTranscriptEntry {
  const held = openText(entry);
  return held === null ? entry : withOpenText(entry, held + text);
}

export function openWindow(entry: ThreadTranscriptEntry, window: number = OPEN_WINDOW): ThreadOpenEntry {
  const text = openText(entry);
  if (text === null || text.length <= window) return { entry, from: 0 };
  let from = text.length - window;
  if (splitsPair(text, from)) from += 1;
  return { entry: withOpenText(entry, text.slice(from)), from };
}

export function joinedOpen(held: ThreadOpenEntry | undefined, open: ThreadOpenEntry): ThreadOpenEntry {
  if (held === undefined || open.from === 0 || held.from >= open.from) return open;
  const before = openText(held.entry);
  const after = openText(open.entry);
  if (before === null || after === null || held.from + before.length < open.from) return open;
  return { entry: withOpenText(open.entry, before.slice(0, open.from - held.from) + after), from: held.from };
}

export function openSlice(text: string, from: number, limit: number): ThreadOpenText {
  let start = Math.min(from, text.length);
  if (splitsPair(text, start)) start += 1;
  let end = Math.max(start, Math.min(text.length, from + limit));
  if (splitsPair(text, end)) end -= 1;
  return { text: text.slice(start, end), from: start, length: text.length };
}

function splitsPair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  const high = text.charCodeAt(at - 1);
  const low = text.charCodeAt(at);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}
