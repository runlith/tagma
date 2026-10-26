import { family } from '@runlith/paging';
import { Schema } from 'effect';

export const CONSOLE_LEVELS = ['error', 'warning', 'info', 'log', 'debug'] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export const ENTRY_CHARS = 2_000;

export const ConsoleEntry = Schema.Struct({
  seq: Schema.Int,
  level: Schema.Literals(CONSOLE_LEVELS),
  source: Schema.String,
  text: Schema.String,
  url: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Int),
  at: Schema.String,
});
export type ConsoleEntry = typeof ConsoleEntry.Type;

export const NetworkEntry = Schema.Struct({
  seq: Schema.Int,
  request: Schema.String,
  method: Schema.String,
  url: Schema.String,
  type: Schema.String,
  status: Schema.NullOr(Schema.Int),
  mime: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Number),
  failure: Schema.NullOr(Schema.String),
  at: Schema.String,
  ms: Schema.NullOr(Schema.Number),
});
export type NetworkEntry = typeof NetworkEntry.Type;

export const CONSOLE_ROWS = family('page-console', 1, 'json', { text: 420, json: 420 }, 50, () => ({
  seq: 1_204,
  level: 'error',
  source: 'console',
  text: 'x'.repeat(240),
  url: `http://127.0.0.1:5173/${'x'.repeat(40)}.js`,
  line: 412,
  at: '2026-10-17T03:10:36.514Z',
}));

export const NETWORK_ROWS = family('page-network', 1, 'json', { text: 360, json: 360 }, 50, () => ({
  seq: 1_204,
  request: '12345.67',
  method: 'POST',
  url: `https://example.com/${'x'.repeat(120)}`,
  type: 'Fetch',
  status: 200,
  mime: 'application/json',
  bytes: 48_213,
  failure: null,
  at: '2026-10-17T03:10:36.514Z',
  ms: 182,
}));

export const DOWNLOADS_KEPT = 50;

export const DOWNLOAD_ROWS = family('page-downloads', 1, 'json', { text: 300, json: 300 }, 20, () => ({
  id: '8f1c2d3e-4b5a-6978-8091-a2b3c4d5e6f7',
  name: `${'x'.repeat(60)}.zip`,
  path: `/Users/someone/Library/Application Support/Tagma/browser/downloads/managed-agent/${'x'.repeat(36)}`,
  bytes: 48_213_000,
  state: 'done',
  at: '2026-10-17T03:10:36.514Z',
}));

export const PAGE_ROWS = family('pages', 1, 'json', { text: 700, json: 700 }, 20, () => ({
  id: '01a147d6-ffd5-7df1-92f6-4999dc1c6e94',
  projectId: 5,
  profile: 'managed-agent',
  url: `https://example.com/${'x'.repeat(120)}`,
  title: 'x'.repeat(80),
  favicon: `https://example.com/${'x'.repeat(40)}`,
  openedBy: '01a147d6-ffd5-7df1-92f6-4999dc1c6e94',
  opener: null,
  state: 'live',
  host: '01a147d6-ffd5-7df1-92f6-4999dc1c6e94',
  live: { loading: false, back: true, forward: false, crashed: false, responsive: true, dialog: null, driven: null, shown: false },
  downloads: 3,
  activeAt: '2026-10-17T03:10:36.514Z',
  closedAt: null,
}));

export const SNAPSHOT_LINES = family(
  'snapshot-lines',
  1,
  'text',
  { text: 60, json: 60 },
  'ceiling',
  () => `      - link "${'x'.repeat(30)}" [ref=e1204]`,
);

export const BODY_CHARS = 40_000;

export const PICTURE_BYTES = 5 * 1024 * 1024;

export const EVALUATED_CHARS = 40_000;
