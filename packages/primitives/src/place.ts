export type Side = 'top' | 'right' | 'bottom' | 'left';

export type Align = 'start' | 'center' | 'end';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

export type Padding = number | { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };

export interface PlaceOptions {
  readonly side?: Side;
  readonly align?: Align;
  readonly sideOffset?: number;
  readonly alignOffset?: number;
  readonly collisionPadding?: Padding;
}

export interface Placement {
  readonly side: Side;
  readonly align: Align;
  readonly x: number;
  readonly y: number;
  readonly availableWidth: number;
  readonly availableHeight: number;
  readonly origin: Point;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function inset(padding: Padding | undefined): Record<Side, number> {
  if (typeof padding === 'number') return { top: padding, right: padding, bottom: padding, left: padding };
  return { top: padding?.top ?? 0, right: padding?.right ?? 0, bottom: padding?.bottom ?? 0, left: padding?.left ?? 0 };
}

function vertical(side: Side): boolean {
  return side === 'top' || side === 'bottom';
}

function room(side: Side, anchor: Rect, viewport: Size, pad: Record<Side, number>, offset: number): number {
  switch (side) {
    case 'top':
      return anchor.y - offset - pad.top;
    case 'bottom':
      return viewport.height - pad.bottom - (anchor.y + anchor.height) - offset;
    case 'left':
      return anchor.x - offset - pad.left;
    case 'right':
      return viewport.width - pad.right - (anchor.x + anchor.width) - offset;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

export function place(anchor: Rect, floating: Size, viewport: Size, options: PlaceOptions = {}): Placement {
  const pad = inset(options.collisionPadding);
  const offset = options.sideOffset ?? 0;
  const align = options.align ?? 'center';
  const preferred = options.side ?? 'bottom';
  const opposite = OPPOSITE[preferred];
  const length = vertical(preferred) ? floating.height : floating.width;
  const own = room(preferred, anchor, viewport, pad, offset);
  const side = length > own && room(opposite, anchor, viewport, pad, offset) > own ? opposite : preferred;
  const across = vertical(side);

  const start = across ? anchor.x : anchor.y;
  const extent = across ? anchor.width : anchor.height;
  const span = across ? floating.width : floating.height;
  const low = across ? pad.left : pad.top;
  const high = across ? viewport.width - pad.right : viewport.height - pad.bottom;
  const shift = options.alignOffset ?? 0;
  const aligned = align === 'start' ? start + shift : align === 'end' ? start + extent - span - shift : start + (extent - span) / 2 + shift;
  const cross = clamp(aligned, low, high - span);

  const main =
    side === 'bottom'
      ? anchor.y + anchor.height + offset
      : side === 'top'
        ? anchor.y - offset - floating.height
        : side === 'right'
          ? anchor.x + anchor.width + offset
          : anchor.x - offset - floating.width;

  const x = across ? cross : main;
  const y = across ? main : cross;
  const free = Math.max(0, room(side, anchor, viewport, pad, offset));

  return {
    side,
    align,
    x,
    y,
    availableWidth: across ? viewport.width - pad.left - pad.right : free,
    availableHeight: across ? free : viewport.height - pad.top - pad.bottom,
    origin: across
      ? { x: clamp(anchor.x + anchor.width / 2 - x, 0, floating.width), y: side === 'bottom' ? 0 : floating.height }
      : { x: side === 'right' ? 0 : floating.width, y: clamp(anchor.y + anchor.height / 2 - y, 0, floating.height) },
  };
}
