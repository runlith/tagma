import { applyPatches, cleanupEfficiency, cleanupSemantic, makeDiff, makePatches } from '@sanity/diff-match-patch';

const RECONCILE_SIZE_CAP_CODE_UNITS = 50_000;

const RECONCILE_DIFF_TIMEOUT_SECONDS = 0.01;

export type ReconcileMarkdownParams = {
  originalSource: string;
  baseCanonical: string;
  edited: string;
  roundTrip: (markdown: string) => string | null;
};

export function reconcileMarkdown({ originalSource, baseCanonical, edited, roundTrip }: ReconcileMarkdownParams): string {
  if (edited === baseCanonical) {
    return originalSource;
  }

  const eol = detectDominantEol(originalSource);
  const originalSourceLf = toLf(originalSource);
  const baseLf = toLf(baseCanonical);
  const editedLf = toLf(edited);

  const originalTrailingNewlines = originalSourceLf.match(/\n+$/)?.[0] ?? '';
  if (
    originalTrailingNewlines.length <= 1 &&
    !editedLf.endsWith('\n') &&
    stripTrailingNewlines(originalSourceLf) === stripTrailingNewlines(baseLf)
  ) {
    return restoreEol(editedLf + originalTrailingNewlines, eol);
  }

  if (Math.max(originalSource.length, baseCanonical.length, edited.length) > RECONCILE_SIZE_CAP_CODE_UNITS) {
    return restoreEol(editedLf, eol);
  }

  if (hasRepeatedHalfMatchSeed(baseLf, editedLf)) {
    return restoreEol(editedLf, eol);
  }
  let diffs = makeDiff(baseLf, editedLf, {
    checkLines: true,
    timeout: RECONCILE_DIFF_TIMEOUT_SECONDS,
  });
  if (diffs.length > 2) {
    diffs = cleanupSemantic(diffs);
    diffs = cleanupEfficiency(diffs);
  }
  const patches = makePatches(baseLf, diffs);
  const utf8Offsets = getUtf8OffsetsAtCodeUnitIndices(
    originalSourceLf,
    patches.flatMap((patch) => [patch.start1, patch.start2]),
  );
  for (const patch of patches) {
    patch.start1 = utf8Offsets.get(patch.start1) ?? 0;
    patch.start2 = utf8Offsets.get(patch.start2) ?? 0;
  }
  const [reconciledLf, results] = applyPatches(patches, originalSourceLf);

  if (results.some((applied) => !applied)) {
    return restoreEol(editedLf, eol);
  }

  const reparsed = roundTrip(reconciledLf);
  if (reparsed === null || normalizeForSafety(reparsed) !== normalizeForSafety(editedLf)) {
    return restoreEol(editedLf, eol);
  }

  return restoreEol(reconciledLf, eol);
}

function stripTrailingNewlines(lfText: string): string {
  return lfText.replace(/\n+$/, '');
}

function detectDominantEol(text: string): '\n' | '\r\n' {
  const totalLf = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lfOnly = totalLf - crlf;
  return crlf > 0 && crlf >= lfOnly ? '\r\n' : '\n';
}

function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function restoreEol(lfText: string, eol: '\n' | '\r\n'): string {
  return eol === '\r\n' ? lfText.replace(/\n/g, '\r\n') : lfText;
}

function normalizeForSafety(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function getUtf8OffsetsAtCodeUnitIndices(text: string, codeUnitIndices: number[]): Map<number, number> {
  const targets = [...new Set(codeUnitIndices)].sort((a, b) => a - b);
  const offsets = new Map<number, number>();
  let codeUnitIndex = 0;
  let byteOffset = 0;
  for (const target of targets) {
    const boundedTarget = Math.max(0, Math.min(target, text.length));
    while (codeUnitIndex < boundedTarget) {
      const codePoint = text.codePointAt(codeUnitIndex);
      if (codePoint === undefined) {
        break;
      }
      byteOffset += utf8CodePointLength(codePoint);
      codeUnitIndex += codePoint > 0xffff ? 2 : 1;
    }
    offsets.set(target, byteOffset);
  }
  return offsets;
}

function utf8CodePointLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function hasRepeatedHalfMatchSeed(textA: string, textB: string): boolean {
  const minimumLength = Math.min(textA.length, textB.length);
  let prefixLength = 0;
  while (prefixLength < minimumLength && textA.charCodeAt(prefixLength) === textB.charCodeAt(prefixLength)) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < minimumLength - prefixLength &&
    textA.charCodeAt(textA.length - suffixLength - 1) === textB.charCodeAt(textB.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }
  const middleA = textA.slice(prefixLength, textA.length - suffixLength);
  const middleB = textB.slice(prefixLength, textB.length - suffixLength);
  const longText = middleA.length > middleB.length ? middleA : middleB;
  const shortText = middleA.length > middleB.length ? middleB : middleA;
  if (longText.length < 4 || shortText.length * 2 < longText.length) {
    return false;
  }

  const seedLength = Math.floor(longText.length / 4);
  for (const start of [Math.ceil(longText.length / 4), Math.ceil(longText.length / 2)]) {
    const seed = longText.slice(start, start + seedLength);
    const firstMatch = shortText.indexOf(seed);
    if (firstMatch !== -1 && shortText.includes(seed, firstMatch + 1)) {
      return true;
    }
  }
  return false;
}
