import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
import { SHORT_SHA } from './reading.js';

export type DiffEnd = { readonly at: string; readonly name: string };

export type DiffEnds = { readonly before: DiffEnd; readonly after: DiffEnd };

const HEAD: DiffEnd = { at: 'HEAD', name: 'HEAD' };
const INDEX: DiffEnd = { at: 'index', name: 'the index' };
const WORKING: DiffEnd = { at: 'working', name: 'the working file' };

const short = (revision: string): string => (/^[0-9a-f]{40,64}$/.test(revision) ? revision.slice(0, SHORT_SHA) : revision);

export function endsOf(read: {
  readonly commit: string | null;
  readonly base: string | null;
  readonly side: AuthorshipSide | null;
}): DiffEnds {
  if (read.commit !== null && read.base !== null) {
    return { before: { at: read.base, name: short(read.base) }, after: { at: read.commit, name: short(read.commit) } };
  }
  if (read.commit !== null) {
    return { before: { at: `${read.commit}^`, name: `${short(read.commit)}^` }, after: { at: read.commit, name: short(read.commit) } };
  }
  if (read.side === 'staged') return { before: HEAD, after: INDEX };
  if (read.side === 'unstaged') return { before: INDEX, after: WORKING };
  return { before: HEAD, after: WORKING };
}
