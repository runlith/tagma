import { bytesDigest, contentDigest, versionContentLimit } from './content';
import { type LineHunk, workspaceChangeHunk } from './hunk';
import type { Standing } from './replace';

export type WriteProvenance = 'edit' | 'write' | 'delete';

export type ChangeTarget = 'entry' | 'resource';

export type WorkspaceChange = {
  readonly origin: WriteProvenance;
  readonly target?: ChangeTarget;
  readonly path: string;
  readonly at: Date;
  readonly hunk?: LineHunk;
  readonly before?: string;
  readonly after?: string;
  readonly beforeText?: string;
  readonly afterText?: string;
  readonly mode?: string;
  readonly movedFrom?: string;
};

const EMPTY = new Uint8Array();

const bytesOf = (standing: Standing): Uint8Array =>
  'bytes' in standing ? standing.bytes : 'link' in standing ? new TextEncoder().encode(standing.link) : EMPTY;

export type ChangeSide = { readonly digest: string; readonly text: string; readonly bytes: number };

export function changeFrom(
  origin: WriteProvenance,
  path: string,
  at: Date,
  before: ChangeSide,
  after: ChangeSide,
  hunk: LineHunk | undefined,
): WorkspaceChange {
  const whole = before.bytes <= versionContentLimit && after.bytes <= versionContentLimit;
  return {
    origin,
    path,
    at,
    hunk,
    before: before.digest,
    after: after.digest,
    beforeText: whole ? before.text : undefined,
    afterText: whole ? after.text : undefined,
  };
}

export function changeOf(
  origin: WriteProvenance,
  path: string,
  standing: Standing,
  before: string,
  after: string,
  normalized: boolean,
  at: Date,
): WorkspaceChange {
  return changeFrom(
    origin,
    path,
    at,
    { digest: bytesDigest(bytesOf(standing)), text: before, bytes: Buffer.byteLength(before, 'utf8') },
    { digest: contentDigest(after), text: after, bytes: Buffer.byteLength(after, 'utf8') },
    workspaceChangeHunk(before, after, normalized),
  );
}
