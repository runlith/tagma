import { contentDigest } from '@runlith/files/content';
import type { LineHunk } from '@runlith/files/hunk';
import type { Proven } from './projection.js';
import { tokensOf } from './marks.js';

export type ReleasedSpan = {
  readonly firstLine: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
};

export type ReleasedLine = {
  readonly row: string;
  readonly thread: string;
  readonly reason: string;
  readonly span: ReleasedSpan;
};

export type Release = { readonly thread: string; readonly reason: string };

export function releaseSpan(hunk: LineHunk): ReleasedSpan {
  const digests = (text: string, count: number) =>
    tokensOf(text)
      .slice(hunk.windowBefore, hunk.windowBefore + count)
      .map(contentDigest);
  return { firstLine: hunk.firstLine, before: digests(hunk.oldText, hunk.oldLines), after: digests(hunk.newText, hunk.newLines) };
}

export function releasedOf(verdict: Proven, witnesses: readonly ReleasedLine[]): ReadonlyMap<number, Release> {
  const released = new Map<number, Release>();
  if (verdict.lines === 'unweighed' || witnesses.length === 0) return released;
  const claims = new Map<string, Release>();
  for (const witness of witnesses) {
    for (const [kind, digests] of [
      ['removed', witness.span.before],
      ['added', witness.span.after],
    ] as const) {
      for (const [offset, digest] of digests.entries())
        claims.set(`${kind}:${witness.span.firstLine + offset}:${digest}`, { thread: witness.thread, reason: witness.reason });
    }
  }
  for (const [index, line] of verdict.lines.entries()) {
    if (line.mark !== 'external') continue;
    const release = claims.get(`${line.kind}:${line.at}:${contentDigest(line.text)}`);
    if (release !== undefined) released.set(index, release);
  }
  return released;
}
