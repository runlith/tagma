export type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export type ScrollState = {
  bottom: boolean;
  jump: boolean;
  overflow: boolean;
};

export const BOTTOM_THRESHOLD = 12;

export function wheelDistance(input: { deltaY: number; deltaMode: number; rootHeight: number }): number {
  if (input.deltaMode === 1) return input.deltaY * 40;
  if (input.deltaMode === 2) return input.deltaY * input.rootHeight;
  return input.deltaY;
}

export function wheelCrossesOut(input: ScrollMetrics & { delta: number }): boolean {
  const max = input.scrollHeight - input.clientHeight;
  if (max <= 1) return true;
  if (!input.delta) return false;
  if (input.delta < 0) return input.scrollTop + input.delta <= 0;
  return input.delta > max - input.scrollTop;
}

export function bottomDistance(metrics: ScrollMetrics): number {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
}

export function canScroll(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.clientHeight > 1;
}

export function isAtBottom(metrics: ScrollMetrics, threshold = BOTTOM_THRESHOLD): boolean {
  return bottomDistance(metrics) <= threshold;
}

export function jumpThreshold(clientHeight: number): number {
  return Math.max(400, clientHeight);
}

export function readScrollState(metrics: ScrollMetrics): ScrollState {
  const overflow = canScroll(metrics);
  const distance = bottomDistance(metrics);
  return {
    bottom: !overflow || distance <= 2,
    jump: overflow && distance > jumpThreshold(metrics.clientHeight),
    overflow,
  };
}

export type OverflowAnchoring = 'dynamic' | 'none';

export function applyOverflowAnchor(element: HTMLElement, mode: OverflowAnchoring, userScrolled: boolean): void {
  element.style.overflowAnchor = mode === 'dynamic' && userScrolled ? 'auto' : 'none';
}

export function selectionInside(selection: Selection | null, content: HTMLElement): boolean {
  if (!selection || selection.toString().length === 0) return false;

  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean((anchor && content.contains(anchor)) || (focus && content.contains(focus)));
}
