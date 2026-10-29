import type { Recording, Rect, RowSignature } from './recording';

export type Cause = 'reference' | 'image' | 'markup' | 'text' | 'font' | 'other';
export type CauseAllowance = 'width' | 'disclosure' | 'live-growth' | null;
export type CauseChange = {
  frame: number;
  key: string;
  before: number;
  after: number;
  delta: number;
  cause: Cause;
  allowance: CauseAllowance;
};
export type CauseUnchecked = { frame: number; key: string | null; reason: 'insufficient-frames' | 'invalid-geometry' | 'duplicate-key' };
export type CauseEvidence = { changes: CauseChange[]; failures: CauseChange[]; unchecked: CauseUnchecked[] };

function finite(rect: Rect): boolean {
  return Object.values(rect).every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;
}

function visible(rect: Rect, viewport: Rect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > viewport.top &&
    rect.top < viewport.bottom &&
    rect.right > viewport.left &&
    rect.left < viewport.right
  );
}

function cause(before: RowSignature, after: RowSignature): Cause {
  if (before.anchors.length !== after.anchors.length || before.anchors.some((text, index) => text !== after.anchors[index]))
    return 'reference';
  if (
    before.images.length !== after.images.length ||
    before.images.some((image, index) => {
      const next = after.images[index];
      return (
        next === undefined ||
        image.source !== next.source ||
        image.complete !== next.complete ||
        image.width !== next.width ||
        image.height !== next.height
      );
    })
  )
    return 'image';
  if (before.structure !== after.structure) return 'markup';
  if (before.text !== after.text) return 'text';
  if (before.font !== after.font || before.fonts !== after.fonts) return 'font';
  return 'other';
}

export function causes(recording: Recording): CauseEvidence {
  const result: CauseEvidence = { changes: [], failures: [], unchecked: [] };
  if (recording.frames.length < 2) result.unchecked.push({ frame: 0, key: null, reason: 'insufficient-frames' });
  for (let frame = 1; frame < recording.frames.length; frame += 1) {
    const previous = recording.frames[frame - 1]!;
    const current = recording.frames[frame]!;
    if (!finite(previous.viewport) || !finite(current.viewport)) {
      result.unchecked.push({ frame, key: null, reason: 'invalid-geometry' });
      continue;
    }
    const before = new Map(previous.rows.map((row) => [row.key, row]));
    const after = new Map(current.rows.map((row) => [row.key, row]));
    const duplicates = new Set<string>();
    for (const rows of [previous.rows, current.rows]) {
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.key)) duplicates.add(row.key);
        seen.add(row.key);
      }
    }
    for (const key of duplicates) result.unchecked.push({ frame, key, reason: 'duplicate-key' });
    for (const [key, row] of after) {
      const old = before.get(key);
      if (old === undefined || duplicates.has(key)) continue;
      if (!finite(old.rect) || !finite(row.rect)) {
        result.unchecked.push({ frame, key, reason: 'invalid-geometry' });
        continue;
      }
      if (!visible(old.rect, previous.viewport) && !visible(row.rect, current.viewport)) continue;
      const delta = row.rect.height - old.rect.height;
      if (delta === 0) continue;
      const wasAnimating = previous.controlRow === key && previous.controlAnimating;
      const disclosure =
        wasAnimating ||
        (current.controlRow === key &&
          (current.controlAnimating ||
            (previous.controlExpanded !== null &&
              current.controlExpanded !== null &&
              previous.controlExpanded !== current.controlExpanded)));
      const allowance: CauseAllowance =
        old.rect.width !== row.rect.width
          ? 'width'
          : disclosure
            ? 'disclosure'
            : row.live && delta > 0 && old.signature.text !== row.signature.text
              ? 'live-growth'
              : null;
      const change: CauseChange = {
        frame,
        key,
        before: old.rect.height,
        after: row.rect.height,
        delta,
        cause: cause(old.signature, row.signature),
        allowance,
      };
      result.changes.push(change);
      if (allowance === null) result.failures.push(change);
    }
  }
  return result;
}
