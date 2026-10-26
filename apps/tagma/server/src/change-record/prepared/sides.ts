import type { TreeEntry } from '@runlith/git/entries';
import type { PreparedEntries } from '../contract/service/prepared.js';

const ABSENT = /^0+$/;

const entryOf = (mode: string, object: string): TreeEntry | null => (ABSENT.test(mode) ? null : { mode, object });

export const rawSides = (base: string, tree: string, raw: string): PreparedEntries => {
  const before = new Map<string, TreeEntry | null>();
  const after = new Map<string, TreeEntry | null>();
  const fields = raw.split('\0');
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [from = '', to = '', was = '', now = ''] = (fields[at] ?? '').replace(/^:/, '').split(' ');
    const path = fields[at + 1] ?? '';
    if (path === '') continue;
    before.set(path, entryOf(from, was));
    after.set(path, entryOf(to, now));
  }
  return { base, tree, before, after };
};

export const stagedSides = (tree: string, listed: string): PreparedEntries => {
  const before = new Map<string, TreeEntry | null>();
  const after = new Map<string, TreeEntry | null>();
  for (const record of listed.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode = '', object = ''] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    before.set(path, null);
    after.set(path, { mode, object });
  }
  return { base: null, tree, before, after };
};
