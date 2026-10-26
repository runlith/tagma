import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { bytesDigest, contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { makePathSet, type PathSet } from '../finding/pathSet.js';
import { lineEdits } from '../documents/edits.js';
import { orderOf } from '../listing/order.js';
import { CANCEL_SLOTS, type Digested, type FilesAnswer, type FilesAsk, type FilesEnvelope, type FilesReply } from './protocol.js';

declare const self: Worker;

type Held = { readonly generation: number; readonly set: PathSet };

const sets = new Map<string, Held>();

const answer = (ask: FilesAsk): FilesReply => {
  switch (ask.kind) {
    case 'load': {
      const held = sets.get(ask.root);
      if (held !== undefined && held.generation > ask.generation) return { kind: 'absent' };
      const set = makePathSet();
      set.load(ask.paths);
      sets.set(ask.root, { generation: ask.generation, set });
      return { kind: 'done' };
    }
    case 'patch': {
      const held = sets.get(ask.root);
      if (held === undefined || held.generation !== ask.generation) return { kind: 'absent' };
      held.set.patch(ask.scanned, ask.found);
      return { kind: 'done' };
    }
    case 'find': {
      const held = sets.get(ask.root);
      if (held === undefined || held.generation !== ask.generation) return { kind: 'absent' };
      return { kind: 'found', ...held.set.find(ask.query, ask.limit, ask.recent) };
    }
    case 'drop': {
      const held = sets.get(ask.root);
      if (held !== undefined && held.generation <= ask.generation) sets.delete(ask.root);
      return { kind: 'done' };
    }
    case 'order':
      return { kind: 'ordered', order: orderOf(ask.names, ask.dirs) };
    case 'diff':
      return { kind: 'edited', edits: lineEdits(ask.before, ask.after) };
    case 'digest':
      return { kind: 'digested', digests: ask.paths.map(digestAt) };
    case 'hash':
      return { kind: 'hashed', digest: bytesDigest(ask.bytes) };
    case 'change':
      return {
        kind: 'changed',
        digest: contentDigest(ask.after),
        hunk: workspaceChangeHunk(ask.before, ask.after, ask.normalized) ?? null,
      };
  }
};

const digestAt = (path: string): Digested => {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) return bytesDigest(new TextEncoder().encode(readlinkSync(path)));
    return entry.isFile() ? bytesDigest(readFileSync(path)) : null;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
    return { unread: cause instanceof Error ? cause.message : String(cause) };
  }
};

self.addEventListener('message', (event: MessageEvent<FilesEnvelope>) => {
  const { id, cancelled, ask } = event.data;
  if (Atomics.load(new Int32Array(cancelled), id % CANCEL_SLOTS) === id) return;
  const reply: FilesAnswer = { id, reply: answer(ask) };
  self.postMessage(reply);
});
