import type { Anchor, Frame, Rect, RowRect } from './recording';

type Band = { rows: RowRect[]; index: Map<string, number>; heights: number[]; faults: number[]; gaps: number[] };
type Endpoint = { anchor: Anchor; offset: number; band: Band };

export type AnchorIssue = {
  frame: number;
  row: string | null;
  reason: 'anchor-unobserved' | 'anchor-changed' | 'anchor-region' | 'anchor-inset';
};
export type ExpectedMotion = { pixels: number };
export type AnchorFlow = { identity: string; shift: number; expected(row: string): ExpectedMotion | AnchorIssue };

function finite(rect: Rect): boolean {
  return Object.values(rect).every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;
}

function coincident(a: number, b: number): boolean {
  return Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 16;
}

function bandOf(frame: Frame): Band {
  const rows = [...frame.rows].sort((a, b) => a.rect.top - b.rect.top);
  const index = new Map<string, number>();
  const heights = [0];
  const faults = [0];
  const gaps = [0];
  const sane = rows.every((row) => finite(row.rect));
  for (const [at, row] of rows.entries()) {
    const rect = row.rect;
    const malformed = !sane || !coincident(rect.bottom - rect.top, rect.height) || index.has(row.key);
    const previous = rows[at - 1];
    heights.push(heights[at]! + (Number.isFinite(rect.height) ? rect.height : 0));
    faults.push(faults[at]! + Number(malformed));
    gaps.push(gaps[at]! + Number(previous !== undefined && !coincident(previous.rect.bottom, rect.top)));
    index.set(row.key, at);
  }
  return { rows, index, heights, faults, gaps };
}

function endpoint(anchor: Anchor, frame: Frame, index: number): Endpoint | AnchorIssue {
  const band = bandOf(frame);
  const at = band.index.get(anchor.row);
  if (!finite(anchor.rect) || at === undefined || band.faults[at + 1]! !== band.faults[at]!) {
    return { frame: index, row: anchor.row, reason: 'anchor-unobserved' };
  }
  const row = band.rows[at]!.rect;
  if (
    (anchor.kind === 'paused' && !coincident(anchor.rect.top, row.top)) ||
    (anchor.kind === 'following' && !coincident(anchor.rect.bottom, row.bottom))
  ) {
    return { frame: index, row: anchor.row, reason: 'anchor-region' };
  }
  const offset = anchor.kind === 'following' ? row.height : anchor.kind === 'paused' ? 0 : anchor.rect.top - row.top;
  if (offset < 0 || offset > row.height) return { frame: index, row: anchor.row, reason: 'anchor-region' };
  return { anchor, offset, band };
}

function position(endpoint: Endpoint, row: string, frame: number): ExpectedMotion | AnchorIssue {
  const band = endpoint.band;
  const anchor = band.index.get(endpoint.anchor.row)!;
  const target = band.index.get(row);
  if (target === undefined) return { frame, row, reason: 'anchor-region' };
  const from = Math.min(anchor, target);
  const to = Math.max(anchor, target);
  if (band.faults[to + 1]! !== band.faults[from]! || band.gaps[to + 1]! !== band.gaps[from + 1]!) {
    return { frame, row, reason: 'anchor-region' };
  }
  const pixels = band.heights[target]! - band.heights[anchor]! - endpoint.offset;
  return Number.isFinite(pixels) ? { pixels } : { frame, row, reason: 'anchor-region' };
}

export function anchorFlow(previous: Frame, current: Frame, frame: number): AnchorFlow | AnchorIssue {
  const after = current.anchor;
  let before = previous.anchor;
  if (after === null) return { frame, row: null, reason: 'anchor-unobserved' };
  const disclosure = after.kind === 'disclosure' && current.controlRow === after.row;
  if (disclosure && (before?.kind !== 'disclosure' || before.row !== after.row)) {
    if (previous.control === null) return { frame, row: after.row, reason: 'anchor-unobserved' };
    before = { kind: 'disclosure', row: after.row, rect: previous.control };
  }
  if (before === null) return { frame, row: after.row, reason: 'anchor-unobserved' };
  if (before.kind !== after.kind || (after.kind !== 'following' && before.row !== after.row)) {
    return { frame, row: after.row, reason: 'anchor-changed' };
  }
  const oldEndpoint = endpoint(before, previous, frame);
  if ('reason' in oldEndpoint) return oldEndpoint;
  const newEndpoint = endpoint(after, current, frame);
  if ('reason' in newEndpoint) return newEndpoint;
  const following = after.kind === 'following';
  if (following && (!Number.isFinite(previous.viewport.bottom) || !Number.isFinite(current.viewport.bottom))) {
    return { frame, row: after.row, reason: 'anchor-region' };
  }
  const viewport = following ? current.viewport.bottom - previous.viewport.bottom : 0;
  const shift = following ? after.rect.bottom - before.rect.bottom - viewport : after.rect.top - before.rect.top;
  const insetChanged = disclosure && !coincident(oldEndpoint.offset, newEndpoint.offset);
  return {
    identity: following ? 'following' : `${after.kind}:${after.row}`,
    shift,
    expected: (row) => {
      if (insetChanged) return { frame, row, reason: 'anchor-inset' };
      const oldPosition = position(oldEndpoint, row, frame);
      if ('reason' in oldPosition) return oldPosition;
      const newPosition = position(newEndpoint, row, frame);
      if ('reason' in newPosition) return newPosition;
      return { pixels: newPosition.pixels - oldPosition.pixels + viewport };
    },
  };
}
