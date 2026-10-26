import type { LiveStatus } from '$lib/wire/Live.js';

export type LiveTrouble = { readonly tone: 'warn' | 'bad'; readonly word: string; readonly note: string };

export const LIVE_TROUBLE: Readonly<Record<LiveStatus, LiveTrouble | null>> = {
  open: null,
  idle: null,
  connecting: { tone: 'warn', word: 'connecting…', note: 'Connecting to the live feed' },
  closed: { tone: 'bad', word: 'offline — any action reconnects', note: 'The live feed dropped — the tree may be behind' },
  paused: { tone: 'warn', word: 'paused in background', note: 'Live resumes when you come back to this page' },
  refused: { tone: 'bad', word: 'not paired', note: 'The server refused this device until it is paired again' },
};
