import { readFileSync, statSync } from 'node:fs';
import { bytesDigest, contentDigest, contentOf, looksBinaryText, versionContentLimit, withBom } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import type { HunkPair, Hunked, Version } from './walks.js';

const bytesOf = (version: Version): Uint8Array | null => {
  if ('bytes' in version) return version.bytes;
  if (!('file' in version)) return null;
  try {
    if (statSync(version.file).size > versionContentLimit) return null;
    const bytes = readFileSync(version.file);
    return bytesDigest(bytes) === version.digest ? bytes : null;
  } catch {
    return null;
  }
};

const textOf = (version: Version): string | null => {
  if ('text' in version) return looksBinaryText(version.text) ? null : version.text;
  const bytes = bytesOf(version);
  if (bytes === null) return null;
  const content = contentOf(bytes);
  return content.kind === 'text' ? withBom(content) : null;
};

const linesOf = (text: string, normalized: boolean): readonly string[] => {
  const lines = (normalized ? text.replaceAll('\r\n', '\n') : text).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const hasCommonLines = (before: string, after: string, normalized: boolean): boolean => {
  const older = new Set(linesOf(before, normalized));
  return linesOf(after, normalized).some((line) => older.has(line));
};

export const hunked = (pair: HunkPair): Hunked => {
  const before = pair.before === null ? null : textOf(pair.before);
  const after = pair.after === null ? null : textOf(pair.after);
  const standing = pair.after === null ? '' : after;
  const hunk = before === null || standing === null ? null : (workspaceChangeHunk(before, standing, pair.normalized) ?? null);
  const rewritten =
    before === null ||
    standing === null ||
    (hunk !== null &&
      hunk.firstLine === 1 &&
      hunk.oldText === before &&
      hunk.newText === standing &&
      !hasCommonLines(before, standing, pair.normalized));
  return {
    rewritten,
    before,
    after,
    beforeDigest: before === null ? null : contentDigest(before),
    afterDigest: after === null ? null : contentDigest(after),
    hunk,
  };
};
